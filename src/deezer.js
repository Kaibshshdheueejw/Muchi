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
    .replace(/\$/g, "s")
    .replace(/p!nk/g, "pink")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
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
  const artistId = clean((t.artist && t.artist.id) || t.artistId || "");
  const artistPicture = clean(
    (t.artist && (t.artist.picture_xl || t.artist.picture_big || t.artist.picture_medium)) ||
    t.artistPicture ||
    ""
  );
  return {
    id,
    rawId: rawId || id.replace(/^deezer:/, ""),
    source: "deezer",
    title,
    artist: artistName,
    artistId,
    artistPicture,
    album: albumTitle,
    duration,
    artwork,
    previewUrl: "",
    preview: "",
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
  const isOneEditAway = (a, b) => {
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, edits = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++edits > 1) return false;
      if (a.length > b.length) i++;
      else if (b.length > a.length) j++;
      else { i++; j++; }
    }
    return edits + (a.length - i) + (b.length - j) <= 1;
  };
  try {
    const j = await dzFetch(`/search/artist?q=${q}&limit=25`, 7000);
    let rows = (j && Array.isArray(j.data) ? j.data : []) || [];
    const maxFansInRows = rows.reduce((m, r) => Math.max(m, Number(r && r.nb_fan) || 0), 0);
    if (maxFansInRows < 5000 && want.includes(" ")) {
      const lastWord = want.split(" ").pop();
      if (lastWord && lastWord.length >= 4) {
        const j2 = await dzFetch(`/search/artist?q=${encodeURIComponent(lastWord)}&limit=25`, 4500).catch(() => null);
        if (j2 && Array.isArray(j2.data)) rows = [...rows, ...j2.data];
      }
    }
    const exact = rows.filter((r) => r && (fold(r.name) === want || isOneEditAway(fold(r.name), want)));
    const cands = rows.filter((r) => r && (fold(r.name).startsWith(want + " ") || fold(r.name) === "the " + want || fold(r.name).startsWith(want)));
    const bestExact = exact.length
      ? exact.sort((a, b) => (Number(b.nb_fan) || 0) - (Number(a.nb_fan) || 0))[0]
      : null;
    const bestPrefix = cands.length
      ? cands.slice().sort((a, b) => (Number(b.nb_fan) || 0) - (Number(a.nb_fan) || 0))[0]
      : null;
    let pick = bestExact;
    if (
      bestPrefix &&
      (!pick ||
        ((Number(bestPrefix.nb_fan) || 0) >= 200000 &&
          (Number(bestPrefix.nb_fan) || 0) > (Number(pick.nb_fan) || 0) * 4))
    ) {
      pick = bestPrefix;
    }
    if (!pick && cands.length) {
      pick = cands.sort(
        (a, b) =>
          (Number(b.nb_fan) || 0) - (Number(a.nb_fan) || 0) ||
          fold(a.name).length - fold(b.name).length
      )[0];
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
 * Genuinely similar / related artists on Deezer (/artist/{id}/related).
 */
export async function deezerRelatedArtists(artistId, limit = 12) {
  if (!artistId) return [];
  const cap = Math.min(Number(limit) || 12, 30);
  const cacheKey = `relart:${artistId}:${cap}`;
  const cachedRel = getCached(cacheKey);
  if (cachedRel) return cachedRel;

  try {
    const j = await dzFetch(`/artist/${artistId}/related?limit=${cap}`, 5000);
    const out = [];
    for (const a of (j && j.data) || []) {
      if (!a || !a.name) continue;
      out.push({
        id: String(a.id || ""),
        name: clean(a.name),
        artwork: clean(a.picture_xl || a.picture_big || a.picture_medium) || "",
      });
    }
    if (out.length) setCached(cacheKey, out);
    return out;
  } catch {
    return [];
  }
}

/**
 * Curated artist radio tracks on Deezer (/artist/{id}/radio) — blends similar artists & songs in the same vibe.
 */
export async function deezerArtistRadio(artistId, limit = 25) {
  if (!artistId) return [];
  const cap = Math.min(Number(limit) || 25, 50);
  const cacheKey = `artradio:${artistId}:${cap}`;
  const cachedRad = getCached(cacheKey);
  if (cachedRad) return cachedRad;

  try {
    const j = await dzFetch(`/artist/${artistId}/radio?limit=${cap}`, 5000);
    const out = [];
    for (const t of (j && j.data) || []) {
      const norm = normalizeDeezerTrack(t);
      if (norm) out.push(norm);
    }
    if (out.length) setCached(cacheKey, out);
    return out;
  } catch {
    return [];
  }
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
  const prioritizedAlbums = albums.slice().sort((a, b) => {
    const rankType = (rt) => (rt === "Album" ? 0 : rt === "EP" ? 1 : 2);
    return rankType(a && a.recordType) - rankType(b && b.recordType);
  });
  const expandIds = prioritizedAlbums.slice(0, maxTrackAlbums).map((al) => al.id.replace("deezer-album:", ""));
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
function parseDeezerQueryIntent(rawQuery) {
  const q = clean(rawQuery).slice(0, 80);
  let songHint = "";
  let artistHint = "";
  let hasExplicitSplit = false;

  const byMatch = q.match(/^(.+?)\s+\bby\b\s+(.+)$/i);
  if (byMatch) {
    songHint = byMatch[1].replace(/^["'\s]+|["'\s]+$/g, "").trim();
    artistHint = byMatch[2].replace(/^["'\s]+|["'\s]+$/g, "").trim();
    hasExplicitSplit = true;
  } else {
    const dashMatch = q.match(/^(.+?)\s+[-–—|]\s+(.+)$/);
    if (dashMatch) {
      songHint = dashMatch[1].trim();
      artistHint = dashMatch[2].trim();
      hasExplicitSplit = true;
    }
  }

  const cleanQuery = hasExplicitSplit
    ? `${songHint} ${artistHint}`.replace(/\s+/g, " ").trim()
    : q.replace(/\s+\bby\b\s+/gi, " ").replace(/\s+/g, " ").trim();

  const stopWords = new Set(["by", "the", "a", "an", "of", "in", "on", "to", "for", "with", "feat", "ft", "featuring", "song", "songs", "music", "official", "audio", "video", "lyrics"]);
  const allTokens = fold(cleanQuery).split(" ").filter((w) => w.length >= 2 && !stopWords.has(w));
  const songFold = fold(songHint);
  const artistFold = fold(artistHint);
  const wantsInstrumental = /\b(instrumental|karaoke|backing\s*track|piano\s*version|lofi|ambient|classical|score|soundtrack)\b/i.test(q);

  return {
    raw: q,
    cleanQuery,
    foldQuery: fold(cleanQuery),
    songHint,
    artistHint,
    songFold,
    artistFold,
    hasExplicitSplit,
    allTokens,
    wantsInstrumental,
  };
}

const DZ_UNRELATED_INSTRUMENTAL_RE = /\b(instrumental|karaoke|backing\s+track|originally\s+performed\s+by|in\s+the\s+style\s+of|made\s+famous\s+by|tribute\s+to|ringtone|8-bit|lullaby\s+rendition|music\s+box|piano\s+rendition|piano\s+version|guitar\s+version|shortened|arr\.\s*by|arranged\s+by|string\s+quartet|orchestral\s+rendition|music\s+for\s+babies|sleep\s+music|white\s+noise|sound\s+effects?|minus\s+one|no\s+lead\s+vocal|with\s+background\s+vocals|lower\s+key|higher\s+key|vocal\s+version|demo\s+version|remix\s+of|cover\s+of|version\s+of)\b/i;
const DZ_JUNK_PERFORMER_RE = /\b(sing2piano|don't\s+stop\s+piano|piano\s+nest|karaoke|tribute|hit\s+crew|party\s+tyme|ameritz|prosource|starlite|8-bit|lullaby|baby\s+einstein|vitamin\s+string|music\s+box|piano\s+guys|soundtrack\s+orchestra|various\s+artists|unknown\s+artist|former\s+fat\s+boys|soundalike|sing-along|done\s+again|cast\s+of|cast\s+recording|famous\s+by|\d{4}\s+.*hitz|iron\s+hitz)\b/i;

export async function deezerSearch(query, { limit = 75, includeExtra = true, country = "US", standbyItunesPromise: externalItunesPromise = null, skipYoutubeFallback = false } = {}) {
  const q = clean(query).slice(0, 80);
  if (!q) return { songs: [], artists: [], playlists: [] };

  const maxSongs = Math.max(15, Math.min(Number(limit) || 75, 100));
  const intent = parseDeezerQueryIntent(q);
  const want = intent.foldQuery || fold(q);
  const cacheKey = `search:v2:${want}:${maxSongs}:${includeExtra ? 1 : 0}`;
  const cachedRes = getCached(cacheKey);
  if (cachedRes && cachedRes.songs && cachedRes.songs.length > 0) {
    return cachedRes;
  }

  const encClean = encodeURIComponent(intent.cleanQuery || q);
  const encRaw = encodeURIComponent(q);
  const songs = [];
  const artists = [];
  const playlists = [];
  const seenArt = new Set();
  const seenAlb = new Set();

  const artistMatchesHint = (candName, hintFold) => {
    const cf = fold(candName);
    if (!cf || !hintFold) return false;
    if (cf === hintFold || cf.startsWith(hintFold + " ") || cf.endsWith(" " + hintFold) || cf.includes(" " + hintFold + " ")) return true;
    const hToks = hintFold.split(" ").filter((t) => t.length >= 3);
    return hToks.length > 0 && hToks.every((t) => cf.includes(t));
  };

  const extractFeaturedArtistMatchingHint = (titleStr, artistStr, hintFold) => {
    if (!hintFold) return "";
    const combined = `${artistStr || ""} ${titleStr || ""}`;
    const featMatches = combined.match(/(?:\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b|&|,)\s*([^()[\],&-]+)/gi) || [];
    for (const rawM of featMatches) {
      const cleaned = rawM.replace(/^(?:\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b|&|,)\s*/i, "").trim();
      if (cleaned && artistMatchesHint(cleaned, hintFold)) return cleaned;
    }
    return "";
  };

  const pushArtist = (id, name, artwork, nbFan = 0) => {
    const cleanName = clean(name);
    if (!cleanName || (!intent.wantsInstrumental && DZ_JUNK_PERFORMER_RE.test(cleanName))) return;
    const k = fold(cleanName);
    if (!k || k === "unknown artist" || k === "various artists") return;
    const artUrl = clean(artwork) || "/cover-default.jpg";
    const isRealPhoto = /dzcdn\.net\/images\/artist/i.test(artUrl);
    if (!seenArt.has(k)) {
      seenArt.add(k);
      artists.push({
        id: `artist:deezer:${String(id || k).replace(/^artist:deezer:/, "")}`,
        kind: "artist",
        name: cleanName,
        artwork: artUrl,
        source: "deezer",
        query: cleanName,
        nb_fan: Number(nbFan) || 0,
      });
    } else {
      const ex = artists.find((x) => fold(x.name) === k);
      if (ex) {
        const exIsReal = /dzcdn\.net\/images\/artist/i.test(ex.artwork || "");
        if ((isRealPhoto && !exIsReal) || ((!ex.artwork || ex.artwork === "/cover-default.jpg") && artUrl !== "/cover-default.jpg")) {
          ex.artwork = artUrl;
        }
        if ((Number(nbFan) || 0) > (Number(ex.nb_fan) || 0)) {
          ex.nb_fan = Number(nbFan) || 0;
        }
        if (id && /^\d+$/.test(String(id)) && !/^artist:deezer:\d+$/.test(ex.id || "")) {
          ex.id = `artist:deezer:${id}`;
        }
      }
    }
  };

  const pushAlbum = (id, title, artistName, artwork, year = "") => {
    const cleanTitle = clean(title);
    if (!cleanTitle) return;
    if (!intent.wantsInstrumental && (DZ_UNRELATED_INSTRUMENTAL_RE.test(cleanTitle) || DZ_JUNK_PERFORMER_RE.test(artistName || ""))) return;
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
  const dzPrimaryPromise = (async () => {
    const rows = [];
    const primaryJobs = [
      dzFetch(`/search?q=${encClean}&limit=${Math.min(maxSongs + 20, 100)}`, 3000).catch(() => null),
    ];
    if (intent.hasExplicitSplit && intent.songHint && intent.artistHint) {
      const strictQ = encodeURIComponent(`track:"${intent.songHint}" artist:"${intent.artistHint}"`);
      primaryJobs.push(dzFetch(`/search?q=${strictQ}&limit=25`, 2500).catch(() => null));
      primaryJobs.push(dzFetch(`/search?q=${encodeURIComponent(intent.artistHint)}&limit=55`, 2600).catch(() => null));
    } else if (encRaw !== encClean) {
      primaryJobs.push(dzFetch(`/search?q=${encRaw}&limit=50`, 2500).catch(() => null));
    }

    const resList = await Promise.all(primaryJobs);
    for (const r of resList) {
      if (r && Array.isArray(r.data) && r.data.length) {
        rows.push(...r.data);
      }
    }
    if (rows.length > 0) return rows;

    try {
      const trkJson2 = await dzFetch(`/search/track?q=${encClean}&limit=${Math.min(maxSongs + 20, 100)}`, 2500);
      if (trkJson2 && Array.isArray(trkJson2.data) && trkJson2.data.length) {
        return trkJson2.data;
      }
    } catch {}
    return [];
  })();

  const standbyItunesPromise = externalItunesPromise || itunesSearch(q, { includeExtra, country: country || "US", limit: maxSongs }).catch(() => null);

  const trackRows = await dzPrimaryPromise;

  let detectedArtistId = "";
  let detectedArtistName = "";
  let exactSongCoArtistFold = "";

  // First pass: check if any song matching intent.songFold has a primary or featured artist matching intent.artistFold
  if (intent.songFold && intent.artistFold) {
    for (const t of trackRows) {
      if (!t || !t.title) continue;
      const artistName = clean(t.artist && t.artist.name);
      if (!intent.wantsInstrumental && (DZ_UNRELATED_INSTRUMENTAL_RE.test(t.title) || DZ_JUNK_PERFORMER_RE.test(artistName))) continue;
      const tf = fold(t.title);
      if (tf === intent.songFold || tf.startsWith(intent.songFold + " ")) {
        if (artistMatchesHint(artistName, intent.artistFold)) {
          detectedArtistName = artistName;
          if (t.artist && t.artist.id) detectedArtistId = String(t.artist.id);
          break;
        }
        const featMatch = extractFeaturedArtistMatchingHint(t.title, artistName, intent.artistFold);
        if (featMatch) {
          detectedArtistName = featMatch;
          exactSongCoArtistFold = fold(artistName);
          break;
        }
      }
    }

    // Deezer often omits "(feat. Artist)" from short track titles (e.g. "Let Me Love You" by "DJ Snake").
    // Cross-check the standby iTunes top hit so we resolve the exact featured artist ("Justin Bieber") and lead co-artist ("DJ Snake").
    if (!detectedArtistName) {
      const itQuick = await Promise.race([
        standbyItunesPromise,
        new Promise((r) => setTimeout(() => r(null), 1200)),
      ]);
      const itTop = itQuick && Array.isArray(itQuick.songs) && itQuick.songs[0];
      if (itTop && itTop.title) {
        const itTitleFold = fold(itTop.title);
        if (itTitleFold === intent.songFold || itTitleFold.startsWith(intent.songFold + " ")) {
          const featFromIt = extractFeaturedArtistMatchingHint(itTop.title, itTop.artist, intent.artistFold);
          if (featFromIt) {
            detectedArtistName = featFromIt;
            exactSongCoArtistFold = fold(itTop.artist);
          } else if (artistMatchesHint(itTop.artist, intent.artistFold)) {
            detectedArtistName = clean(itTop.artist.split(/\s*(?:,|&|\bfeat\.?|\bft\.?)\s*/i)[0]);
            exactSongCoArtistFold = fold(detectedArtistName);
          }
        }
      }
    }
  }

  for (const t of trackRows) {
    if (!t || !t.title) continue;
    const artistName = clean(t.artist && t.artist.name);
    const albCover = clean(t.album && (t.album.cover_big || t.album.cover_medium));
    if (t.artist && artistName) {
      const artPic = clean(t.artist.picture_big || t.artist.picture_medium) || albCover;
      pushArtist(t.artist.id, artistName, artPic);
      if (!detectedArtistName && intent.artistFold && artistMatchesHint(artistName, intent.artistFold) && !DZ_JUNK_PERFORMER_RE.test(artistName)) {
        detectedArtistName = artistName;
        if (t.artist.id) detectedArtistId = String(t.artist.id);
      }
    }
    if (t.album && t.album.title) {
      pushAlbum(t.album.id, t.album.title, artistName, albCover);
    }
  }

  // Stage 1b: Optional extra artist & album endpoints + artist top tracks & artist radio
  if (includeExtra && trackRows.length > 0) {
    const top0TitlePre = trackRows[0] && fold(String(trackRows[0].title || "").replace(/\s*[\[(].*$/, ""));
    const top0ArtPre = trackRows[0] && trackRows[0].artist && fold(trackRows[0].artist.name);
    const isTop0SongByDifferentArtist = Boolean(
      top0TitlePre === want && top0ArtPre && !top0ArtPre.startsWith(want)
    );
    if (!detectedArtistName && isTop0SongByDifferentArtist && trackRows[0].artist && trackRows[0].artist.name) {
      detectedArtistName = clean(trackRows[0].artist.name);
      if (trackRows[0].artist.id) detectedArtistId = String(trackRows[0].artist.id);
    }

    const artistQueryEnc = encodeURIComponent(detectedArtistName || intent.artistHint || intent.cleanQuery || q);
    const [artistsR, albumsR] = await Promise.allSettled([
      dzFetch(`/search/artist?q=${artistQueryEnc}&limit=25`, 2400),
      dzFetch(`/search/album?q=${encClean}&limit=12`, 2400),
    ]);

    if (artistsR.status === "fulfilled" && artistsR.value && Array.isArray(artistsR.value.data)) {
      const rawArtists = artistsR.value.data.filter((a) => a && a.id && a.name && !DZ_JUNK_PERFORMER_RE.test(a.name)).slice();
      const targetArtLookupFold = fold(detectedArtistName || intent.artistHint || "");
      rawArtists.sort((a, b) => {
        const na = fold(a.name);
        const nb = fold(b.name);
        const fa = Number(a.nb_fan) || 0;
        const fb = Number(b.nb_fan) || 0;
        const tier = (n, fans, rawNameStr) => {
          if (targetArtLookupFold && artistMatchesHint(rawNameStr, targetArtLookupFold)) return 3;
          if (n === want && fans >= 50000) return 2;
          if ((n === "the " + want || n.startsWith(want + " ")) && fans >= 50000) return 2;
          if (n === want || n.startsWith(want)) return 1;
          return 0;
        };
        const aTier = tier(na, fa, a.name);
        const bTier = tier(nb, fb, b.name);
        if (bTier !== aTier) return bTier - aTier;
        if (na === want && nb !== want && fa * 4 >= fb) return -1;
        if (nb === want && na !== want && fb * 4 >= fa) return 1;
        return fb - fa;
      });
      if (
        rawArtists[0] &&
        !isTop0SongByDifferentArtist &&
        !intent.hasExplicitSplit &&
        (fold(rawArtists[0].name).startsWith(want + " ") || fold(rawArtists[0].name) === "the " + want) &&
        (Number(rawArtists[0].nb_fan) || 0) >= 2000000
      ) {
        detectedArtistId = String(rawArtists[0].id);
        detectedArtistName = clean(rawArtists[0].name);
      }
      for (const a of rawArtists) {
        pushArtist(a.id, a.name, a.picture_big || a.picture_medium, a.nb_fan || 0);
        const top0Title = trackRows[0] && fold(String(trackRows[0].title || "").replace(/\s*[\[(].*$/, ""));
        const top0Art = trackRows[0] && trackRows[0].artist && fold(trackRows[0].artist.name);
        const top0IsDifferentArtistSong = Boolean(top0Title === want && top0Art && top0Art !== want && top0Art !== fold(a.name));
        const hasTracksInTop10 = trackRows.slice(0, 10).some((tr) => tr && tr.artist && fold(tr.artist.name) === fold(a.name));
        if (
          !detectedArtistId &&
          (!top0IsDifferentArtistSong || hasTracksInTop10 || (Number(a.nb_fan) || 0) >= 500000) &&
          ((targetArtLookupFold && artistMatchesHint(a.name, targetArtLookupFold)) || want.includes(fold(a.name)) || fold(a.name).includes(want))
        ) {
          detectedArtistId = String(a.id);
          if (!detectedArtistName) detectedArtistName = clean(a.name);
        }
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

    if (!detectedArtistName && trackRows[0] && trackRows[0].artist && trackRows[0].artist.name) {
      detectedArtistName = clean(trackRows[0].artist.name);
      if (trackRows[0].artist.id) detectedArtistId = String(trackRows[0].artist.id);
    }

    // Fetch broad selection of target artist's top songs + artist radio for related vocal songs
    if (detectedArtistId) {
      const targetFoldCheck = fold(detectedArtistName || intent.artistHint || "");
      const haveArtistTracks = targetFoldCheck
        ? trackRows.filter((r) => r && r.artist && artistMatchesHint(r.artist.name, targetFoldCheck)).length
        : 0;
      const expandJobs = [];
      if (haveArtistTracks < 30) {
        expandJobs.push(dzFetch(`/artist/${detectedArtistId}/top?limit=50`, 2400).catch(() => null));
      }
      if (trackRows.length < 75) {
        expandJobs.push(dzFetch(`/artist/${detectedArtistId}/radio?limit=35`, 2400).catch(() => null));
      }
      if (expandJobs.length > 0) {
        const expRes = await Promise.all(expandJobs);
        for (const er of expRes) {
          if (er && Array.isArray(er.data)) {
            trackRows.push(...er.data);
          }
        }
      }
    }
  }

  // Score and sequence Deezer tracks with Spotify-style intelligence
  const stripDecorations = (title) =>
    String(title || "")
      .replace(/\s*[\[(][^)\]]*(?:feat\.?|ft\.?|featuring|with|official|audio|video|lyric|remaster|version|edit|mix|live|explicit|clean|from\s|spider-man|motion\s+picture|soundtrack|ost\b|prod\.?)[^)\]]*[)\]]/gi, "")
      .replace(/\s*[-–—]\s*(?:remaster(?:ed)?|single|radio\s*edit|version|live|from\s.*|spider-man.*).*$/i, "")
      .trim();

  const targetArtistFold = fold(detectedArtistName || intent.artistHint || "");
  const artistTrackCountInRaw = targetArtistFold
    ? trackRows.filter((r) => r && r.artist && artistMatchesHint(r.artist.name, targetArtistFold)).length
    : 0;
  const targetSongFold = intent.songFold || (() => {
    if (!targetArtistFold) return want;
    const artToks = new Set(targetArtistFold.split(" ").filter(Boolean));
    const rem = want.split(" ").filter((w) => !artToks.has(w) && w !== "by").join(" ").trim();
    if (rem) return rem;
    return artistTrackCountInRaw >= 2 ? "" : want;
  })();

  const seenCanonKey = new Set();
  const scoredCandidates = [];

  for (let rawIdx = 0; rawIdx < trackRows.length; rawIdx++) {
    const rawTrack = trackRows[rawIdx];
    const s = normalizeDeezerTrack(rawTrack);
    if (!s) continue;
    const durSec = Number(s.duration) || 0;
    if (durSec > 0 && (durSec < 45 || durSec > 720)) continue;

    if (!intent.wantsInstrumental) {
      if (DZ_UNRELATED_INSTRUMENTAL_RE.test(s.title) || DZ_UNRELATED_INSTRUMENTAL_RE.test(s.album || "")) continue;
      if (DZ_JUNK_PERFORMER_RE.test(s.artist) || DZ_JUNK_PERFORMER_RE.test(s.album || "")) continue;
    }

    const coreTitle = stripDecorations(s.title) || s.title;
    const titleFold = fold(s.title);
    const coreTitleFold = fold(coreTitle);
    const artistFoldVal = fold(s.artist);
    const primCredit = s.artist.split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bwith\b)\s*/i)[0].trim();
    const combinedText = `${artistFoldVal} ${titleFold}`;
    const isRemixOrLive = /\b(remix|live|acoustic|sped\s*up|slowed|reverb|karaoke|instrumental|vip|dub|club\s*mix|extended)\b/i.test(s.title);
    const canonKey = `${coreTitleFold}|${fold(primCredit)}${isRemixOrLive ? `|${titleFold}` : ""}`;

    let score = 0;
    let bucket = "related";

    const matchesTargetTitleExact = Boolean(
      targetSongFold &&
      (coreTitleFold === targetSongFold || titleFold === targetSongFold)
    );
    const matchesTargetTitlePrefix = Boolean(
      targetSongFold &&
      targetSongFold.length >= 3 &&
      (coreTitleFold.startsWith(targetSongFold + " ") ||
       titleFold.startsWith(targetSongFold + " ") ||
       (coreTitleFold.includes(targetSongFold) && Math.abs(coreTitleFold.length - targetSongFold.length) <= 12))
    );
    const matchesCoArtistOnExact = Boolean(
      exactSongCoArtistFold &&
      (matchesTargetTitleExact || matchesTargetTitlePrefix) &&
      artistMatchesHint(s.artist, exactSongCoArtistFold)
    );
    const featInTitle = Boolean(
      targetArtistFold && extractFeaturedArtistMatchingHint(s.title, s.artist, targetArtistFold)
    );
    const matchesTargetArtist = Boolean(
      matchesCoArtistOnExact ||
      featInTitle ||
      (targetArtistFold &&
      (artistMatchesHint(s.artist, targetArtistFold) ||
       (intent.artistFold && artistMatchesHint(s.artist, intent.artistFold))))
    );

    if (matchesTargetTitleExact && matchesTargetArtist) {
      bucket = "exact_song";
      score += 1000;
      if (!isRemixOrLive) score += 250;
      if (coreTitleFold === targetSongFold) score += 80;
    } else if (matchesTargetTitlePrefix && matchesTargetArtist) {
      bucket = "exact_song";
      score += 820;
      if (!isRemixOrLive) score += 160;
    } else if (matchesTargetTitleExact && !intent.hasExplicitSplit) {
      bucket = "exact_title";
      score += 620;
      if (!isRemixOrLive) score += 120;
    } else if (matchesTargetArtist) {
      bucket = "target_artist";
      score += 480;
      if (artistMatchesHint(primCredit, targetArtistFold)) score += 120;
      else if (intent.artistFold && artistMatchesHint(primCredit, intent.artistFold)) score += 60;
      if (!isRemixOrLive) score += 85;
    } else if (matchesTargetTitleExact || matchesTargetTitlePrefix) {
      bucket = "exact_title";
      score += 410;
      if (!isRemixOrLive) score += 70;
    } else {
      bucket = "related";
      score += 200;
      if (!isRemixOrLive) score += 45;
    }

    for (const tok of intent.allTokens) {
      if (coreTitleFold.includes(tok)) score += 28;
      if (combinedText.includes(tok)) score += 24;
    }

    // Factor in Deezer popularity rank & upstream position so #0/#1 hits surface first
    const rankNum = Number(rawTrack && rawTrack.rank) || 0;
    if (rankNum > 0) {
      score += Math.min(60, Math.round(rankNum / 20000));
    }
    if (rawIdx < 20) {
      score += Math.max(0, 20 - rawIdx) * 4;
    }

    const queryWantsRemix = /\b(remix|live|acoustic|slowed|sped\s*up)\b/i.test(q);
    if (isRemixOrLive && !queryWantsRemix) {
      score -= 180;
    }

    scoredCandidates.push({ track: s, canonKey, bucket, score, isRemixOrLive });
  }

  scoredCandidates.sort((a, b) => b.score - a.score);
  const uniqueCandidates = [];
  for (const c of scoredCandidates) {
    if (seenCanonKey.has(c.canonKey)) continue;
    seenCanonKey.add(c.canonKey);
    uniqueCandidates.push(c);
  }

  const exactSongs = uniqueCandidates.filter((c) => c.bucket === "exact_song");
  exactSongs.sort((a, b) => {
    if (a.isRemixOrLive !== b.isRemixOrLive) return a.isRemixOrLive ? 1 : -1;
    return b.score - a.score;
  });
  const targetArtistSongs = uniqueCandidates.filter((c) => c.bucket === "target_artist");
  const exactTitleSongs = uniqueCandidates.filter((c) => c.bucket === "exact_title");
  const relatedSongs = uniqueCandidates.filter((c) => c.bucket === "related");

  const isArtistQueryIntent = Boolean(
    targetArtistFold &&
    targetArtistSongs.length >= 2 &&
    (targetArtistFold === want || targetArtistFold === "the " + want || targetArtistFold.startsWith(want + " "))
  );

  const pushOrdered = (item) => {
    if (!item || songs.length >= maxSongs) return;
    if (!songs.some((x) => x.id === item.track.id)) {
      songs.push(item.track);
    }
  };

  const nonRemixExact = exactSongs.filter((c) => !c.isRemixOrLive);
  const remixExact = exactSongs.filter((c) => c.isRemixOrLive);
  if (nonRemixExact.length > 0) {
    for (const ex of nonRemixExact.slice(0, 2)) pushOrdered(ex);
  } else {
    for (const ex of exactSongs.slice(0, 2)) pushOrdered(ex);
  }
  if (exactSongs.length === 0 && !isArtistQueryIntent && exactTitleSongs.length > 0) {
    for (const et of exactTitleSongs.slice(0, 3)) pushOrdered(et);
  }

  const remainingExact = nonRemixExact.length > 0 ? [...nonRemixExact.slice(2), ...remixExact] : exactSongs.slice(2);
  let ai = 0;
  let ti = exactSongs.length === 0 && !isArtistQueryIntent ? 3 : 0;
  let ri = 0;
  let exRest = 0;
  while (songs.length < maxSongs && (ai < targetArtistSongs.length || ti < exactTitleSongs.length || ri < relatedSongs.length || exRest < remainingExact.length)) {
    if (ai < targetArtistSongs.length) pushOrdered(targetArtistSongs[ai++]);
    if (ai < targetArtistSongs.length) pushOrdered(targetArtistSongs[ai++]);
    if (intent.hasExplicitSplit && ai < targetArtistSongs.length) pushOrdered(targetArtistSongs[ai++]);
    if (ti < exactTitleSongs.length) pushOrdered(exactTitleSongs[ti++]);
    else if (exRest < remainingExact.length) pushOrdered(remainingExact[exRest++]);
    if (ri < relatedSongs.length) pushOrdered(relatedSongs[ri++]);
    if (!intent.hasExplicitSplit && ri < relatedSongs.length) pushOrdered(relatedSongs[ri++]);
  }

  const pushFallbackSong = (rawTrack) => {
    const s = normalizeDeezerTrack(rawTrack);
    if (!s) return;
    if (!intent.wantsInstrumental && (DZ_UNRELATED_INSTRUMENTAL_RE.test(s.title) || DZ_JUNK_PERFORMER_RE.test(s.artist))) return;
    const k = `${fold(s.title)}|${fold(s.artist)}`;
    if (seenCanonKey.has(k)) return;
    seenCanonKey.add(k);
    songs.push(s);
  };

  // Stage 2: Studio Catalog Fallback when api.deezer.com is blocked / rate-limited on the server IP
  if (songs.length < 25) {
    const itVal = await standbyItunesPromise;
    if (itVal) {
      for (const t of itVal.songs || []) {
        pushFallbackSong({
          id: t.trackId || String(t.id || "").replace(/^apple:|^itunes:/, ""),
          title: t.title || t.trackName,
          artist: { name: t.artist || t.artistName },
          album: { title: t.album || t.collectionName, cover_big: t.artwork, cover_medium: t.artwork },
          duration: t.duration || Math.round(Number(t.trackTimeMillis || 0) / 1000),
          preview: "",
          playQuery: t.playQuery,
        });
        if (songs.length >= maxSongs) break;
      }
      for (const a of itVal.artists || []) {
        pushArtist(String(a.id || "").replace(/^artist:apple:/, ""), a.name, a.artwork);
      }
      for (const p of itVal.playlists || []) {
        pushAlbum(String(p.id || "").replace(/^album:/, ""), p.title, p.artist, p.artwork);
      }
    }

    if (songs.length < 15 && !skipYoutubeFallback) {
      try {
        const ytVal = await searchYouTube(`${intent.cleanQuery || q} official audio`, country || "US", true);
        if (Array.isArray(ytVal)) {
          for (const yt of ytVal) {
            if (!yt || !yt.title) continue;
            pushFallbackSong({
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
            if (songs.length >= maxSongs) break;
          }
        }
      } catch {}
    }
  }

  if (artists.length > 1 && (want || targetArtistFold)) {
    artists.sort((a, b) => {
      const na = fold(a.name);
      const nb = fold(b.name);
      const aExact = (targetArtistFold && na === targetArtistFold) ? 4 : na === want ? 3 : na.startsWith(want) ? 2 : na.includes(want) || (na.length >= 3 && want.includes(na)) ? 1 : 0;
      const bExact = (targetArtistFold && nb === targetArtistFold) ? 4 : nb === want ? 3 : nb.startsWith(want) ? 2 : nb.includes(want) || (nb.length >= 3 && want.includes(nb)) ? 1 : 0;
      if (bExact !== aExact) return bExact - aExact;
      return na.length - nb.length;
    });
  }

  const out = { songs: songs.slice(0, maxSongs), artists, playlists };
  if (out.songs.length > 0) {
    setCached(cacheKey, out);
  }
  return out;
}
