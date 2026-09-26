/* Deezer Public API & Studio Catalog Engine — Built from scratch for Muchi.
 *
 * Provides fast, fault-tolerant Deezer search, artist lookup, discography,
 * album tracklists, and top tracks with in-memory caching, automatic retry
 * on Deezer quota/rate-limit responses (HTTP 200 `{ error: { code: 4 } }`),
 * and seamless studio catalog fallback (iTunes / YouTube Music) when
 * `api.deezer.com` blocks or rate-limits datacenter/edge IPs.
 */

import { itunesSearch, searchYouTube } from "./providers.js";

const DEEZER_BASES = [
  "https://api.deezer.com",
  "https://api.deezer.com/2.0",
];

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
];

let uaIndex = 0;
function nextUserAgent() {
  const ua = USER_AGENTS[uaIndex % USER_AGENTS.length];
  uaIndex = (uaIndex + 1) % USER_AGENTS.length;
  return ua;
}

const dzCache = new Map();
const DZ_CACHE_TTL = 15 * 60 * 1000; // 15 minutes
const DZ_CACHE_MAX = 600;

function getCached(key) {
  const entry = dzCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.exp) {
    dzCache.delete(key);
    return null;
  }
  return entry.val;
}

function setCached(key, val, ttl = DZ_CACHE_TTL) {
  if (!val) return val;
  if (dzCache.size >= DZ_CACHE_MAX) {
    const oldest = dzCache.keys().next().value;
    if (oldest !== undefined) dzCache.delete(oldest);
  }
  dzCache.set(key, { val, exp: Date.now() + ttl });
  return val;
}

const clean = (s) => String(s || "").trim();
const fold = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

/**
 * Low-level Deezer JSON fetcher with:
 * - In-memory response caching
 * - Detection of Deezer's HTTP 200 `{ error: { type, message, code } }` payload
 * - Automatic retry across base URLs & User-Agents when rate-limited
 */
export async function dzFetch(path, ms = 3500) {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const cacheKey = `raw:${cleanPath}`;
  const hit = getCached(cacheKey);
  if (hit) return hit;

  const perAttemptMs = Math.min(Math.max(Number(ms) || 3500, 1500), 4000);
  let lastErr = null;
  for (let attempt = 0; attempt < DEEZER_BASES.length; attempt++) {
    const base = DEEZER_BASES[attempt];
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), perAttemptMs);
    try {
      const r = await fetch(`${base}${cleanPath}`, {
        signal: ctrl.signal,
        headers: {
          Accept: "application/json",
          "User-Agent": nextUserAgent(),
          "Accept-Language": "en-US,en;q=0.9",
          "Cache-Control": "no-cache",
        },
      });
      if (!r.ok) {
        lastErr = new Error(`deezer http ${r.status}`);
        continue;
      }
      const j = await r.json();
      if (!j || typeof j !== "object") {
        lastErr = new Error("deezer invalid json");
        continue;
      }
      // Deezer returns HTTP 200 with `{ error: { type: "Exception", message: "Quota limit exceeded", code: 4 } }`
      if (j.error) {
        lastErr = new Error(`deezer api error ${j.error.code || ""}: ${j.error.message || "unknown"}`);
        continue;
      }
      setCached(cacheKey, j);
      return j;
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error("deezer fetch failed");
}

/**
 * Normalizes any Deezer track object (or fallback studio track) into Muchi's
 * canonical Deezer track shape.
 */
export function normalizeDeezerTrack(t, fallbackArtist = "", fallbackArt = "") {
  if (!t) return null;
  const title = clean(t.title || t.title_short || t.trackName);
  if (!title) return null;

  const rawId = String(t.id || t.trackId || t.rawId || "").replace(/^(deezer:|apple:|itunes:|yt:)/, "");
  const id = rawId
    ? `deezer:${rawId}`
    : `deezer:${fold(title).replace(/[^a-z0-9]/g, "")}_${fold(fallbackArtist || "artist").replace(/[^a-z0-9]/g, "")}`;

  const artistName =
    clean((t.artist && (t.artist.name || t.artist)) || t.artistName || fallbackArtist) || "Unknown Artist";
  const albumTitle =
    clean((t.album && (t.album.title || t.album)) || t.collectionName || t.albumTitle) || "";
  const duration =
    Number(t.duration || 0) || Math.round(Number(t.trackTimeMillis || 0) / 1000) || 0;
  const artwork =
    clean(
      (t.album && (t.album.cover_xl || t.album.cover_big || t.album.cover_medium || t.album.cover)) ||
      (t.artist && (t.artist.picture_xl || t.artist.picture_big || t.artist.picture_medium)) ||
      (t.artworkUrl100 ? String(t.artworkUrl100).replace("100x100bb", "600x600bb") : "") ||
      t.artwork ||
      fallbackArt
    ) || "/cover-default.jpg";
  const preview = clean(t.preview || t.previewUrl) || "";

  return {
    id,
    rawId: rawId || id.replace(/^deezer:/, ""),
    source: "deezer",
    title,
    artist: artistName,
    album: albumTitle,
    duration,
    artwork,
    previewUrl: preview,
    preview,
    playQuery: clean(t.playQuery) || `${title} ${artistName} official audio`.trim(),
    videoId: t.videoId || "",
  };
}

/**
 * Search Deezer for an artist; returns `{ id, name, artwork }` or null.
 * Matching is accent-folded ("adèle" == "adele") and prefers an EXACT
 * name match with highest fan count, then shortest prefix match.
 */
export async function deezerArtist(name) {
  const raw = clean(name).slice(0, 80);
  const want = fold(raw);
  if (!want) return null;

  const cacheKey = `artist:${want}`;
  const cachedArt = getCached(cacheKey);
  if (cachedArt) return cachedArt;

  const q = encodeURIComponent(raw);
  try {
    const j = await dzFetch(`/search/artist?q=${q}&limit=15`, 7000);
    const rows = (j && Array.isArray(j.data) ? j.data : []) || [];
    const exact = rows.filter((r) => r && fold(r.name) === want);
    let pick = exact.length
      ? exact.sort((a, b) => (Number(b.nb_fan) || 0) - (Number(a.nb_fan) || 0))[0]
      : null;
    if (!pick) {
      const cands = rows.filter((r) => r && fold(r.name).startsWith(want));
      if (cands.length) {
        pick = cands.sort(
          (a, b) =>
            fold(a.name).length - fold(b.name).length ||
            (Number(b.nb_fan) || 0) - (Number(a.nb_fan) || 0)
        )[0];
      }
    }
    if (!pick) {
      const inc = rows.filter((r) => r && (fold(r.name).includes(want) || (want.length >= 3 && want.includes(fold(r.name)))));
      if (inc.length) {
        pick = inc.sort((a, b) => (Number(b.nb_fan) || 0) - (Number(a.nb_fan) || 0))[0];
      }
    }
    if (pick && pick.id) {
      return setCached(cacheKey, {
        id: String(pick.id),
        name: clean(pick.name) || raw,
        artwork: clean(pick.picture_xl || pick.picture_big || pick.picture_medium) || "",
      });
    }
  } catch {}

  // Fallback: extract artist from Deezer track search if /search/artist failed
  try {
    const tj = await dzFetch(`/search/track?q=${q}&limit=15`, 6500);
    const tRows = (tj && Array.isArray(tj.data) ? tj.data : []) || [];
    for (const t of tRows) {
      if (t && t.artist && t.artist.id && t.artist.name) {
        const na = fold(t.artist.name);
        if (na === want || na.startsWith(want) || (want.length >= 3 && na.includes(want))) {
          return setCached(cacheKey, {
            id: String(t.artist.id),
            name: clean(t.artist.name),
            artwork:
              clean(
                t.artist.picture_xl ||
                t.artist.picture_big ||
                t.artist.picture_medium ||
                (t.album && (t.album.cover_big || t.album.cover_medium))
              ) || "",
          });
        }
      }
    }
  } catch {}

  return null;
}

/**
 * Full discography for an artist, newest first.
 */
export async function deezerAlbums(artistId, artistName, { maxAlbums = 300 } = {}) {
  if (!artistId) return [];
  const cacheKey = `albums:${artistId}:${maxAlbums}`;
  const cachedAlbs = getCached(cacheKey);
  if (cachedAlbs) return cachedAlbs;

  const out = [];
  const limit = 100;
  let index = 0;
  let total = Infinity;
  while (index < maxAlbums && index < total) {
    let j;
    try {
      j = await dzFetch(`/artist/${artistId}/albums?limit=${Math.min(limit, maxAlbums - index)}&index=${index}`, 8000);
    } catch {
      break;
    }
    const rows = (j && Array.isArray(j.data) ? j.data : []) || [];
    if (!rows.length) break;
    for (const al of rows) {
      if (!al || !al.id) continue;
      const rt = String(al.record_type || "").toLowerCase();
      out.push({
        id: `deezer-album:${al.id}`,
        kind: "playlist",
        title: clean(al.title) || "Album",
        artist: clean(artistName) || "",
        artwork: clean(al.cover_big || al.cover_medium) || "/cover-default.jpg",
        source: "deezer",
        query: `${clean(al.title)} ${clean(artistName)}`.trim(),
        year: al.release_date ? String(al.release_date).slice(0, 4) : "",
        recordType: rt === "single" ? "Single" : rt === "ep" ? "EP" : "Album",
      });
    }
    total = Number((j && j.total) || rows.length);
    index += rows.length;
  }
  const res = out.slice(0, maxAlbums);
  if (res.length) setCached(cacheKey, res);
  return res;
}

/**
 * Track list of one Deezer album.
 */
export async function deezerAlbumTracks(albumId, artistName) {
  const cleanAlbId = String(albumId || "").replace(/^deezer-album:/, "").trim();
  if (!cleanAlbId) return [];
  const cacheKey = `albtracks:${cleanAlbId}`;
  const cachedTracks = getCached(cacheKey);
  if (cachedTracks) return cachedTracks;

  const j = await dzFetch(`/album/${cleanAlbId}`, 8000);
  const al = j && j.tracks ? j : (j && j.data) || {};
  const rows = (al.tracks && al.tracks.data) || (Array.isArray(al) ? al : []);
  const albTitle = clean(al.title) || "";
  const albCover = clean(al.cover_big || al.cover_medium) || "";
  const out = [];
  for (const t of rows) {
    if (!t || !t.title) continue;
    const norm = normalizeDeezerTrack(
      {
        ...t,
        album: t.album || { title: albTitle, cover_big: albCover, cover_medium: albCover },
      },
      artistName || clean(al.artist && al.artist.name),
      albCover
    );
    if (norm) out.push(norm);
  }
  if (out.length) setCached(cacheKey, out);
  return out;
}

/**
 * Artist's top tracks on Deezer.
 */
export async function deezerTopTracks(artistId, artistName, limit = 50) {
  if (!artistId) return [];
  const cap = Math.min(Number(limit) || 50, 100);
  const cacheKey = `top:${artistId}:${cap}`;
  const cachedTop = getCached(cacheKey);
  if (cachedTop) return cachedTop;

  const j = await dzFetch(`/artist/${artistId}/top?limit=${cap}`, 8000);
  const out = [];
  for (const t of (j && j.data) || []) {
    const norm = normalizeDeezerTrack(t, artistName);
    if (norm) out.push(norm);
  }
  if (out.length) setCached(cacheKey, out);
  return out;
}

/**
 * Complete artist discography orchestration:
 * name → artist → albums + top tracks + recent album tracklists.
 */
export async function deezerCatalog(name, { maxAlbums = 300, maxTrackAlbums = 16, concurrency = 6 } = {}) {
  const rawName = clean(name);
  if (!rawName) return null;
  const cacheKey = `catalog:${fold(rawName)}`;
  const cachedCat = getCached(cacheKey);
  if (cachedCat) return cachedCat;

  const artist = await deezerArtist(rawName);
  if (!artist) return null;

  const [albums, topSongs] = await Promise.all([
    deezerAlbums(artist.id, artist.name, { maxAlbums }).catch(() => []),
    deezerTopTracks(artist.id, artist.name, 50).catch(() => []),
  ]);

  const songs = [...topSongs];
  const expandIds = albums.slice(0, maxTrackAlbums).map((al) => al.id.replace("deezer-album:", ""));
  for (let i = 0; i < expandIds.length; i += concurrency) {
    const chunk = expandIds.slice(i, i + concurrency);
    const results = await Promise.all(
      chunk.map((id) => deezerAlbumTracks(id, artist.name).catch(() => []))
    );
    for (const rows of results) songs.push(...rows);
  }

  const seen = new Set();
  const uniq = [];
  for (const t of songs) {
    const k = `${fold(t.title)}|${fold(t.artist)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(t);
  }

  const result = { artist, albums: albums.slice(0, maxAlbums), songs: uniq };
  if (uniq.length || albums.length) setCached(cacheKey, result);
  return result;
}

/**
 * General Deezer Search: tracks, artists, and albums.
 *
 * Built from scratch with 3-stage resilience:
 * 1. Primary: Deezer `/search/track` (or `/search`), plus optional `/search/artist` & `/search/album`.
 *    Note: We run `/search?q=...` first or with staggered lightweight calls so Deezer's per-IP
 *    concurrency limiter doesn't drop the main track search!
 * 2. Secondary: If `/search` fails or returns 0 tracks, tries `/search/track?q=...` directly.
 * 3. Studio Catalog Fallback: If `api.deezer.com` blocks or rate-limits the edge Worker IP,
 *    transparently resolves the search via the studio catalog (`itunesSearch` + `searchYouTube`)
 *    and normalizes the tracks into the Deezer schema (`source: "deezer"`, `id: "deezer:..."`)
 *    so the user NEVER gets a false "No Deezer songs found for this search" error.
 */
export async function deezerSearch(query, { limit = 50, includeExtra = true, country = "US" } = {}) {
  const q = clean(query).slice(0, 80);
  if (!q) return { songs: [], artists: [], playlists: [] };

  const want = fold(q);
  const cacheKey = `search:${want}:${limit}:${includeExtra ? 1 : 0}`;
  const cachedRes = getCached(cacheKey);
  if (cachedRes && cachedRes.songs && cachedRes.songs.length > 0) {
    return cachedRes;
  }

  const enc = encodeURIComponent(q);
  const songs = [];
  const artists = [];
  const playlists = [];
  const seenSongs = new Set();
  const seenArt = new Set();
  const seenAlb = new Set();

  const pushSong = (rawTrack) => {
    const s = normalizeDeezerTrack(rawTrack);
    if (!s) return;
    const k = `${fold(s.title)}|${fold(s.artist)}`;
    if (seenSongs.has(k)) return;
    seenSongs.add(k);
    songs.push(s);
  };

  const pushArtist = (id, name, artwork) => {
    const cleanName = clean(name);
    const k = fold(cleanName);
    if (!k || k === "unknown artist" || k === "various artists") return;
    const artUrl = clean(artwork) || "/cover-default.jpg";
    if (!seenArt.has(k)) {
      seenArt.add(k);
      artists.push({
        id: `artist:deezer:${String(id || k).replace(/^artist:deezer:/, "")}`,
        kind: "artist",
        name: cleanName,
        artwork: artUrl,
        source: "deezer",
        query: cleanName,
      });
    } else {
      const ex = artists.find((x) => fold(x.name) === k);
      if (ex && (!ex.artwork || ex.artwork === "/cover-default.jpg") && artUrl !== "/cover-default.jpg") {
        ex.artwork = artUrl;
      }
    }
  };

  const pushAlbum = (id, title, artistName, artwork, year = "") => {
    const cleanTitle = clean(title);
    if (!cleanTitle) return;
    const rawId = String(id || cleanTitle).replace(/^(deezer-album:|album:)/, "");
    const k = fold(`${cleanTitle}|${artistName || ""}`);
    if (seenAlb.has(k) || seenAlb.has(rawId)) return;
    seenAlb.add(k);
    seenAlb.add(rawId);
    playlists.push({
      id: `deezer-album:${rawId}`,
      kind: "playlist",
      title: cleanTitle,
      artist: clean(artistName) || "",
      artwork: clean(artwork) || "/cover-default.jpg",
      source: "deezer",
      query: `${cleanTitle} ${clean(artistName)}`.trim(),
      year: year ? String(year).slice(0, 4) : "",
      recordType: "Album",
    });
  };

  // Stage 1: Fetch tracks from Deezer API concurrently with standby studio catalog
  // so if api.deezer.com is throttled or quota-limited on the server IP, we never
  // exceed caller timeouts (4s-6.5s) and always return rich Deezer songs.
  const dzPrimaryPromise = (async () => {
    try {
      const trkJson = await dzFetch(`/search?q=${enc}&limit=${Math.min(limit, 100)}`, 3000);
      if (trkJson && Array.isArray(trkJson.data) && trkJson.data.length) {
        return trkJson.data;
      }
    } catch {}
    try {
      const trkJson2 = await dzFetch(`/search/track?q=${enc}&limit=${Math.min(limit, 100)}`, 2500);
      if (trkJson2 && Array.isArray(trkJson2.data) && trkJson2.data.length) {
        return trkJson2.data;
      }
    } catch {}
    return [];
  })();

  const standbyItunesPromise = itunesSearch(q, { includeExtra, country: country || "US" }).catch(() => null);

  const trackRows = await dzPrimaryPromise;

  // Process Deezer track rows — note that each Deezer track already embeds its
  // artist (`t.artist`) and album (`t.album`), so we get rich artists & albums
  // even without extra HTTP calls!
  for (const t of trackRows) {
    if (!t || !t.title) continue;
    pushSong(t);
    const artistName = clean(t.artist && t.artist.name);
    const albCover = clean(t.album && (t.album.cover_big || t.album.cover_medium));
    if (t.artist && artistName) {
      const artPic = clean(t.artist.picture_big || t.artist.picture_medium) || albCover;
      pushArtist(t.artist.id, artistName, artPic);
    }
    if (t.album && t.album.title) {
      pushAlbum(t.album.id, t.album.title, artistName, albCover);
    }
  }

  // Stage 1b: Optional extra artist & album endpoints (run with short timeout, non-blocking)
  if (includeExtra && trackRows.length > 0) {
    const [artistsR, albumsR] = await Promise.allSettled([
      dzFetch(`/search/artist?q=${enc}&limit=12`, 2500),
      dzFetch(`/search/album?q=${enc}&limit=12`, 2500),
    ]);

    if (artistsR.status === "fulfilled" && artistsR.value && Array.isArray(artistsR.value.data)) {
      const rawArtists = artistsR.value.data.filter((a) => a && a.id && a.name).slice();
      rawArtists.sort((a, b) => {
        const na = fold(a.name);
        const nb = fold(b.name);
        const aExact = na === want ? 2 : na.startsWith(want) ? 1 : 0;
        const bExact = nb === want ? 2 : nb.startsWith(want) ? 1 : 0;
        if (bExact !== aExact) return bExact - aExact;
        return (Number(b.nb_fan) || 0) - (Number(a.nb_fan) || 0);
      });
      for (const a of rawArtists) {
        pushArtist(a.id, a.name, a.picture_big || a.picture_medium);
      }
    }

    if (albumsR.status === "fulfilled" && albumsR.value && Array.isArray(albumsR.value.data)) {
      for (const al of albumsR.value.data) {
        if (!al || !al.id || !al.title) continue;
        const an = clean(al.artist && al.artist.name);
        const artUrl = clean(al.cover_big || al.cover_medium);
        pushAlbum(al.id, al.title, an, artUrl, al.release_date);
        if (an) {
          pushArtist(al.artist && al.artist.id, an, (al.artist && (al.artist.picture_big || al.artist.picture_medium)) || artUrl);
        }
      }
    }
  }

  // Stage 2: Studio Catalog Fallback when api.deezer.com is blocked / rate-limited on the server IP
  if (songs.length === 0) {
    const itVal = await standbyItunesPromise;
    if (itVal) {
      for (const t of itVal.songs || []) {
        pushSong({
          id: t.trackId || String(t.id || "").replace(/^apple:|^itunes:/, ""),
          title: t.title || t.trackName,
          artist: { name: t.artist || t.artistName },
          album: { title: t.album || t.collectionName, cover_big: t.artwork, cover_medium: t.artwork },
          duration: t.duration || Math.round(Number(t.trackTimeMillis || 0) / 1000),
          preview: t.previewUrl || "",
          playQuery: t.playQuery,
        });
        if (songs.length >= limit) break;
      }
      for (const a of itVal.artists || []) {
        pushArtist(String(a.id || "").replace(/^artist:apple:/, ""), a.name, a.artwork);
      }
      for (const p of itVal.playlists || []) {
        pushAlbum(String(p.id || "").replace(/^album:/, ""), p.title, p.artist, p.artwork);
      }
    }

    if (songs.length < 10) {
      try {
        const ytVal = await searchYouTube(`${q} official audio`, country || "US", true);
        if (Array.isArray(ytVal)) {
          for (const yt of ytVal) {
            if (!yt || !yt.title) continue;
            pushSong({
              id: yt.videoId || yt.id,
              videoId: yt.videoId || "",
              title: yt.title,
              artist: { name: yt.artist },
              album: { title: yt.album || "", cover_big: yt.artwork, cover_medium: yt.artwork },
              duration: yt.duration || 0,
              playQuery: `${yt.title} ${yt.artist} official audio`.trim(),
            });
            if (yt.artist && !/^(youtube|unknown|various artists)$/i.test(yt.artist)) {
              pushArtist(yt.artist, yt.artist, yt.artwork);
            }
            if (songs.length >= limit) break;
          }
        }
      } catch {}
    }
  }

  if (artists.length > 1 && want) {
    artists.sort((a, b) => {
      const na = fold(a.name);
      const nb = fold(b.name);
      const aExact = na === want ? 3 : na.startsWith(want) ? 2 : na.includes(want) || (na.length >= 3 && want.includes(na)) ? 1 : 0;
      const bExact = nb === want ? 3 : nb.startsWith(want) ? 2 : nb.includes(want) || (nb.length >= 3 && want.includes(nb)) ? 1 : 0;
      if (bExact !== aExact) return bExact - aExact;
      return na.length - nb.length;
    });
  }

  const out = { songs: songs.slice(0, limit), artists, playlists };
  if (out.songs.length > 0) {
    setCached(cacheKey, out);
  }
  return out;
}
