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
import { handleHealth, handleMoods, handleGeo } from "./direct.js";
import {
  handleAuthStatus, handleAuthUrl, handleGoogleCallback, handleYoutubeCallback,
  handleSignout, handleYoutubeDisconnect, handleYoutubeData,
} from "./oauth.js";
import {
  handleHome, handleShelf, handleSearch, handleYoutubeSearch, handleYtPlaylist,
  handleArtist, handleRadio, handleRadioClick, handleDiscover, handleRelated,
  handleLyrics, handleYtStream,
} from "./aggregate.js";
import { handleStream, handleImg, handleAudiusStream, handleAudiusFile, handleDownload } from "./stream.js";
import { maybeSweep } from "./db.js";
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

  // ── PREVIEW SEED (dev-only) ────────────────────────────────────────────
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
    if (p === "/api/preview/audio") {
      // ?dur=<seconds> tells the seed how long to make the tone so a tapped
      // song plays for its real duration (the sandbox can't stream real music).
      const wav = previewAudioWav(url.searchParams.get("dur"));
      return new Response(new Uint8Array(wav), {
        status: 200,
        headers: {
          "Content-Type": "audio/wav",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
        },
      });
    }
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
    if (p === "/api/related") return seedJson(200, previewRelated(url.searchParams.get("title") || ""));
    if (p === "/api/discover" || p === "/api/for-you") return seedJson(200, previewDiscover(gl));
    if (p === "/api/radio") return seedJson(200, previewRadio(url.searchParams.get("q") || ""));
    if (p === "/api/lyrics") {
      return seedJson(200, previewLyrics(url.searchParams.get("title") || "", url.searchParams.get("artist") || ""));
    }
  }

  if (p === "/api/health" || p === "/api/version") return handleHealth(env);
  if (p === "/api/auth/status") return handleAuthStatus(request, env);
  if (p === "/api/auth/google/url" || p === "/api/auth/youtube/url") return handleAuthUrl(request, env, url, p);
  if (p === "/api/auth/google/callback") return handleGoogleCallback(request, env, url);
  if (p === "/api/auth/youtube/callback") return handleYoutubeCallback(request, env, url);
  if (p === "/api/auth/signout") return handleSignout(request, env);
  if (p === "/api/auth/youtube/disconnect") return handleYoutubeDisconnect(request, env);
  if (p === "/api/youtube/liked" || p === "/api/youtube/playlists" || p === "/api/youtube/playlist"
      || p === "/api/youtube/like" || p === "/api/youtube/playlist/add") {
    return handleYoutubeData(request, env, url, p);
  }
  if (p === "/api/moods") return handleMoods(url);
  if (p === "/api/geo") return handleGeo(request);
  if (p === "/api/home") return handleHome(env, url);
  if (p === "/api/shelf") return handleShelf(env, url);
  if (p === "/api/search") return handleSearch(env, url);
  if (p === "/api/youtube/search") return handleYoutubeSearch(url);
  if (p === "/api/yt/playlist") return handleYtPlaylist(url);
  if (p === "/api/yt/stream") return handleYtStream(url);
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
