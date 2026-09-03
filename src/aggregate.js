// MUCHI — aggregation endpoints, ported from server.js (lines 1665–2167)
// with the Phase-2 plan's decomposition applied:
//   - home: per-day KV-cached blocks (english + per-country) so the heavy
//     ~16-subrequest build runs ONCE per day per key, not per user/isolate
//   - shelf: per-day KV-cached per shelf
//   - discover/related/search: in-memory cached() exactly like server.js
//     (user-generated keys are NOT KV-cached — KV free allows 1k writes/day)
// Response shapes are byte-identical to server.js.

import { json, cached, kvCached, fetchJSON } from "./util.js";
import {
  searchYouTube, youtubeMusicSearch, youtubePlaylistTracks, youtubeAudioStream,
  itunesSearch,
  audiusSearch, audiusTrending, audiusUnderground, audiusUserSearch, audiusUserTracks,
  radioSearch, radioBrowser, lyricsFor, resolveShelfPlaylist,
} from "./providers.js";
import {
  regionCode, utcDay, LOCAL_CHARTS, ENGLISH_SHELVES, FY_QUERIES,
  moodsForCountry, playlistsOf, uniqPlaylists, buildForYouPlaylists,
} from "./data.js";
import { deezerCatalog } from "./deezer.js";
import { strictSongs } from "./parse.js";

const take = (r) => (r.status === "fulfilled" ? r.value : []);
// Resolve with `fallback` after ms so one slow upstream (usually Piped)
// can't stall the whole artist build. The losing promise is abandoned.
const raceTimeout = (p, ms, fallback = null) =>
  Promise.race([p, new Promise((res) => setTimeout(() => res(fallback), ms))]);

export async function handleHome(env, url) {
  const gl = regionCode(url.searchParams.get("gl"));
  const localQ = LOCAL_CHARTS[gl] || "top hits official audio";
  const refresh = url.searchParams.get("refresh") === "1";
  let globalPart = { shelves: [], globalPlaylists: [], audius: [], underground: [], radio: [], forYouPlaylists: [] };
  let localPart = { youtubeLocal: [], countryPlaylists: [] };
  try {
    globalPart = await (refresh ? buildGlobal(gl, localQ) : kvCached(env, `home:english:v5:${utcDay()}`, 86400000, () => buildGlobal(gl, localQ)));
  } catch (e) {
    console.error("home english", e);
    globalPart.shelves = ENGLISH_SHELVES.map((s) => ({ id: s.id, title: s.title, query: s.query, tracks: [] }));
    globalPart.forYouPlaylists = buildForYouPlaylists([]);
  }
  try {
    localPart = await (refresh ? buildLocal(gl, localQ) : kvCached(env, `home:local:${gl}:v5:${utcDay()}`, 86400000, () => buildLocal(gl, localQ)));
  } catch (e) {
    console.error("home local", e);
  }
  const charts = (globalPart.shelves[0] && globalPart.shelves[0].tracks) || [];
  return json(200, {
    country: gl,
    day: utcDay(),
    localQuery: localQ,
    moods: moodsForCountry(gl),
    shelves: globalPart.shelves.length
      ? globalPart.shelves
      : ENGLISH_SHELVES.map((s) => ({ id: s.id, title: s.title, query: s.query, tracks: [] })),
    youtubeCharts: charts,
    youtubeLocal: localPart.youtubeLocal,
    youtubeIndia: localPart.youtubeLocal,
    countryPlaylists: localPart.countryPlaylists || [],
    globalPlaylists: globalPart.globalPlaylists || [],
    forYouPlaylists: globalPart.forYouPlaylists || [],
    audius: globalPart.audius,
    underground: globalPart.underground,
    radio: globalPart.radio,
  });
}

async function buildGlobal(gl, localQ) {
  const prime = ENGLISH_SHELVES.slice(0, 2);
  const jobs = prime.map((s) => searchYouTube(s.query, "US", true));
  const extra = await Promise.allSettled([
    ...jobs,
    youtubeMusicSearch("global top hits playlist", "US", 6000, { limit: 40 }),
    audiusTrending(),
    audiusUnderground(),
    radioSearch("hits", 16),
  ]);
  const filled = prime.map((s, i) => take(extra[i]).slice(0, 18));
  const shelves = ENGLISH_SHELVES.map((s, i) => ({
    id: s.id,
    title: s.title,
    query: s.query,
    tracks: i < filled.length ? filled[i] : [],
  }));
  const globalPlaylists = uniqPlaylists([
    ...playlistsOf(extra[0].status === "fulfilled" ? extra[0].value : []),
    ...playlistsOf(extra[1].status === "fulfilled" ? extra[1].value : []),
    ...playlistsOf(extra[2].status === "fulfilled" ? extra[2].value : []),
  ]).slice(0, 16);
  const audius = take(extra[jobs.length + 1]).slice(0, 18);
  const underground = take(extra[jobs.length + 2]).slice(0, 12);
  const radio = take(extra[jobs.length + 3]).slice(0, 12);
  const fyRes = await Promise.allSettled(FY_QUERIES.map((f) => resolveShelfPlaylist(f.query, "US")));
  const forYouPlaylists = buildForYouPlaylists(fyRes);
  const total =
    shelves.reduce((n, s) => n + (s.tracks || []).length, 0) +
    globalPlaylists.length + audius.length + underground.length + radio.length +
    forYouPlaylists.filter((p) => p.playlistId).length;
  if (!total) throw new Error("home empty — not caching");
  return { shelves, globalPlaylists, audius, underground, radio, forYouPlaylists };
}

async function buildLocal(gl, localQ) {
  const [ytLocal, ytPl] = await Promise.allSettled([
    searchYouTube(localQ, gl, true),
    youtubeMusicSearch(`${localQ} playlist`, gl, 6000, { limit: 40 }),
  ]);
  return {
    youtubeLocal: take(ytLocal).slice(0, 18),
    countryPlaylists: uniqPlaylists([
      ...playlistsOf(ytLocal.status === "fulfilled" ? ytLocal.value : []),
      ...playlistsOf(ytPl.status === "fulfilled" ? ytPl.value : []),
    ]).slice(0, 12),
  };
}

export async function handleShelf(env, url) {
  const id = url.searchParams.get("id") || "";
  const shelf = ENGLISH_SHELVES.find((s) => s.id === id);
  const q = url.searchParams.get("q") || (shelf && shelf.query) || "";
  const full = url.searchParams.get("full") === "1";
  if (!q.trim()) return json(400, { error: "Missing query" });
  const gl = url.searchParams.get("gl") || "US";
  const cap = full ? 100 : 18;
  const refresh = url.searchParams.get("refresh") === "1";
  try {
    const key = `shelf:${full ? "full" : "row"}:${id}:${q}:${gl}:${utcDay()}`;
    const build = async () => {
      let rows = [];
      try {
        rows = await searchYouTube(q, gl, false);
      } catch {}
      if (!rows || !rows.length) {
        try {
          rows = await searchYouTube(q, gl, true);
        } catch {}
      }
      const sliced = (rows || []).slice(0, cap);
      if (!sliced.length) throw new Error("no tracks");
      return sliced;
    };
    const tracks = refresh ? await build() : await kvCached(env, key, 86400000, build);
    return json(200, {
      id: id || (shelf && shelf.id) || "",
      title: (shelf && shelf.title) || q,
      tracks: tracks || [],
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
  const q = url.searchParams.get("q") || url.searchParams.get("query") || "";
  if (!q.trim()) return json(400, { error: "Missing query" });
  const gl = regionCode(url.searchParams.get("gl"));
  const source = (url.searchParams.get("source") || "all").toLowerCase();
  const tasks = [];
  if (source === "all" || source === "youtube") tasks.push(["youtube", searchYouTube(q, gl)]);
  if (source === "all" || source === "audius") tasks.push(["audius", audiusSearch(q)]);
  if (source === "all" || source === "radio") tasks.push(["radio", radioSearch(q, 16, url.searchParams.get("quality"))]);
  if (source === "all" || source === "apple") tasks.push(["apple", itunesSearch(q)]);
  if (source === "all" || source === "audius") tasks.push(["audiusUsers", audiusUserSearch(q)]);
  const settled = await Promise.allSettled(tasks.map((t) => t[1]));
  const result = { query: q, youtube: [], audius: [], radio: [], apple: [], artists: [], playlists: [] };
  settled.forEach((s, i) => {
    const key = tasks[i][0];
    result[key] = s.status === "fulfilled" ? s.value : [];
  });
  const yt = result.youtube || [];
  const apple = result.apple && !Array.isArray(result.apple) ? result.apple : { songs: [], artists: [], playlists: [] };
  if (Array.isArray(result.apple)) result.apple = [];
  else result.apple = apple.songs || [];
  const artists = [];
  const playlists = [];
  const seenA = new Set();
  const seenP = new Set();
  const pushA = (a) => {
    const k = String((a && a.name) || "").toLowerCase();
    if (!k || seenA.has(k)) return;
    seenA.add(k);
    artists.push(a);
  };
  const pushP = (p) => {
    const k = String((p && (p.playlistId || p.id || p.title)) || "").toLowerCase();
    if (!k || seenP.has(k)) return;
    seenP.add(k);
    playlists.push(p);
  };
  (apple.artists || []).forEach(pushA);
  (apple.playlists || []).forEach(pushP);
  (yt.artists || []).forEach(pushA);
  (yt.playlists || []).forEach(pushP);
  for (const u of result.audiusUsers || []) {
    pushA({
      id: `artist:audius:${u.id}`,
      kind: "artist",
      name: u.name,
      artwork: u.artwork,
      source: "audius",
      query: u.name,
    });
  }
  delete result.audiusUsers;
  result.artists = artists.slice(0, 20);
  result.playlists = playlists.slice(0, 20);
  // STRICT "songs only": search shows single songs — no playlist videos,
  // Topic re-uploads, 2-hour mixes or non-music. (Audius rows are real
  // user-uploaded tracks; radio is obviously left alone.)
  if (Array.isArray(yt)) result.youtube = strictSongs(yt);
  result.apple = strictSongs(result.apple);
  return json(200, result);
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
  const id = url.searchParams.get("v") || url.searchParams.get("id") || "";
  if (!id) return json(400, { error: "Missing videoId" });
  // Cache the resolved stream URL briefly so re-taps are instant and we
  // don't hammer the Piped instances. 15 min TTL + in-flight dedupe.
  try {
    const stream = await cached(`ytstream:${id}`, 15 * 60 * 1000, () => youtubeAudioStream(id));
    // Route the (IP/token-restricted) Googlevideo URL through the /api/stream
    // proxy. Handing a raw Googlevideo URL straight to the device's player
    // often 403s because it is locked to the resolver's IP; the Worker fetches
    // it with proper headers and streams it back, which is what makes native
    // background play + the OS media notification actually work. The proxy URL
    // is stable and cacheable, so re-taps reuse it instantly.
    const proxied = `/api/stream?url=${encodeURIComponent(stream.url)}`;
    return json(200, {
      url: proxied,
      format: stream.format || "",
      mimeType: stream.mimeType || "",
      quality: stream.quality || "",
      duration: stream.duration || 0,
    });
  } catch (e) {
    // Always 200 with empty so the client falls back to the iframe player.
    return json(200, { url: "", error: String((e && e.message) || e) });
  }
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
            nm = self.artistName || "";
            for (const al of rows) {
              if (al.wrapperType !== "collection" && al.collectionType !== "Album") continue;
              if (!art && al.artworkUrl100) art = String(al.artworkUrl100).replace("100x100bb", "600x600bb");
              alb.push({
                id: `album:${al.collectionId}`,
                kind: "playlist",
                title: al.collectionName || "Album",
                artist: al.artistName || nm,
                artwork: String(al.artworkUrl100 || "").replace("100x100bb", "600x600bb") || "/cover-default.png",
                source: "apple",
                query: `${al.collectionName || ""} ${al.artistName || nm}`.trim(),
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
                artist: t.artistName || nm,
                album: t.collectionName || "",
                duration: Math.round((t.trackTimeMillis || 0) / 1000),
                artwork: String(t.artworkUrl100 || "").replace("100x100bb", "600x600bb") || "/cover-default.png",
                playQuery: `${t.trackName || ""} ${t.artistName || nm} official audio`.trim(),
              });
            }
          } catch {}
        }
        if (!songs.length && (q || name)) {
          try {
            const pack = await itunesSearch(q || name);
            if (!art && pack.artists[0]) art = pack.artists[0].artwork;
            if (!nm && pack.artists[0]) nm = pack.artists[0].name;
            songs = pack.songs || [];
            if (!alb.length) alb = pack.playlists || [];
          } catch {}
        }
        return { art, alb, songs, nm };
      })();
      // YouTube fast search — hard-capped at 9s: Piped is often slow, and
      // Apple + Deezer still give a full profile without it.
      const ytJob = (async () => {
        try {
          const rows = await raceTimeout(searchYouTube(`${q || name} official audio`, gl, true), 9000, []);
          return Array.isArray(rows) ? rows.slice(0, 16) : [];
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
      if (ap.nm && ap.nm.toLowerCase() !== (artistName || "").toLowerCase()) artistName = ap.nm;
      albums = ap.alb;
      const normKey = (t) => `${String(t.title || "").toLowerCase()}|${String(t.artist || "").toLowerCase()}`;
      const haveYt = new Set(ytRows.map((t) => normKey(t)));
      const appleRest = ap.songs.filter((t) => !haveYt.has(normKey(t)));
      let songs = [...ytRows, ...appleRest];
      if (dz) {
        if (!artwork && dz.artist.artwork) artwork = dz.artist.artwork;
        if (dz.artist.name) artistName = dz.artist.name; // Deezer canonical name
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
          const k = String(row.videoId || row.id || "");
          if (!k || seen.has(k)) continue;
          seen.add(k);
          out.push(row);
          if (out.length >= 40) break;
        }
        if (out.length >= 40) break;
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
  if (a && !/^(youtube|various artists|unknown)$/i.test(a)) {
    qs.push(`${a} official audio`);
    qs.push(`${a} mix`);
  }
  if (t && a) qs.push(`${t} ${a} official audio`);
  else if (t) qs.push(`${t} official audio`);
  const queries = [...new Set(qs.filter(Boolean))].slice(0, 1);
  if (!queries.length) return json(200, { tracks: [] });
  const cacheKey = `related:${gl}:${queries.join("|")}`;
  try {
    const tracks = await cached(cacheKey, 180000, async () => {
      const settled = await Promise.allSettled(queries.map((q) => searchYouTube(q, gl, true)));
      const seen = new Set();
      const out = [];
      for (const s of settled) {
        const rows = s.status === "fulfilled" ? s.value : [];
        for (const row of rows || []) {
          if (!row || row.source === "radio") continue;
          const k = String(row.videoId || row.id || "");
          if (!k || seen.has(k) || seen.has(row.id)) continue;
          seen.add(k);
          if (row.id) seen.add(row.id);
          out.push(row);
          if (out.length >= 28) break;
        }
        if (out.length >= 28) break;
      }
      return out;
    });
    const skipSet = new Set(String(skip).split(",").map((x) => x.trim()).filter(Boolean));
    return json(200, {
      tracks: (tracks || []).filter((row) => row && !skipSet.has(row.id) && !skipSet.has(row.videoId)).slice(0, 24),
    });
  } catch (e) {
    return json(200, { tracks: [], error: String(e.message || e) });
  }
}

export async function handleLyrics(url) {
  const title = url.searchParams.get("title") || "";
  const artist = url.searchParams.get("artist") || "";
  const data = await lyricsFor(title, artist);
  return json(200, data);
}

