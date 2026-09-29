// MUCHI — external providers, ported VERBATIM from server.js
// (youtubeMusicSearch/youtubeWebSearch/pipedSearch/searchYouTube lines
// 720–884, itunes 905–963, playlist browse 963–1037, audius 1037–1060 +
// 1189–1209, radio 1060–1189, lyrics 1209–1262, resolveShelfPlaylist
// 1380–1393). Response shapes are unchanged.

import { fetchJSON, codecMatch, tidyTitle, tidyArtist, isEnglishTrack } from "./util.js";
import { walkCollect, walkCatalog } from "./parse.js";
import { regionCode, YT_SONGS_PARAMS, RADIO_HOSTS, pickPlaylistHit } from "./data.js";
import { APP_NAME, APP_VERSION } from "./config.js";

function searchWalkOpts(extra, musicOnly) {
  return {
    musicOnly: musicOnly && !extra.loose,
    limit: extra.limit || 40,
    loose: !!extra.loose,
  };
}

export async function youtubeMusicSearch(query, gl, timeoutMs = 6500, extra = {}) {
  const payload = {
    context: { client: { clientName: "WEB_REMIX", clientVersion: "1.20240814.01.00", hl: "en", gl: regionCode(gl) } },
    query,
  };
  if (extra.params) payload.params = extra.params;
  const data = await fetchJSON("https://music.youtube.com/youtubei/v1/search?prettyPrint=false", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://music.youtube.com",
      Referer: "https://music.youtube.com/",
    },
    body: JSON.stringify(payload),
  }, timeoutMs);
  const out = [];
  walkCollect(data, out, new Set(), new Set(), searchWalkOpts(extra, true));
  const bag = { artists: [], playlists: [], seenPl: new Set(), seenArt: new Set() };
  walkCatalog(data, bag);
  return { tracks: out, artists: bag.artists, playlists: bag.playlists };
}

export async function youtubeWebSearch(query, gl, timeoutMs = 6500, extra = {}) {
  const body = JSON.stringify({
    context: { client: { clientName: "WEB", clientVersion: "2.20240815.00.00", hl: "en", gl: regionCode(gl) } },
    query,
  });
  const data = await fetchJSON("https://www.youtube.com/youtubei/v1/search?prettyPrint=false", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://www.youtube.com",
      Referer: "https://www.youtube.com/",
    },
    body,
  }, timeoutMs);
  const out = [];
  walkCollect(data, out, new Set(), new Set(), searchWalkOpts(extra, false));
  const bag = { artists: [], playlists: [], seenPl: new Set(), seenArt: new Set() };
  walkCatalog(data, bag);
  return { tracks: out, artists: bag.artists, playlists: bag.playlists };
}

export async function pipedSearch(query) {
  const data = await fetchJSON(
    `https://api.piped.private.coffee/search?q=${encodeURIComponent(query)}&filter=all`
  );
  const items = data.items || data || [];
  return items
    .filter((it) => it.type === "stream" || it.url)
    .map((it) => {
      const videoId = (it.url || "").split("v=")[1] || (it.url || "").replace("/watch?v=", "").split("&")[0];
      if (!videoId) return null;
      return {
        id: `yt:${videoId}`,
        source: "youtube",
        videoId,
        title: it.title || "YouTube",
        artist: it.uploaderName || it.uploader || "YouTube",
        album: "",
        duration: it.duration || 0,
        artwork: (it.thumbnail || "").replace("proxy.piped.private.coffee/vi/", "i.ytimg.com/vi/") ||
          `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      };
    })
    .filter(Boolean);
}

/**
 * searchYouTube(query, gl, fast) — multi-source YouTube search with scoring.
 * IMPORTANT: the returned ARRAY carries `.artists` and `.playlists` as own
 * properties (server.js does the same — callers read them directly).
 */
export async function searchYouTube(query, gl, fast) {
  const seen = new Set();
  const out = [];
  const artists = [];
  const playlists = [];
  const seenArt = new Set();
  const seenPl = new Set();
  const add = (bundle) => {
    const rows = Array.isArray(bundle) ? bundle : (bundle && bundle.tracks) || [];
    for (const r of rows || []) {
      if (r && r.videoId && !seen.has(r.videoId)) {
        seen.add(r.videoId);
        out.push(r);
      }
    }
    for (const a of (bundle && bundle.artists) || []) {
      const k = String(a.name || "").toLowerCase();
      if (k && !seenArt.has(k)) {
        seenArt.add(k);
        artists.push(a);
      }
    }
    for (const p of (bundle && bundle.playlists) || []) {
      if (p.playlistId && !seenPl.has(p.playlistId)) {
        seenPl.add(p.playlistId);
        playlists.push(p);
      }
    }
  };
  const errors = [];
  const extra = { limit: fast ? 24 : 60, musicOnly: true, loose: false };
  if (fast) {
    try {
      // Prioritize YouTube Music (WEB_REMIX + YT_SONGS_PARAMS) studio masters;
      // give web search a 350ms head-start delay so studio masters always win when available.
      const fastHit = await Promise.any([
        youtubeMusicSearch(query, gl, 2000, { ...extra, params: YT_SONGS_PARAMS }).then((r) => {
          const rows = Array.isArray(r) ? r : (r && r.tracks) || [];
          if (!rows.length) throw new Error("empty music search");
          return r;
        }),
        new Promise((res, rej) =>
          setTimeout(() => {
            youtubeWebSearch(query, gl, 1800, { limit: 24, musicOnly: true, loose: false })
              .then((r) => {
                const rows = Array.isArray(r) ? r : (r && r.tracks) || [];
                if (!rows.length) throw new Error("empty web search");
                return r;
              })
              .then(res, rej);
          }, 350)
        ),
      ]);
      add(fastHit);
    } catch (e) {
      errors.push(String(e && e.message ? e.message : e));
    }
  } else {
    const jobs = [
      youtubeMusicSearch(query, gl, 3200, { ...extra, params: YT_SONGS_PARAMS }),
      youtubeWebSearch(query, gl, 3000, { limit: 35, musicOnly: true, loose: false }),
    ];
    const settled = await Promise.allSettled(jobs);
    for (const s of settled) {
      if (s.status === "fulfilled") add(s.value);
      else errors.push(String(s.reason && s.reason.message ? s.reason.message : s.reason));
    }
  }
  // If we have no songs or very few, try fallback query with a fast timeout
  if (out.length < 5 && !fast) {
    try {
      const hasOfficial = /\bofficial\s+audio\b/i.test(query);
      const fallbackQ = hasOfficial
        ? query.replace(/\b(?:official\s+audio|official\s+video|official)\b/gi, "").replace(/\s*[\[(][^)\]]*[)\]]/g, "").replace(/\s+/g, " ").trim()
        : `${query} official audio`;
      const webRes = await youtubeWebSearch(fallbackQ || query, gl, 2500, { limit: 25, musicOnly: false, loose: true });
      add(webRes);
    } catch (e) {
      errors.push(String(e.message || e));
    }
  }
  if (!out.length && !fast) {
    try {
      add(await pipedSearch(query));
    } catch (e) {
      errors.push(String(e.message || e));
    }
  }
  if (!out.length) throw new Error(errors.join(" | ") || "YouTube search failed");
  const qn = String(query || "").toLowerCase().trim();
  const words = qn.split(/\s+/).filter((w) => w.length > 1);
  const cjkRuns = qn.match(/[\u3040-\u30ff\u3400-\u9fff]{2,}/g) || [];
  const cjkBigrams = [];
  for (const run of cjkRuns) {
    for (let i = 0; i < run.length - 1; i++) {
      cjkBigrams.push(run.slice(i, i + 2));
    }
  }
  const score = (t) => {
    const title = String(t.title || "").toLowerCase();
    const artist = String(t.artist || "").toLowerCase();
    if (!qn) return 0;
    if (title === qn) return 200;
    if (title.includes(qn)) return 120;
    if (`${title} ${artist}`.includes(qn)) return 90;
    let s = 0;
    for (const w of words) {
      if (title.includes(w)) s += 18;
      if (artist.includes(w)) s += 10;
    }
    for (const bg of cjkBigrams) {
      if (title.includes(bg)) s += 14;
    }
    return s;
  };
  out.sort((a, b) => score(b) - score(a));
  const tracks = out.slice(0, fast ? 24 : 100);
  tracks.artists = artists.slice(0, 24);
  tracks.playlists = playlists.slice(0, 24);
  return tracks;
}

// Finds the "load more" token inside a playlist browse response.
function findPlaylistToken(node) {
  const cont = (n) => {
    if (!n || typeof n !== "object") return null;
    if (n.continuationItemRenderer && n.continuationItemRenderer.continuationEndpoint) {
      const cmd = n.continuationItemRenderer.continuationEndpoint.continuationCommand;
      if (cmd && cmd.token) return cmd.token;
    }
    if (n.continuationCommand && n.continuationCommand.token) return n.continuationCommand.token;
    for (const v of Object.values(n)) {
      const t = cont(v);
      if (t) return t;
    }
    return null;
  };
  if (!node || typeof node !== "object") return null;
  if (node.playlistVideoListRenderer) {
    const t = cont(node.playlistVideoListRenderer);
    if (t) return t;
  }
  return cont(node);
}

export async function youtubePlaylistTracks(playlistId) {
  const id = String(playlistId || "").replace(/^VL/, "");
  if (!id) return [];
  async function browse(clientName, clientVersion, origin) {
    const headers = {
      "Content-Type": "application/json",
      Origin: origin,
      Referer: `${origin}/`,
    };
    const context = { client: { clientName, clientVersion, hl: "en" } };
    const out = [];
    const seen = new Set();
    let token = null;
    let guard = 0;
    const page = async (body) => {
      const data = await fetchJSON(`${origin}/youtubei/v1/browse?prettyPrint=false`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const batch = [];
      walkCollect(data, batch, seen, new Set(), { limit: 120, loose: true });
      for (const t of batch) out.push(t);
      token = findPlaylistToken(data);
    };
    await page({ context, browseId: `VL${id}` });
    while (token && out.length < 300 && guard < 4) {
      guard++;
      const t = token;
      token = null;
      try {
        await page({ context, continuation: t });
      } catch {
        break;
      }
    }
    return out;
  }
  try {
    const web = await browse("WEB", "2.20240815.00.00", "https://www.youtube.com");
    if (web.length) return web.slice(0, 300);
  } catch {}
  try {
    const remix = await browse("WEB_REMIX", "1.20240814.01.00", "https://music.youtube.com");
    return remix.slice(0, 300);
  } catch {
    return [];
  }
}

// ── YouTube → direct audio stream (background/native playback) ──────────
// Resolves a YouTube videoId to a direct audio stream URL so the song can be
// handed to the native foreground media service (background play + OS media
// notification) instead of the WebView iframe player. Tries several Piped
// instances (search only uses api.piped.private.coffee; stream endpoints are
// instance-volatile, so we try a rotated list). Returns null on any failure —
// callers fall back to the iframe player, so a Piped outage never breaks play.
// The stream endpoints are instance-volatile, so we fan out to ALL of them in
// PARALLEL and take the first that returns a usable stream. Calling them one
// at a time (each 9 s) meant a single slow/dead instance could stall the whole
// request for ~36 s — which made an iTunes tap feel like it "took so long" and
// could time out the native handoff entirely. Parallel + short timeouts means
// /api/yt/stream answers in ~2 s if any instance is up.
const PIPED_STREAM_INSTANCES = [
  "https://api.piped.private.coffee",
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.adminforge.de",
  "https://pipedapi.leptons.xyz",
  "https://pipedapi.reallyaweso.me",
  "https://pipedapi.ducks.party",
];
const PIPED_API_TIMEOUT = 3500;

export function pickPipedStream(data) {
  const streams = (data && data.audioStreams) || [];
  if (!streams.length) return null;
  // Spotube-style "best quality": pick the HIGHEST-BITRATE audio stream, not
  // just the first one. Piped lists several audioStreams per video; the first
  // is often a low-bitrate placeholder. We prefer AAC/m4a (best native decoder
  // compatibility on ExoPlayer/AVPlayer), then opus/webm, and within each
  // container choose the stream with the largest listed bitrate/quality — so
  // both playback and downloads come through at the highest available quality.
  const byType = (re) => streams
    .filter((s) => s && s.url && re.test(String(s.mimeType || "") + " " + String(s.format || "")))
    .sort((a, b) => streamQualityScore(b) - streamQualityScore(a));
  const m4a = byType(/mp4|m4a|mpeg|aac/i);
  const opus = byType(/opus|webm|ogg|vorbis/i);
  const m4aTop = m4a[0] || null;
  const opusTop = opus[0] || null;
  const useM4a = m4aTop && (!opusTop || (streamQualityScore(m4aTop) >= 115000 && streamQualityScore(m4aTop) >= streamQualityScore(opusTop) * 0.75));
  const best = (useM4a ? m4aTop : (opusTop || m4aTop)) || streams.find((s) => s && s.url);
  if (!best || !best.url) return null;
  return {
    url: best.url,
    format: best.format || (best === m4aTop ? "m4a" : "opus"),
    mimeType: best.mimeType || "",
    quality: best.quality || "",
    // Expose the numeric bitrate so callers can surface/track it.
    bitrate: best.bitrate || "",
    duration: (data && data.duration) || 0,
  };
}

function streamQualityScore(s) {
  // Piped audioStreams may carry `bitrate` (bps or kbps) and/or `quality`
  // (itag-ish number). Higher = better. Prefer explicit bitrate, then quality.
  const b = Number(s.bitrate);
  if (isFinite(b) && b > 0) return b > 1000 ? b : b * 1000; // normalize kbps→bps
  const q = Number(s.quality);
  if (isFinite(q) && q > 0) return q * 1000;
  return 0;
}

// ── Tier 1: innerTube player endpoint (multi-client race) ───────────────
// WHY THIS TIER EXISTS (v1.5.4 audit, D+E): the public Piped instances became
// unreliable — production /api/yt/stream returned an empty url for every video
// on 2026-09-05 (live-verified), which killed native background playback
// (the Media3/AVPlayer sink never engaged) and made YouTube downloads fail.
// The public innerTube `player` endpoint answers with audio-only adaptive
// formats with DIRECT (no cipher-decipher needed) playable URLs — one request
// per client profile, no third-party dependency, profiles raced in parallel. It uses the same
// keyless innerTube pattern as the WEB_REMIX/WEB search calls in this file.
// If Google ever gates this endpoint too, this tier simply returns null and
// the existing Piped fan-out (Tier 2) + the client's iframe fallback keep
// working exactly as before — nothing regresses.
const INNERTUBE_PLAYER_TIMEOUT = 4500;
const INNERTUBE_API = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";
// Multiple client profiles, raced in parallel with ANDROID_VR prioritized in Tier 1A.
// ANDROID_VR returns full-file streamable googlevideo URLs without PO-token / range-chunk
// 403 blocks, whereas IOS/ANDROID are staggered by 250ms as Tier 1B fallbacks.
const INNERTUBE_PROFILES = [
  {
    tag: "ANDROID_VR-1.61",
    tier: 1,
    clientId: "28",
    ua: "com.google.android.apps.youtube.vr.oculus/1.61.48 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
    client: { clientName: "ANDROID_VR", clientVersion: "1.61.48", androidSdkVersion: 32, osName: "Android", osVersion: "12L", deviceMake: "Oculus", deviceModel: "Quest 3", hl: "en", gl: "US" },
  },
  {
    tag: "ANDROID_VR-1.60",
    tier: 1,
    clientId: "28",
    ua: "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
    client: { clientName: "ANDROID_VR", clientVersion: "1.60.19", androidSdkVersion: 32, osName: "Android", osVersion: "12L", deviceMake: "Oculus", deviceModel: "Quest 3", hl: "en", gl: "US" },
  },
  {
    tag: "IOS-19.09",
    tier: 2,
    clientId: "5",
    ua: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X; en_US)",
    client: { clientName: "IOS", clientVersion: "20.10.4", deviceMake: "Apple", deviceModel: "iPhone16,2", osName: "iPhone", osVersion: "18.3.2.22D82", hl: "en", gl: "US" },
  },
  {
    tag: "ANDROID-19.09",
    tier: 2,
    clientId: "3",
    ua: "com.google.android.youtube/20.10.38 (Linux; U; Android 14; en_US) gzip",
    client: { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 34, osName: "Android", osVersion: "14", hl: "en", gl: "US" },
  },
  {
    tag: "TV_EMBED-2.0",
    tier: 2,
    clientId: "85",
    ua: "Mozilla/5.0 (PlayStation; PlayStation 4/11.50) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.4 Safari/605.1.15",
    client: { clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER", clientVersion: "2.0", hl: "en", gl: "US" },
    thirdParty: { embedUrl: "https://www.youtube.com/" },
  },
];

// One profile probe: direct audio stream or a REJECT carrying "TAG=reason"
// (playability status, or NO_AUDIO_FORMATS when playable-but-empty).
async function innertubeProbe(spec, videoId) {
  const ctx = { client: spec.client };
  if (spec.thirdParty) ctx.thirdParty = spec.thirdParty;
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": spec.ua,
  };
  if (spec.clientId) {
    headers["X-YouTube-Client-Name"] = spec.clientId;
    headers["X-YouTube-Client-Version"] = spec.client.clientVersion;
  }
  if (spec.thirdParty) {
    headers.Origin = "https://www.youtube.com";
    headers.Referer = "https://www.youtube.com/";
  }
  const data = await fetchJSON(INNERTUBE_API, {
    method: "POST",
    headers,
    body: JSON.stringify({
      context: ctx,
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
    }),
  }, INNERTUBE_PLAYER_TIMEOUT);
  const picked = pickInnertubeStream(data);
  if (picked) return { ...picked, source: `innertube:${spec.tag}` };
  const status = String((data && data.playabilityStatus && data.playabilityStatus.status) || "NO_AUDIO_FORMATS");
  throw new Error(`${spec.tag}=${status}`);
}

export async function youtubeAudioStream(videoId) {
  const id = String(videoId || "").trim();
  if (!id) return null;
  const gates = [];
  const primarySpecs = INNERTUBE_PROFILES.filter((s) => s.tier === 1);
  const secondarySpecs = INNERTUBE_PROFILES.filter((s) => s.tier !== 1);
  try {
    return await Promise.any(
      primarySpecs.map((spec) =>
        innertubeProbe(spec, id).catch((e) => {
          gates.push(String(e.message || e));
          throw e;
        })
      )
    );
  } catch {}
  const tier1B = Promise.any(
    secondarySpecs.map((spec) =>
      innertubeProbe(spec, id).catch((e) => {
        gates.push(String(e.message || e));
        throw e;
      })
    )
  );
  const tier2 = new Promise((resolve, reject) => {
    setTimeout(() => {
      Promise.any(
        PIPED_STREAM_INSTANCES.map((base) =>
          fetchJSON(`${base}/streams/${encodeURIComponent(id)}`, {}, PIPED_API_TIMEOUT).then((data) => {
            const picked = pickPipedStream(data);
            if (!picked) throw new Error("empty piped stream");
            return picked;
          })
        )
      ).then(resolve, reject);
    }, 150);
  });
  try {
    return await Promise.any([tier1B, tier2]);
  } catch {
    throw new Error(`no audio stream (innertube: ${gates.length ? [...new Set(gates)].join(", ") : "not attempted"}; all piped stream instances failed)`);
  }
}

/**
 * Pure extractor: innerTube player response → the best direct audio URL.
 * Mirrors pickPipedStream's contract exactly:
 *   { url, format, mimeType, quality, bitrate, duration } | null
 * Prefers AAC/m4a (best device + tagging compatibility) over Opus/webm,
 * highest bitrate first within a container.
 */
// Google's ANDROID/IOS player responses sometimes omit videoDetails.durationSeconds;
// the signed format URL always carries the canonical `dur` param — use it as fallback.
function urlDuration(u) {
  try { return Number(new URL(String(u)).searchParams.get("dur")) || 0; } catch { return 0; }
}

export function pickInnertubeStream(data) {
  const st = data && data.streamingData;
  if (!st) return null;
  const status = String((data.playabilityStatus && data.playabilityStatus.status) || "OK");
  if (status !== "OK") return null;
  const formats = [...(st.adaptiveFormats || []), ...(st.formats || [])];
  const isAudio = (f) => f && f.url && /audio/i.test(String(f.mimeType || ""));
  const score = (f) => Number(f.bitrate) || 0;
  const audio = formats.filter(isAudio);
  const m4a = audio.filter((f) => /mp4/i.test(String(f.mimeType))).sort((a, b) => score(b) - score(a));
  const opus = audio.filter((f) => /opus|webm/i.test(String(f.mimeType))).sort((a, b) => score(b) - score(a));
  const m4aTop = m4a[0] || null;
  const opusTop = opus[0] || null;
  // Prefer high-bitrate AAC/m4a (>=115kbps, e.g. itag=140 128k / itag=141 256k),
  // but never let a low-bitrate 48kbps itag=139 m4a beat a 160kbps itag=251 Opus stream.
  const useM4a = m4aTop && (!opusTop || (score(m4aTop) >= 115000 && score(m4aTop) >= score(opusTop) * 0.75) || score(m4aTop) === 0);
  const best = useM4a ? m4aTop : (opusTop || m4aTop);
  if (!best || !best.url) return null;
  const isM4a = best === m4aTop;
  return {
    url: String(best.url),
    format: isM4a ? "m4a" : "opus",
    mimeType: String(best.mimeType || (isM4a ? "audio/mp4" : "audio/webm")),
    quality: String(best.itag || ""),
    bitrate: String(best.bitrate || ""),
    duration: Number(data.videoDetails && data.videoDetails.durationSeconds) || Number(data.videoDetails && data.videoDetails.lengthSeconds) || urlDuration(best.url),
  };
}

export function mapAudiusTrack(t) {
  if (!t || !t.id) return null;
  if (t.is_delete || t.is_streamable === false || (t.access && t.access.stream === false)) return null;
  const user = t.user || {};
  const art = t.artwork || {};
  return {
    id: `audius:${t.id}`,
    source: "audius",
    trackId: t.id,
    title: t.title || "Untitled",
    artist: user.name || user.handle || (t.permalink || "").split("/")[1] || "Independent artist",
    album: t.genre || "Audius",
    duration: t.duration || 0,
    artwork: art["480x480"] || art["1000x1000"] || art["150x150"] || "/cover-default.jpg",
    genre: t.genre || "",
    mood: t.mood || "",
    plays: t.play_count || 0,
    permalink: t.permalink || "",
    streamUrl: "",
  };
}

const itunesCache = new Map();
const ITUNES_CACHE_TTL = 10 * 60 * 1000;
let itunesRateLimitedUntil = 0;

export async function itunesSearch(query, { includeExtra = true, country = "" } = {}) {
  const cleanQ = String(query || "").trim().slice(0, 80);
  const q = encodeURIComponent(cleanQ);
  if (!q) return { songs: [], artists: [], playlists: [] };

  const cacheKey = `${cleanQ.toLowerCase()}:${country.toLowerCase()}:${includeExtra ? 1 : 0}`;
  const cached = itunesCache.get(cacheKey);
  if (cached && cached.exp > Date.now()) {
    return cached.val;
  }

  const countryParam = country ? `&country=${encodeURIComponent(country)}` : "";
  const fetchItunes = async (url) => {
    if (Date.now() < itunesRateLimitedUntil) return null;
    const ctrl = new AbortController();
    const tm = setTimeout(() => ctrl.abort(), 2500);
    try {
      const r = await fetch(url, {
        signal: ctrl.signal,
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        },
      });
      if (r.status === 403 || r.status === 429) {
        itunesRateLimitedUntil = Date.now() + 45000;
        return null;
      }
      if (!r.ok) return null;
      return await r.json();
    } catch {
      return null;
    } finally {
      clearTimeout(tm);
    }
  };

  const calls = [
    fetchItunes(`https://itunes.apple.com/search?term=${q}&media=music&entity=song&limit=50${countryParam}`)
      .then((res) => (!res || !res.results || !res.results.length) && countryParam ? fetchItunes(`https://itunes.apple.com/search?term=${q}&media=music&entity=song&limit=50`) : res),
  ];
  if (includeExtra) {
    calls.push(
      fetchItunes(`https://itunes.apple.com/search?term=${q}&media=music&entity=musicArtist&limit=25${countryParam}`)
        .then((res) => (!res || !res.results || !res.results.length) && countryParam ? fetchItunes(`https://itunes.apple.com/search?term=${q}&media=music&entity=musicArtist&limit=25`) : res)
    );
    calls.push(
      fetchItunes(`https://itunes.apple.com/search?term=${q}&media=music&entity=album&limit=25${countryParam}`)
        .then((res) => (!res || !res.results || !res.results.length) && countryParam ? fetchItunes(`https://itunes.apple.com/search?term=${q}&media=music&entity=album&limit=25`) : res)
    );
  }
  const settled = await Promise.allSettled(calls);
  const songsR = settled[0];
  const artistsR = includeExtra ? settled[1] : null;
  const albumsR = includeExtra ? settled[2] : null;

  const songs = [];
  const artists = [];
  const playlists = [];
  const seenArt = new Set();
  const seenAlb = new Set();

  const foldArtist = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const wantQ = foldArtist(query);

  const upsertArtist = (name, id, artwork) => {
    const cleanName = String(name || "").trim();
    const k = foldArtist(cleanName);
    if (!k) return;
    if (!seenArt.has(k)) {
      seenArt.add(k);
      artists.push({
        id: `artist:apple:${id || cleanName}`,
        kind: "artist",
        name: cleanName,
        artwork: artwork || "/cover-default.jpg",
        source: "apple",
        query: cleanName,
      });
    } else {
      const existing = artists.find((x) => foldArtist(x.name) === k);
      if (existing && (!existing.artwork || existing.artwork === "/cover-default.jpg") && artwork && artwork !== "/cover-default.jpg") {
        existing.artwork = artwork;
      }
    }
  };

  if (artistsR && artistsR.status === "fulfilled") {
    for (const a of (artistsR.value && artistsR.value.results) || []) {
      if (!a.artistName) continue;
      const art = a.artworkUrl100 ? String(a.artworkUrl100).replace("100x100bb", "400x400bb") : "/cover-default.jpg";
      upsertArtist(a.artistName, a.artistId || a.artistName, art);
    }
  }
  if (songsR && songsR.status === "fulfilled") {
    for (const t of (songsR.value && songsR.value.results) || []) {
      if (!t.trackId) continue;
      const art400 = String(t.artworkUrl100 || "").replace("100x100bb", "400x400bb") || "/cover-default.jpg";
      songs.push({
        id: `apple:${t.trackId}`,
        source: "apple",
        title: t.trackName || "Song",
        artist: t.artistName || "Artist",
        album: t.collectionName || "",
        duration: Math.round((t.trackTimeMillis || 0) / 1000),
        artwork: art400,
        genre: t.primaryGenreName || "",
        year: t.releaseDate ? String(t.releaseDate).slice(0, 4) : "",
        releaseDate: t.releaseDate || "",
        previewUrl: "",
        playQuery: `${t.trackName || ""} ${t.artistName || ""} official audio`.trim(),
        trackId: t.trackId,
        trackName: t.trackName || "Song",
        artistName: t.artistName || "Artist",
        collectionName: t.collectionName || "",
        trackTimeMillis: t.trackTimeMillis || 0,
        artworkUrl100: t.artworkUrl100 || "",
      });
      if (t.artistName) {
        upsertArtist(t.artistName, t.artistId || t.artistName, art400);
      }
      if (t.collectionId && t.collectionName && !seenAlb.has(String(t.collectionId))) {
        seenAlb.add(String(t.collectionId));
        playlists.push({
          id: `album:${t.collectionId}`,
          kind: "playlist",
          title: t.collectionName,
          artist: t.artistName || "Apple Music",
          artwork: art400,
          source: "apple",
          query: `${t.collectionName} ${t.artistName || ""}`.trim(),
        });
      }
    }
  }
  // Secondary fallback if specific entity search returned empty
  if (!songs.length && Date.now() >= itunesRateLimitedUntil) {
    try {
      const fb = await fetchItunes(`https://itunes.apple.com/search?term=${q}&media=music&limit=30`);
      for (const t of (fb && fb.results) || []) {
        if (!t.trackId || !t.trackName) continue;
        const art400 = String(t.artworkUrl100 || "").replace("100x100bb", "400x400bb") || "/cover-default.jpg";
        songs.push({
          id: `apple:${t.trackId}`,
          source: "apple",
          title: t.trackName,
          artist: t.artistName || "Artist",
          album: t.collectionName || "",
          duration: Math.round((t.trackTimeMillis || 0) / 1000),
          artwork: art400,
          genre: t.primaryGenreName || "",
          year: t.releaseDate ? String(t.releaseDate).slice(0, 4) : "",
          releaseDate: t.releaseDate || "",
          previewUrl: "",
          playQuery: `${t.trackName || ""} ${t.artistName || ""} official audio`.trim(),
          trackId: t.trackId,
          trackName: t.trackName,
          artistName: t.artistName || "Artist",
          collectionName: t.collectionName || "",
          trackTimeMillis: t.trackTimeMillis || 0,
          artworkUrl100: t.artworkUrl100 || "",
        });
        if (t.artistName) {
          upsertArtist(t.artistName, t.artistId || t.artistName, art400);
        }
      }
    } catch {}
  }
  // Tertiary studio catalog fallback when itunes.apple.com rate-limits the server IP
  if (!songs.length) {
    try {
      const dzFb = await fetchJSON(`https://api.deezer.com/search?q=${q}&limit=30`, {}, 5000);
      for (const d of (dzFb && dzFb.data) || []) {
        if (!d || !d.id || !d.title) continue;
        const aName = (d.artist && d.artist.name) || "Artist";
        const cName = (d.album && d.album.title) || "";
        const artUrl = (d.album && (d.album.cover_big || d.album.cover_medium)) || (d.artist && d.artist.picture_big) || "/cover-default.jpg";
        const durSec = Number(d.duration) || 0;
        songs.push({
          id: `apple:${d.id}`,
          source: "apple",
          title: d.title,
          artist: aName,
          album: cName,
          duration: durSec,
          artwork: artUrl,
          genre: "",
          year: "",
          previewUrl: "",
          playQuery: `${d.title} ${aName} official audio`.trim(),
          trackId: d.id,
          trackName: d.title,
          artistName: aName,
          collectionName: cName,
          trackTimeMillis: durSec * 1000,
          artworkUrl100: artUrl,
        });
        upsertArtist(aName, (d.artist && d.artist.id) || aName, (d.artist && (d.artist.picture_big || d.artist.picture_medium)) || artUrl);
        if (d.album && d.album.id && cName && !seenAlb.has(String(d.album.id))) {
          seenAlb.add(String(d.album.id));
          playlists.push({
            id: `album:${d.album.id}`,
            kind: "playlist",
            title: cName,
            artist: aName,
            artwork: artUrl,
            source: "apple",
            query: `${cName} ${aName}`.trim(),
          });
        }
      }
    } catch {}
  }
  // Quaternary YouTube Music catalog fallback when both iTunes and Deezer rate-limit datacenter IPs
  if (!songs.length) {
    try {
      const ytFb = await searchYouTube(`${cleanQ} official audio`, country || "US", true);
      if (Array.isArray(ytFb)) {
        for (const yt of ytFb) {
          if (!yt || !yt.title) continue;
          const trackId = yt.videoId || String(yt.id || "").replace(/^yt:/, "") || cleanQ;
          const aName = yt.artist || "Artist";
          const cName = yt.album || "";
          const artUrl = yt.artwork || "/cover-default.jpg";
          const durSec = Number(yt.duration) || 0;
          songs.push({
            id: `apple:${trackId}`,
            source: "apple",
            title: yt.title,
            artist: aName,
            album: cName,
            duration: durSec,
            artwork: artUrl,
            genre: "",
            year: "",
            previewUrl: "",
            playQuery: `${yt.title} ${aName} official audio`.trim(),
            trackId,
            trackName: yt.title,
            artistName: aName,
            collectionName: cName,
            trackTimeMillis: durSec * 1000,
            artworkUrl100: artUrl,
          });
          if (aName && !/^(youtube|unknown|various artists)$/i.test(aName)) {
            upsertArtist(aName, aName, artUrl);
          }
          if (songs.length >= 30) break;
        }
      }
    } catch {}
  }
  if (artists.length > 1 && wantQ) {
    artists.sort((a, b) => {
      const na = foldArtist(a.name);
      const nb = foldArtist(b.name);
      const exactA = na === wantQ ? 1 : 0;
      const exactB = nb === wantQ ? 1 : 0;
      if (exactA !== exactB) return exactB - exactA;
      const prefA = na.startsWith(wantQ) ? 1 : 0;
      const prefB = nb.startsWith(wantQ) ? 1 : 0;
      if (prefA !== prefB) return prefB - prefA;
      const incA = (na.includes(wantQ) || (na.length >= 3 && wantQ.includes(na))) ? 1 : 0;
      const incB = (nb.includes(wantQ) || (nb.length >= 3 && wantQ.includes(nb))) ? 1 : 0;
      if (incA !== incB) return incB - incA;
      return na.length - nb.length;
    });
  }
  if (albumsR && albumsR.status === "fulfilled") {
    for (const al of (albumsR.value && albumsR.value.results) || []) {
      if (!al.collectionId) continue;
      const k = String(al.collectionId);
      if (!seenAlb.has(k)) {
        seenAlb.add(k);
        const art400 = String(al.artworkUrl100 || "").replace("100x100bb", "400x400bb") || "/cover-default.jpg";
        playlists.push({
          id: `album:${al.collectionId}`,
          kind: "playlist",
          title: al.collectionName || "Album",
          artist: al.artistName || "Apple Music",
          artwork: art400,
          source: "apple",
          query: `${al.collectionName || ""} ${al.artistName || ""}`.trim(),
        });
        if (al.artistName) {
          upsertArtist(al.artistName, al.artistId || al.artistName, art400);
        }
      }
    }
  }
  const res = { songs, artists, playlists };
  if (songs.length || artists.length) {
    if (itunesCache.size > 500) {
      const firstKey = itunesCache.keys().next().value;
      if (firstKey) itunesCache.delete(firstKey);
    }
    itunesCache.set(cacheKey, { val: res, exp: Date.now() + ITUNES_CACHE_TTL });
  }
  return res;
}

const appleRssCache = new Map();
const APPLE_RSS_TTL = 20 * 60 * 1000;

export async function appleRssMostPlayed(country = "IN", limit = 50) {
  const cc = String(country || "IN").toLowerCase().trim();
  const n = Math.max(10, Math.min(50, Number(limit) || 50));
  const cacheKey = `${cc}:${n}`;
  const hit = appleRssCache.get(cacheKey);
  if (hit && hit.exp > Date.now()) return hit.val;

  try {
    const data = await fetchJSON(
      `https://rss.applemarketingtools.com/api/v2/${encodeURIComponent(cc)}/music/most-played/${n}/songs.json`,
      {},
      5000
    );
    const results = (data && data.feed && Array.isArray(data.feed.results)) ? data.feed.results : [];
    const songs = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (!r || !r.name) continue;
      const trackId = String(r.id || `${cc}_${i}`);
      const title = String(r.name || "Song").trim();
      const artist = String(r.artistName || "Artist").trim();
      const art400 = String(r.artworkUrl100 || "").replace(/\d+x\d+bb/, "600x600bb") || "/cover-default.jpg";
      const genreName = (Array.isArray(r.genres) && r.genres[0] && r.genres[0].name) ? String(r.genres[0].name) : "";
      const relDate = String(r.releaseDate || "").trim();
      songs.push({
        id: `apple:${trackId}`,
        source: "apple",
        title,
        artist,
        album: "",
        duration: 210,
        artwork: art400,
        genre: genreName,
        year: relDate ? relDate.slice(0, 4) : "",
        releaseDate: relDate,
        chartRank: i + 1,
        previewUrl: "",
        playQuery: `${title} ${artist} official audio`.trim(),
        trackId,
        trackName: title,
        artistName: artist,
        collectionName: "",
        trackTimeMillis: 210000,
        artworkUrl100: art400,
      });
    }
    if (songs.length) {
      if (appleRssCache.size > 100) {
        const firstKey = appleRssCache.keys().next().value;
        if (firstKey) appleRssCache.delete(firstKey);
      }
      appleRssCache.set(cacheKey, { val: songs, exp: Date.now() + APPLE_RSS_TTL });
    }
    return songs;
  } catch {
    return [];
  }
}

export async function audiusSearch(query) {
  const data = await fetchJSON(
    `https://api.audius.co/v1/tracks/search?query=${encodeURIComponent(query)}&app_name=${APP_NAME}&limit=50`,
    {},
    6000
  );
  return (data.data || []).map(mapAudiusTrack).filter(Boolean);
}

export async function audiusTrending(genre) {
  const qs = new URLSearchParams({ app_name: APP_NAME, limit: "24" });
  if (genre) qs.set("genre", genre);
  const data = await fetchJSON(`https://api.audius.co/v1/tracks/trending?${qs}`);
  return (data.data || []).map(mapAudiusTrack).filter(Boolean);
}

export async function audiusUnderground() {
  const data = await fetchJSON(
    `https://api.audius.co/v1/tracks/trending/underground?app_name=${APP_NAME}&limit=18`
  );
  return (data.data || []).map(mapAudiusTrack).filter(Boolean);
}

export async function radioBrowser(path, extraHeaders = {}) {
  const attempts = RADIO_HOSTS.map((host) =>
    fetchJSON(`${host}${path}`, {
      headers: { "User-Agent": `${APP_NAME}/${APP_VERSION}`, ...extraHeaders },
    }, 3500)
  );
  try {
    return await Promise.any(attempts);
  } catch {
    throw new Error("radio directory failed");
  }
}

export async function audiusStreamUrl(trackId) {
  const id = encodeURIComponent(String(trackId || "").replace(/[^\w-]/g, ""));
  if (!id) throw new Error("bad track");

  // Fast path: resolve 302 redirect directly from healthy Audius discovery/stream endpoints.
  // Audius stream endpoint redirects (302) to an active, load-balanced validator node in ~150ms.
  const endpoints = [
    `https://api.audius.co/v1/tracks/${id}/stream?app_name=${APP_NAME}`,
    `https://discoveryprovider.audius.co/v1/tracks/${id}/stream?app_name=${APP_NAME}`,
  ];

  for (const ep of endpoints) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2500);
      const res = await fetch(ep, {
        redirect: "manual",
        headers: { "User-Agent": `${APP_NAME}/${APP_VERSION}` },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (loc) return loc;
      }
      if (res.status === 200) return ep;
      // If primary gateway explicitly reports 404/410 (deleted or non-existent track), fail fast
      if (res.status === 404 || res.status === 410) break;
    } catch {}
  }

  // Fallback: check track metadata if stream redirect wasn't returned directly
  try {
    const data = await fetchJSON(`https://api.audius.co/v1/tracks/${id}?app_name=${APP_NAME}`, {}, 2500);
    const t = (data && data.data) || {};
    if (t.is_delete || t.is_streamable === false) return "";
    if (t.stream && t.stream.url) return t.stream.url;
  } catch {}

  return `https://api.audius.co/v1/tracks/${id}/stream?app_name=${APP_NAME}`;
}

export async function radioSearch(query, limit = 24, quality, codec) {
  const params = new URLSearchParams({
    limit: String(Math.max(limit * 3, 24)),
    hidebroken: "true",
    order: query ? "votes" : "clickcount",
    reverse: "true",
    lastcheckok: "true",
  });
  if (query) params.set("name", query);
  let floor = 0;
  let ceil = 0;
  if (quality === "low") ceil = 96;
  else if (quality === "standard") floor = 128;
  else if (quality === "high") floor = 192;
  else if (quality === "highest") floor = 320;
  if (ceil) params.set("bitrateMax", String(ceil));
  if (floor) params.set("bitrateMin", String(floor));
  const data = await radioBrowser(`/json/stations/search?${params}`);
  let rows = (data || []).filter(
    (s) => s.url_resolved && Number(s.hls) !== 1 && !/\.m3u8(\?|$)/i.test(s.url_resolved)
  );
  if (ceil) rows = rows.filter((s) => !s.bitrate || Number(s.bitrate) <= ceil);
  if (floor) rows = rows.filter((s) => !s.bitrate || Number(s.bitrate) >= floor);
  rows.sort((a, b) => Number(b.bitrate || 0) - Number(a.bitrate || 0));
  const want = String(codec || "auto").toLowerCase();
  if (want !== "auto") rows = rows.filter((s) => codecMatch(s.codec, want));
  return rows.slice(0, limit)
    .map((s) => ({
      id: `radio:${s.stationuuid}`,
      source: "radio",
      stationId: s.stationuuid,
      title: (s.name || "Radio").trim(),
      artist: [s.country, s.tags].filter(Boolean).join(" · ") || "Live radio",
      album: s.codec || "Radio",
      duration: 0,
      artwork: s.favicon || "/cover-default.jpg",
      streamUrl: s.url_resolved,
      homepage: s.homepage || "",
      bitrate: s.bitrate || 0,
      codec: s.codec || "",
    }));
}

export async function audiusUserSearch(query) {
  const data = await fetchJSON(
    `https://api.audius.co/v1/users/search?query=${encodeURIComponent(query)}&app_name=${APP_NAME}&limit=8`
  );
  return (data.data || []).map((u) => ({
    id: u.id,
    handle: u.handle,
    name: u.name || u.handle,
    artwork: (u.profile_picture && (u.profile_picture["480x480"] || u.profile_picture["150x150"])) || "/cover-default.jpg",
    followerCount: u.follower_count || 0,
  }));
}

export async function audiusUserTracks(userId) {
  const data = await fetchJSON(
    `https://api.audius.co/v1/users/${encodeURIComponent(userId)}/tracks?app_name=${APP_NAME}&limit=12`
  );
  return (data.data || []).map(mapAudiusTrack).filter(Boolean);
}

export function parseLyricsHit(hit) {
  if (!hit) return null;
  const synced = [];
  if (hit.syncedLyrics) {
    for (const line of String(hit.syncedLyrics).split("\n")) {
      const m = line.match(/\[(\d+):(\d+(?:\.\d+)?)\](.*)/);
      if (m) synced.push({ t: Number(m[1]) * 60 + Number(m[2]), text: m[3].trim() });
    }
  }
  const lyrics = String(hit.plainLyrics || "").trim();
  if (!lyrics && !synced.length) return null;
  return { lyrics, synced, title: hit.trackName, artist: hit.artistName };
}

function normLyricToken(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\u0900-\u097f\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]+/g, " ")
    .trim();
}

function pickBestLyricsHit(list, wantTitle, wantArtist, wantDur) {
  if (!Array.isArray(list) || !list.length) return null;
  const wt = normLyricToken(wantTitle);
  const wa = normLyricToken(wantArtist);
  let best = null;
  let bestScore = -1;
  for (const item of list) {
    const parsed = parseLyricsHit(item);
    if (!parsed) continue;
    let score = 0;
    if (parsed.synced && parsed.synced.length) score += 25;
    if (parsed.lyrics) score += 10;
    const it = normLyricToken(item.trackName);
    const ia = normLyricToken(item.artistName);
    if (wt && it) {
      if (it === wt) score += 40;
      else if (it.startsWith(wt) || wt.startsWith(it)) score += 28;
      else if (it.includes(wt) || wt.includes(it)) score += 18;
    }
    if (wa && ia) {
      if (ia === wa) score += 35;
      else if (ia.includes(wa) || wa.includes(ia)) score += 24;
      else {
        const waFirst = wa.split(" ")[0];
        if (waFirst && waFirst.length > 2 && ia.includes(waFirst)) score += 12;
      }
    }
    if (wantDur > 0 && item.duration) {
      const diff = Math.abs(Number(item.duration) - wantDur);
      if (diff <= 3) score += 18;
      else if (diff <= 10) score += 10;
      else if (diff <= 25) score += 4;
    }
    if (score > bestScore) {
      bestScore = score;
      best = parsed;
    }
  }
  return best;
}

export async function lyricsFor(title, artist, duration) {
  const rawTitle = String(title || "").trim();
  const rawArtist = String(artist || "").trim();
  const t = tidyTitle(rawTitle);
  const a = tidyArtist(rawArtist);
  const dur = Math.max(0, Math.round(Number(duration) || 0));

  // Build candidate (track, artist) pairs to handle YouTube "Artist - Title",
  // "Title - Artist", "Title | Movie", and parenthetical suffixes.
  const stripParens = (s) =>
    String(s || "")
      .replace(/\s*[\[(][^)\]]*[)\]]/g, " ")
      .replace(/\s*["'“”‘’]/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();

  const coreTitle = stripParens(t) || t;
  const candidatePairs = [];
  const seenPairs = new Set();
  const addPair = (tr, ar) => {
    const ct = tidyTitle(tr).replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();
    const ca = tidyArtist(ar).trim();
    if (!ct) return;
    const k = `${ct.toLowerCase()}|${ca.toLowerCase()}`;
    if (seenPairs.has(k)) return;
    seenPairs.add(k);
    candidatePairs.push({ track: ct, artist: ca });
  };

  // If title contains " - " / " – " / " — " (common in YouTube videos like "Artist - Song")
  const dashParts = t.split(/\s+[-–—]\s+/).map((x) => x.trim()).filter(Boolean);
  if (dashParts.length >= 2) {
    const left = dashParts[0];
    const right = dashParts.slice(1).join(" - ");
    // If artist is missing or matches left, prefer right as the song title
    if (!a || normLyricToken(left) === normLyricToken(a) || normLyricToken(a).includes(normLyricToken(left))) {
      addPair(right, a || left);
      addPair(stripParens(right), a || left);
    }
    addPair(t, a);
    addPair(right, left);
    addPair(left, right);
  }

  addPair(t, a);
  if (coreTitle && coreTitle !== t) addPair(coreTitle, a);
  if (a) {
    // Also strip leading "Artist - " if still attached
    const escapedA = a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const strippedLead = coreTitle.replace(new RegExp(`^${escapedA}\\s*[-–—:|]\\s*`, "i"), "").trim();
    if (strippedLead && strippedLead !== coreTitle) addPair(strippedLead, a);
  }

  const UA = `${APP_NAME}/${APP_VERSION} (https://github.com/Kaibshshdheueejw/Muchi)`;
  const lrcHeaders = {
    "User-Agent": UA,
    "X-User-Agent": UA,
    "Lrclib-Client": `${APP_NAME}/${APP_VERSION}`,
    Accept: "application/json",
  };

  const tries = [];
  const seenUrls = new Set();
  const pushTry = (url) => {
    if (!url || seenUrls.has(url)) return;
    seenUrls.add(url);
    tries.push({ url, headers: lrcHeaders });
  };

  const primary = candidatePairs[0] || { track: coreTitle || t, artist: a };

  for (const pair of candidatePairs.slice(0, 4)) {
    if (pair.artist && pair.track) {
      if (dur > 0) {
        const getWithDur = new URLSearchParams({
          artist_name: pair.artist,
          track_name: pair.track,
          duration: String(dur),
        });
        pushTry(`https://lrclib.net/api/get?${getWithDur.toString()}`);
      }
      const getNoDur = new URLSearchParams({
        artist_name: pair.artist,
        track_name: pair.track,
      });
      pushTry(`https://lrclib.net/api/get?${getNoDur.toString()}`);

      const searchStructured = new URLSearchParams({
        track_name: pair.track,
        artist_name: pair.artist,
      });
      pushTry(`https://lrclib.net/api/search?${searchStructured.toString()}`);
      pushTry(`https://lrclib.net/api/search?q=${encodeURIComponent(`${pair.artist} ${pair.track}`)}`);
    }
  }

  // Title-focused searches in case the artist was a YouTube channel or collab string
  if (primary.track) {
    const searchTitleOnly = new URLSearchParams({ track_name: primary.track });
    pushTry(`https://lrclib.net/api/search?${searchTitleOnly.toString()}`);
    pushTry(`https://lrclib.net/api/search?q=${encodeURIComponent(primary.track)}`);
  }

  for (const { url, headers } of tries) {
    try {
      const data = await fetchJSON(url, { headers }, 7500);
      if (Array.isArray(data)) {
        const best = pickBestLyricsHit(data, primary.track, primary.artist, dur);
        if (best) return best;
      } else {
        const parsed = parseLyricsHit(data);
        if (parsed) return parsed;
      }
    } catch {}
  }

  // Stage 2: Canonicalize via iTunes Search API when YouTube/uploader metadata is noisy
  const lookupQ = [primary.track, primary.artist].filter(Boolean).join(" ").trim();
  if (lookupQ) {
    try {
      const it = await itunesSearch(lookupQ, { includeExtra: false });
      const topSong = it && Array.isArray(it.songs) && it.songs[0];
      if (topSong && topSong.title) {
        const canonT = tidyTitle(topSong.title);
        const canonA = tidyArtist(topSong.artist);
        const canonUrls = [];
        if (canonA && canonT) {
          const s1 = new URLSearchParams({ track_name: canonT, artist_name: canonA });
          canonUrls.push(`https://lrclib.net/api/search?${s1.toString()}`);
          canonUrls.push(`https://lrclib.net/api/search?q=${encodeURIComponent(`${canonA} ${canonT}`)}`);
        }
        for (const u of canonUrls) {
          if (seenUrls.has(u)) continue;
          seenUrls.add(u);
          try {
            const data = await fetchJSON(u, { headers: lrcHeaders }, 7000);
            const best = Array.isArray(data)
              ? pickBestLyricsHit(data, canonT, canonA, topSong.duration || dur)
              : parseLyricsHit(data);
            if (best) return best;
          } catch {}
        }
        if (canonA && canonT) {
          addPair(canonT, canonA);
        }
      }
    } catch {}
  }

  // Stage 3: Fallback to lyrics.ovh for plain lyrics when LRCLIB doesn't have the song
  for (const pair of candidatePairs.slice(0, 3)) {
    if (!pair.artist || !pair.track) continue;
    try {
      const ovh = await fetchJSON(
        `https://api.lyrics.ovh/v1/${encodeURIComponent(pair.artist)}/${encodeURIComponent(pair.track)}`,
        {},
        6500
      );
      if (ovh && typeof ovh.lyrics === "string" && ovh.lyrics.trim()) {
        const cleaned = ovh.lyrics
          .replace(/^Paroles de la chanson .*?\r?\n/i, "")
          .trim();
        if (cleaned) {
          return { lyrics: cleaned, synced: [], title: pair.track, artist: pair.artist };
        }
      }
    } catch {}
  }

  return { lyrics: "", synced: [] };
}

// Resolves a real YouTube Music playlist for a query (server.js:1380).
export async function resolveShelfPlaylist(query, gl) {
  if (!query) return null;
  try {
    const r = await youtubeMusicSearch(`${query} playlist`, gl, 6000, { limit: 24 });
    const hit = pickPlaylistHit(r && r.playlists, query);
    if (!hit) return null;
    // Carry up to 20 English-only tracks so "Made for you" cards are fully
    // populated (and show the real song count) even before the user opens
    // them — and so Hindi/regional songs never sneak into the English row.
    const tracks = (r && Array.isArray(r.tracks) ? r.tracks : [])
      .filter((t) => t && t.videoId && isEnglishTrack(t))
      .slice(0, 20);
    return { playlistId: hit.playlistId, title: hit.title, artwork: hit.artwork, tracks };
  } catch {
    return null;
  }
}
