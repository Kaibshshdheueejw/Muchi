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

import { corsHeaders, json } from "./util.js";
import { handleHealth, handleMoods } from "./direct.js";
import {
  handleAuthStatus, handleAuthUrl, handleGoogleCallback, handleYoutubeCallback,
  handleSignout, handleYoutubeDisconnect, handleYoutubeData,
} from "./oauth.js";
import {
  handleHome, handleShelf, handleSearch, handleYoutubeSearch, handleYtPlaylist,
  handleArtist, handleRadio, handleRadioClick, handleDiscover, handleRelated,
  handleLyrics,
} from "./aggregate.js";
import { handleStream, handleImg, handleAudiusStream, handleAudiusFile } from "./stream.js";
import { maybeSweep } from "./db.js";

export default {
  async fetch(request, env, ctx) {
    const t0 = performance.now();
    try {
      const url = new URL(request.url);
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders() });
      }
      let response;
      if (url.pathname.startsWith("/api/")) {
        await maybeSweep(env);
        response = await handleApi(request, env, url);
      } else {
        // Non-/api paths: served by Workers Static Assets (run_worker_first
        // sends only /api/* here; this fallback covers manual routing).
        response = await env.ASSETS.fetch(request);
      }
      if (url.searchParams.get("debug") === "1" && response) {
        response = new Response(response.body, response);
        response.headers.set("x-muchi-ms", (performance.now() - t0).toFixed(1));
      }
      return response;
    } catch (err) {
      console.error(err);
      return json(500, { error: String((err && err.message) || err || "Server error") });
    }
  },
};

async function handleApi(request, env, url) {
  const p = url.pathname;

  if (p === "/api/health" || p === "/api/version") return handleHealth(env);
  if (p === "/api/auth/status") return handleAuthStatus(request, env);
  if (p === "/api/auth/google/url" || p === "/api/auth/youtube/url") return handleAuthUrl(request, env, url, p);
  if (p === "/api/auth/google/callback") return handleGoogleCallback(request, env, url);
  if (p === "/api/auth/youtube/callback") return handleYoutubeCallback(request, env, url);
  if (p === "/api/auth/signout") return handleSignout(request, env);
  if (p === "/api/auth/youtube/disconnect") return handleYoutubeDisconnect(request, env);
  if (p === "/api/youtube/liked" || p === "/api/youtube/playlists" || p === "/api/youtube/playlist") {
    return handleYoutubeData(request, env, url, p);
  }
  if (p === "/api/moods") return handleMoods(url);
  if (p === "/api/home") return handleHome(env, url);
  if (p === "/api/shelf") return handleShelf(env, url);
  if (p === "/api/search") return handleSearch(env, url);
  if (p === "/api/youtube/search") return handleYoutubeSearch(url);
  if (p === "/api/yt/playlist") return handleYtPlaylist(url);
  if (p === "/api/artist") return handleArtist(url);
  if (p === "/api/radio") return handleRadio(url);
  if (p.startsWith("/api/radio/click/")) return handleRadioClick(url);
  if (p === "/api/stream") return handleStream(request, url);
  if (p.startsWith("/api/audius/stream/")) return handleAudiusStream(url);
  if (p.startsWith("/api/audius/file/")) return handleAudiusFile(request, url);
  if (p === "/api/img") return handleImg(url);
  if (p === "/api/discover" || p === "/api/for-you") return handleDiscover(url);
  if (p === "/api/related") return handleRelated(url);
  if (p === "/api/lyrics") return handleLyrics(url);

  return json(404, { error: "Not found" });
}
