// MUCHI — external providers, ported VERBATIM from server.js
// (youtubeMusicSearch/youtubeWebSearch/pipedSearch/searchYouTube lines
// 720–884, itunes 905–963, playlist browse 963–1037, audius 1037–1060 +
// 1189–1209, radio 1060–1189, lyrics 1209–1262, resolveShelfPlaylist
// 1380–1393). Response shapes are unchanged.

import { fetchJSON, codecMatch, tidyTitle, tidyArtist } from "./util.js";
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
  const extra = { limit: fast ? 24 : 120, loose: !fast };
  const jobs = fast
    ? [youtubeMusicSearch(query, gl, 6000, extra)]
    : [
        youtubeMusicSearch(query, gl, 6500, { ...extra, params: YT_SONGS_PARAMS }),
        youtubeMusicSearch(query, gl, 6500, extra),
        youtubeWebSearch(query, gl, 6500, extra),
      ];
  const settled = await Promise.allSettled(jobs);
  for (const s of settled) {
    if (s.status === "fulfilled") add(s.value);
    else errors.push(String(s.reason && s.reason.message ? s.reason.message : s.reason));
  }
  if (!out.length) {
    try {
      add(await pipedSearch(query));
    } catch (e) {
      errors.push(String(e.message || e));
    }
  }
  if (!out.length) throw new Error(errors.join(" | ") || "YouTube search failed");
  const qn = String(query || "").toLowerCase().trim();
  const words = qn.split(/\s+/).filter((w) => w.length > 1);
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
const PIPED_API_TIMEOUT = 5000;

export function pickPipedStream(data) {
  const streams = (data && data.audioStreams) || [];
  if (!streams.length) return null;
  // Prefer m4a/mp4 (best native ExoPlayer/AVPlayer compatibility), then
  // opus/webm. Lower quality numbers are the "best" on Piped.
  const byType = (re) => streams.find((s) => s && s.url && re.test(String(s.mimeType || "") + " " + String(s.format || "")));
  const m4a = byType(/mp4|m4a|mpeg|aac/i);
  const opus = byType(/opus|webm|ogg|vorbis/i);
  const best = m4a || opus || streams.find((s) => s && s.url);
  if (!best || !best.url) return null;
  return {
    url: best.url,
    format: best.format || (m4a ? "m4a" : "opus"),
    mimeType: best.mimeType || "",
    quality: best.quality || "",
    duration: (data && data.duration) || 0,
  };
}

export async function youtubeAudioStream(videoId) {
  const id = String(videoId || "").trim();
  if (!id) return null;
  const attempts = PIPED_STREAM_INSTANCES.map((base) =>
    fetchJSON(`${base}/streams/${encodeURIComponent(id)}`, {}, PIPED_API_TIMEOUT)
  );
  try {
    const data = await Promise.any(attempts);
    const picked = pickPipedStream(data);
    if (picked) return picked;
  } catch (e) {
    // Promise.any rejects only if ALL instances failed.
    throw new Error("all piped stream instances failed");
  }
  throw new Error("no audio stream");
}

export function mapAudiusTrack(t) {
  if (!t || !t.id) return null;
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
    artwork: art["480x480"] || art["1000x1000"] || art["150x150"] || "/cover-default.png",
    genre: t.genre || "",
    mood: t.mood || "",
    plays: t.play_count || 0,
    permalink: t.permalink || "",
    streamUrl: (t.stream && t.stream.url) || "",
  };
}

export async function itunesSearch(query) {
  const q = encodeURIComponent(query);
  const [songsR, artistsR, albumsR] = await Promise.allSettled([
    fetchJSON(`https://itunes.apple.com/search?term=${q}&media=music&entity=song&limit=50`, {}, 6000),
    fetchJSON(`https://itunes.apple.com/search?term=${q}&media=music&entity=musicArtist&limit=20`, {}, 6000),
    fetchJSON(`https://itunes.apple.com/search?term=${q}&media=music&entity=album&limit=25`, {}, 6000),
  ]);
  const songs = [];
  const artists = [];
  const playlists = [];
  if (songsR.status === "fulfilled") {
    for (const t of (songsR.value && songsR.value.results) || []) {
      if (!t.trackId) continue;
      songs.push({
        id: `apple:${t.trackId}`,
        source: "apple",
        title: t.trackName || "Song",
        artist: t.artistName || "Artist",
        album: t.collectionName || "",
        duration: Math.round((t.trackTimeMillis || 0) / 1000),
        artwork: String(t.artworkUrl100 || "").replace("100x100bb", "400x400bb") || "/cover-default.png",
        playQuery: `${t.trackName || ""} ${t.artistName || ""} official audio`.trim(),
      });
    }
  }
  if (artistsR.status === "fulfilled") {
    for (const a of (artistsR.value && artistsR.value.results) || []) {
      if (!a.artistName) continue;
      artists.push({
        id: `artist:apple:${a.artistId || a.artistName}`,
        kind: "artist",
        name: a.artistName,
        artwork: a.artworkUrl100 || "/cover-default.png",
        source: "apple",
        query: a.artistName,
      });
    }
  }
  if (albumsR.status === "fulfilled") {
    for (const al of (albumsR.value && albumsR.value.results) || []) {
      if (!al.collectionId) continue;
      playlists.push({
        id: `album:${al.collectionId}`,
        kind: "playlist",
        title: al.collectionName || "Album",
        artist: al.artistName || "Apple Music",
        artwork: String(al.artworkUrl100 || "").replace("100x100bb", "400x400bb") || "/cover-default.png",
        source: "apple",
        query: `${al.collectionName || ""} ${al.artistName || ""}`.trim(),
      });
    }
  }
  return { songs, artists, playlists };
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
  try {
    const data = await fetchJSON(`https://api.audius.co/v1/tracks/${id}?app_name=${APP_NAME}`);
    const t = (data && data.data) || {};
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
      artwork: s.favicon || "/cover-default.png",
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
    artwork: (u.profile_picture && (u.profile_picture["480x480"] || u.profile_picture["150x150"])) || "/cover-default.png",
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
  const lyrics = hit.plainLyrics || "";
  if (!lyrics && !synced.length) return null;
  return { lyrics, synced, title: hit.trackName, artist: hit.artistName };
}

export async function lyricsFor(title, artist) {
  const t = tidyTitle(title);
  const a = tidyArtist(artist);
  const tries = [];
  if (a && t) {
    tries.push(`https://lrclib.net/api/get?artist_name=${encodeURIComponent(a)}&track_name=${encodeURIComponent(t)}`);
  }
  const q = [a, t].filter(Boolean).join(" ");
  if (q) tries.push(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`);
  if (t) tries.push(`https://lrclib.net/api/search?track_name=${encodeURIComponent(t)}&artist_name=${encodeURIComponent(a)}`);
  for (const url of tries) {
    try {
      const data = await fetchJSON(url, {}, 10000);
      if (Array.isArray(data)) {
        const hit = data.find((x) => x.plainLyrics || x.syncedLyrics) || data[0];
        const parsed = parseLyricsHit(hit);
        if (parsed) return parsed;
      } else {
        const parsed = parseLyricsHit(data);
        if (parsed) return parsed;
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
    return { playlistId: hit.playlistId, title: hit.title, artwork: hit.artwork };
  } catch {
    return null;
  }
}
