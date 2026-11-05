// MUCHI — Cloudflare Worker entry point — COMPLETE backend port.
//
// Routes (23 groups, mirroring server.js handleApi):
//   direct     health, version, moods
//   oauth      auth/status, auth/google/url, auth/youtube/url,
//              auth/google/callback, auth/youtube/callback, auth/signout,
//              auth/youtube/disconnect, youtube/liked, youtube/playlists,
//              youtube/playlist
//   aggregate  home, shelf, search, youtube/search, yt/playlist, artist,
//              radio, radio/click/*, discover, for-you, related, lyrics
//   stream     stream, img, audius/stream/*, audius/file/*
//
// Static assets (public/) are served by Workers Static Assets; `/api/*` is
// routed to this Worker first (assets.run_worker_first in wrangler.toml).
//
// CPU instrumentation: `?debug=1` adds `x-muchi-ms` (wall time — coarse
// signal only; the real metric is per-invocation CPU in the Cloudflare
// dashboard, which must stay < 10 ms on the free plan).

import { corsHeaders, json, rateLimit } from "./util.js";
import { handleHealth, handleMoods, handleGeo, handleAppIcon, handleManifest } from "./direct.js";
import {
  handleAuthStatus, handleAuthUrl, handleGoogleCallback, handleYoutubeCallback,
  handleSignout, handleYoutubeDisconnect, handleYoutubeData, handleUserLibrary,
} from "./oauth.js";
import {
  handleHome, handleShelf, handleSearch, handleYoutubeSearch, handleYtPlaylist,
  handleArtist, handleRadio, handleRadioClick, handleDiscover, handleRelated,
  handleLyrics, handleYtStream, handleItunesSearch, handleDeezerProxy,
} from "./aggregate.js";
import { handleStream, handleImg, handleAudiusStream, handleAudiusFile, handleDownload } from "./stream.js";
import { handleSpotifyResolve } from "./spotify.js";
import { maybeSweep } from "./db.js";
import { handleAdmin } from "./admin.js";
import { handleWebhook } from "./webhook.js";
import { PRIVACY_HTML, TERMS_HTML } from "./legal.js";
// PREVIEW-ONLY seed: active solely when env.MUCHI_PREVIEW_SEED is set (only
// in the locally git-ignored .dev.vars). In production that env var is never
// present, so this file and these handlers are inert.
import {
  previewHome, previewShelf, previewSearch, previewYtSearch,
  previewArtist, previewRelated, previewDiscover, previewRadio,
  previewLyrics, previewAudioWav,
} from "./preview-seed.js";

export default {
  async fetch(request, env, ctx) {
    const t0 = performance.now();
    try {
      const url = new URL(request.url);
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(request, env) });
      }
      const cleanPath = url.pathname.replace(/\/+$/, "") || "/";
      if (cleanPath === "/privacy" || cleanPath === "/privacy.html") {
        return new Response(request.method === "HEAD" ? null : PRIVACY_HTML, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
            ...corsHeaders(request, env),
          },
        });
      }
      if (cleanPath === "/terms" || cleanPath === "/terms.html") {
        return new Response(request.method === "HEAD" ? null : TERMS_HTML, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
            ...corsHeaders(request, env),
          },
        });
      }
      let response;
      if (url.pathname.startsWith("/api/")) {
        const limited = rateLimitForPath(request, url);
        if (limited) return limited;
        await maybeSweep(env);
        response = await handleApi(request, env, url);
        if (response) {
          const cors = corsHeaders(request, env);
          if (cors["Access-Control-Allow-Origin"]) {
            for (const [k, v] of Object.entries(cors)) {
              response.headers.set(k, v);
            }
          } else {
            // Some endpoint helpers default to wildcard CORS when called
            // without a Request. Never let that wildcard survive for a
            // disallowed origin.
            response.headers.delete("Access-Control-Allow-Origin");
            response.headers.delete("Access-Control-Allow-Credentials");
          }
        }
      } else {
        // Non-/api paths: served by Workers Static Assets (run_worker_first
        // sends only /api/* here; this fallback covers manual routing).
        response = await env.ASSETS.fetch(request);
      }
      const isDev = (env && env.NODE_ENV === "development") || (typeof process !== "undefined" && process.env.NODE_ENV === "development");
      const debugEnabled = isDev || (env && env.MUCHI_DEBUG === "1");
      if (debugEnabled && url.searchParams.get("debug") === "1" && response) {
        response = new Response(response.body, response);
        response.headers.set("x-muchi-ms", (performance.now() - t0).toFixed(1));
      }
      return response;
    } catch (err) {
      console.error("Worker internal error:", err);
      const isDev = (env && env.NODE_ENV === "development") || (typeof process !== "undefined" && process.env.NODE_ENV === "development");
      return json(500, { error: isDev ? String((err && err.message) || err) : "Internal server error" }, request);
    }
  },
};

function rateLimitForPath(request, url) {
  const p = url.pathname;
  if (p === "/api/health" || p === "/api/version" || p === "/api/moods" || p === "/api/geo") return null;
  if (p === "/api/preview/audio") return rateLimit(request, "preview-audio", 20, 60 * 1000);
  if (/^\/api\/auth\//.test(p)) return rateLimit(request, "auth", 20, 10 * 60 * 1000);
  if (p === "/api/download") return rateLimit(request, "download", 20, 60 * 1000);
  if (p === "/api/stream" || p === "/api/img" || p.startsWith("/api/audius/file/")) {
    return rateLimit(request, "media-proxy", 180, 60 * 1000);
  }
  if (p.includes("search") || p === "/api/home" || p === "/api/shelf" || p === "/api/radio" || p === "/api/discover" || p === "/api/for-you" || p === "/api/related" || p === "/api/lyrics") {
    return rateLimit(request, "provider", 120, 60 * 1000);
  }
  if (p.startsWith("/api/user/") || p.startsWith("/api/youtube/")) {
    return rateLimit(request, "account", 90, 60 * 1000);
  }
  return rateLimit(request, "api", 180, 60 * 1000);
}

function allowedMethodsForPath(p) {
  if (p === "/api/auth/signout" || p === "/api/auth/youtube/disconnect") return ["POST"];
  if (p === "/api/auth/status" || p === "/api/auth/google/url" || p === "/api/auth/youtube/url" || p.endsWith("/callback")) return ["GET"];
  if (p === "/api/user/library" || p === "/api/user/sync") return ["GET", "POST"];
  if (p === "/api/youtube/like" || p === "/api/youtube/unlike" || p === "/api/youtube/playlist/add" || p === "/api/youtube/playlist/remove") return ["POST"];
  if (p === "/api/youtube/liked" || p === "/api/youtube/playlists" || p === "/api/youtube/playlist") return ["GET"];
  if (p.startsWith("/api/admin") || p === "/api/webhook" || p.startsWith("/api/webhooks")) return null;
  if (p.startsWith("/api/")) return ["GET"];
  return null;
}

async function handleApi(request, env, url) {
  const p = url.pathname;
  const allowed = allowedMethodsForPath(p);
  if (allowed && !allowed.includes(request.method)) {
    return json(405, { error: "Method Not Allowed", allow: allowed.join(", ") }, request, env);
  }

  // ── PREVIEW SEED (dev-only) ────────────────────────────────────────────
  if (p === "/api/preview/audio") {
    if (!env || !env.MUCHI_PREVIEW_SEED) return json(404, { error: "Not found" }, request, env);
    const wav = previewAudioWav(url.searchParams.get("dur"));
    return new Response(new Uint8Array(wav), {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "public, max-age=86400",
        ...corsHeaders(request, env),
      },
    });
  }

  // When MUCHI_PREVIEW_SEED is set (local .dev.vars only), serve curated
  // sample data instead of calling the real providers. This lets the
  // workspace preview show populated, tappable, playable content even though
  // the sandbox has no egress to the music providers. auth/stream/img routes
  // still flow through their normal handlers untouched.
  if (env && env.MUCHI_PREVIEW_SEED) {
    const gl = url.searchParams.get("gl") || "";
    // Dev seed data must never be cached by the browser/service worker — a
    // stale `/api/lyrics` (old {synced,plain} shape) would keep showing
    // "Lyrics aren't available" even after the fix. Always send no-store.
    const seedJson = (status, obj) => {
      const r = json(status, obj);
      r.headers.set("Cache-Control", "no-store");
      return r;
    };
    if (p === "/api/home") return seedJson(200, previewHome(gl));
    if (p === "/api/shelf") {
      return seedJson(200, previewShelf(
        url.searchParams.get("id") || "",
        url.searchParams.get("q") || "",
        gl,
      ));
    }
    if (p === "/api/search") return seedJson(200, previewSearch(url.searchParams.get("q") || ""));
    if (p === "/api/youtube/search") return seedJson(200, previewYtSearch(url.searchParams.get("q") || url.searchParams.get("query") || ""));
    if (p === "/api/artist") {
      return seedJson(200, previewArtist(url.searchParams.get("name") || url.searchParams.get("q") || ""));
    }
    if (p === "/api/related") {
      const title = url.searchParams.get("title") || "";
      const artist = url.searchParams.get("artist") || "";
      const genre = url.searchParams.get("genre") || "";
      const mood = url.searchParams.get("mood") || "";
      const tempo = url.searchParams.get("tempo") || "";
      const style = url.searchParams.get("style") || "";
      const skip = url.searchParams.get("skip") || "";
      return seedJson(200, previewRelated(title || artist, artist, { genre, mood, tempo, style, skip }));
    }
    if (p === "/api/discover" || p === "/api/for-you") {
      const artists = (url.searchParams.get("artists") || "").split(",").filter(Boolean);
      const genres = (url.searchParams.get("genres") || "").split(",").filter(Boolean);
      const skip = (url.searchParams.get("skip") || "").split(",").filter(Boolean);
      return seedJson(200, previewDiscover(gl, { artists, genres, skip }));
    }
    if (p === "/api/radio") return seedJson(200, previewRadio(url.searchParams.get("q") || ""));
    if (p === "/api/lyrics") {
      return seedJson(200, previewLyrics(url.searchParams.get("title") || "", url.searchParams.get("artist") || ""));
    }
  }

  if (p === "/api/health" || p === "/api/version") return await handleHealth(env);
  if (p.startsWith("/api/admin")) return handleAdmin(request, env, url);
  if (p === "/api/webhook" || p.startsWith("/api/webhooks")) return handleWebhook(request, env, url);
  if (p === "/api/auth/status") return handleAuthStatus(request, env);
  if (p === "/api/user/library" || p === "/api/user/sync") return handleUserLibrary(request, env);
  if (p === "/api/auth/google/url" || p === "/api/auth/youtube/url") return handleAuthUrl(request, env, url, p);
  if (p === "/api/auth/google/callback") return handleGoogleCallback(request, env, url);
  if (p === "/api/auth/youtube/callback") return handleYoutubeCallback(request, env, url);
  if (p === "/api/auth/signout") return handleSignout(request, env);
  if (p === "/api/auth/youtube/disconnect") return handleYoutubeDisconnect(request, env);
  if (p === "/api/youtube/liked" || p === "/api/youtube/playlists" || p === "/api/youtube/playlist"
      || p === "/api/youtube/like" || p === "/api/youtube/unlike"
      || p === "/api/youtube/playlist/add" || p === "/api/youtube/playlist/remove") {
    return handleYoutubeData(request, env, url, p);
  }
  if (p === "/api/moods") return handleMoods(url);
  if (p === "/api/geo") return handleGeo(request);
  if (p === "/api/app-icon") return handleAppIcon(url);
  if (p === "/api/manifest.json" || p === "/api/manifest.webmanifest") return handleManifest(url);
  if (p === "/api/home") return handleHome(env, url);
  if (p === "/api/shelf") return handleShelf(env, url);
  if (p === "/api/search") return handleSearch(env, url);
  if (p === "/api/itunes/search" || p === "/api/apple/search" || p === "/api/itunes/proxy" || p === "/api/itunes") return handleItunesSearch(url);
  if (p === "/api/deezer/search" || p === "/api/deezer/proxy" || p === "/api/deezer") return handleDeezerProxy(url);
  if (p === "/api/catalog/search" || p === "/api/catalog/proxy" || p === "/api/catalog") {
    const prov = String(url.searchParams.get("provider") || url.searchParams.get("source") || "").toLowerCase();
    const rawPath = String(url.searchParams.get("path") || "").toLowerCase();
    if (prov === "deezer" || rawPath.includes("deezer") || rawPath.startsWith("/search") || rawPath.startsWith("/artist") || rawPath.startsWith("/album") || rawPath.startsWith("/track")) {
      if (prov === "apple" || prov === "itunes" || rawPath.includes("itunes") || rawPath.includes("entity=")) {
        return handleItunesSearch(url);
      }
      return handleDeezerProxy(url);
    }
    return handleItunesSearch(url);
  }
  if (p === "/api/youtube/search") return handleYoutubeSearch(url);
  if (p === "/api/yt/playlist") return handleYtPlaylist(url);
  if (p === "/api/yt/stream") return handleYtStream(url);
  if (p === "/api/spotify/resolve" || p === "/api/spotify") return handleSpotifyResolve(url);
  if (p === "/api/artist") return handleArtist(url);
  if (p === "/api/radio") return handleRadio(url);
  if (p.startsWith("/api/radio/click/")) return handleRadioClick(url);
  if (p === "/api/stream") return handleStream(request, url);
  if (p.startsWith("/api/audius/stream/")) return handleAudiusStream(url);
  if (p.startsWith("/api/audius/file/")) return handleAudiusFile(request, url);
  if (p === "/api/download") return handleDownload(request, url);
  if (p === "/api/img") return handleImg(url);
  if (p === "/api/discover" || p === "/api/for-you") return handleDiscover(url);
  if (p === "/api/related") return handleRelated(url);
  if (p === "/api/lyrics") return handleLyrics(url);

  return json(404, { error: "Not found" });
}
