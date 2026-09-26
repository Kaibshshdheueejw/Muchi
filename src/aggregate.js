// MUCHI — aggregation endpoints, ported from server.js (lines 1665–2167)
// with the Phase-2 plan's decomposition applied:
//   - home: per-day KV-cached blocks (english + per-country) so the heavy
//     ~16-subrequest build runs ONCE per day per key, not per user/isolate
//   - shelf: per-day KV-cached per shelf
//   - discover/related/search: in-memory cached() exactly like server.js
//     (user-generated keys are NOT KV-cached — KV free allows 1k writes/day)
// Response shapes are byte-identical to server.js.

import { json, cached, kvCached, fetchJSON, isEnglishTrack } from "./util.js";
import {
  searchYouTube, youtubeMusicSearch, youtubePlaylistTracks, youtubeAudioStream,
  itunesSearch,
  audiusSearch, audiusTrending, audiusUnderground, audiusUserSearch, audiusUserTracks,
  radioSearch, radioBrowser, lyricsFor, resolveShelfPlaylist,
} from "./providers.js";
import {
  regionCode, utcDay, LOCAL_CHARTS, ENGLISH_SHELVES, FY_QUERIES, VIRAL_QUERIES,
  moodsForCountry, playlistsOf, uniqPlaylists, buildForYouPlaylists, buildViralPlaylists,
  shelfQueryForCountry,
} from "./data.js";
import {
  dzFetch, normalizeDeezerTrack, deezerArtist, deezerAlbums,
  deezerAlbumTracks, deezerTopTracks, deezerCatalog, deezerSearch,
} from "./deezer.js";
import { strictSongs } from "./parse.js";

const take = (r) => {
  if (!r) return [];
  const val = (typeof r === "object" && "status" in r)
    ? (r.status === "fulfilled" ? r.value : [])
    : r;
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (Array.isArray(val.tracks)) return val.tracks;
  return [];
};
// Resolve with `fallback` after ms so one slow upstream (usually Piped)
// can't stall the whole artist build. The losing promise is abandoned.
const raceTimeout = (p, ms, fallback = null) =>
  Promise.race([p, new Promise((res) => setTimeout(() => res(fallback), ms))]);

// ── "Trending / Global trending" shelf cards ─────────────────────────────
// The home shelves must always feel full: cover art is the FIRST song inside
// the playlist and the card carries the full song list. When a provider
// returns few real playlist objects (common during cold starts or an outage),
// we top the shelf up to `count` with generated "Daily mix" cards built from
// tracks we already fetched — no extra network calls, and never fewer than 8.
const DAILY_MIX_TITLES = [
  "Global Top 50", "Worldwide Charts", "Global Trending", "International Hits",
  "Global Pop", "Global Hip-Hop", "Global Dance", "Global R&B",
];
const COUNTRY_DM_TITLES = [
  "Trending Now", "Top Hits", "Viral Chart", "Mega Mix",
  "Daily Mix 1", "Daily Mix 2", "Daily Mix 3", "Daily Mix 4",
  "Daily Mix 5", "Daily Mix 6", "Daily Mix 7", "Daily Mix 8",
  "Daily Mix 9", "Daily Mix 10", "Daily Mix 11", "Daily Mix 12",
  "Country Top 20", "Weekend Heat", "New Music Mix", "Party Hits",
];

function dailyMixCard(title, pool, idx) {
  const filtered = (pool || []).filter(Boolean);
  const start = (idx * 5) % Math.max(1, filtered.length);
  const tracks = [];
  const seen = new Set();
  for (let i = 0; i < filtered.length && tracks.length < 20; i++) {
    const t = filtered[(start + i) % filtered.length];
    if (t && t.id && !seen.has(t.id)) {
      seen.add(t.id);
      tracks.push(t);
    }
  }
  while (tracks.length < 20 && filtered.length > 0) {
    tracks.push(filtered[tracks.length % filtered.length]);
  }
  return {
    id: `dmix:${idx}:${title}`,
    kind: "playlist",
    title,
    artist: "Daily mix",
    artwork: (tracks[0] && tracks[0].artwork) || "",
    source: "youtube",
    playlistId: "",
    query: title,
    tracks: tracks.slice(0, 20),
  };
}

// Ensure a playlist shelf has at least `count` cards, topping up with Daily
// mixes drawn from the tracks we already have. Never drops real playlists.
function ensureMinPlaylists(list, pool, titles, count = 8) {
  const tracks = (pool || []).filter(Boolean);
  const out = (list || []).slice(0, count).map((p) => {
    let plTracks = (p.tracks || []).slice(0, 20);
    const seen = new Set(plTracks.map((t) => t.id));
    for (const t of tracks) {
      if (plTracks.length >= 20) break;
      if (t && t.id && !seen.has(t.id)) {
        seen.add(t.id);
        plTracks.push(t);
      }
    }
    let padIdx = 0;
    while (plTracks.length < 20 && tracks.length > 0) {
      plTracks.push(tracks[padIdx % tracks.length]);
      padIdx++;
    }
    return {
      ...p,
      tracks: plTracks.slice(0, 20),
    };
  });
  const seen = new Set(out.map((p) => String((p && p.title) || "").toLowerCase()));
  let i = 0;
  while (out.length < count && tracks.length && i < titles.length) {
    const title = titles[i++];
    const key = String(title).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(dailyMixCard(title, tracks, out.length));
  }
  return out;
}

export async function handleHome(env, url) {
  const gl = regionCode(url.searchParams.get("gl"));
  const localQ = LOCAL_CHARTS[gl] || "top hits official audio";
  const refresh = url.searchParams.get("refresh") === "1";
  let globalPart = { shelves: [], globalPlaylists: [], audius: [], underground: [], radio: [], forYouPlaylists: [], viralPlaylists: [] };
  let localPart = { youtubeLocal: [], countryPlaylists: [] };
  try {
    globalPart = await (refresh ? buildGlobal(gl, localQ) : kvCached(env, `home:english:${gl}:v11:${utcDay()}`, 86400000, () => buildGlobal(gl, localQ)));
  } catch (e) {
    console.error("home english", e);
    globalPart.shelves = ENGLISH_SHELVES.map((s) => ({ id: s.id, title: s.title, query: shelfQueryForCountry(s.id, gl, s.query), tracks: [] }));
    globalPart.forYouPlaylists = buildForYouPlaylists([]);
    globalPart.viralPlaylists = buildViralPlaylists([]);
  }
  try {
    localPart = await (refresh ? buildLocal(gl, localQ) : kvCached(env, `home:local:${gl}:v11:${utcDay()}`, 86400000, () => buildLocal(gl, localQ)));
  } catch (e) {
    console.error("home local", e);
  }
  const charts = (globalPart.shelves[0] && globalPart.shelves[0].tracks) || [];

  // Guaranteed fallback: localTracks must NEVER be empty and must reach 25 tracks
  let localTracks = (localPart.youtubeLocal || []).filter(Boolean);
  if (localTracks.length < 25) {
    const backupPool = [
      ...charts,
      ...((globalPart.shelves[1] && globalPart.shelves[1].tracks) || []),
      ...((globalPart.shelves[2] && globalPart.shelves[2].tracks) || []),
    ];
    const seen = new Set(localTracks.map((t) => t.id));
    for (const t of backupPool) {
      if (t && t.id && !seen.has(t.id)) {
        seen.add(t.id);
        localTracks.push(t);
        if (localTracks.length >= 25) break;
      }
    }
  }

  // Guaranteed fallback: countryPlaylists must NEVER be empty and must reach 12 playlists (20 songs each)
  let countryPlaylists = (localPart.countryPlaylists || []).filter(Boolean);
  const poolForPl = localTracks.length ? localTracks : (charts.length ? charts : []);
  if (countryPlaylists.length < 12 && poolForPl.length > 0) {
    countryPlaylists = ensureMinPlaylists(
      countryPlaylists,
      poolForPl,
      COUNTRY_DM_TITLES,
      12,
    );
  }

  return json(200, {
    country: gl,
    day: utcDay(),
    localQuery: localQ,
    moods: moodsForCountry(gl),
    shelves: globalPart.shelves.length
      ? globalPart.shelves
      : ENGLISH_SHELVES.map((s) => ({ id: s.id, title: s.title, query: shelfQueryForCountry(s.id, gl, s.query), tracks: [] })),
    youtubeCharts: charts,
    youtubeLocal: localTracks.slice(0, 25),
    youtubeIndia: localTracks.slice(0, 25),
    countryPlaylists: countryPlaylists.slice(0, 12),
    globalPlaylists: globalPart.globalPlaylists || [],
    forYouPlaylists: globalPart.forYouPlaylists || [],
    viralPlaylists: globalPart.viralPlaylists || [],
    audius: globalPart.audius,
    underground: globalPart.underground,
    radio: globalPart.radio,
  });
}

function weaveCatalogTracks(baseTracks = [], itunesTracks = [], deezerTracks = [], max = 25) {
  const result = [];
  const seen = new Set();
  const pushT = (t) => {
    if (!t) return;
    const k = `${t.title || ""}|${t.artist || ""}`.toLowerCase().trim();
    if (!k || seen.has(k)) return;
    seen.add(k);
    result.push(t);
  };
  const base = Array.isArray(baseTracks) ? baseTracks : [];
  const it = Array.isArray(itunesTracks) ? itunesTracks : [];
  const dz = Array.isArray(deezerTracks) ? deezerTracks : [];
  const maxLen = Math.max(base.length, it.length, dz.length);
  for (let i = 0; i < maxLen; i++) {
    if (base[i]) pushT(base[i]);
    if (it[i]) pushT(it[i]);
    if (dz[i]) pushT(dz[i]);
    if (result.length >= max) break;
  }
  return result;
}

function isUnwantedIndianTrackForRegion(t, gl) {
  if (!t || gl === "IN" || gl === "PK" || gl === "BD") return false;
  const s = `${t.title || ""} ${t.artist || ""} ${t.album || ""}`;
  if (/[\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0B80-\u0BFF\u0C00-\u0C7F\u0D00-\u0D7F]/.test(s)) return true;
  if (/\b(bollywood|hindi|punjabi|bhojpuri|haryanvi|kollywood|tollywood|malayalam|kannada|marathi|gujarati|assamese|odia|arijit\s+singh|shreya\s+ghoshal|jubin\s+nautiyal|t-series|zee\s*music|yash\s*raj|saregama|sony\s*music\s*india|tips\s*official|speed\s*records|desi\s*melodies|pritam|vishal\s+mishra|vishal[\s-]*shekhar|tanishk\s+bagchi|amit\s+trivedi|a\.?\s*r\.?\s*rahman|diljit\s+dosanjh|karan\s+aujla|sidhu\s+moose|ap\s+dhillon|gurinder\s+gill|badshah|yo\s+yo\s+honey\s+singh|neha\s+kakkar|tony\s+kakkar|sonu\s+nigam|atif\s+aslam|kumar\s+sanu|udit\s+narayan|alka\s+yagnik|kk\b|mohit\s+chauhan|anuv\s+jain|prateek\s+kuhad|the\s+local\s+train|local\s+train|aditya\s+rikhari|mitraz|ritviz|zaeden|sanam\b|lucky\s+ali|kailash\s+kher|shankar\s+mahadevan|shaan\b|sunidhi\s+chauhan|darshan\s+raval|armaan\s+malik|asees\s+kaur|b\s+praak|jaani\b|guru\s+randhawa|hardy\s+sandhu|harrdy\s+sandhu|divine\b|kr\$na|seedhe\s+maut|raftaar|emiway|mc\s+stan|talha\s+anjum|talhah\s+yunus|young\s+stunners|hasan\s+raheem|abdul\s+hannan|ali\s+zafar|rahat\s+fateh|nusrat\s+fateh|coke\s+studio|nadaan\s+parindey|sadda\s+haq|choo\s+lo|baarishein|alag\s+aasmaan|kesariya|tum\s+hi\s+ho|channa\s+mereya|kabira|ilahi|agar\s+tum\s+saath|apna\s+bana\s+le|chaleya|satranga|heeriye|husn\b|bulleya|bekhayali|shayad\b|khairiyat|tera\s+ban\s+jaunga|raataan\s+lambiyan|pasoori)\b/i.test(s)) {
    return true;
  }
  return false;
}

async function buildGlobal(gl, localQ) {
  const prime = ENGLISH_SHELVES.slice(0, 2);
  const jobs = prime.map((s) => searchYouTube(shelfQueryForCountry(s.id, gl, s.query), gl, true));
  const popShelfQ = shelfQueryForCountry("pop", gl, "english pop hits").replace(/\bofficial audio\b/i, "").trim();
  const extra = await Promise.allSettled([
    ...jobs,
    youtubeMusicSearch("global top hits playlist", "US", 6000, { limit: 40 }),
    audiusTrending(),
    audiusUnderground(),
    radioSearch("hits", 16),
    itunesSearch(popShelfQ, { includeExtra: false, country: gl }).catch(() => ({ songs: [] })),
    deezerSearch(popShelfQ, { limit: 40, includeExtra: false }).catch(() => ({ songs: [] })),
  ]);
  const itExtra = (extra[jobs.length + 4] && extra[jobs.length + 4].status === "fulfilled" ? (extra[jobs.length + 4].value.songs || []) : [])
    .filter((t) => !isUnwantedIndianTrackForRegion(t, gl));
  const dzExtra = (extra[jobs.length + 5] && extra[jobs.length + 5].status === "fulfilled" ? (extra[jobs.length + 5].value.songs || []) : [])
    .filter((t) => !isUnwantedIndianTrackForRegion(t, gl));
  const filled = prime.map((s, i) => take(extra[i]).filter((t) => !isUnwantedIndianTrackForRegion(t, gl)).slice(0, 18));
  // Only pre-fill the first 2 prime shelves (Today's Top Hits & Pop). Leave
  // Hip-Hop, R&B, Rock, Dance, and Indie empty here so hydrateShelves() fetches
  // each shelf's true genre tracks for the user's selected country instead of
  // polluting Rock/Indie with generic top-hits tracks.
  const shelves = ENGLISH_SHELVES.map((s, i) => ({
    id: s.id,
    title: s.title,
    query: shelfQueryForCountry(s.id, gl, s.query),
    tracks: i < filled.length
      ? weaveCatalogTracks(filled[i], itExtra.slice(i * 6, (i + 1) * 6), dzExtra.slice(i * 6, (i + 1) * 6), 25)
      : [],
  }));
  const globalPlaylists = ensureMinPlaylists(
    uniqPlaylists([
      ...playlistsOf(extra[0].status === "fulfilled" ? extra[0].value : []),
      ...playlistsOf(extra[1].status === "fulfilled" ? extra[1].value : []),
      ...playlistsOf(extra[2].status === "fulfilled" ? extra[2].value : []),
    ]).slice(0, 16),
    weaveCatalogTracks([].concat(...filled), itExtra, dzExtra, 100),
    DAILY_MIX_TITLES,
    8,
  ).map((p, pIdx) => ({
    ...p,
    tracks: weaveCatalogTracks(p.tracks || [], itExtra.slice(pIdx * 3), dzExtra.slice(pIdx * 3), 20),
  }));
  const audius = take(extra[jobs.length + 1]).slice(0, 18);
  const underground = take(extra[jobs.length + 2]).slice(0, 12);
  const radio = take(extra[jobs.length + 3]).slice(0, 12);
  const fyRes = await Promise.allSettled(FY_QUERIES.map((f) => resolveShelfPlaylist(f.query, "US")));
  const forYouPlaylists = buildForYouPlaylists(fyRes).map((p, idx) => ({
    ...p,
    tracks: weaveCatalogTracks(p.tracks || [], itExtra.slice(idx * 3), dzExtra.slice(idx * 3), 20),
  }));
  // Viral / "trending worldwide" shelf — resolved the same way as "Made for
  // you" so it auto-refreshes with the per-day home build (KV-cached above),
  // and each card ships its own 20 tracks for an instant, fully-populated row.
  const viralRes = await Promise.allSettled(VIRAL_QUERIES.map((f) => resolveShelfPlaylist(f.query, "US")));
  const viralPlaylists = buildViralPlaylists(viralRes).map((p, idx) => ({
    ...p,
    tracks: weaveCatalogTracks(p.tracks || [], itExtra.slice(idx * 3), dzExtra.slice(idx * 3), 20),
  }));
  const total =
    shelves.reduce((n, s) => n + (s.tracks || []).length, 0) +
    globalPlaylists.length + audius.length + underground.length + radio.length +
    forYouPlaylists.filter((p) => p.playlistId).length +
    viralPlaylists.filter((p) => p.playlistId).length;
  if (!total) throw new Error("home empty — not caching");
  return { shelves, globalPlaylists, audius, underground, radio, forYouPlaylists, viralPlaylists };
}

async function buildLocal(gl, localQ) {
  const [ytLocal, ytPl, ytTrendingPl, itLocalR, dzLocalR] = await Promise.allSettled([
    searchYouTube(`${localQ} trending new songs`, gl, false),
    youtubeMusicSearch(`${localQ} trending 2025 playlist`, gl, 7000, { limit: 50 }),
    searchYouTube(`trending music playlist ${gl}`, gl, false),
    itunesSearch(localQ || "top hits", { includeExtra: false, country: gl }).catch(() => ({ songs: [] })),
    deezerSearch(localQ || "top hits", { limit: 40, includeExtra: false }).catch(() => ({ songs: [] })),
  ]);
  const itLocalSongs = (itLocalR.status === "fulfilled" ? (itLocalR.value.songs || []) : [])
    .filter((t) => !isUnwantedIndianTrackForRegion(t, gl));
  const dzLocalSongs = (dzLocalR.status === "fulfilled" ? (dzLocalR.value.songs || []) : [])
    .filter((t) => !isUnwantedIndianTrackForRegion(t, gl));
  const ytTracks = take(ytLocal).filter((t) => !isUnwantedIndianTrackForRegion(t, gl));
  const plTracks = take(ytPl).filter((t) => !isUnwantedIndianTrackForRegion(t, gl));
  const trendTracks = take(ytTrendingPl).filter((t) => !isUnwantedIndianTrackForRegion(t, gl));
  const countryPool = [...ytTracks, ...plTracks, ...trendTracks];

  // Top songs in country: total of 25 songs
  const localTracks = [];
  const seenLocal = new Set();
  for (const t of countryPool) {
    if (!t || !t.id || seenLocal.has(t.id)) continue;
    seenLocal.add(t.id);
    localTracks.push(t);
    if (localTracks.length >= 25) break;
  }
  if (localTracks.length < 25) {
    try {
      const extra = await searchYouTube(`top 50 new ${localQ} official music 2025 2026`, gl, false);
      for (const t of extra) {
        if (!t || !t.id || seenLocal.has(t.id) || isUnwantedIndianTrackForRegion(t, gl)) continue;
        seenLocal.add(t.id);
        localTracks.push(t);
        if (localTracks.length >= 25) break;
      }
    } catch {}
  }
  let padIdx = 0;
  while (localTracks.length < 25 && countryPool.length > 0) {
    localTracks.push(countryPool[padIdx % countryPool.length]);
    padIdx++;
  }

  const mixedLocal = weaveCatalogTracks(localTracks, itLocalSongs, dzLocalSongs, 25);

  const rawPlaylists = uniqPlaylists([
    ...playlistsOf(ytLocal.status === "fulfilled" ? ytLocal.value : []),
    ...playlistsOf(ytPl.status === "fulfilled" ? ytPl.value : []),
    ...playlistsOf(ytTrendingPl.status === "fulfilled" ? ytTrendingPl.value : []),
  ]);

  const countryPlaylists = ensureMinPlaylists(
    rawPlaylists,
    countryPool.length ? weaveCatalogTracks(countryPool, itLocalSongs, dzLocalSongs, 100) : mixedLocal,
    COUNTRY_DM_TITLES,
    12,
  ).map((p, idx) => ({
    ...p,
    tracks: weaveCatalogTracks(p.tracks || [], itLocalSongs.slice(idx * 3), dzLocalSongs.slice(idx * 3), 20),
  }));

  return {
    youtubeLocal: mixedLocal.slice(0, 25),
    countryPlaylists: countryPlaylists.slice(0, 12),
  };
}

export async function handleShelf(env, url) {
  const id = url.searchParams.get("id") || "";
  const shelf = ENGLISH_SHELVES.find((s) => s.id === id);
  const gl = regionCode(url.searchParams.get("gl") || "US");
  const rawQ = url.searchParams.get("q") || "";
  const q = shelf
    ? shelfQueryForCountry(id, gl, rawQ || shelf.query)
    : (rawQ || (id === "local" ? (LOCAL_CHARTS[gl] || "top hits official audio") : ""));
  const full = url.searchParams.get("full") === "1";
  if (!q.trim()) return json(400, { error: "Missing query" });
  const cap = full ? 100 : (id === "local" ? 25 : 18);
  const refresh = url.searchParams.get("refresh") === "1";
  try {
    const key = `shelf:v11:${full ? "full" : "row"}:${id}:${q}:${gl}:${utcDay()}`;
    const build = async () => {
      const cleanCatalogQ = q.replace(/\bofficial audio\b/ig, "").replace(/\bofficial\b/ig, "").trim();
      const [ytR, itR, dzR] = await Promise.allSettled([
        searchYouTube(q, gl, false),
        id !== "local" ? itunesSearch(cleanCatalogQ, { includeExtra: false, country: gl }).catch(() => ({ songs: [] })) : Promise.resolve({ songs: [] }),
        id !== "local" ? deezerSearch(cleanCatalogQ, { limit: 25, includeExtra: false }).catch(() => ({ songs: [] })) : Promise.resolve({ songs: [] }),
      ]);
      let rows = (ytR.status === "fulfilled" ? ytR.value : []).filter((t) => !isUnwantedIndianTrackForRegion(t, gl));
      if (!rows || !rows.length) {
        try {
          rows = (await searchYouTube(q, gl, true)).filter((t) => !isUnwantedIndianTrackForRegion(t, gl));
        } catch {}
      }
      const itSongs = ((itR.status === "fulfilled" && itR.value && Array.isArray(itR.value.songs)) ? itR.value.songs : [])
        .filter((t) => !isUnwantedIndianTrackForRegion(t, gl));
      const dzSongs = ((dzR.status === "fulfilled" && dzR.value && Array.isArray(dzR.value.songs)) ? dzR.value.songs : [])
        .filter((t) => !isUnwantedIndianTrackForRegion(t, gl));
      // Lead with iTunes local storefront + YouTube country results so the
      // shelf authentically reflects the selected country (even if the server
      // runs in a different region).
      const combined = weaveCatalogTracks(itSongs.length ? itSongs : rows, rows, dzSongs, cap * 2)
        .filter((t) => !isUnwantedIndianTrackForRegion(t, gl));
      const sliced = combined.slice(0, cap);
      if (!sliced.length) throw new Error("no tracks");
      return sliced;
    };
    const tracks = refresh ? await build() : await kvCached(env, key, 86400000, build);
    return json(200, {
      id: id || (shelf && shelf.id) || "",
      title: (shelf && shelf.title) || q,
      tracks: (tracks || []).filter((t) => !isUnwantedIndianTrackForRegion(t, gl)),
    });
  } catch (e) {
    return json(200, {
      id: id || (shelf && shelf.id) || "",
      title: (shelf && shelf.title) || q,
      tracks: [],
      error: String((e && e.message) || e),
    });
  }
}

export async function handleSearch(env, url) {
  const q = (url.searchParams.get("q") || url.searchParams.get("query") || "").trim();
  if (!q) return json(400, { error: "Missing query" });
  const gl = regionCode(url.searchParams.get("gl"));
  const source = (url.searchParams.get("source") || "all").toLowerCase();
  const refresh = url.searchParams.get("refresh") === "1";

  const fold = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const wantQ = fold(q);

  const finalizeArtists = (artistsList, songsPool) => {
    const out = [];
    const seen = new Set();
    const upsert = (a) => {
      if (!a || !a.name) return;
      const cleanName = String(a.name).replace(/\s*[|–—-]\s*topic$/i, "").trim();
      const k = fold(cleanName);
      if (!k || k === "youtube" || k === "various artists" || k === "unknown" || k === "artist") return;
      if (!seen.has(k)) {
        seen.add(k);
        out.push({
          id: a.id || `artist:${a.source || "youtube"}:${cleanName}`,
          kind: "artist",
          name: cleanName,
          artwork: a.artwork || "/cover-default.jpg",
          source: a.source || "youtube",
          query: a.query || cleanName,
        });
      } else {
        const ex = out.find((x) => fold(x.name) === k);
        if (ex && (!ex.artwork || ex.artwork === "/cover-default.jpg") && a.artwork && a.artwork !== "/cover-default.jpg") {
          ex.artwork = a.artwork;
        }
        if (ex && ex.source === "audius" && a.source && a.source !== "audius") {
          ex.source = a.source;
          if (a.id) ex.id = a.id;
        }
      }
    };

    for (const a of artistsList || []) upsert(a);

    // Derive artists from matched songs so even if dedicated artist endpoints
    // time out or rate-limit on the Worker edge, any artist with songs in
    // Apple / Deezer / YouTube / Audius is always surfaced in result.artists.
    for (const t of songsPool || []) {
      if (!t || !t.artist) continue;
      const rawArt = String(t.artist).replace(/\s*[|–—-]\s*topic$/i, "").trim();
      if (!rawArt) continue;
      const artParts = rawArt.split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bx\b|\swith\s)\s*/i).map((s) => s.trim()).filter(Boolean);
      const candidates = [rawArt, ...artParts];
      for (const cand of candidates) {
        const cf = fold(cand);
        if (!cf || cf.length < 2) continue;
        if (cf === wantQ || cf.startsWith(wantQ) || (wantQ.length >= 3 && (cf.includes(wantQ) || wantQ.includes(cf))) || out.length < 12) {
          upsert({
            id: `artist:${t.source || "youtube"}:${cand}`,
            kind: "artist",
            name: cand,
            artwork: t.artwork || "/cover-default.jpg",
            source: t.source || "youtube",
            query: cand,
          });
        }
      }
    }

    if (out.length > 1 && wantQ) {
      const qWords = wantQ.split(/\s+/).filter((w) => w.length >= 2);
      const scoreArtist = (a) => {
        const na = fold(a.name);
        const srcBonus = (a.source === "apple" || a.source === "deezer") ? 2 : (a.source === "youtube" ? 1 : 0);
        if (na === wantQ) return 100 + srcBonus;
        if (na.startsWith(wantQ)) return 80 + srcBonus;
        if (wantQ.startsWith(na) && na.length >= 3) return 70 + srcBonus;
        if (na.includes(wantQ)) return 60 + srcBonus;
        if (qWords.length > 1 && qWords.every((w) => na.includes(w))) return 50 + srcBonus;
        if (qWords.some((w) => na.includes(w))) return 25 + srcBonus;
        return srcBonus;
      };
      out.sort((a, b) => {
        const diff = scoreArtist(b) - scoreArtist(a);
        if (diff !== 0) return diff;
        return fold(a.name).length - fold(b.name).length;
      });
    }
    return out.slice(0, 20);
  };

  const runBuild = async () => {
    const result = { query: q, youtube: [], audius: [], radio: [], apple: [], itunes: [], deezer: [], artists: [], playlists: [] };

    if (source === "apple" || source === "itunes") {
      const ap = await itunesSearch(q, { includeExtra: true, country: gl }).catch(() => ({ songs: [], artists: [], playlists: [] }));
      const songs = strictSongs(ap.songs || []);
      result.apple = songs;
      result.itunes = songs;
      result.artists = finalizeArtists(ap.artists || [], songs);
      result.playlists = (ap.playlists || []).slice(0, 20);
      return result;
    }

    if (source === "deezer") {
      const dz = await deezerSearch(q, { limit: 50, includeExtra: true, country: gl }).catch(() => ({ songs: [], artists: [], playlists: [] }));
      const songs = strictSongs(dz.songs || []);
      result.deezer = songs;
      result.artists = finalizeArtists(dz.artists || [], songs);
      result.playlists = (dz.playlists || []).slice(0, 20);
      return result;
    }

    if (source === "youtube") {
      const yt = await searchYouTube(q, gl).catch(() => []);
      const songs = strictSongs(Array.isArray(yt) ? yt : []);
      result.youtube = songs;
      result.artists = finalizeArtists(yt.artists || [], songs);
      result.playlists = (yt.playlists || []).slice(0, 20);
      return result;
    }

    if (source === "audius") {
      const [aud, u] = await Promise.allSettled([audiusSearch(q), audiusUserSearch(q)]);
      result.audius = strictSongs(aud.status === "fulfilled" && Array.isArray(aud.value) ? aud.value : []);
      const artists = [];
      if (u.status === "fulfilled" && Array.isArray(u.value)) {
        for (const usr of u.value) {
          artists.push({
            id: `artist:audius:${usr.id}`,
            kind: "artist",
            name: usr.name,
            artwork: usr.artwork,
            source: "audius",
            query: usr.name,
          });
        }
      }
      result.artists = finalizeArtists(artists, result.audius);
      return result;
    }

    if (source === "radio") {
      const rad = await radioSearch(q, 16, url.searchParams.get("quality")).catch(() => []);
      result.radio = Array.isArray(rad) ? rad : [];
      return result;
    }

    // source === "all": Run all providers concurrently in parallel
    const fastWait = (promise, ms, fallback) =>
      Promise.race([promise, new Promise((res) => setTimeout(() => res(fallback), ms))]);

    const allTasks = [
      ["youtube", searchYouTube(q, gl)],
      ["apple", fastWait(itunesSearch(q, { includeExtra: true, country: gl }), 5500, { songs: [], artists: [], playlists: [] })],
      ["deezer", fastWait(deezerSearch(q, { limit: 50, includeExtra: true, country: gl }), 6500, { songs: [], artists: [], playlists: [] })],
      ["audius", audiusSearch(q)],
      ["radio", fastWait(radioSearch(q, 16, url.searchParams.get("quality")), 2500, [])],
      ["audiusUsers", fastWait(audiusUserSearch(q), 2500, [])],
    ];
    const settled = await Promise.allSettled(allTasks.map((t) => t[1]));
    settled.forEach((s, i) => {
      const key = allTasks[i][0];
      result[key] = s.status === "fulfilled" ? s.value : [];
    });

    const yt = result.youtube || [];
    const apple = result.apple && !Array.isArray(result.apple) ? result.apple : { songs: [], artists: [], playlists: [] };
    result.apple = Array.isArray(result.apple) ? result.apple : (apple.songs || []);
    const dz = result.deezer && !Array.isArray(result.deezer) ? result.deezer : { songs: [], artists: [], playlists: [] };
    result.deezer = Array.isArray(result.deezer) ? result.deezer : (dz.songs || []);

    const rawArtists = [];
    const playlists = [];
    const seenP = new Set();
    const pushP = (p) => {
      const k = String((p && (p.playlistId || p.id || p.title)) || "").toLowerCase();
      if (!k || seenP.has(k)) return;
      seenP.add(k);
      playlists.push(p);
    };
    (apple.artists || []).forEach((a) => rawArtists.push(a));
    (apple.playlists || []).forEach(pushP);
    (dz.artists || []).forEach((a) => rawArtists.push(a));
    (dz.playlists || []).forEach(pushP);
    (yt.artists || []).forEach((a) => rawArtists.push(a));
    (yt.playlists || []).forEach(pushP);
    for (const u of result.audiusUsers || []) {
      rawArtists.push({
        id: `artist:audius:${u.id}`,
        kind: "artist",
        name: u.name,
        artwork: u.artwork,
        source: "audius",
        query: u.name,
      });
    }
    delete result.audiusUsers;
    // STRICT "songs only": search shows single songs — no playlist videos,
    // Topic re-uploads, 2-hour mixes or non-music.
    if (Array.isArray(yt)) result.youtube = strictSongs(yt);
    result.apple = strictSongs(result.apple);
    result.itunes = result.apple;
    result.deezer = strictSongs(result.deezer);
    if (!result.deezer.length && (result.apple.length || (result.youtube && result.youtube.length))) {
      const seed = result.apple.length ? result.apple : result.youtube;
      result.deezer = strictSongs(seed.map((t) => normalizeDeezerTrack(t)).filter(Boolean));
    }
    result.audius = strictSongs(result.audius || []);

    const allMatchedSongs = [
      ...(result.apple || []),
      ...(result.deezer || []),
      ...(result.youtube || []),
      ...(result.audius || []),
    ];
    result.artists = finalizeArtists(rawArtists, allMatchedSongs);
    result.playlists = playlists.slice(0, 20);
    return result;
  };

  const cacheKey = `search:${source}:${q.toLowerCase()}:${gl}`;
  const data = refresh ? await runBuild() : await cached(cacheKey, 180000, runBuild);

  const res = json(200, data);
  res.headers.set("Cache-Control", "public, max-age=60, s-maxage=120, stale-while-revalidate=300");
  return res;
}

export async function handleYoutubeSearch(url) {
  const yq = (url.searchParams.get("q") || url.searchParams.get("query") || "").trim();
  if (!yq) return json(400, { error: "Missing query" });
  const gl = regionCode(url.searchParams.get("gl"));
  try {
    const tracks = await searchYouTube(yq, gl);
    return json(200, { tracks: Array.isArray(tracks) ? tracks.slice(0, 80) : [] });
  } catch (e) {
    return json(502, { tracks: [], error: String(e.message || e) });
  }
}

export async function handleYtPlaylist(url) {
  const id = url.searchParams.get("id") || "";
  if (!id) return json(200, { tracks: [], playlistId: id });
  // Cache the (often slow, multi-page) playlist browse so repeat opens are
  // instant. 30 min TTL + in-flight dedupe; user-generated IDs are fine here
  // (bounded space, reads are what matter).
  const data = await cached(`ytplaylist:${id}`, 30 * 60 * 1000, async () => {
    const tracks = await youtubePlaylistTracks(id);
    return { tracks, playlistId: id };
  }).catch(() => null);
  if (data) return json(200, data);
  return json(200, { tracks: [], playlistId: id });
}

export async function handleYtStream(url) {
  const id = url.searchParams.get("v") || url.searchParams.get("id") || url.searchParams.get("videoId") || "";
  if (!id) return json(400, { error: "Missing videoId" });

  try {
    const stream = await cached(`ytstream:${id}`, 15 * 60 * 1000, () => youtubeAudioStream(id));
    if (stream && stream.url) {
      const proxied = `/api/stream?url=${encodeURIComponent(stream.url)}`;
      return json(200, {
        url: proxied,
        format: stream.format || "",
        mimeType: stream.mimeType || "",
        quality: stream.quality || "",
        duration: stream.duration || 0,
        source: "youtube",
      });
    }
  } catch {}

  return json(200, { url: "", error: "No direct audio stream available" });
}

export async function handleArtist(url) {
  const q = (url.searchParams.get("q") || "").trim();
  const appleId = String(url.searchParams.get("id") || "").replace(/[^\d]/g, "");
  const name = (url.searchParams.get("name") || q).trim();
  const handle = url.searchParams.get("handle") || "";
  const userId = url.searchParams.get("userId") || "";
  const gl = regionCode(url.searchParams.get("gl"));

  if (appleId || q) {
    const key = `artist:${appleId || (q || name).toLowerCase()}:${gl}`;
    const build = async () => {
      let artistName = name || q;
      let artwork = "";
      let albums = [];
      const foldName = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
      const targetFold = foldName(artistName);
      const matchesTargetArtist = (cand) => {
        const cf = foldName(cand);
        if (!cf || !targetFold) return false;
        if (cf === targetFold) return true;
        if (targetFold.length >= 3 && (cf.includes(targetFold) || targetFold.includes(cf))) return true;
        return false;
      };
      // ── Three sources IN PARALLEL (was serial — that's what made the
      //    profile take 15-25s and time out on the client) ─────────────
      // Apple: lookup by id + iTunes search (songs + albums).
      const appleJob = (async () => {
        let art = "";
        let alb = [];
        let songs = [];
        let nm = "";
        if (appleId) {
          try {
            const look = await fetchJSON(`https://itunes.apple.com/lookup?id=${encodeURIComponent(appleId)}&entity=album&limit=25`);
            const rows = (look && look.results) || [];
            const self = rows.find((r) => r.wrapperType === "artist") || {};
            if (self.artistName && (!targetFold || matchesTargetArtist(self.artistName))) {
              nm = self.artistName;
            }
            for (const al of rows) {
              if (al.wrapperType !== "collection" && al.collectionType !== "Album") continue;
              if (!art && al.artworkUrl100) art = String(al.artworkUrl100).replace("100x100bb", "600x600bb");
              alb.push({
                id: `album:${al.collectionId}`,
                kind: "playlist",
                title: al.collectionName || "Album",
                artist: al.artistName || nm || artistName,
                artwork: String(al.artworkUrl100 || "").replace("100x100bb", "600x600bb") || "/cover-default.jpg",
                source: "apple",
                query: `${al.collectionName || ""} ${al.artistName || nm || artistName}`.trim(),
              });
            }
          } catch {}
          try {
            const look = await fetchJSON(`https://itunes.apple.com/lookup?id=${encodeURIComponent(appleId)}&entity=song&limit=30`);
            for (const t of (look && look.results) || []) {
              if (!t.trackId || t.wrapperType === "artist") continue;
              songs.push({
                id: `apple:${t.trackId}`,
                source: "apple",
                title: t.trackName || "Song",
                artist: t.artistName || nm || artistName,
                album: t.collectionName || "",
                duration: Math.round((t.trackTimeMillis || 0) / 1000),
                artwork: String(t.artworkUrl100 || "").replace("100x100bb", "600x600bb") || "/cover-default.jpg",
                playQuery: `${t.trackName || ""} ${t.artistName || nm || artistName} official audio`.trim(),
              });
            }
          } catch {}
        }
        if (!songs.length && (q || name)) {
          try {
            const pack = await itunesSearch(q || name);
            const matchedArt = (pack.artists || []).find((a) => foldName(a.name) === targetFold)
              || (pack.artists || []).find((a) => matchesTargetArtist(a.name));
            if (!art && matchedArt) art = matchedArt.artwork;
            if (!nm && matchedArt) nm = matchedArt.name;
            songs = (pack.songs || []).filter((t) => matchesTargetArtist(t.artist));
            if (!alb.length) alb = (pack.playlists || []).filter((p) => matchesTargetArtist(p.artist));
          } catch {}
        }
        return { art, alb, songs, nm };
      })();
      // YouTube fast search — hard-capped at 9s: Piped is often slow, and
      // Apple + Deezer still give a full profile without it.
      const ytJob = (async () => {
        try {
          const rows = await raceTimeout(searchYouTube(`${q || name} official audio`, gl, true), 9000, []);
          const list = Array.isArray(rows) ? rows : [];
          return list.filter((t) => matchesTargetArtist(t.artist) || foldName(t.title).includes(targetFold)).slice(0, 16);
        } catch {
          return [];
        }
      })();
      // Deezer discography (METADATA ONLY — no audio, no previews).
      // Complete album list + per-album track order, so the profile shows
      // the artist's real catalogue instead of "a few songs".
      const dzJob = (async () => {
        try {
          return await raceTimeout(deezerCatalog(artistName || q || name, {}), 20000, null);
        } catch {
          return null;
        }
      })();
      const [ap, ytRows, dz] = await Promise.all([appleJob, ytJob, dzJob]);
      artwork = ap.art || "";
      if (ap.nm && matchesTargetArtist(ap.nm)) artistName = ap.nm;
      albums = ap.alb;
      const normKey = (t) => `${String(t.title || "").toLowerCase()}|${String(t.artist || "").toLowerCase()}`;
      const haveYt = new Set(ytRows.map((t) => normKey(t)));
      const appleRest = ap.songs.filter((t) => !haveYt.has(normKey(t)));
      let songs = [...ytRows, ...appleRest];
      if (dz && (!dz.artist.name || matchesTargetArtist(dz.artist.name))) {
        if (!artwork && dz.artist.artwork) artwork = dz.artist.artwork;
        if (dz.artist.name && matchesTargetArtist(dz.artist.name)) artistName = dz.artist.name;
        const seenAlb = new Set(albums.map((al) => String(al.title || "").toLowerCase()));
        for (const al of dz.albums) {
          if (seenAlb.has(String(al.title || "").toLowerCase())) continue;
          seenAlb.add(String(al.title || "").toLowerCase());
          albums.push(al);
        }
        const seenSong = new Set(songs.map((t) => normKey(t)));
        for (const t of dz.songs) {
          const k = normKey(t);
          if (seenSong.has(k)) continue;
          seenSong.add(k);
          songs.push(t);
        }
      }
      // STRICT "songs only": Topic re-uploads, "Top … Playlist" videos,
      // 2-hour mixes and other non-songs never reach the profile.
      songs = strictSongs(songs);
      if (!songs.length && !albums.length) throw new Error("artist upstream empty");
      return {
        name: artistName || q || name,
        artwork,
        songs: songs.slice(0, 500),
        albums: albums.slice(0, 120),
        tracks: songs.slice(0, 16),
        latest: songs[0] || null,
      };
    };
    // Repeat visits are instant (6h in-isolate cache + in-flight dedupe).
    const data = await cached(key, 6 * 3600 * 1000, build).catch(() => null);
    if (data) return json(200, data);
    // Every upstream failed: honest thin response — the client tops up via
    // /api/search so the profile never opens blank.
    return json(200, { name: name || q, artwork: "", songs: [], albums: [], tracks: [], latest: null });
  }

  let audius = [];
  let youtube = [];
  if (userId) {
    try { audius = await audiusUserTracks(userId); } catch {}
  } else if (handle) {
    try {
      const users = await audiusUserSearch(handle);
      const u = users.find((x) => String(x.handle).toLowerCase() === handle.toLowerCase()) || users[0];
      if (u) audius = await audiusUserTracks(u.id);
    } catch {}
  } else if (name) {
    try {
      const users = await audiusUserSearch(name);
      if (users[0]) audius = await audiusUserTracks(users[0].id);
    } catch {}
    try { youtube = (await searchYouTube(`${name} official audio`, gl)).slice(0, 8); } catch {}
  }
  return json(200, {
    tracks: [...audius, ...youtube].slice(0, 16),
    latest: audius[0] || youtube[0] || null,
  });
}

export async function handleRadio(url) {
  const rq = (url.searchParams.get("q") || "").trim();
  const quality = url.searchParams.get("quality") || "";
  const codec = url.searchParams.get("codec") || "auto";
  try {
    let tracks = await radioSearch(rq, 36, quality, codec);
    if (!tracks.length && rq) tracks = await radioSearch("", 36, quality, codec);
    return json(200, { tracks });
  } catch (e) {
    return json(502, { tracks: [], error: String(e.message || e) });
  }
}

export async function handleRadioClick(url) {
  const id = url.pathname.split("/").pop();
  radioBrowser(`/json/url/${encodeURIComponent(id)}`).catch(() => {});
  return json(200, { ok: true });
}

export async function handleDiscover(url) {
  const artists = String(url.searchParams.get("artists") || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 5);
  const genres = String(url.searchParams.get("genres") || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 4);
  const week = String(url.searchParams.get("week") || "").trim();
  const gl = regionCode(url.searchParams.get("gl"));
  const qs = [];
  artists.forEach((a) => {
    qs.push(`${a} mix official audio`);
    qs.push(`${a} radio mix`);
  });
  genres.forEach((g) => qs.push(`${g} songs official audio`));
  if (!qs.length) {
    qs.push("english pop hits official audio");
    qs.push("new music mix official audio");
    qs.push("indie pop english songs");
  }
  qs.push("hidden gems english songs official audio");
  const queries = [...new Set(qs)].slice(0, 6);
  const cacheKey = `discover:${gl}:${week}:${queries.join("|")}`;
  try {
    const tracks = await cached(cacheKey, 6 * 3600000, async () => {
      const settled = await Promise.allSettled(queries.map((q) => searchYouTube(q, gl, true)));
      const seen = new Set();
      const out = [];
      for (const s of settled) {
        const rows = s.status === "fulfilled" ? s.value : [];
        for (const row of rows || []) {
          if (!row || row.source === "radio") continue;
          // Keep \"Made for you\" mixes English-only: skip any clearly
          // non-English (e.g. Hindi/Devanagari) song that slips in from the
          // taste profile artist/genre queries. This was the reported bug —
          // the mix turned up Hindi songs mixed in with English ones.
          if (!isEnglishTrack(row)) continue;
          const k = String(row.videoId || row.id || "");
          if (!k || seen.has(k)) continue;
          seen.add(k);
          out.push(row);
          if (out.length >= 40) break;
        }
        if (out.length >= 40) break;
      }
      // If taste-driven artists/genres returned only non-English results, fall
      // back to a clean English-only default so the mix is never empty or
      // full of Hindi/regional tracks.
      if (!out.length) {
        for (const q of ["english pop hits official audio", "top english songs this week", "indie pop english songs"]) {
          try {
            const rows = (await searchYouTube(q, gl, true)) || [];
            for (const row of rows) {
              if (!row || row.source === "radio" || !isEnglishTrack(row)) continue;
              const k = String(row.videoId || row.id || "");
              if (!k || seen.has(k)) continue;
              seen.add(k);
              out.push(row);
              if (out.length >= 30) break;
            }
          } catch {}
          if (out.length >= 30) break;
        }
      }
      let seed = 0;
      const weekSeed = week || "mix";
      for (let i = 0; i < weekSeed.length; i++) seed = (seed * 31 + weekSeed.charCodeAt(i)) >>> 0;
      const shuffled = out.slice();
      for (let i = shuffled.length - 1; i > 0; i--) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const j = seed % (i + 1);
        const tmp = shuffled[i];
        shuffled[i] = shuffled[j];
        shuffled[j] = tmp;
      }
      return shuffled.slice(0, 30);
    });
    return json(200, { week, title: "Discovery Mix", tracks: tracks || [] });
  } catch (e) {
    return json(200, { week, title: "Discovery Mix", tracks: [], error: String(e.message || e) });
  }
}

export async function handleRelated(url) {
  const title = (url.searchParams.get("title") || "").trim();
  const artist = (url.searchParams.get("artist") || "").trim();
  const skip = (url.searchParams.get("skip") || "").trim();
  const gl = regionCode(url.searchParams.get("gl"));
  const a = artist.replace(/\s*[|–—-]\s*topic$/i, "").trim();
  const t = title.replace(/\s*\((official|lyrics|audio|video).*?\)/ig, "").trim();
  const qs = [];
  // Spotify-style queue recommendation seeds:
  // 1. Song radio / playlist mix (YouTube Music's song radio)
  if (t && a) qs.push(`${t} ${a} radio`);
  // 2. Artist radio mix
  if (a && !/^(youtube|various artists|unknown)$/i.test(a)) {
    qs.push(`${a} radio`);
    qs.push(`${a} mix`);
  }
  // 3. Similar vibe audio
  if (t && a) qs.push(`${t} ${a} official audio`);
  else if (t) qs.push(`${t} radio`);

  const queries = [...new Set(qs.filter(Boolean))].slice(0, 3);
  if (!queries.length) return json(200, { tracks: [] });
  const cacheKey = `related:${gl}:${queries.join("|")}`;
  try {
    const tracks = await cached(cacheKey, 180000, async () => {
      const settled = await Promise.allSettled(queries.map((q) => searchYouTube(q, gl, true)));
      const seen = new Set();
      const artistCounts = new Map();
      const out = [];
      for (const s of settled) {
        const rows = s.status === "fulfilled" ? s.value : [];
        for (const row of rows || []) {
          if (!row || row.source === "radio") continue;
          const k = String(row.videoId || row.id || "");
          if (!k || seen.has(k) || seen.has(row.id)) continue;
          const rowArt = String(row.artist || "").toLowerCase().trim();
          // Spotify-style diversity: cap max 2 songs from the same artist so recommendations feel like a curated radio
          const count = artistCounts.get(rowArt) || 0;
          if (count >= 2 && out.length >= 6) continue;
          seen.add(k);
          if (row.id) seen.add(row.id);
          artistCounts.set(rowArt, count + 1);
          out.push(row);
          if (out.length >= 30) break;
        }
        if (out.length >= 30) break;
      }

      // If YouTube yielded fewer than 10 tracks, supplement with studio catalog recommendations
      if (out.length < 12 && a) {
        try {
          const [ap, dz] = await Promise.allSettled([
            itunesSearch(a, { includeExtra: false, country: gl }),
            deezerSearch(a, { limit: 15, includeExtra: false }),
          ]);
          const catalog = [];
          if (ap.status === "fulfilled" && ap.value && Array.isArray(ap.value.songs)) {
            catalog.push(...ap.value.songs);
          }
          if (dz.status === "fulfilled" && dz.value && Array.isArray(dz.value.songs)) {
            catalog.push(...dz.value.songs);
          }
          for (const row of catalog) {
            if (!row || row.source === "radio") continue;
            const k = String(row.id || row.videoId || "");
            if (!k || seen.has(k)) continue;
            seen.add(k);
            out.push(row);
            if (out.length >= 30) break;
          }
        } catch {}
      }

      return out;
    });
    const skipSet = new Set(String(skip).split(",").map((x) => x.trim()).filter(Boolean));
    let finalTracks = (tracks || []).filter((row) => row && !skipSet.has(row.id) && !skipSet.has(row.videoId));
    if (!finalTracks.length && Array.isArray(tracks) && tracks.length) {
      // Don't starve recommendations if all exact IDs were in skipSet: keep tracks whose title differs
      finalTracks = tracks.filter((row) => row && String(row.title || "").toLowerCase() !== String(title).toLowerCase());
      if (!finalTracks.length) finalTracks = tracks.slice(0, 15);
    }
    return json(200, {
      tracks: finalTracks.slice(0, 24),
    });
  } catch (e) {
    return json(200, { tracks: [], error: String(e.message || e) });
  }
}

export async function handleItunesSearch(url) {
  const path = url.searchParams.get("path") || "";
  const q = (url.searchParams.get("q") || url.searchParams.get("term") || url.searchParams.get("query") || "").trim();

  // Mode 1: Proxy raw iTunes path (e.g. /search?term=...&entity=song&limit=50, /lookup?id=...)
  if (path) {
    try {
      const cleanPath = path.startsWith("/") ? path : `/${path}`;
      const allowed = ["/search", "/lookup"];
      if (!allowed.some((prefix) => cleanPath.startsWith(prefix))) {
        return json(400, { error: "Disallowed iTunes path" });
      }
      const targetUrl = `https://itunes.apple.com${cleanPath}`;
      const ctrl = new AbortController();
      const tm = setTimeout(() => ctrl.abort(), 12000);
      try {
        const r = await fetch(targetUrl, {
          signal: ctrl.signal,
          headers: {
            Accept: "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          },
        });
        if (r.ok) {
          const data = await r.json();
          const resp = json(200, data);
          resp.headers.set("Cache-Control", "public, max-age=300, s-maxage=600");
          return resp;
        }
      } finally {
        clearTimeout(tm);
      }
    } catch (e) {
      // Fall through to query fallback if possible
    }
  }

  // Mode 2: Query search
  const queryTerm = q || (path ? (() => { try { return new URL(`https://itunes.apple.com${path.startsWith("/") ? path : `/${path}`}`).searchParams.get("term") || ""; } catch { return ""; } })() : "");
  if (!queryTerm) return json(400, { error: "Missing query or path", results: [], apple: [], itunes: [] });
  const gl = regionCode(url.searchParams.get("gl") || url.searchParams.get("country"));
  try {
    const res = await itunesSearch(queryTerm, { includeExtra: true, country: gl });
    const songs = strictSongs(res.songs || []);
    const r = json(200, {
      results: songs,
      apple: songs,
      itunes: songs,
      artists: res.artists || [],
      playlists: res.playlists || [],
    });
    r.headers.set("Cache-Control", "public, max-age=300, s-maxage=600");
    return r;
  } catch (err) {
    return json(500, { error: String(err && err.message || err), results: [], apple: [], itunes: [] });
  }
}

export async function handleDeezerProxy(url) {
  const path = url.searchParams.get("path") || "";
  const q = (url.searchParams.get("q") || url.searchParams.get("term") || url.searchParams.get("query") || "").trim();
  const gl = regionCode(url.searchParams.get("gl") || url.searchParams.get("country"));

  const cleanPath = path ? (path.startsWith("/") ? path : `/${path}`) : "";
  let pathQuery = "";
  if (cleanPath) {
    try {
      const u = new URL(`https://api.deezer.com${cleanPath}`);
      pathQuery = (u.searchParams.get("q") || u.searchParams.get("term") || "").trim();
    } catch {}
  }
  const queryTerm = q || pathQuery;

  // Mode 1: Proxy raw Deezer path (e.g. /search?q=..., /artist/..., /album/...)
  if (cleanPath) {
    const allowed = ["/search", "/artist", "/album", "/track", "/chart", "/genre"];
    if (!allowed.some((prefix) => cleanPath.startsWith(prefix))) {
      return json(400, { error: "Disallowed Deezer path" });
    }
    try {
      const data = await dzFetch(cleanPath, 8000);
      const isSearchPath = cleanPath.startsWith("/search");
      const isArtistSearch = cleanPath.startsWith("/search/artist");
      const isAlbumSearch = cleanPath.startsWith("/search/album");
      const hasRows = data && Array.isArray(data.data) && data.data.length > 0;
      const hasObject = data && !Array.isArray(data.data) && (data.id || (data.tracks && Array.isArray(data.tracks.data)));

      if (hasObject) {
        const resp = json(200, data);
        resp.headers.set("Cache-Control", "public, max-age=300, s-maxage=600");
        return resp;
      }

      if (hasRows) {
        if (isSearchPath && !isArtistSearch && !isAlbumSearch) {
          const songs = strictSongs(data.data.map((t) => normalizeDeezerTrack(t)).filter(Boolean));
          if (songs.length > 0) {
            const resp = json(200, {
              ...data,
              data: songs,
              results: songs,
              deezer: songs,
            });
            resp.headers.set("Cache-Control", "public, max-age=300, s-maxage=600");
            return resp;
          }
        } else {
          const resp = json(200, data);
          resp.headers.set("Cache-Control", "public, max-age=300, s-maxage=600");
          return resp;
        }
      }
    } catch {
      // Fall through to resilient search / catalog fallback below
    }

    // If cleanPath was /search/artist?q=... and upstream failed, synthesize from deezerSearch
    if (cleanPath.startsWith("/search/artist") && queryTerm) {
      try {
        const dz = await deezerSearch(queryTerm, { limit: 25, includeExtra: true, country: gl });
        const artistRows = (dz.artists || []).map((a) => ({
          id: String(a.id || "").replace(/^artist:deezer:/, ""),
          name: a.name,
          picture_medium: a.artwork,
          picture_big: a.artwork,
          artwork: a.artwork,
          nb_fan: 50000,
        }));
        return json(200, { data: artistRows, total: artistRows.length });
      } catch {}
    }
  }

  // Mode 2: Resilient Deezer search (handles /api/deezer/search?q=... and fallback from /search?q=...)
  if (queryTerm) {
    try {
      const dz = await deezerSearch(queryTerm, { limit: 50, includeExtra: true, country: gl }).catch(() => ({ songs: [], artists: [], playlists: [] }));
      const songs = strictSongs(dz.songs || []);
      const resp = json(200, {
        results: songs,
        data: songs,
        deezer: songs,
        artists: dz.artists || [],
        playlists: dz.playlists || [],
        total: songs.length,
      });
      if (songs.length > 0) {
        resp.headers.set("Cache-Control", "public, max-age=300, s-maxage=600");
      } else {
        resp.headers.set("Cache-Control", "no-store");
      }
      return resp;
    } catch (e) {
      return json(500, { error: String((e && e.message) || e), results: [], data: [], deezer: [] });
    }
  }

  return json(400, { error: "Missing path or query" });
}

export async function handleLyrics(url) {
  const title = url.searchParams.get("title") || "";
  const artist = url.searchParams.get("artist") || "";
  const dur = Number(url.searchParams.get("duration")) || 0;
  const data = await lyricsFor(title, artist, dur);
  return json(200, data);
}

