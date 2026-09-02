/* Deezer public API — METADATA / CATALOG CROSS-CHECK ONLY.
 *
 * WHY THIS EXISTS
 * The artist profile previously merged (a) iTunes lookup, which caps at
 * ~30 songs / ~25 albums per artist, and (b) one YouTube "name official
 * audio" search capped at 16 rows — so an artist with hundreds of tracks
 * showed only a few. This module adds a legitimate metadata cross-check:
 * Deezer's public discography endpoints give the complete album list and
 * per-album track order, so the profile can show the artist's real
 * catalogue (all albums, correct release info, artwork, song order).
 *
 * LICENSING BOUNDARY (important)
 * - No audio is fetched from Deezer. No 30-second preview URL is ever
 *   read, stored or played. Deezer is used strictly as a discography
 *   database (titles, artists, albums, years, order, cover art URLs).
 * - Every track returned here carries a `playQuery` (title + artist),
 *   which MUCHI's existing playback pipeline resolves against its own
 *   supported sources (YouTube search → playable video → full track).
 *   If the existing source has no full version of a track, the track
 *   simply cannot play — we never substitute a preview clip.
 * - No DRM bypass, no copyrighted download, no audio mirroring.
 */

const DEEZER = "https://api.deezer.com";

async function dzFetch(path, ms = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(DEEZER + path, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    if (!r.ok) throw new Error(`deezer ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

const clean = (s) => String(s || "").trim();

/* Search Deezer for the artist; returns {id, name, artwork} or null.
 * Matching is accent-folded ("adèle" == "adele") and prefers an EXACT
 * name, then the shortest "starts with" match. We never blindly take
 * rows[0] — for "adele" that is the duo "Adèle & Robin", which would
 * merge an unrelated artist's discography into the profile. */
export async function deezerArtist(name) {
  const raw = clean(name).slice(0, 80);
  const fold = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const want = fold(raw);
  if (!want) return null;
  const q = encodeURIComponent(raw);
  const j = await dzFetch(`/search/artist?q=${q}&limit=10`);
  const rows = (j && j.data) || [];
  let pick = rows.find((r) => fold(r.name) === want);
  if (!pick) {
    const cands = rows.filter((r) => fold(r.name).startsWith(want));
    if (cands.length) pick = cands.sort((a, b) => fold(a.name).length - fold(b.name).length)[0];
  }
  if (!pick || !pick.id) return null;
  return {
    id: String(pick.id),
    name: clean(pick.name) || name,
    artwork: clean(pick.picture_medium) || "",
  };
}

/*
 * Full discography, newest first.
 * Endpoint (live-verified against api.deezer.com): GET /artist/{id}/albums
 * Pagination is an OFFSET (`index`), not a page token:
 *   /artist/{id}/albums?limit=100&index=100  → next 100.
 * Response shape: { data: Album[], total: int, next?, prev? }.
 * Album objects here carry id, title, cover URLs, release_date and
 * record_type — artist name and track count are NOT in this payload,
 * so the artist name is supplied by the caller.
 */
export async function deezerAlbums(artistId, artistName, { maxAlbums = 300 } = {}) {
  const out = [];
  const limit = 100;
  let index = 0;
  let total = Infinity;
  while (index < maxAlbums && index < total) {
    const j = await dzFetch(`/artist/${artistId}/albums?limit=${Math.min(limit, maxAlbums - index)}&index=${index}`);
    const rows = (j && j.data) || [];
    if (!rows.length) break;
    for (const al of rows) {
      if (!al || !al.id) continue;
      const rt = String(al.record_type || "").toLowerCase();
      out.push({
        id: `deezer-album:${al.id}`,
        kind: "playlist",
        title: clean(al.title) || "Album",
        artist: clean(artistName) || "",
        artwork: clean(al.cover_medium) || clean(al.cover_big) || "",
        source: "deezer",
        query: `${clean(al.title)} ${clean(artistName)}`.trim(),
        year: al.release_date ? String(al.release_date).slice(0, 4) : "",
        recordType: rt === "single" ? "Single" : rt === "ep" ? "EP" : "Album",
      });
    }
    total = Number(j && j.total || rows.length);
    index += rows.length;
  }
  return out.slice(0, maxAlbums);
}

/* Track list of one album (metadata only — never the preview URLs). */
export async function deezerAlbumTracks(albumId, artistName) {
  const j = await dzFetch(`/album/${albumId}`);
  const al = (j && j.data) || {};
  const rows = (al.tracks && al.tracks.data) || [];
  const out = [];
  for (const t of rows) {
    if (!t || !t.title) continue;
    out.push({
      id: `deezer:${t.id}`,
      source: "deezer",
      title: clean(t.title),
      artist: clean(t.artist && t.artist.name) || artistName,
      album: clean(t.album && t.album.title) || clean(al.title) || "",
      duration: Number(t.duration || 0),
      artwork: clean(t.album && t.album.cover_medium) || clean(al.cover_medium) || "",
      // Playback resolves through MUCHI's existing pipeline (search →
      // playable source → full track). Deezer audio is never used.
      playQuery: `${clean(t.title)} ${clean(t.artist && t.artist.name) || artistName} official audio`.trim(),
    });
  }
  return out;
}

/* Artist's top tracks (metadata only). */
export async function deezerTopTracks(artistId, artistName, limit = 50) {
  const j = await dzFetch(`/artist/${artistId}/top?limit=${Math.min(Number(limit) || 50, 100)}`);
  const out = [];
  for (const t of (j && j.data) || []) {
    if (!t || !t.title) continue;
    out.push({
      id: `deezer:${t.id}`,
      source: "deezer",
      title: clean(t.title),
      artist: clean(t.artist && t.artist.name) || artistName,
      album: clean(t.album && t.album.title) || "",
      duration: Number(t.duration || 0),
      artwork: clean(t.album && t.album.cover_medium) || "",
      playQuery: `${clean(t.title)} ${clean(t.artist && t.artist.name) || artistName} official audio`.trim(),
    });
  }
  return out;
}

/*
 * Orchestration: name → artist → albums + songs, with a hard cap on how
 * many upstream requests we fan out (top list + N recent albums), so a
 * single artist page never triggers hundreds of HTTP calls.
 */
export async function deezerCatalog(name, { maxAlbums = 300, maxTrackAlbums = 20, concurrency = 6 } = {}) {
  const artist = await deezerArtist(name);
  if (!artist) return null;

  const albums = (await deezerAlbums(artist.id, artist.name, { maxAlbums }).catch(() => []))
    .slice(0, maxAlbums);

  const songs = await deezerTopTracks(artist.id, artist.name).catch(() => []);

  // Expand the most recent albums into their full track lists (correct
  // song order + album attribution), newest first.
  const expandIds = albums.slice(0, maxTrackAlbums).map((al) => al.id.replace("deezer-album:", ""));
  for (let i = 0; i < expandIds.length; i += concurrency) {
    const chunk = expandIds.slice(i, i + concurrency);
    const results = await Promise.all(
      chunk.map((id) => deezerAlbumTracks(id, artist.name).catch(() => []))
    );
    for (const rows of results) songs.push(...rows);
  }

  // Dedupe by normalized title+artist (top list overlaps album lists).
  const seen = new Set();
  const uniq = [];
  for (const t of songs) {
    const k = `${clean(t.title).toLowerCase()}|${clean(t.artist).toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(t);
  }

  return { artist, albums, songs: uniq };
}
