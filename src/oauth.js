// MUCHI — Google Sign-In + YouTube authorization on Cloudflare Workers.
// Ported from server.js (lines 1493–1658) with D1/KV-backed state.
//
// DEVIATION FIXED FROM server.js (documented, see MIGRATION.md §6):
//   server.js:218 setSessionCookie() stores the RAW sid, while readSession()
//   (server.js:87–95) requires "sid.signature" — so web cookie auth NEVER
//   resolved a session on Render (masked by the ephemeral-FS bug; it would
//   have surfaced on any persistent host). The Worker stores the FULL signed
//   token in the cookie. Native Bearer deep-link flow is byte-identical.
//
// oauth `state` lives in D1 (strong consistency — a callback can hit a
// different edge PoP than the /url request; KV eventual consistency could
// drop single-use state). KV is used only for the long-TTL bounded caches.

import { createHmac, randomBytes } from "node:crypto";
import { APP_NAME, APP_VERSION, authConfig, SESSION_TTL_MS, corsHeaders } from "./config.js";
import { json, redirect } from "./util.js";
import { decodeIdToken } from "./parse.js";
import { sidFromToken, sessionToken } from "./auth.js";
import { getSession, putSession, deleteSession, putOAuthState, takeOAuthState } from "./db.js";

// ── session lookup: Bearer token or muchi_sid cookie → D1 row ──
export async function readSession(request, env) {
  const auth = request.headers.get("authorization") || "";
  let token = null;
  if (auth.startsWith("Bearer ")) {
    token = auth.slice(7).trim();
  } else {
    const cookies = String(request.headers.get("cookie") || "");
    const m = cookies.match(/(?:^|;\s*)muchi_sid=([^;]+)/);
    if (m) token = decodeURIComponent(m[1]);
  }
  if (!token) return null;
  const sid = sidFromToken(token, env.MUCHI_SESSION_SECRET);
  if (!sid) return null;
  return getSession(env, sid);
}

export function sessionCookie(sid, secret) {
  const token = sessionToken(sid, secret);
  return `muchi_sid=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

export function clearSessionCookie() {
  return "muchi_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
}

function withCookie(res, cookie) {
  const r = new Response(res.body, res);
  r.headers.append("Set-Cookie", cookie);
  return r;
}

// ── Google OAuth plumbing (server.js:151–233) ──
async function googleExchange(code, env) {
  const { googleClientId, googleClientSecret, googleRedirectUri } = authConfig(env);
  try {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: googleClientId,
        client_secret: googleClientSecret,
        redirect_uri: googleRedirectUri,
        grant_type: "authorization_code",
      }).toString(),
    });
    if (!r.ok) {
      const t = await r.text();
      console.error("google token exchange failed", r.status, String(t).slice(0, 200));
      return null;
    }
    return await r.json();
  } catch (e) {
    console.error("google token exchange error", e);
    return null;
  }
}

async function googleRefresh(session, env) {
  const { googleClientId, googleClientSecret } = authConfig(env);
  if (!session.yt || !session.yt.refresh) return false;
  try {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: googleClientId,
        client_secret: googleClientSecret,
        refresh_token: session.yt.refresh,
        grant_type: "refresh_token",
      }).toString(),
    });
    if (!r.ok) {
      session.yt = null;
      await putSession(env, session);
      return false;
    }
    const j = await r.json();
    session.yt.access = j.access_token;
    session.yt.expiresAt = Date.now() + (Number(j.expires_in || 3600) * 1000);
    await putSession(env, session);
    return true;
  } catch (e) {
    console.error("google refresh error", e);
    return false;
  }
}

async function ytApi(session, env, pathAndQuery) {
  const base = "https://www.googleapis.com/youtube/v3/";
  const doFetch = async () => {
    return fetch(base + pathAndQuery, { headers: { Authorization: "Bearer " + session.yt.access } });
  };
  let r = await doFetch();
  if (r.status === 401 && (await googleRefresh(session, env))) r = await doFetch();
  if (!r.ok) {
    try {
      const body = await r.text().catch(() => "");
      console.error(`YouTube API ${r.status} ${pathAndQuery.split("?")[0]}: ${String(body).slice(0, 180)}`);
    } catch {}
    return null;
  }
  return await r.json();
}

function revokeGoogle(token) {
  if (!token) return;
  fetch("https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(token), { method: "POST" }).catch(() => {});
}

function makeOAuthUrl(scope, state, extra, env) {
  const { googleClientId, googleRedirectUri } = authConfig(env);
  const p = new URLSearchParams({
    client_id: googleClientId,
    redirect_uri: googleRedirectUri,
    response_type: "code",
    scope,
    state,
    nonce: randomBytes(8).toString("hex"),
  });
  if (extra) {
    for (const k of Object.keys(extra)) if (extra[k]) p.set(k, extra[k]);
  }
  return "https://accounts.google.com/o/oauth2/v2/auth?" + p.toString();
}

// ── per-session YouTube cache (in-memory, 60 s freshness; server.js:1576) ──
// In-memory only, like server.js: KV free's 1k writes/day would be exceeded
// by per-session cache writes; correctness is unaffected (worst case = a
// refetch after isolate churn). Size-capped like the shared cache.
import { ytTrack, ytThumb } from "./parse.js";
const ytCache = new Map();
const YT_CACHE_MAX = 300;
const ytCacheFor = (sid) => {
  let c = ytCache.get(sid);
  if (!c) {
    c = { liked: null, playlists: null, detail: new Map(), at: 0 };
    ytCache.set(sid, c);
    if (ytCache.size > YT_CACHE_MAX) {
      const oldest = ytCache.keys().next().value;
      if (oldest !== undefined) ytCache.delete(oldest);
    }
  }
  return c;
};
const ytFresh = (obj) => obj && (Date.now() - obj.at) < 60 * 1000;

// ── route handlers ──────────────────────────────────────────────────────────

export async function handleAuthStatus(request, env) {
  const { on } = authConfig(env);
  const s = await readSession(request, env);
  const ytOn = !!(s && s.yt && s.yt.access);
  return json(200, {
    configured: on,
    signedIn: !!s,
    profile: s ? { name: s.name, email: s.email, picture: s.picture } : null,
    youtube: ytOn ? { connected: true, connectedAt: s.yt.at } : { connected: false },
  });
}

export async function handleAuthUrl(request, env, url, path) {
  const { on } = authConfig(env);
  if (!on) return json(503, { error: "Google auth not configured on the server" });
  const platform = url.searchParams.get("platform") === "native" ? "native" : "web";
  const s = await readSession(request, env);
  const step = path.indexOf("youtube") >= 0 ? "youtube" : "signin";
  const state = randomBytes(18).toString("hex");
  await putOAuthState(env, state, {
    step,
    sid: s ? s.sid : null,
    platform,
    exp: Date.now() + 10 * 60 * 1000,
  });
  const scope = step === "youtube"
    ? "openid email profile https://www.googleapis.com/auth/youtube.readonly"
    : "openid email profile";
  const extra = step === "youtube" ? { access_type: "offline", prompt: "consent" } : { prompt: "select_account" };
  return json(200, { url: makeOAuthUrl(scope, state, extra, env) });
}

export async function handleGoogleCallback(request, env, url) {
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const oauthErr = url.searchParams.get("error") || "";
  const st = await takeOAuthState(env, state);
  const platform = st ? st.platform : "web";
  const home = platform === "native" ? "muchi://auth/success" : "/?auth=success";
  const errHome = platform === "native" ? "muchi://auth/error" : "/?auth=error";
  if (oauthErr || !st || st.exp < Date.now() || !code) return redirect(errHome);
  const tok = await googleExchange(code, env);
  if (!tok) return redirect(errHome);
  const id = decodeIdToken(tok.id_token);
  if (!id || id.aud !== env.GOOGLE_CLIENT_ID) return redirect(errHome);
  const sid = randomBytes(24).toString("hex");
  const session = {
    sid,
    at: Date.now(),
    name: String(id.name || id.email || "Google user"),
    email: String(id.email || ""),
    picture: String(id.picture || ""),
    yt: null,
  };
  await putSession(env, session);
  if (platform === "native") {
    return redirect(home + "?token=" + encodeURIComponent(sessionToken(sid, env.MUCHI_SESSION_SECRET)));
  }
  return withCookie(redirect(home), sessionCookie(sid, env.MUCHI_SESSION_SECRET));
}

export async function handleYoutubeCallback(request, env, url) {
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const oauthErr = url.searchParams.get("error") || "";
  const st = await takeOAuthState(env, state);
  const platform = st ? st.platform : "web";
  const home = platform === "native" ? "muchi://youtube/success" : "/?youtube=success";
  const errHome = platform === "native" ? "muchi://youtube/error" : "/?youtube=error";
  if (oauthErr || !st || st.exp < Date.now() || !code) return redirect(errHome);
  let s = await readSession(request, env);
  if (!s && st.sid) s = await getSession(env, st.sid);
  if (!s) return redirect(errHome);
  const tok = await googleExchange(code, env);
  if (!tok) return redirect(errHome);
  s.yt = {
    access: tok.access_token,
    refresh: tok.refresh_token || "",
    expiresAt: Date.now() + (Number(tok.expires_in || 3600) * 1000),
    at: Date.now(),
  };
  await putSession(env, s);
  ytCache.delete(s.sid);
  return redirect(home);
}

export async function handleSignout(request, env) {
  const s = await readSession(request, env);
  if (s) {
    if (s.yt && s.yt.access) revokeGoogle(s.yt.access);
    await deleteSession(env, s.sid);
    ytCache.delete(s.sid);
  }
  const cookies = String(request.headers.get("cookie") || "");
  const m = cookies.match(/(?:^|;\s*)muchi_sid=([^;]+)/);
  if (m) return withCookie(json(200, { ok: true }), clearSessionCookie());
  return json(200, { ok: true });
}

export async function handleYoutubeDisconnect(request, env) {
  const s = await readSession(request, env);
  if (!s) return json(401, { error: "auth" });
  if (s.yt && s.yt.access) revokeGoogle(s.yt.access);
  s.yt = null;
  await putSession(env, s);
  ytCache.delete(s.sid);
  return json(200, { ok: true });
}

export async function handleYoutubeData(request, env, url, path) {
  const s = await readSession(request, env);
  if (!s) return json(401, { error: "auth" });
  if (!s.yt || !s.yt.access) return json(401, { error: "youtube" });
  const sid = s.sid;
  const cache = ytCacheFor(sid);
  try {
    if (path === "/api/youtube/liked") {
      if (!ytFresh(cache.liked)) {
        const pages = [];
        let pageToken = "";
        for (let i = 0; i < 4; i++) {
          const q = new URLSearchParams({ part: "snippet,contentDetails", myRating: "like", maxResults: "50" });
          if (pageToken) q.set("pageToken", pageToken);
          const j = await ytApi(s, env, "videos?" + q.toString());
          if (!j) throw new Error("yt");
          pages.push(...(j.items || []));
          pageToken = j.nextPageToken || "";
          if (!pageToken) break;
        }
        const tracks = pages.map((it) => ytTrack(it, "ytlike:")).filter(Boolean);
        cache.liked = { tracks, truncated: !!pageToken, at: Date.now() };
      }
      return json(200, { tracks: cache.liked.tracks, truncated: cache.liked.truncated });
    }
    if (path === "/api/youtube/playlists") {
      if (!ytFresh(cache.playlists)) {
        const out = [];
        let pageToken = "";
        for (let i = 0; i < 4; i++) {
          const q = new URLSearchParams({ part: "snippet,contentDetails", mine: "true", maxResults: "50" });
          if (pageToken) q.set("pageToken", pageToken);
          const j = await ytApi(s, env, "playlists?" + q.toString());
          if (!j) throw new Error("yt");
          for (const it of j.items || []) {
            const sn = it.snippet || {};
            if (!it.id || !sn.title) continue;
            out.push({
              id: it.id,
              title: sn.title,
              artwork: ytThumb(sn.thumbnails),
              count: (it.contentDetails && it.contentDetails.itemCount) || 0,
            });
          }
          pageToken = j.nextPageToken || "";
          if (!pageToken) break;
        }
        cache.playlists = { items: out, at: Date.now() };
      }
      return json(200, { playlists: cache.playlists.items });
    }
    // /api/youtube/playlist?id=…
    const plId = url.searchParams.get("id") || "";
    if (!plId) return json(400, { error: "Missing playlist id" });
    let det = cache.detail.get(plId);
    if (!ytFresh(det)) {
      const pages = [];
      let pageToken = "";
      for (let i = 0; i < 4; i++) {
        const q = new URLSearchParams({ part: "snippet,contentDetails", playlistId: plId, maxResults: "50" });
        if (pageToken) q.set("pageToken", pageToken);
        const j = await ytApi(s, env, "playlistItems?" + q.toString());
        if (!j) throw new Error("yt");
        pages.push(...(j.items || []));
        pageToken = j.nextPageToken || "";
        if (!pageToken) break;
      }
      const tracks = pages.map((it) => ytTrack(it, `ytpl:${plId}:`)).filter(Boolean);
      det = { tracks, truncated: !!pageToken, at: Date.now() };
      cache.detail.set(plId, det);
    }
    return json(200, { tracks: det.tracks, truncated: det.truncated });
  } catch (e) {
    if (e && e.message === "yt") {
      if (!s.yt) ytCache.delete(sid);
      return json(401, { error: "youtube" });
    }
    return json(502, { error: "YouTube API error" });
  }
}
