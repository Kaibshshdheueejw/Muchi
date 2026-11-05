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
import { APP_NAME, APP_VERSION, authConfig, SESSION_TTL_MS } from "./config.js";
import { json, redirect, corsHeaders } from "./util.js";
import { decodeIdToken } from "./parse.js";
import { sidFromToken, sessionToken, safeCompare } from "./auth.js";
import { getSession, putSession, deleteSession, putOAuthState, takeOAuthState, getUserLibrary, putUserLibrary } from "./db.js";
import { getAdminEmails, isUserAdmin } from "./admin.js";

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
  // Raw SIDs are never accepted. Every browser cookie and native bearer token
  // must use the same sufficiently long configured secret as OAuth issuance.
  const { sessionSecret } = authConfig(env);
  if (sessionSecret.length < 32) return null;
  const sid = sidFromToken(token, sessionSecret);
  if (!sid) return null;
  return getSession(env, sid);
}

function isSecureRequest(request) {
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

export function sessionCookie(sid, secret, request) {
  const token = sessionToken(sid, secret);
  const secure = request && isSecureRequest(request) ? "; Secure" : "";
  return `muchi_sid=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

export function clearSessionCookie(request) {
  const secure = request && isSecureRequest(request) ? "; Secure" : "";
  return `muchi_sid=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`;
}

function oauthBindingHash(value, secret) {
  return createHmac("sha256", secret).update(String(value || "")).digest("base64url");
}

function oauthBindingCookie(value, request) {
  const secure = request && isSecureRequest(request) ? "; Secure" : "";
  return `muchi_oauth=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=600`;
}

function clearOAuthBindingCookie(request) {
  const secure = request && isSecureRequest(request) ? "; Secure" : "";
  return `muchi_oauth=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`;
}

function requestCookie(request, name) {
  const cookies = String(request.headers.get("cookie") || "");
  const m = cookies.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : "";
}

function withCookies(res, cookies) {
  const r = new Response(res.body, res);
  for (const cookie of cookies.filter(Boolean)) r.headers.append("Set-Cookie", cookie);
  return r;
}

function withCookie(res, cookie) {
  return withCookies(res, [cookie]);
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
  if (r.status === 404) {
    // A 404 from playlists.list or videos.list(myRating) means no channel or no rated items exist yet
    return { items: [] };
  }
  if (!r.ok) {
    try {
      const body = await r.text().catch(() => "");
      console.error(`YouTube API ${r.status} ${pathAndQuery.split("?")[0]}: ${String(body).slice(0, 180)}`);
    } catch {}
    return null;
  }
  return await r.json();
}

// POST variant for the write endpoints (videos/rate, playlistItems.insert).
// Some of these return 204 No Content with an empty body — treat that as an
// empty object so callers still see success.
async function ytApiPost(session, env, pathAndQuery, body) {
  const base = "https://www.googleapis.com/youtube/v3/";
  const headers = {
    Authorization: "Bearer " + session.yt.access,
    "Content-Type": "application/json",
  };
  const doFetch = async () => {
    return fetch(base + pathAndQuery, { method: "POST", headers, body: body ? JSON.stringify(body) : undefined });
  };
  let r = await doFetch();
  if (r.status === 401 && (await googleRefresh(session, env))) r = await doFetch();
  if (!r.ok) {
    try {
      const t = await r.text().catch(() => "");
      console.error(`YouTube API POST ${pathAndQuery.split("?")[0]} ${r.status}: ${String(t).slice(0, 180)}`);
    } catch {}
    return null;
  }
  const text = await r.text().catch(() => "");
  if (!text) return {};
  try { return JSON.parse(text); } catch { return {}; }
}

// DELETE variant for removing an item from a YouTube playlist (playlistItems.delete).
// Returns 204 No Content on success.
async function ytApiDelete(session, env, pathAndQuery) {
  const base = "https://www.googleapis.com/youtube/v3/";
  const headers = {
    Authorization: "Bearer " + session.yt.access,
  };
  const doFetch = async () => {
    return fetch(base + pathAndQuery, { method: "DELETE", headers });
  };
  let r = await doFetch();
  if (r.status === 401 && (await googleRefresh(session, env))) r = await doFetch();
  if (!r.ok) {
    try {
      const t = await r.text().catch(() => "");
      console.error(`YouTube API DELETE ${pathAndQuery.split("?")[0]} ${r.status}: ${String(t).slice(0, 180)}`);
    } catch {}
    return null;
  }
  return {};
}

function revokeGoogle(token) {
  if (!token) return;
  fetch("https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(token), { method: "POST" }).catch(() => {});
}

function makeOAuthUrl(scope, state, extra, env, nonce) {
  const { googleClientId, googleRedirectUri } = authConfig(env);
  const p = new URLSearchParams({
    client_id: googleClientId,
    redirect_uri: googleRedirectUri,
    response_type: "code",
    scope,
    state,
    nonce: nonce || randomBytes(16).toString("hex"),
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
  const isAdmin = s ? isUserAdmin(s, env) : false;
  return json(200, {
    configured: on,
    signedIn: !!s,
    profile: s ? {
      name: s.name,
      email: s.email,
      email_verified: s.email_verified === true || s.email_verified === "true",
      role: isAdmin ? "admin" : (s.role && s.role !== "admin" ? s.role : "user"),
      picture: s.picture,
    } : null,
    youtube: ytOn ? { connected: true, connectedAt: s.yt.at } : { connected: false },
  }, request);
}

export async function handleAuthUrl(request, env, url, path) {
  const { on, sessionSecret } = authConfig(env);
  if (!on) return json(503, { error: "Google auth not configured on the server" }, request);
  const platform = url.searchParams.get("platform") === "native" ? "native" : "web";
  const s = await readSession(request, env);
  const step = path.indexOf("youtube") >= 0 ? "youtube" : "signin";
  const state = randomBytes(24).toString("hex");
  const nonce = randomBytes(18).toString("hex");
  const browserBinding = platform === "web" ? randomBytes(24).toString("hex") : "";
  await putOAuthState(env, state, {
    step,
    sid: s ? s.sid : null,
    platform,
    nonce,
    bindingHash: browserBinding ? oauthBindingHash(browserBinding, sessionSecret) : "",
    exp: Date.now() + 10 * 60 * 1000,
  });
  // Request scopes so a connected user can authenticate, read their YouTube
  // likes & playlists, and like songs or add them to playlists from MUCHI.
  // Using access_type: "offline" + prompt: "consent" ensures Google issues
  // a refresh_token for background refreshes.
  const ytScopes = "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.force-ssl";
  const scope = "openid email profile " + ytScopes;
  const extra = { access_type: "offline", prompt: "consent" };
  const authUrl = makeOAuthUrl(scope, state, extra, env, nonce);
  const response = json(200, { url: authUrl }, request);
  return browserBinding ? withCookie(response, oauthBindingCookie(browserBinding, request)) : response;
}

function callbackFailure(request, home, _reason = "state") {
  // Keep the browser-visible callback contract stable and do not reflect
  // internal OAuth failure details into the URL.
  return withCookie(redirect(home), clearOAuthBindingCookie(request));
}

function stateBoundToBrowser(request, env, st) {
  if (!st || st.platform !== "web") return true;
  const binding = requestCookie(request, "muchi_oauth");
  const secret = authConfig(env).sessionSecret;
  return Boolean(binding && st.bindingHash && safeCompare(oauthBindingHash(binding, secret), st.bindingHash));
}

function idTokenIsValid(id, env, st) {
  if (!id) return false;
  if (env.GOOGLE_CLIENT_ID && id.aud !== env.GOOGLE_CLIENT_ID) return false;
  if (id.iss && !["https://accounts.google.com", "accounts.google.com"].includes(id.iss)) return false;
  if (typeof id.exp === "number" && id.exp * 1000 < Date.now()) return false;
  if (st && st.nonce && !safeCompare(String(id.nonce || ""), String(st.nonce))) return false;
  return true;
}

function nativeTokenQuery(platform, sid, secret) {
  if (platform !== "native") return "";
  return "?token=" + encodeURIComponent(sessionToken(sid, secret));
}

export async function handleGoogleCallback(request, env, url) {
  const { on, sessionSecret } = authConfig(env);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const oauthErr = url.searchParams.get("error") || "";
  const st = await takeOAuthState(env, state);
  const platform = st ? st.platform : "web";
  const home = platform === "native" ? "muchi://auth/success" : "/?auth=success";
  const errHome = platform === "native" ? "muchi://auth/error" : "/?auth=error";
  if (!on) return callbackFailure(request, errHome, "not_configured");

  if (oauthErr) return callbackFailure(request, errHome, "cancelled");
  if (!st || st.exp < Date.now() || !code) return callbackFailure(request, errHome, "invalid_state");
  if (!stateBoundToBrowser(request, env, st)) return callbackFailure(request, errHome, "state_mismatch");

  const tok = await googleExchange(code, env);
  if (!tok) return callbackFailure(request, errHome, "exchange_failed");
  const id = decodeIdToken(tok.id_token);
  if (!id || !idTokenIsValid(id, env, st)) return callbackFailure(request, errHome, "invalid_token");

  const email = String(id.email || "").trim().toLowerCase();
  const isEmailVerified = id.email_verified === true || id.email_verified === "true";
  if (!email || !isEmailVerified) return callbackFailure(request, errHome, "email_not_verified");

  const adminEmails = getAdminEmails(env);
  const isAdmin = adminEmails.includes(email);
  const role = isAdmin ? "admin" : "user";

  // The YouTube step may share Google's registered callback URI. It must update
  // the exact session that initiated the flow; it cannot silently attach to a
  // different browser/session supplied by an attacker.
  if (st.step === "youtube") {
    const current = await readSession(request, env);
    if (st.sid && current && current.sid !== st.sid) return callbackFailure(request, errHome, "session_mismatch");
    let s = st.sid ? await getSession(env, st.sid) : current;
    if (!s) return callbackFailure(request, errHome, "session_required");
    s.yt = {
      access: tok.access_token,
      refresh: tok.refresh_token || (s.yt && s.yt.refresh) || "",
      expiresAt: Date.now() + (Number(tok.expires_in || 3600) * 1000),
      at: Date.now(),
    };
    if (isAdmin) s.role = "admin";
    await putSession(env, s);
    ytCache.delete(s.sid);
    const ytHome = platform === "native" ? "muchi://youtube/success" : "/?youtube=success";
    const dest = ytHome + nativeTokenQuery(platform, s.sid, sessionSecret);
    return withCookies(redirect(dest), [sessionCookie(s.sid, sessionSecret, request), clearOAuthBindingCookie(request)]);
  }

  const sid = randomBytes(24).toString("hex");
  const session = {
    sid,
    at: Date.now(),
    name: String(id.name || id.email || "Google user"),
    email,
    email_verified: true,
    role,
    picture: String(id.picture || ""),
    yt: tok.access_token ? {
      access: tok.access_token,
      refresh: tok.refresh_token || "",
      expiresAt: Date.now() + (Number(tok.expires_in || 3600) * 1000),
      at: Date.now(),
    } : null,
  };
  await putSession(env, session);
  const dest = home + nativeTokenQuery(platform, sid, sessionSecret);
  return withCookies(redirect(dest), [sessionCookie(sid, sessionSecret, request), clearOAuthBindingCookie(request)]);
}

export async function handleYoutubeCallback(request, env, url) {
  const { on, sessionSecret } = authConfig(env);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const oauthErr = url.searchParams.get("error") || "";
  const st = await takeOAuthState(env, state);
  const platform = st ? st.platform : "web";
  const home = platform === "native" ? "muchi://youtube/success" : "/?youtube=success";
  const errHome = platform === "native" ? "muchi://youtube/error" : "/?youtube=error";
  if (!on) return callbackFailure(request, errHome, "not_configured");
  if (oauthErr) return callbackFailure(request, errHome, "cancelled");
  if (!st || st.exp < Date.now() || !code) return callbackFailure(request, errHome, "invalid_state");
  if (!stateBoundToBrowser(request, env, st)) return callbackFailure(request, errHome, "state_mismatch");

  const current = await readSession(request, env);
  if (st.sid && current && current.sid !== st.sid) return callbackFailure(request, errHome, "session_mismatch");
  const s = st.sid ? await getSession(env, st.sid) : current;
  if (!s) return callbackFailure(request, errHome, "session_required");

  const tok = await googleExchange(code, env);
  if (!tok) return callbackFailure(request, errHome, "exchange_failed");
  const id = decodeIdToken(tok.id_token);
  if (!id || !idTokenIsValid(id, env, st)) return callbackFailure(request, errHome, "invalid_token");

  s.yt = {
    access: tok.access_token,
    refresh: tok.refresh_token || (s.yt && s.yt.refresh) || "",
    expiresAt: Date.now() + (Number(tok.expires_in || 3600) * 1000),
    at: Date.now(),
  };
  await putSession(env, s);
  ytCache.delete(s.sid);
  const dest = home + nativeTokenQuery(platform, s.sid, sessionSecret);
  return withCookies(redirect(dest), [sessionCookie(s.sid, sessionSecret, request), clearOAuthBindingCookie(request)]);
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
  if (m) return withCookie(json(200, { ok: true }, request), clearSessionCookie(request));
  return json(200, { ok: true }, request);
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
    // ── WRITE actions (connected user) ────────────────────────────────
    // Add the current song to the user's YouTube Liked Videos.
    if (path === "/api/youtube/like" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const videoId = String(body.videoId || url.searchParams.get("videoId") || "").trim();
      if (!videoId) return json(400, { error: "Missing videoId" });
      const q = new URLSearchParams({ id: videoId, rating: "like" });
      const j = await ytApiPost(s, env, "videos/rate?" + q.toString());
      if (!j) return json(401, { error: "youtube" });
      cache.liked = null; // refetch the liked list next time
      return json(200, { ok: true });
    }
    // Add the current song to one of the user's YouTube playlists.
    if (path === "/api/youtube/playlist/add" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const videoId = String(body.videoId || "").trim();
      const playlistId = String(body.playlistId || url.searchParams.get("playlistId") || "").trim();
      if (!videoId || !playlistId) return json(400, { error: "Missing videoId or playlistId" });
      const j = await ytApiPost(s, env, "playlistItems?part=snippet", {
        snippet: { playlistId, resourceId: { kind: "youtube#video", videoId } },
      });
      if (!j) return json(401, { error: "youtube" });
      cache.detail.delete(playlistId); // invalidate the cached track list
      cache.playlists = null;
      return json(200, { ok: true });
    }
    // Remove/unlike a song from the user's YouTube Liked Videos.
    if (path === "/api/youtube/unlike" && (request.method === "POST" || request.method === "DELETE")) {
      const body = await request.json().catch(() => ({}));
      const videoId = String(body.videoId || url.searchParams.get("videoId") || "").trim();
      if (!videoId) return json(400, { error: "Missing videoId" });
      const q = new URLSearchParams({ id: videoId, rating: "none" });
      const j = await ytApiPost(s, env, "videos/rate?" + q.toString());
      if (!j) return json(401, { error: "youtube" });
      cache.liked = null; // refetch the liked list next time
      return json(200, { ok: true });
    }
    // Remove a song from one of the user's YouTube playlists.
    if (path === "/api/youtube/playlist/remove" && (request.method === "POST" || request.method === "DELETE")) {
      const body = await request.json().catch(() => ({}));
      const playlistId = String(body.playlistId || url.searchParams.get("playlistId") || "").trim();
      const videoId = String(body.videoId || url.searchParams.get("videoId") || "").trim();
      let playlistItemId = String(body.playlistItemId || url.searchParams.get("playlistItemId") || "").trim();
      if (!playlistItemId && playlistId && videoId) {
        const cachedDet = cache.detail.get(playlistId);
        const cachedHit = cachedDet && Array.isArray(cachedDet.tracks)
          ? cachedDet.tracks.find((t) => t && (t.videoId === videoId || t.id === `ytpl:${playlistId}:${videoId}`) && t.playlistItemId)
          : null;
        if (cachedHit && cachedHit.playlistItemId) {
          playlistItemId = String(cachedHit.playlistItemId);
        } else {
          const qLookup = new URLSearchParams({ part: "id,snippet,contentDetails", playlistId, videoId, maxResults: "50" });
          const found = await ytApi(s, env, "playlistItems?" + qLookup.toString());
          const match = (found && Array.isArray(found.items) && found.items.find((it) => {
            const vid = (it.contentDetails && it.contentDetails.videoId) || (it.snippet && it.snippet.resourceId && it.snippet.resourceId.videoId) || "";
            return !vid || vid === videoId;
          })) || (found && Array.isArray(found.items) && found.items[0]);
          if (match && match.id) playlistItemId = String(match.id);
        }
      }
      if (!playlistItemId) return json(400, { error: "Missing playlistItemId or videoId" });
      const q = new URLSearchParams({ id: playlistItemId });
      const j = await ytApiDelete(s, env, "playlistItems?" + q.toString());
      if (!j) return json(401, { error: "youtube" });
      if (playlistId) cache.detail.delete(playlistId);
      else cache.detail.clear();
      cache.playlists = null;
      return json(200, { ok: true });
    }
    const forceRefresh = url.searchParams.get("refresh") === "1";
    if (path === "/api/youtube/liked") {
      if (forceRefresh || !ytFresh(cache.liked)) {
        const pages = [];
        let pageToken = "";
        for (let i = 0; i < 4; i++) {
          const q = new URLSearchParams({ part: "snippet,contentDetails", myRating: "like", maxResults: "50" });
          if (pageToken) q.set("pageToken", pageToken);
          const j = await ytApi(s, env, "videos?" + q.toString());
          if (!j) break;
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
      if (forceRefresh || !ytFresh(cache.playlists)) {
        const out = [];
        let pageToken = "";
        for (let i = 0; i < 4; i++) {
          const q = new URLSearchParams({ part: "snippet,contentDetails", mine: "true", maxResults: "50" });
          if (pageToken) q.set("pageToken", pageToken);
          const j = await ytApi(s, env, "playlists?" + q.toString());
          if (!j) break;
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
    if (forceRefresh || !ytFresh(det)) {
      const pages = [];
      let pageToken = "";
      for (let i = 0; i < 4; i++) {
        const q = new URLSearchParams({ part: "snippet,contentDetails", playlistId: plId, maxResults: "50" });
        if (pageToken) q.set("pageToken", pageToken);
        const j = await ytApi(s, env, "playlistItems?" + q.toString());
        if (!j) break;
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

// ── Persistent User Library (Liked songs, playlists, followed artists & taste across devices & browser resets) ──
export async function handleUserLibrary(request, env) {
  const s = await readSession(request, env);
  if (!s || !s.email) {
    return json(401, { error: "Authentication required to sync library across devices" }, request);
  }
  const userId = String(s.email).toLowerCase().trim();

  const normalizeFollowKey = (f) => {
    if (!f) return "";
    if (typeof f === "string") {
      const s = f.trim().toLowerCase();
      return s ? (s.startsWith("audius:") || s.startsWith("name:") ? s : `name:${s}`) : "";
    }
    if (typeof f !== "object") return "";
    const rawKey = String(f.key || "").trim().toLowerCase();
    if (rawKey.startsWith("audius:") || rawKey.startsWith("name:")) return rawKey;
    const nm = String(f.name || rawKey || "").trim().toLowerCase();
    return nm ? `name:${nm}` : "";
  };

  if (request.method === "GET") {
    const lib = await getUserLibrary(env, userId);
    const hasData = Boolean(
      lib && (
        lib.onboarded ||
        (Array.isArray(lib.liked) && lib.liked.length > 0) ||
        (Array.isArray(lib.playlists) && lib.playlists.length > 0) ||
        (Array.isArray(lib.following) && lib.following.length > 0) ||
        (Array.isArray(lib.recents) && lib.recents.length > 0) ||
        (lib.taste && Object.keys(lib.taste).some((k) => {
          const v = lib.taste[k];
          return Array.isArray(v) ? v.length > 0 : Boolean(v);
        })) ||
        lib.updated_at > 0
      )
    );
    return json(200, {
      library: lib || { liked: [], playlists: [], following: [], recents: [], taste: {}, onboarded: false },
      isReturningUser: hasData,
      syncedAt: (lib && lib.updated_at) || 0,
      user: { email: s.email, name: s.name },
    }, request);
  }

  if (request.method === "POST" || request.method === "PUT") {
    try {
      const body = await request.json().catch(() => null);
      if (!body || typeof body !== "object") {
        return json(400, { error: "Invalid library data" }, request);
      }

      // Read existing to merge safely so user never loses items unless explicitly replacing
      const existing = (await getUserLibrary(env, userId)) || {
        liked: [],
        playlists: [],
        following: [],
        recents: [],
        taste: {},
        onboarded: false,
      };

      const normalizeTrack = (t) => {
        if (!t || typeof t !== "object") return null;
        const rawKey = t.id || (t.videoId ? `yt:${t.videoId}` : (t.trackId ? `audius:${t.trackId}` : (t.title ? `${t.title}-${t.artist || ""}` : "")));
        const k = String(rawKey || "").trim();
        if (!k) return null;
        return {
          ...t,
          id: t.id || k,
        };
      };

      const likedMap = new Map();
      // Put body.liked first so the latest order and newly added likes are preserved at the top
      for (const t of (body.liked || [])) {
        const nt = normalizeTrack(t);
        if (nt && !likedMap.has(nt.id)) likedMap.set(nt.id, nt);
      }
      if (!body.replaceLiked) {
        for (const t of (existing.liked || [])) {
          const nt = normalizeTrack(t);
          if (nt && !likedMap.has(nt.id)) likedMap.set(nt.id, nt);
        }
      }

      const plMap = new Map();
      if (!body.replacePlaylists) {
        for (const p of (existing.playlists || [])) {
          const k = p && (p.id || p.name);
          if (k) plMap.set(k, p);
        }
      }
      for (const p of (body.playlists || [])) {
        const k = p && (p.id || p.name);
        if (k) plMap.set(k, p);
      }

      const followMap = new Map();
      if (!body.replaceFollowing) {
        for (const f of (existing.following || [])) {
          const k = normalizeFollowKey(f);
          if (k) followMap.set(k, typeof f === "string" ? f : { ...f, key: k });
        }
      }
      for (const f of (body.following || [])) {
        const k = normalizeFollowKey(f);
        if (k) followMap.set(k, typeof f === "string" ? f : { ...f, key: k });
      }

      const recentsMap = new Map();
      for (const t of (body.recents || [])) {
        if (t && t.id) recentsMap.set(t.id, t);
      }
      for (const t of (existing.recents || [])) {
        if (t && t.id && !recentsMap.has(t.id)) recentsMap.set(t.id, t);
      }

      const mergedTaste = { ...(existing.taste || {}), ...(body.taste || {}) };
      const isOnboarded = Boolean(existing.onboarded || body.onboarded || mergedTaste.onboarded);
      if (isOnboarded) mergedTaste.onboarded = true;

      const merged = {
        liked: Array.from(likedMap.values()).slice(0, 2000),
        playlists: Array.from(plMap.values()).slice(0, 200),
        following: Array.from(followMap.values()).slice(0, 500),
        recents: Array.from(recentsMap.values()).slice(0, 100),
        taste: mergedTaste,
        onboarded: isOnboarded,
        updated_at: Date.now(),
      };

      await putUserLibrary(env, userId, merged);

      return json(200, {
        ok: true,
        library: merged,
        isReturningUser: true,
        syncedAt: merged.updated_at,
      }, request);
    } catch (err) {
      return json(500, { error: "Failed to persist library" }, request);
    }
  }

  return json(405, { error: "Method not allowed" }, request);
}
