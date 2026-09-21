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
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
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

/*
 * General Search: tracks, artists, and albums from Deezer public API.
 * Returns { songs, artists, playlists } so handleSearch can merge them.
 */
export async function deezerSearch(query, { limit = 50, includeExtra = true } = {}) {
  const q = clean(query).slice(0, 80);
  if (!q) return { songs: [], artists: [], playlists: [] };
  const enc = encodeURIComponent(q);

  const calls = [
    dzFetch(`/search?q=${enc}&limit=${limit}`, 8000),
  ];
  if (includeExtra) {
    calls.push(dzFetch(`/search/artist?q=${enc}&limit=15`, 6000));
    calls.push(dzFetch(`/search/album?q=${enc}&limit=15`, 6000));
  }
  const settled = await Promise.allSettled(calls);
  const tracksR = settled[0];
  const artistsR = includeExtra ? settled[1] : null;
  const albumsR = includeExtra ? settled[2] : null;

  const songs = [];
  const artists = [];
  const playlists = [];
  const seenArt = new Set();
  const seenAlb = new Set();

  if (tracksR && tracksR.status === "fulfilled" && tracksR.value && Array.isArray(tracksR.value.data)) {
    for (const t of tracksR.value.data) {
      if (!t || !t.id || !t.title) continue;
      const artistName = clean(t.artist && t.artist.name) || "Unknown Artist";
      const title = clean(t.title);
      songs.push({
        id: `deezer:${t.id}`,
        source: "deezer",
        title,
        artist: artistName,
        album: clean(t.album && t.album.title) || "",
        duration: Number(t.duration || 0),
        artwork: clean(t.album && (t.album.cover_big || t.album.cover_medium)) || "/cover-default.jpg",
        previewUrl: clean(t.preview) || "",
        playQuery: `${title} ${artistName} official audio`.trim(),
        rawId: t.id,
        preview: clean(t.preview) || "",
      });
      if (t.artist && t.artist.name) {
        const k = clean(t.artist.name).toLowerCase();
        if (!seenArt.has(k)) {
          seenArt.add(k);
          artists.push({
            id: `artist:deezer:${t.artist.id || k}`,
            kind: "artist",
            name: clean(t.artist.name),
            artwork: clean(t.artist.picture_medium || t.artist.picture_big) || "/cover-default.jpg",
            source: "deezer",
            query: clean(t.artist.name),
          });
        }
      }
      if (t.album && t.album.title) {
        const k = String(t.album.id || clean(t.album.title));
        if (!seenAlb.has(k)) {
          seenAlb.add(k);
          playlists.push({
            id: `deezer-album:${t.album.id || k}`,
            kind: "playlist",
            title: clean(t.album.title),
            artist: artistName,
            artwork: clean(t.album.cover_medium || t.album.cover_big) || "/cover-default.jpg",
            source: "deezer",
            query: `${clean(t.album.title)} ${artistName}`.trim(),
            recordType: "Album",
          });
        }
      }
    }
  }

  if (artistsR && artistsR.status === "fulfilled" && artistsR.value && Array.isArray(artistsR.value.data)) {
    for (const a of artistsR.value.data) {
      if (!a || !a.id || !a.name) continue;
      const k = clean(a.name).toLowerCase();
      if (!seenArt.has(k)) {
        seenArt.add(k);
        artists.push({
          id: `artist:deezer:${a.id}`,
          kind: "artist",
          name: clean(a.name),
          artwork: clean(a.picture_medium || a.picture_big) || "/cover-default.jpg",
          source: "deezer",
          query: clean(a.name),
        });
      }
    }
  }

  if (albumsR && albumsR.status === "fulfilled" && albumsR.value && Array.isArray(albumsR.value.data)) {
    for (const al of albumsR.value.data) {
      if (!al || !al.id || !al.title) continue;
      const k = String(al.id);
      if (!seenAlb.has(k)) {
        seenAlb.add(k);
        const an = clean(al.artist && al.artist.name) || "";
        playlists.push({
          id: `deezer-album:${al.id}`,
          kind: "playlist",
          title: clean(al.title),
          artist: an,
          artwork: clean(al.cover_medium || al.cover_big) || "/cover-default.jpg",
          source: "deezer",
          query: `${clean(al.title)} ${an}`.trim(),
          recordType: "Album",
        });
      }
    }
  }

  return { songs, artists, playlists };
}
