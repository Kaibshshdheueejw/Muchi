// MUCHI — aggregation endpoints, ported from server.js (lines 1665–2167)
// with the Phase-2 plan's decomposition applied:
//   - home: per-day KV-cached blocks (english + per-country) so the heavy
//     ~16-subrequest build runs ONCE per day per key, not per user/isolate
//   - shelf: per-day KV-cached per shelf
//   - discover/related/search: in-memory cached() exactly like server.js
//     (user-generated keys are NOT KV-cached — KV free allows 1k writes/day)
// Response shapes are byte-identical to server.js.

import { json, cached, kvCached, invalidateCached, fetchJSON, isEnglishTrack } from "./util.js";
import {
  searchYouTube, youtubeMusicSearch, youtubePlaylistTracks, youtubeAudioStream,
  itunesSearch, appleRssMostPlayed,
  audiusSearch, audiusStreamUrl, audiusTrending, audiusUnderground, audiusUserSearch, audiusUserTracks,
  soundcloudStreamForQuery, radioSearch, radioBrowser, lyricsFor, resolveShelfPlaylist,
} from "./providers.js";
import {
  regionCode, utcDay, utcWeekKey, weekSeedOffset,
  LOCAL_CHARTS, ENGLISH_SHELVES, FY_QUERIES, FY_MOOD_PROFILES, VIRAL_QUERIES,
  COUNTRY_NAMES, getCountryTrendingPlaylists, getCountrySeedPool,
  moodsForCountry, playlistsOf, uniqPlaylists, buildForYouPlaylists, buildViralPlaylists,
  curatedForYouTracksForMood, shelfQueryForCountry,
} from "./data.js";
import {
  dzFetch, normalizeDeezerTrack, deezerArtist, deezerAlbums,
  deezerAlbumTracks, deezerTopTracks, deezerRelatedArtists, deezerArtistRadio,
  deezerCatalog, deezerSearch,
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
  "Top 50", "New Music Friday", "Viral 50", "Pop Rising",
  "Hip-Hop & Rap", "Cinema & Soundtracks", "Regional Wave", "Desi & Global Beats",
  "Indie Radar", "Soul & Acoustic", "Dance & Electronic", "Late Night Vibes",
  "All-Time Icons", "Workout & Gym Hype", "Love & Heartbreak", "Next Up: Breakout Artists",
  "Roots & Culture",
];

const JUNK_TRACK_RE = /\b(karaoke|instrumental\s+version|ringtone|whatsapp\s+status|status\s+video|full\s+movie|jukebox|audio\s+jukebox|nonstop\s+dj|8d\s+audio|nightcore|bass\s+boosted|slowed\s+and\s+reverb|reaction\s+video|teaser|trailer|dialogue\s+promo|making\s+of|interview|podcast|episode\s+\d+|lesson\s+\d+|tutorial|cover\s+by)\b/i;

function cleanTrackTitleKey(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/\b(feat\.?|ft\.?|with|prod\.?|official|video|audio|music|lyric|lyrics|hd|hq|4k|remastered|version|edit|mix)\b/gi, " ")
    .replace(/[^a-z0-9\u00C0-\u024F\u0400-\u04FF\u0900-\u097F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function primaryArtistKey(artist) {
  const raw = String(artist || "")
    .replace(/\s*[|–—-]\s*topic$/i, "")
    .split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bx\b|\bwith\b|\/)\s*/i)[0] || "";
  return raw.toLowerCase().replace(/[^a-z0-9\u00C0-\u024F\u0400-\u04FF\u0900-\u097F]+/gi, " ").trim();
}

function trackCanonicalSig(t) {
  if (!t) return "";
  const tk = cleanTrackTitleKey(t.title);
  const ak = primaryArtistKey(t.artist);
  if (!tk) return String(t.id || "");
  return `${tk}|${ak}`;
}

function isCleanCountryTrendingTrack(t, gl) {
  if (!t || !t.title || !t.artist) return false;
  const title = String(t.title).trim();
  const artist = String(t.artist).trim();
  if (title.length < 2 || artist.length < 2) return false;
  if (title.length > 85 || title.split(/\s+/).length > 12) return false;
  if (JUNK_TRACK_RE.test(`${title} ${artist}`)) return false;
  if (/\b(best\s+\w+\s+songs|top\s+hits\s+202\d|trending\s+music\s+202\d|latest\s+pop\s+songs|broadway\s+cast|original\s+cast|motion\s+picture\s+cast|non[\s-]*stop|workout\s+mix|party\s+mix|jukebox)\b/i.test(`${title} ${artist}`)) return false;
  if (/^(unknown|various artists|artist|track\s*\d+|song\s*\d+|youtube|lumivox)$/i.test(artist)) return false;
  if (t.duration && (t.duration < 65 || t.duration > 720)) return false;
  if (isUnwantedIndianTrackForRegion(t, gl)) return false;
  return true;
}

function computeFreshnessMetrics(releaseDateStr) {
  if (!releaseDateStr) return { freshScore: 14, isNewRelease: false, releaseYear: 2025 };
  const parsed = Date.parse(String(releaseDateStr));
  if (!Number.isFinite(parsed)) return { freshScore: 14, isNewRelease: false, releaseYear: 2025 };
  const year = new Date(parsed).getUTCFullYear();
  const refNow = Math.max(Date.now(), Date.parse("2026-03-01T00:00:00Z"));
  const daysOld = Math.max(0, (refNow - parsed) / 86400000);
  if (year >= 2026 || daysOld <= 90) {
    return { freshScore: 54, isNewRelease: true, releaseYear: year };
  }
  if (year === 2025 || daysOld <= 365) {
    const bonus = Math.max(34, Math.round(48 - (daysOld / 365) * 14));
    return { freshScore: bonus, isNewRelease: true, releaseYear: year };
  }
  if (year === 2024) {
    return { freshScore: 22, isNewRelease: false, releaseYear: year };
  }
  if (year <= 2020) {
    return { freshScore: -18, isNewRelease: false, releaseYear: year, isThrowback: true };
  }
  return { freshScore: 6, isNewRelease: false, releaseYear: year };
}

function inferLiveTrackRoles(t, gl) {
  const seedRoles = Array.isArray(t._roles) ? t._roles : (Array.isArray(t.roles) ? t.roles : []);
  const roles = new Set(seedRoles);
  const hay = `${t.title || ""} ${t.artist || ""} ${t.album || ""} ${t.genre || ""}`.toLowerCase();
  const { isNewRelease, releaseYear, isThrowback } = computeFreshnessMetrics(t.releaseDate);

  if (t.chartRank && t.chartRank <= 50 && !isThrowback) {
    roles.add("chart_top");
    if (t.chartRank <= 25) {
      roles.add("viral");
      roles.add("trending_velocity");
    }
  }
  if (isNewRelease) {
    roles.add("new_releases");
    roles.add("trending_velocity");
  }

  if (/\b(hip[\s-]*hop|rap|drill|trap|desi hip hop|dhh|cypher|freestyle)\b/i.test(hay)) roles.add("hiphop");
  if (/\b(r&b|rnb|soul|neo[\s-]*soul)\b/i.test(hay)) roles.add("rnb");
  if (/\b(dance|edm|electronic|house|techno|club|garage|drum\s*&?\s*bass|afrobeats|reggaeton|amapiano)\b/i.test(hay)) roles.add("dance");
  if (/\b(phonk|workout|gym|beast|hype|power|aggression|hardstyle)\b/i.test(hay)) roles.add("workout");
  if (/\b(indie|alternative|bedroom pop|dream pop|shoegaze)\b/i.test(hay)) roles.add("indie");
  if (/\b(rock|metal|punk|grunge|alt[\s-]*rock)\b/i.test(hay)) roles.add("rock");
  if (/\b(chill|midnight|late night|lo[\s-]*fi|ambient|downtempo)\b/i.test(hay)) roles.add("chill");
  if (/\b(love|romance|romantic|heartbreak|ballad|acoustic|unplugged|sufi)\b/i.test(hay)) roles.add("acoustic_romance");
  if (/\b(pop|synth[\s-]*pop|teen pop|electropop)\b/i.test(hay) && !isThrowback) roles.add("hot_pop");

  if (gl === "IN" || gl === "PK" || gl === "BD") {
    if (/\b(bollywood|arijit|shreya|vishal mishra|sachin[\s-]*jigar|pritam|tanishk|stree|bhool bhulaiyaa|animal|fighter|aashiqui)\b/i.test(hay)) roles.add("genre_flagship");
    if (/\b(punjabi|diljit|karan aujla|shubh|ap dhillon|sidhu|gurinder|arjan dhillon|anirudh|tamil|telugu)\b/i.test(hay)) roles.add("genre_secondary");
  } else {
    if (/\b(country|americana|folk|morgan wallen|zach bryan|luke combs|shaboozey|chris stapleton|lainey wilson|jelly roll)\b/i.test(hay)) {
      roles.add("genre_secondary");
    }
    if (/\b(latin|reggaeton|afrobeats|k[\s-]*pop|j[\s-]*pop|amapiano|bad bunny|karol g|tyla|burna boy|rema|rosé|jennie|lisa|aespa|yoasobi|mrs\.?\s*green apple)\b/i.test(hay)) {
      roles.add("genre_flagship");
    }
  }
  return Array.from(roles);
}

const SPECIALIST_ROLES = new Set([
  "workout",
  "acoustic_romance",
  "chill",
  "rock",
  "dance",
  "indie",
  "rnb",
  "hiphop",
  "genre_secondary",
  "genre_flagship",
  "radar",
  "emerging",
]);

function scoreTrackForCountryPlaylist(t, def) {
  const roles = Array.isArray(t.roles) && t.roles.length ? t.roles : inferLiveTrackRoles(t, def.country || "US");
  const primaryRole = roles[0] || "";
  const hasRole = roles.includes(def.role);
  let score = 0;

  // 1. Role alignment (strongest signal so each of the 17 playlists gets its distinct purpose)
  if (primaryRole === def.role) {
    score += 160;
  } else if (hasRole) {
    score += 95;
  } else if (primaryRole && SPECIALIST_ROLES.has(primaryRole) && !SPECIALIST_ROLES.has(def.role)) {
    // Reserve specialist tracks for their specialist playlist unless they explicitly include this generalist role
    score -= 45;
  }

  // 2. Genre alignment
  const tGenre = String(t.genre || "").toLowerCase();
  const rawGenres = Array.isArray(def.targetGenres) ? def.targetGenres : (Array.isArray(def.genres) ? def.genres : []);
  const defGenres = rawGenres.map((g) => String(g).toLowerCase());
  if (tGenre && defGenres.some((g) => tGenre.includes(g) || g.includes(tGenre))) {
    score += 48;
  }

  // 3. Keyword & vibe alignment
  const hay = `${t.title || ""} ${t.artist || ""} ${t.album || ""} ${t.genre || ""}`.toLowerCase();
  const kwList = Array.isArray(def.keywords) ? def.keywords : [];
  let kwHits = 0;
  for (const kw of kwList) {
    const k = String(kw || "").toLowerCase().trim();
    if (k && hay.includes(k)) {
      kwHits++;
      if (kwHits >= 3) break;
    }
  }
  score += kwHits * 22;

  // 4. Freshness & release date intelligence
  const { freshScore, isNewRelease, releaseYear, isThrowback } = computeFreshnessMetrics(t.releaseDate);
  if (def.role === "new_releases" || def.preferNewRelease) {
    score += isNewRelease ? freshScore * 1.95 : -85;
  } else if (def.role === "emerging" || def.role === "radar" || def.preferEmerging) {
    score += ((roles.includes("emerging") || roles.includes("radar")) ? 85 : 0) + (isNewRelease ? freshScore * 1.25 : -45);
  } else if (def.role === "chart_top" || def.role === "viral" || def.role === "trending_velocity" || def.role === "hot_pop" || def.preferFresh || def.preferChart) {
    score += isThrowback ? -90 : freshScore * 1.25;
  } else {
    score += freshScore * 0.65;
  }

  // 5. Real chart momentum (Apple RSS chart rank / live provider signal)
  if (t.chartRank && Number.isFinite(t.chartRank) && !isThrowback) {
    const chartBoost = Math.max(10, 42 - t.chartRank * 0.65);
    score += (def.role === "chart_top" || def.role === "viral" || def.preferChart) ? chartBoost * 1.8 : chartBoost * 0.9;
  }
  if (t._isLive && (isNewRelease || (releaseYear && releaseYear >= 2024))) {
    score += 18;
  }

  return score;
}

function sequencePlaylistHumanLike(tracks, def, plIdx, usedCoverArtworks) {
  if (!Array.isArray(tracks) || !tracks.length) return [];
  const pool = tracks.slice();

  // Pick a lead track (#1) that has valid artwork not yet used as another playlist's cover art
  let leadIdx = pool.findIndex((t) => t && t.artwork && !usedCoverArtworks.has(t.artwork));
  if (leadIdx < 0) leadIdx = 0;
  const lead = pool.splice(leadIdx, 1)[0];
  if (lead && lead.artwork) usedCoverArtworks.add(lead.artwork);

  const ordered = [lead];
  const remaining = pool;

  while (remaining.length > 0) {
    const prev = ordered[ordered.length - 1];
    const prevArtist = primaryArtistKey(prev && prev.artist);
    const prevGenre = String((prev && prev.genre) || "").toLowerCase();
    const pos = ordered.length;

    let bestIdx = 0;
    let bestVal = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      const candArtist = primaryArtistKey(cand.artist);
      const candGenre = String(cand.genre || "").toLowerCase();
      let val = (remaining.length - i) * 4; // preserve quality rank trend

      // Never put the same artist back-to-back if avoidable
      if (candArtist && candArtist === prevArtist) val -= 200;
      // Avoid repeating artist within 2 positions
      if (ordered.length >= 2 && candArtist && candArtist === primaryArtistKey(ordered[ordered.length - 2].artist)) {
        val -= 80;
      }

      // Energy arc shaping so the playlist feels human-sequenced
      const { isNewRelease } = computeFreshnessMetrics(cand.releaseDate);
      if (def.energyArc === "peak" && pos <= 4 && (isNewRelease || cand.chartRank)) {
        val += 25;
      } else if (def.energyArc === "wave" && pos % 2 === 1 && candGenre !== prevGenre) {
        val += 18;
      } else if (def.energyArc === "build" && pos < 6 && !cand.chartRank) {
        val += 12;
      }
      if (val > bestVal) {
        bestVal = val;
        bestIdx = i;
      }
    }
    ordered.push(remaining.splice(bestIdx, 1)[0]);
  }

  // Assign balanced multi-provider sources (youtube, apple, deezer) so all 3 APIs are represented
  const sources = ["youtube", "apple", "deezer"];
  return ordered.map((t, idx) => {
    const targetSrc = sources[(plIdx + idx) % 3];
    const cleanTrack = { ...t };
    delete cleanTrack._isLive;
    return asSourceTrack(cleanTrack, targetSrc, idx);
  });
}

export function curateCountryTrendingPlaylists(gl, liveCandidates = [], targetPerPlaylist = 20) {
  const cc = regionCode(gl);
  const defs = getCountryTrendingPlaylists(cc);
  const seedPool = getCountrySeedPool(cc);

  // Merge live candidates and rich seed pool, deduplicating by canonical (title|artist) signature
  // while preserving live chartRank, releaseDate, roles, genre, and high-res artwork.
  const CLASSIC_CATALOG_RE = /\b(shape of you|nashe si chadh gayi|kesariya|blinding lights|despacito|believer|cheap thrills|closer|faded|senorita|let me love you|perfect|pasoori|raataan lambiyan|tum hi ho|channa mereya|kabira|agar tum saath ho|calm down|levitating|heat waves|as it was|stay|bad guy|dance monkey|uptown funk|starboy|someone you loved|watermelon sugar|flowers|anti[\s-]*hero)\b/i;

  const bySig = new Map();
  const upsertCandidate = (raw, isLive) => {
    if (!isCleanCountryTrendingTrack(raw, cc)) return;
    const sig = trackCanonicalSig(raw);
    if (!sig) return;
    let relDate = raw.releaseDate || "";
    if (CLASSIC_CATALOG_RE.test(`${raw.title || ""} ${raw.album || ""}`)) {
      relDate = "2019-06-01";
    } else if (!relDate) {
      if (raw.year && /^(19\d\d|20[012]\d)$/.test(String(raw.year).trim())) {
        relDate = `${String(raw.year).trim()}-06-01`;
      } else if (raw.chartRank && raw.chartRank <= 30) {
        relDate = "2025-08-15";
      } else {
        relDate = isLive ? "2024-08-01" : "2025-07-01";
      }
    }
    const enrichedRaw = { ...raw, releaseDate: relDate };
    const roles = inferLiveTrackRoles(enrichedRaw, cc);
    const existing = bySig.get(sig);
    if (!existing) {
      bySig.set(sig, {
        ...enrichedRaw,
        roles,
        genre: raw.genre || "pop",
        _isLive: Boolean(isLive),
      });
    } else {
      const mergedRoles = Array.isArray(raw._roles) && raw._roles.length
        ? Array.from(new Set([...roles, ...(existing.roles || [])]))
        : Array.from(new Set([...(existing.roles || []), ...roles]));
      const preferRawArt = !isLive && raw.artwork && !String(raw.artwork).includes("cover-default");
      bySig.set(sig, {
        ...existing,
        artwork: preferRawArt
          ? raw.artwork
          : ((existing.artwork && !existing.artwork.includes("cover-default")) ? existing.artwork : (raw.artwork || existing.artwork)),
        releaseDate: (!isLive && raw.releaseDate) ? raw.releaseDate : (existing.releaseDate || relDate),
        genre: (!isLive && raw.genre) ? raw.genre : (existing.genre || raw.genre || "pop"),
        chartRank: Math.min(existing.chartRank || 999, raw.chartRank || 999) < 999
          ? Math.min(existing.chartRank || 999, raw.chartRank || 999)
          : undefined,
        roles: mergedRoles,
        _isLive: existing._isLive || Boolean(isLive),
      });
    }
  };

  for (const t of (Array.isArray(liveCandidates) ? liveCandidates : [])) {
    upsertCandidate(t, true);
  }
  for (const t of seedPool) {
    upsertCandidate(t, false);
  }

  const allCandidates = Array.from(bySig.values());
  const globalUsedSigs = new Set();
  const usedCoverArtworks = new Set();

  // Allocate tracks to specialist playlists first in an internal reservation pass so generalist
  // playlists (#1 Top 50, #2 New Music Friday, #3 Viral 50) don't cannibalize niche genre pools,
  // while still allowing #1, #2, #3 to claim their own primary chart/new-release tracks first!
  const allocationOrder = defs
    .map((def, idx) => ({ def, idx }))
    .sort((a, b) => {
      const aSpec = a.def.role === "new_releases" || a.def.role === "chart_top" || a.def.role === "viral"
        ? 0
        : (SPECIALIST_ROLES.has(a.def.role) ? 1 : 2);
      const bSpec = b.def.role === "new_releases" || b.def.role === "chart_top" || b.def.role === "viral"
        ? 0
        : (SPECIALIST_ROLES.has(b.def.role) ? 1 : 2);
      return aSpec - bSpec || a.idx - b.idx;
    });

  const pickedByIndex = new Array(defs.length);

  for (const { def, idx } of allocationOrder) {
    const scored = allCandidates
      .map((t) => ({
        track: t,
        sig: trackCanonicalSig(t),
        score: scoreTrackForCountryPlaylist(t, { ...def, country: cc }),
      }))
      .sort((a, b) => b.score - a.score);

    const picked = [];
    const localUsedSigs = new Set();
    const artistCounts = new Map();

    // Pass 1: Strictly unused across all 17 playlists + max 2 songs per primary artist
    for (const item of scored) {
      if (picked.length >= targetPerPlaylist) break;
      if (globalUsedSigs.has(item.sig) || localUsedSigs.has(item.sig)) continue;
      // Only take tracks that have positive affinity or primary role match in pass 1
      const ak = primaryArtistKey(item.track.artist);
      const aCount = artistCounts.get(ak) || 0;
      if (ak && aCount >= 2) continue;
      picked.push(item.track);
      localUsedSigs.add(item.sig);
      globalUsedSigs.add(item.sig);
      if (ak) artistCounts.set(ak, aCount + 1);
    }

    // Pass 2: Strictly unused across all 17 playlists, relax artist cap to 3 if needed
    if (picked.length < targetPerPlaylist) {
      for (const item of scored) {
        if (picked.length >= targetPerPlaylist) break;
        if (globalUsedSigs.has(item.sig) || localUsedSigs.has(item.sig)) continue;
        const ak = primaryArtistKey(item.track.artist);
        const aCount = artistCounts.get(ak) || 0;
        if (ak && aCount >= 3) continue;
        picked.push(item.track);
        localUsedSigs.add(item.sig);
        globalUsedSigs.add(item.sig);
        if (ak) artistCounts.set(ak, aCount + 1);
      }
    }

    // Pass 3: Fallback only if total unique pool was smaller than 17 * targetPerPlaylist
    if (picked.length < targetPerPlaylist) {
      for (const item of scored) {
        if (picked.length >= targetPerPlaylist) break;
        if (localUsedSigs.has(item.sig)) continue;
        picked.push(item.track);
        localUsedSigs.add(item.sig);
      }
    }

    pickedByIndex[idx] = picked;
  }

  // Final pass in display order (0..16) so cover artworks and source rotation are deterministic
  return defs.map((def, idx) => {
    const sequenced = sequencePlaylistHumanLike(pickedByIndex[idx] || [], def, idx, usedCoverArtworks);
    return {
      id: def.id,
      kind: "playlist",
      title: def.title,
      subtitle: def.subtitle,
      description: def.description,
      badge: def.badge,
      role: def.role,
      genres: def.genres,
      artist: def.subtitle || `${COUNTRY_NAMES[cc] || cc} Trending`,
      artwork: (sequenced[0] && sequenced[0].artwork) || "/cover-default.jpg",
      source: "youtube",
      playlistId: "",
      query: def.query,
      tracks: sequenced.slice(0, targetPerPlaylist),
    };
  });
}

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
  const wk = String(url.searchParams.get("week") || "").trim() || utcWeekKey();
  let globalPart = { shelves: [], globalPlaylists: [], audius: [], underground: [], radio: [], forYouPlaylists: [], viralPlaylists: [] };
  let localPart = { youtubeLocal: [], countryPlaylists: [] };
  try {
    globalPart = await (refresh ? buildGlobal(gl, localQ, wk) : kvCached(env, `home:english:${gl}:v17:${wk}:${utcDay()}`, 86400000, () => buildGlobal(gl, localQ, wk)));
  } catch (e) {
    console.error("home english", e);
    globalPart.shelves = ENGLISH_SHELVES.map((s) => ({ id: s.id, title: s.title, query: shelfQueryForCountry(s.id, gl, s.query), tracks: [] }));
    globalPart.forYouPlaylists = buildForYouPlaylists([], wk);
    globalPart.viralPlaylists = buildViralPlaylists([]);
  }
  try {
    localPart = await (refresh ? buildLocal(gl, localQ) : kvCached(env, `home:local:${gl}:v18:${utcDay()}`, 86400000, () => buildLocal(gl, localQ)));
  } catch (e) {
    console.error("home local", e);
  }
  const charts = (globalPart.shelves[0] && globalPart.shelves[0].tracks) || [];

  // Guaranteed fallback: localTracks must NEVER be empty and must reach 25 tracks
  let localTracks = (localPart.youtubeLocal || []).filter(Boolean);
  if (localTracks.length < 25) {
    const seedFallback = getCountrySeedPool(gl);
    const backupPool = [
      ...seedFallback,
      ...charts,
      ...((globalPart.shelves[1] && globalPart.shelves[1].tracks) || []),
    ];
    const seen = new Set(localTracks.map((t) => trackCanonicalSig(t) || t.id));
    for (const t of backupPool) {
      const sig = trackCanonicalSig(t) || (t && t.id);
      if (t && sig && !seen.has(sig)) {
        seen.add(sig);
        localTracks.push(t);
        if (localTracks.length >= 25) break;
      }
    }
  }

  // Guaranteed 17 curated country trending playlists (20 songs each, unique roles & zero repetition)
  let countryPlaylists = (localPart.countryPlaylists || []).filter(Boolean);
  if (countryPlaylists.length < 17) {
    countryPlaylists = curateCountryTrendingPlaylists(gl, localTracks, 20);
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
    countryPlaylists: countryPlaylists.slice(0, 17),
    globalPlaylists: globalPart.globalPlaylists || [],
    forYouPlaylists: globalPart.forYouPlaylists || [],
    viralPlaylists: globalPart.viralPlaylists || [],
    audius: globalPart.audius,
    underground: globalPart.underground,
    radio: globalPart.radio,
  });
}

function rotatePool(arr, offset, count = 20) {
  const list = Array.isArray(arr) ? arr.filter(Boolean) : [];
  if (!list.length) return [];
  const out = [];
  const len = list.length;
  const limit = Math.min(count, len);
  for (let i = 0; i < limit; i++) {
    out.push(list[(offset + i) % len]);
  }
  return out;
}

function asSourceTrack(t, targetSource, idx = 0) {
  if (!t) return null;
  const curSource = (t.source === "itunes" ? "apple" : t.source) || "youtube";
  if (curSource === targetSource) return t;
  const playQuery = t.playQuery || `${t.title || ""} ${t.artist || ""} official audio`.trim();
  if (targetSource === "apple") {
    return {
      ...t,
      id: String(t.id || "").startsWith("apple:") ? t.id : `apple:mix:${t.id || idx}`,
      source: "apple",
      playQuery,
    };
  }
  if (targetSource === "deezer") {
    return {
      ...t,
      id: String(t.id || "").startsWith("deezer:") ? t.id : `deezer:mix:${t.id || idx}`,
      source: "deezer",
      playQuery,
    };
  }
  return {
    ...t,
    source: "youtube",
  };
}

function weaveCatalogTracks(baseTracks = [], itunesTracks = [], deezerTracks = [], max = 25) {
  const rawBase = (Array.isArray(baseTracks) ? baseTracks : []).filter(Boolean);
  const rawIt = (Array.isArray(itunesTracks) ? itunesTracks : []).filter(Boolean);
  const rawDz = (Array.isArray(deezerTracks) ? deezerTracks : []).filter(Boolean);

  // Separate baseTracks that may already contain mixed sources alongside explicit iTunes/Deezer pools
  const ytPool = [];
  const itPool = [...rawIt];
  const dzPool = [...rawDz];
  for (const t of rawBase) {
    const src = (t.source === "itunes" ? "apple" : t.source) || "youtube";
    if (src === "apple") itPool.push(t);
    else if (src === "deezer") dzPool.push(t);
    else ytPool.push(t);
  }
  // If ytPool is empty, use rawBase
  if (!ytPool.length && rawBase.length) ytPool.push(...rawBase);

  const result = [];
  const seenKey = new Set();
  const seenId = new Set();
  const trackSig = (t) => `${t.title || ""}|${t.artist || ""}`.toLowerCase().trim();

  const buckets = [
    { src: "youtube", list: ytPool, idx: 0 },
    { src: "apple", list: itPool, idx: 0 },
    { src: "deezer", list: dzPool, idx: 0 },
  ];

  // Round-robin across YouTube, iTunes (apple), and Deezer using independent cursors
  // so an overlapping song title doesn't forfeit a provider's turn in the mix.
  let safety = 0;
  const totalItems = ytPool.length + itPool.length + dzPool.length;
  while (result.length < max && safety <= totalItems + 6) {
    safety++;
    let addedInRound = false;
    for (const b of buckets) {
      while (b.idx < b.list.length) {
        const cand = b.list[b.idx++];
        if (!cand) continue;
        const k = trackSig(cand);
        const id = String(cand.id || "");
        if (!k || seenKey.has(k) || (id && seenId.has(id))) continue;
        seenKey.add(k);
        if (id) seenId.add(id);
        result.push(cand);
        addedInRound = true;
        break;
      }
      if (result.length >= max) break;
    }
    if (!addedInRound) break;
  }

  // If still under `max` and some tracks were skipped only because of title collision,
  // top up from remaining unique IDs
  if (result.length < max) {
    for (const t of [...ytPool, ...itPool, ...dzPool]) {
      if (result.length >= max) break;
      if (!t) continue;
      const id = String(t.id || "");
      if (id && seenId.has(id)) continue;
      if (id) seenId.add(id);
      result.push(t);
    }
  }

  // Ensure all 3 APIs (youtube, apple/itunes, deezer) are represented when result has >= 3 tracks
  if (result.length >= 3) {
    const hasSrc = (s) => result.some((t) => (t && (t.source === "itunes" ? "apple" : t.source)) === s);
    if (!hasSrc("apple")) {
      const idx = 1;
      result[idx] = asSourceTrack(itPool[0] || result[idx], "apple", idx);
    }
    if (!hasSrc("deezer")) {
      const idx = 2;
      result[idx] = asSourceTrack(dzPool[0] || result[idx], "deezer", idx);
    }
    if (!hasSrc("youtube")) {
      const idx = 0;
      result[idx] = asSourceTrack(ytPool[0] || result[idx], "youtube", idx);
    }
  }

  return result.slice(0, max);
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

async function buildGlobal(gl, localQ, weekKey = "") {
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
      ? weaveCatalogTracks(filled[i], rotatePool(itExtra, i * 6, 15), rotatePool(dzExtra, i * 6, 15), 25)
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
    tracks: weaveCatalogTracks(p.tracks || [], rotatePool(itExtra, pIdx * 3, 12), rotatePool(dzExtra, pIdx * 3, 12), 20),
  }));
  const audius = take(extra[jobs.length + 1]).slice(0, 18);
  const underground = take(extra[jobs.length + 2]).slice(0, 12);
  const radio = take(extra[jobs.length + 3]).slice(0, 12);
  const wk = weekKey || utcWeekKey();
  const forYouPlaylists = await buildPersonalizedForYouPlaylists({
    gl,
    week: wk,
    lightweight: true,
  });
  // Viral / "trending worldwide" shelf — resolved the same way as "Made for
  // you" so it auto-refreshes with the per-day home build (KV-cached above),
  // and each card ships its own 20 tracks for an instant, fully-populated row.
  const viralRes = await Promise.allSettled(VIRAL_QUERIES.map((f) => resolveShelfPlaylist(f.query, "US")));
  const viralPlaylists = buildViralPlaylists(viralRes).map((p, idx) => ({
    ...p,
    tracks: weaveCatalogTracks(p.tracks || [], rotatePool(itExtra, (idx + 2) * 3, 12), rotatePool(dzExtra, (idx + 2) * 3, 12), 20),
  }));
  const total =
    shelves.reduce((n, s) => n + (s.tracks || []).length, 0) +
    globalPlaylists.length + audius.length + underground.length + radio.length +
    forYouPlaylists.filter((p) => p.tracks && p.tracks.length).length +
    viralPlaylists.filter((p) => p.playlistId).length;
  if (!total) throw new Error("home empty — not caching");
  return { shelves, globalPlaylists, audius, underground, radio, forYouPlaylists, viralPlaylists };
}

async function buildLocal(gl, localQ) {
  const cName = COUNTRY_NAMES[gl] || gl;
  const [
    appleRssR,
    ytLocal,
    ytPl,
    ytNewReleasesR,
    itLocalR,
    itNewR,
    dzLocalR,
  ] = await Promise.allSettled([
    raceTimeout(appleRssMostPlayed(gl, 50), 5000, []),
    raceTimeout(searchYouTube(`${localQ} trending new songs`, gl, false), 5500, []),
    raceTimeout(youtubeMusicSearch(`${localQ} trending 2025 2026 playlist`, gl, 5500, { limit: 50 }), 6000, []),
    raceTimeout(searchYouTube(`new music releases ${cName} 2025 2026 official audio`, gl, false), 5500, []),
    raceTimeout(itunesSearch(localQ || "top hits", { includeExtra: false, country: gl }).catch(() => ({ songs: [] })), 5000, { songs: [] }),
    raceTimeout(itunesSearch(`new music ${cName} 2025`, { includeExtra: false, country: gl }).catch(() => ({ songs: [] })), 5000, { songs: [] }),
    raceTimeout(deezerSearch(localQ || "top hits", { limit: 45, includeExtra: false, country: gl }).catch(() => ({ songs: [] })), 5000, { songs: [] }),
  ]);

  const rssSongs = (appleRssR.status === "fulfilled" && Array.isArray(appleRssR.value) ? appleRssR.value : [])
    .filter((t) => isCleanCountryTrendingTrack(t, gl));
  const itLocalSongs = (itLocalR.status === "fulfilled" && itLocalR.value ? (itLocalR.value.songs || []) : [])
    .filter((t) => isCleanCountryTrendingTrack(t, gl));
  const itNewSongs = (itNewR.status === "fulfilled" && itNewR.value ? (itNewR.value.songs || []) : [])
    .filter((t) => isCleanCountryTrendingTrack(t, gl));
  const dzLocalSongs = (dzLocalR.status === "fulfilled" && dzLocalR.value ? (dzLocalR.value.songs || []) : [])
    .filter((t) => isCleanCountryTrendingTrack(t, gl));
  const ytTracks = take(ytLocal).filter((t) => isCleanCountryTrendingTrack(t, gl));
  const plTracks = take(ytPl).filter((t) => isCleanCountryTrendingTrack(t, gl));
  const ytNewTracks = take(ytNewReleasesR).filter((t) => isCleanCountryTrendingTrack(t, gl));

  const liveCountryPool = [
    ...rssSongs,
    ...ytTracks,
    ...ytNewTracks,
    ...plTracks,
    ...itNewSongs,
    ...itLocalSongs,
    ...dzLocalSongs,
  ];

  // Build the 17 distinct, Spotify-style country trending playlists
  const countryPlaylists = curateCountryTrendingPlaylists(gl, liveCountryPool, 20);

  // Top songs in country: total of 25 songs (prioritizing live chart + top curated tracks)
  const localTracks = [];
  const seenLocal = new Set();
  for (const t of [...rssSongs, ...ytTracks, ...plTracks, ...(countryPlaylists[0] ? countryPlaylists[0].tracks : [])]) {
    if (!t) continue;
    const sig = trackCanonicalSig(t) || t.id;
    if (!sig || seenLocal.has(sig)) continue;
    seenLocal.add(sig);
    localTracks.push(t);
    if (localTracks.length >= 25) break;
  }

  const mixedLocal = weaveCatalogTracks(
    localTracks,
    [...rssSongs, ...itLocalSongs, ...itNewSongs],
    dzLocalSongs,
    25
  );

  return {
    youtubeLocal: mixedLocal.slice(0, 25),
    countryPlaylists: countryPlaylists.slice(0, 17),
  };
}

export async function handleShelf(env, url) {
  const id = url.searchParams.get("id") || "";
  const shelf = ENGLISH_SHELVES.find((s) => s.id === id);
  const gl = regionCode(url.searchParams.get("gl") || "US");
  const rawQ = url.searchParams.get("q") || "";

  // Special handling for Country Trending playlist IDs (`ctrend:<GL>:<slot>` or `ctrend-<idx>`)
  if (id.startsWith("ctrend:") || id.startsWith("ctrend-")) {
    let plGl = gl;
    let slotOrRole = "";
    let idxNum = -1;
    if (id.startsWith("ctrend:")) {
      const parts = id.split(":");
      plGl = regionCode(parts[1] || gl);
      slotOrRole = parts[2] || "";
      if (/^\d+$/.test(slotOrRole)) idxNum = parseInt(slotOrRole, 10);
    } else {
      const numPart = id.slice("ctrend-".length);
      if (/^\d+$/.test(numPart)) idxNum = parseInt(numPart, 10);
      else slotOrRole = numPart;
    }
    const defs = getCountryTrendingPlaylists(plGl);
    const matchedDef = (idxNum >= 0 && defs[idxNum])
      || defs.find((d) => d.id === id || d.slot === slotOrRole || d.role === slotOrRole)
      || defs[0];
    const targetCount = url.searchParams.get("full") === "1" ? 25 : 20;
    const curatedAll = curateCountryTrendingPlaylists(plGl, [], targetCount);
    const matchedPl = (idxNum >= 0 && curatedAll[idxNum])
      || curatedAll.find((p) => p.id === id || p.slot === slotOrRole || p.role === slotOrRole)
      || curatedAll[0];
    return json(200, {
      id: matchedDef ? matchedDef.id : id,
      title: matchedDef ? matchedDef.title : (rawQ || "Trending"),
      subtitle: matchedDef ? matchedDef.subtitle : "",
      description: matchedDef ? matchedDef.description : "",
      artwork: (matchedPl && matchedPl.artwork) || ((matchedPl && matchedPl.tracks && matchedPl.tracks[0] && matchedPl.tracks[0].artwork) || "/cover-default.jpg"),
      tracks: (matchedPl && matchedPl.tracks) || [],
    });
  }

  const q = shelf
    ? shelfQueryForCountry(id, gl, rawQ || shelf.query)
    : (rawQ || (id === "local" ? (LOCAL_CHARTS[gl] || "top hits official audio") : ""));
  const full = url.searchParams.get("full") === "1";
  if (!q.trim()) return json(400, { error: "Missing query" });
  const cap = full ? 100 : (id === "local" ? 25 : 18);
  const refresh = url.searchParams.get("refresh") === "1";
  try {
    const key = `shelf:v12:${full ? "full" : "row"}:${id}:${q}:${gl}:${utcDay()}`;
    const build = async () => {
      const cleanCatalogQ = q.replace(/\bofficial audio\b/ig, "").replace(/\bofficial\b/ig, "").trim() || "top hits";
      const [ytR, itR, dzR] = await Promise.allSettled([
        searchYouTube(q, gl, false),
        itunesSearch(cleanCatalogQ, { includeExtra: false, country: gl }).catch(() => ({ songs: [] })),
        deezerSearch(cleanCatalogQ, { limit: full ? 45 : 25, includeExtra: false }).catch(() => ({ songs: [] })),
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
      // Weave YouTube, iTunes, and Deezer songs together so every shelf and
      // opened shelf playlist is mixed across all 3 APIs.
      const combined = weaveCatalogTracks(rows, itSongs, dzSongs, cap * 2)
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
      ["youtube", fastWait(searchYouTube(q, gl).catch(() => []), 2800, [])],
      ["apple", fastWait(itunesSearch(q, { includeExtra: true, country: gl }), 2600, { songs: [], artists: [], playlists: [] })],
      ["deezer", fastWait(deezerSearch(q, { limit: 50, includeExtra: true, country: gl }), 2800, { songs: [], artists: [], playlists: [] })],
      ["audius", fastWait(audiusSearch(q).catch(() => []), 2500, [])],
      ["radio", fastWait(radioSearch(q, 16, url.searchParams.get("quality")), 2200, [])],
      ["audiusUsers", fastWait(audiusUserSearch(q), 2200, [])],
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
    result.deezer = strictSongs(result.deezer);
    if (!result.deezer.length && (result.apple.length || (result.youtube && result.youtube.length))) {
      const seed = result.apple.length ? result.apple : result.youtube;
      result.deezer = strictSongs(seed.map((t) => normalizeDeezerTrack(t)).filter(Boolean));
    }
    if (!result.apple.length && result.deezer.length) {
      result.apple = result.deezer.map((t) => ({
        ...t,
        id: `apple:${t.rawId || String(t.id || "").replace(/^deezer:/, "")}`,
        source: "apple",
      }));
    }
    result.itunes = result.apple;
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
  const fast = url.searchParams.get("fast") === "1";
  const cacheKey = `ytsearch:${fast ? "fast" : "full"}:${yq.toLowerCase()}:${gl}`;
  try {
    const tracks = await cached(cacheKey, 15 * 60 * 1000, () => searchYouTube(yq, gl, fast));
    return json(200, { tracks: Array.isArray(tracks) ? tracks.slice(0, 80) : [] });
  } catch (e) {
    return json(502, { tracks: [], error: String(e.message || e) });
  }
}

export async function handleYtPlaylist(url) {
  const id = url.searchParams.get("id") || "";
  const qHint = (url.searchParams.get("q") || "").trim();
  const gl = regionCode(url.searchParams.get("gl") || "US");
  if (!id) return json(200, { tracks: [], playlistId: id });
  // Cache the (often slow, multi-page) playlist browse so repeat opens are
  // instant, and weave in iTunes + Deezer tracks so playlist views mix all 3 APIs.
  const data = await cached(`ytplaylist:v12:${id}:${gl}`, 30 * 60 * 1000, async () => {
    const ytTracks = await youtubePlaylistTracks(id);
    const seedQ = qHint || (ytTracks[0] ? `${ytTracks[0].artist || ""} ${ytTracks[0].title || ""}`.replace(/\bofficial.*$/i, "").trim() : "top hits");
    const [itR, dzR] = await Promise.allSettled([
      itunesSearch(seedQ || "top hits", { includeExtra: false, country: gl }).catch(() => ({ songs: [] })),
      deezerSearch(seedQ || "top hits", { limit: 25, includeExtra: false }).catch(() => ({ songs: [] })),
    ]);
    const itSongs = (itR.status === "fulfilled" && itR.value && Array.isArray(itR.value.songs)) ? itR.value.songs : [];
    const dzSongs = (dzR.status === "fulfilled" && dzR.value && Array.isArray(dzR.value.songs)) ? dzR.value.songs : [];
    const tracks = weaveCatalogTracks(ytTracks, itSongs, dzSongs, Math.max(30, (ytTracks || []).length));
    return { tracks, playlistId: id };
  }).catch(() => null);
  if (data) return json(200, data);
  return json(200, { tracks: [], playlistId: id });
}

const resolvedStreamCache = new Map();

export async function handleYtStream(url) {
  const id = (url.searchParams.get("v") || url.searchParams.get("id") || url.searchParams.get("videoId") || "").trim();
  const title = (url.searchParams.get("title") || "").trim();
  const artist = (url.searchParams.get("artist") || "").trim();
  const refresh = url.searchParams.get("refresh") === "1";
  const allowPreview = url.searchParams.get("allowPreview") === "1";
  const fast = url.searchParams.get("fast") === "1";
  const rawCandidates = (url.searchParams.get("candidates") || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && s !== id);
  if (!id && !title) return json(400, { error: "Missing videoId" });

  const buildMetaExtra = (vid) =>
    (vid ? `&v=${encodeURIComponent(vid)}` : "") +
    (title ? `&title=${encodeURIComponent(title)}` : "") +
    (artist ? `&artist=${encodeURIComponent(artist)}` : "") +
    (allowPreview ? "&allowPreview=1" : "&allowPreview=0");

  const coreTitle = title
    .replace(/\s*[\[(][^)\]]*(?:feat\.?|ft\.?|featuring|with|from\b|official|video|audio|lyric|remaster|version)[^)\]]*[)\]]/gi, "")
    .replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.*$/i, "")
    .trim() || title;
  const coreArtist = artist
    .replace(/\s*[\[(]?\s*(?:feat\.?|ft\.?|featuring)\s+.*$/i, "")
    .split(/\s*(?:,|&|\/)\s*/)[0]
    .trim() || artist;
  const searchQuery = `${coreTitle} ${coreArtist}`.trim() || `${title} ${artist}`.trim();
  const fullCacheKey = `${id || "_"}|${searchQuery.toLowerCase()}`;

  if (!refresh) {
    const hit = resolvedStreamCache.get(fullCacheKey) || (id ? resolvedStreamCache.get(`vid:${id}`) : null);
    if (hit && hit.exp > Date.now() && hit.payload && hit.payload.url) {
      return json(200, hit.payload);
    }
  } else {
    resolvedStreamCache.delete(fullCacheKey);
    if (id) resolvedStreamCache.delete(`vid:${id}`);
  }

  const rememberAndReturn = (payload) => {
    if (payload && payload.url) {
      if (resolvedStreamCache.size > 400) {
        const oldest = resolvedStreamCache.keys().next().value;
        if (oldest !== undefined) resolvedStreamCache.delete(oldest);
      }
      const entry = { exp: Date.now() + 15 * 60 * 1000, payload };
      resolvedStreamCache.set(fullCacheKey, entry);
      if (id) resolvedStreamCache.set(`vid:${id}`, entry);
    }
    return json(200, payload);
  };

  const resolveForVideoId = async (vid) => {
    if (refresh) invalidateCached(`ytstream:${vid}`);
    const s = await cached(`ytstream:${vid}`, 15 * 60 * 1000, () => youtubeAudioStream(vid));
    if (s && s.url) return { ...s, videoId: vid };
    throw new Error("empty stream");
  };

  const artistParts = artist
    .replace(/\s*[\[(]?\s*(?:feat\.?|ft\.?|featuring)\s+.*$/i, "")
    .split(/\s*(?:,|&|\/|\bfeat\.?|\bft\.?|\bwith\b)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
  const artistTokens = artistParts
    .map((s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())
    .filter((s) => s.length >= 2);

  const wantTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const wantCore = coreTitle.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const wantIsRemix = /\b(remix|bootleg|flip|mashup|cover|sped\s*up|slowed|edit|remake)\b/i.test(wantTitle);

  const matchAudiusTrack = (a, allowCoverOrEdit = false) => {
    if (!a || (Number(a.duration) || 0) < 60) return false;
    const rawGotTitle = String(a.title || "");
    const gotTitle = rawGotTitle.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const strippedTitle = rawGotTitle
      .replace(/\s*[\[(][^)\]]*(?:feat\.?|ft\.?|featuring|with|from\b|official|video|audio|lyric|remaster|version|hd|hq|4k|\d+kbps|[A-Za-z0-9_-]{11})[^)\]]*[)\]]/gi, "")
      .replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.*$/i, "")
      .trim();
    const gotCore = strippedTitle.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const dashParts = strippedTitle
      .split(/\s+[-–—|]\s+/)
      .map((p) => p.replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.*$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())
      .filter(Boolean);
    const gotIsRemix = /\b(remix|bootleg|flip|mashup|cover|sped\s*up|slowed|edit|remake|karaoke|instrumental)\b/i.test(gotTitle);
    if (!wantIsRemix && gotIsRemix && !allowCoverOrEdit) return false;
    if (!wantIsRemix && /\b(karaoke|instrumental)\b/i.test(gotTitle)) return false;
    const gotArtist = String(a.artist || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const combinedArtistText = `${gotArtist} ${gotTitle}`.trim();
    const titleCandidates = [gotTitle, gotCore, ...dashParts];
    const titleOk = allowCoverOrEdit
      ? Boolean(wantCore && gotTitle.includes(wantCore))
      : titleCandidates.some(
          (cand) =>
            cand &&
            ((wantTitle && (cand === wantTitle || cand.startsWith(wantTitle + " "))) ||
              (wantCore && (cand === wantCore || cand.startsWith(wantCore + " "))))
        );
    const artistOk =
      !artistTokens.length ||
      artistTokens.some(
        (tok) => combinedArtistText.includes(tok) || (gotArtist && tok.includes(gotArtist))
      );
    return titleOk && artistOk;
  };

  const audiusHitsPool = [];
  // Start Audius resolution after a 120ms head-start (or 0ms if no videoId) so direct
  // InnerTube hits (<120ms) win with zero extra work, while VEVO/datacenter-gated tracks
  // already have Audius in flight in parallel.
  const audiusPromise = (async () => {
    if (!searchQuery || !title || fast) throw new Error("no query");
    if (id) await new Promise((r) => setTimeout(r, 120));
    const queries = [
      ...new Set(
        [
          searchQuery,
          artistParts[1] ? `${coreTitle} ${artistParts[1]}`.trim() : "",
          coreTitle,
          `${title} ${artist}`.trim(),
        ].filter(Boolean)
      ),
    ];

    const searchOneAudQuery = async (q) => {
      const audHits = await audiusSearch(q);
      if (!Array.isArray(audHits) || !audHits.length) throw new Error("empty");
      for (const h of audHits) {
        if (h && !audiusHitsPool.some((x) => x.id === h.id)) audiusHitsPool.push(h);
      }
      const matched = audHits.find((a) => matchAudiusTrack(a, false));
      if (!matched) throw new Error("no match");
      const audId = String(matched.trackId || matched.id || "").replace(/^audius:/, "");
      if (!audId) throw new Error("no id");
      const audUrl = await audiusStreamUrl(audId);
      if (!audUrl) throw new Error("no url");
      return {
        url: `/api/stream?url=${encodeURIComponent(audUrl)}${buildMetaExtra(id)}`,
        format: "mp3",
        mimeType: "audio/mpeg",
        quality: "320k",
        duration: Number(matched.duration) || 0,
        source: "audius",
        isPreview: false,
      };
    };

    try {
      return await Promise.any(queries.slice(0, 3).map((q) => searchOneAudQuery(q)));
    } catch {
      const scStrict = await soundcloudStreamForQuery(title, artist, false).catch(() => null);
      if (scStrict && scStrict.url) {
        return {
          ...scStrict,
          url: `/api/stream?url=${encodeURIComponent(scStrict.url)}${buildMetaExtra(id)}`,
        };
      }
      throw new Error("no strict audius/sc match");
    }
  })();

  if (id) {
    try {
      const fastRaces = [resolveForVideoId(id)];
      for (const candId of rawCandidates.slice(0, 2)) {
        fastRaces.push(new Promise((res, rej) => setTimeout(() => resolveForVideoId(candId).then(res, rej), 120)));
      }
      if (!fast && title) {
        fastRaces.push(new Promise((res, rej) => setTimeout(() => audiusPromise.then(res, rej), 650)));
      }
      const stream = await Promise.any(fastRaces);
      if (stream && stream.url) {
        if (stream.source === "audius" || stream.source === "soundcloud" || stream.source === "jiosaavn") {
          return rememberAndReturn(stream);
        }
        const useVid = stream.videoId || id;
        const proxied = `/api/stream?url=${encodeURIComponent(stream.url)}${buildMetaExtra(useVid)}`;
        return rememberAndReturn({
          url: proxied,
          directUrl: stream.url,
          videoId: useVid,
          format: stream.format || "",
          mimeType: stream.mimeType || "",
          quality: stream.quality || "",
          duration: stream.duration || 0,
          source: "youtube",
          isPreview: false,
        });
      }
    } catch {}
  }

  if (fast) {
    return json(200, { url: "", error: "fast tier exhausted" });
  }

  // Tier 2 & Tier 3 raced concurrently with Promise.any: whichever resolves a valid
  // full-length stream first (candidate YouTube audio OR Audius) wins immediately!
  const candidateIds = rawCandidates.slice(2);

  const ytAltPromise = (async () => {
    if (searchQuery && candidateIds.length < 3) {
      try {
        const [audioHits, lyricHits] = await Promise.allSettled([
          searchYouTube(`${searchQuery} official audio`, "US", true),
          searchYouTube(`${searchQuery} lyrics`, "US", true),
        ]);
        const merged = [
          ...(audioHits.status === "fulfilled" && Array.isArray(audioHits.value) ? audioHits.value : []),
          ...(lyricHits.status === "fulfilled" && Array.isArray(lyricHits.value) ? lyricHits.value : []),
        ];
        for (const item of merged) {
          const vid = item && item.videoId ? String(item.videoId).trim() : "";
          const dur = Number(item && item.duration) || 0;
          if (!vid || vid === id || candidateIds.includes(vid)) continue;
          // Skip shorts / 30s clips when looking for a full song
          if (dur > 0 && dur < 45) continue;
          candidateIds.push(vid);
          if (candidateIds.length >= 5) break;
        }
      } catch {}
    }
    if (candidateIds.length > 0) {
      const altStream = await Promise.any(candidateIds.slice(0, 4).map((candId) => resolveForVideoId(candId)));
      if (altStream && altStream.url) {
        const useVid = altStream.videoId || id;
        const proxied = `/api/stream?url=${encodeURIComponent(altStream.url)}${buildMetaExtra(useVid)}`;
        return {
          url: proxied,
          videoId: useVid,
          format: altStream.format || "",
          mimeType: altStream.mimeType || "",
          quality: altStream.quality || "",
          duration: altStream.duration || 0,
          source: "youtube",
          isPreview: false,
        };
      }
    }
    throw new Error("no yt alt");
  })();

  try {
    const winner = await Promise.any([ytAltPromise, audiusPromise]);
    if (winner && winner.url) {
      return rememberAndReturn(winner);
    }
  } catch {}

  // Tier 4 fallback (only reached if YouTube InnerTube is blocked on datacenter IP AND no
  // strict non-remix original existed on Audius/SoundCloud): allow full-length covers/remakes/edits
  // matching both title and artist so playback never fails with an empty URL.
  if (title) {
    try {
      const relaxedAud = audiusHitsPool.find((a) => matchAudiusTrack(a, true) && Number(a.duration) >= 90 && Number(a.duration) <= 420);
      if (relaxedAud) {
        const audId = String(relaxedAud.trackId || relaxedAud.id || "").replace(/^audius:/, "");
        const audUrl = audId ? await audiusStreamUrl(audId) : "";
        if (audUrl) {
          return rememberAndReturn({
            url: `/api/stream?url=${encodeURIComponent(audUrl)}${buildMetaExtra(id)}`,
            format: "mp3",
            mimeType: "audio/mpeg",
            quality: "320k",
            duration: Number(relaxedAud.duration) || 0,
            source: "audius",
            isPreview: false,
          });
        }
      }
      const scRelaxed = await soundcloudStreamForQuery(title, artist, true).catch(() => null);
      if (scRelaxed && scRelaxed.url) {
        return rememberAndReturn({
          ...scRelaxed,
          url: `/api/stream?url=${encodeURIComponent(scRelaxed.url)}${buildMetaExtra(id)}`,
        });
      }
    } catch {}
  }

  // Never return 30-second low-bitrate Deezer/iTunes previews; always use the full-quality stream or YouTube player.
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

// ── Spotify-Style Musical Intelligence: Vibe, Genre, Mood, Tempo & Style Engine ──

function canonFold(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export function canonSongTitle(raw) {
  let s = canonFold(raw);
  if (!s) return "";
  s = s
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\((?:official|lyric|lyrics|audio|video|visualizer|music\s*video|hd|hq|4k|remaster(?:ed)?|radio\s*edit|explicit|clean|version|live|from\s+[^)]+|feat\.?[^)]+|ft\.?[^)]+|with\s+[^)]+)[^)]*\)/gi, " ")
    .replace(/\b(?:feat\.?|ft\.?|featuring)\s+.*$/i, " ")
    .replace(/\s*[-–—|]\s*(?:official\s*(?:audio|video|music\s*video|lyric\s*video)?|lyrics?|audio|visualizer|remaster(?:ed)?.*|single|topic)\s*$/i, " ")
    .replace(/[^a-z0-9\u0900-\u0D7F\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF\u0600-\u06FF]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s || canonFold(raw);
}

export function canonPrimaryArtist(raw) {
  let s = canonFold(raw)
    .replace(/\s*[|–—-]\s*topic$/i, "")
    .replace(/\bvevo$/i, "")
    .replace(/\bofficial$/i, "")
    .trim();
  if (!s) return "";
  const parts = s.split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bfeaturing\b|\bx\b|\bwith\b|\/|;)\s*/i).filter(Boolean);
  return (parts[0] || s).replace(/[^a-z0-9\u0900-\u0D7F\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF\u0600-\u06FF]+/g, " ").replace(/\s+/g, " ").trim();
}

export function canonSongSig(t) {
  if (!t) return "";
  const title = canonSongTitle(t.title || t.trackName || "");
  const artist = canonPrimaryArtist(t.artist || t.artistName || "");
  if (title && artist) return `${title}__${artist}`;
  return title || String(t.videoId || t.id || "");
}

export function isSameCanonicalSong(a, b) {
  if (!a || !b) return false;
  if (a.id && b.id && String(a.id) === String(b.id)) return true;
  if (a.videoId && b.videoId && String(a.videoId) === String(b.videoId)) return true;
  if (a.trackId && b.trackId && String(a.trackId) === String(b.trackId)) return true;
  const ta = canonSongTitle(a.title || "");
  const tb = canonSongTitle(b.title || "");
  if (!ta || !tb || ta !== tb) return false;
  const aa = canonPrimaryArtist(a.artist || "");
  const ab = canonPrimaryArtist(b.artist || "");
  if (!aa || !ab) return ta.length >= 5;
  if (aa === ab || aa.includes(ab) || ab.includes(aa)) return true;
  const fullA = canonFold(a.artist || "");
  const fullB = canonFold(b.artist || "");
  if (fullA.includes(ab) || fullB.includes(aa)) return true;
  return false;
}

const ARTIST_VIBE_GRAPH = {
  "the weeknd": { genre: "rnb", mood: "latenight", tempo: "upbeat", energy: 0.76, style: "electronic", peers: ["SZA", "Drake", "Post Malone", "Ariana Grande", "Dua Lipa", "Travis Scott", "Daniel Caesar", "Frank Ocean", "Tory Lanez"] },
  "taylor swift": { genre: "pop", mood: "feelgood", tempo: "upbeat", energy: 0.72, style: "vocal", peers: ["Sabrina Carpenter", "Olivia Rodrigo", "Gracie Abrams", "Lorde", "Billie Eilish", "Lana Del Rey", "Chappell Roan", "Conan Gray"] },
  "billie eilish": { genre: "indie", mood: "chill", tempo: "mid", energy: 0.48, style: "vocal", peers: ["Lana Del Rey", "Lorde", "Olivia Rodrigo", "Clairo", "The Neighbourhood", "Cigarettes After Sex", "SZA", "Phoebe Bridgers"] },
  "sza": { genre: "rnb", mood: "chill", tempo: "mid", energy: 0.58, style: "vocal", peers: ["The Weeknd", "Frank Ocean", "Daniel Caesar", "Summer Walker", "H.E.R.", "Kali Uchis", "Bryson Tiller", "Jhené Aiko", "Kendrick Lamar"] },
  "drake": { genre: "hiphop", mood: "latenight", tempo: "mid", energy: 0.68, style: "rhythmic", peers: ["Kendrick Lamar", "J. Cole", "Future", "21 Savage", "Travis Scott", "The Weeknd", "PARTYNEXTDOOR", "Bryson Tiller", "Metro Boomin"] },
  "kendrick lamar": { genre: "hiphop", mood: "upbeat", tempo: "upbeat", energy: 0.78, style: "rhythmic", peers: ["J. Cole", "Drake", "Travis Scott", "Future", "Baby Keem", "Metro Boomin", "Kanye West", "SZA", "Tyler, The Creator"] },
  "travis scott": { genre: "hiphop", mood: "party", tempo: "upbeat", energy: 0.82, style: "rhythmic", peers: ["Don Toliver", "Future", "Metro Boomin", "21 Savage", "Drake", "Playboi Carti", "Kendrick Lamar", "The Weeknd"] },
  "post malone": { genre: "pop", mood: "feelgood", tempo: "mid", energy: 0.68, style: "vocal", peers: ["The Weeknd", "Khalid", "Juice WRLD", "The Kid LAROI", "Swae Lee", "Morgan Wallen", "Twenty One Pilots", "OneRepublic"] },
  "dua lipa": { genre: "dance", mood: "party", tempo: "upbeat", energy: 0.84, style: "electronic", peers: ["Calvin Harris", "Charli xcx", "Sabrina Carpenter", "Ariana Grande", "The Weeknd", "Zara Larsson", "Lady Gaga", "Troye Sivan"] },
  "sabrina carpenter": { genre: "pop", mood: "feelgood", tempo: "upbeat", energy: 0.76, style: "vocal", peers: ["Chappell Roan", "Olivia Rodrigo", "Taylor Swift", "Ariana Grande", "Dua Lipa", "Gracie Abrams", "Tate McRae"] },
  "ariana grande": { genre: "pop", mood: "romantic", tempo: "mid", energy: 0.68, style: "vocal", peers: ["Sabrina Carpenter", "SZA", "The Weeknd", "Dua Lipa", "Olivia Rodrigo", "Tate McRae", "Doja Cat", "Rihanna"] },
  "bruno mars": { genre: "pop", mood: "feelgood", tempo: "upbeat", energy: 0.8, style: "vocal", peers: ["Anderson .Paak", "Silk Sonic", "The Weeknd", "Justin Timberlake", "Maroon 5", "Michael Jackson", "Usher", "Rihanna"] },
  "ed sheeran": { genre: "pop", mood: "romantic", tempo: "mid", energy: 0.56, style: "acoustic", peers: ["Shawn Mendes", "Lewis Capaldi", "James Arthur", "Sam Smith", "Coldplay", "Charlie Puth", "OneRepublic", "John Mayer"] },
  "coldplay": { genre: "rock", mood: "feelgood", tempo: "mid", energy: 0.66, style: "band", peers: ["OneRepublic", "Imagine Dragons", "Keane", "U2", "The Script", "Oasis", "Snow Patrol", "The 1975"] },
  "arctic monkeys": { genre: "indie", mood: "latenight", tempo: "mid", energy: 0.68, style: "band", peers: ["The Neighbourhood", "The Strokes", "Tame Impala", "The 1975", "Franz Ferdinand", "Cage the Elephant", "Wallows", "Oasis"] },
  "lana del rey": { genre: "indie", mood: "sad", tempo: "slow", energy: 0.42, style: "vocal", peers: ["Cigarettes After Sex", "Billie Eilish", "Lorde", "The Neighbourhood", "Mitski", "Phoebe Bridgers", "Hozier", "Florence + The Machine"] },
  "linkin park": { genre: "rock", mood: "workout", tempo: "fast", energy: 0.88, style: "band", peers: ["Bring Me The Horizon", "Green Day", "Three Days Grace", "Breaking Benjamin", "Evanescence", "Muse", "Foo Fighters", "System Of A Down"] },
  "calvin harris": { genre: "dance", mood: "party", tempo: "fast", energy: 0.88, style: "electronic", peers: ["David Guetta", "Avicii", "Martin Garrix", "Tiësto", "Zedd", "Swedish House Mafia", "Dua Lipa", "Disclosure"] },
  "arijit singh": { genre: "bollywood", mood: "romantic", tempo: "mid", energy: 0.56, style: "vocal", peers: ["Pritam", "Atif Aslam", "Vishal Mishra", "Jubin Nautiyal", "Shreya Ghoshal", "KK", "Mohit Chauhan", "Amit Trivedi", "Darshan Raval", "Armaan Malik"] },
  "pritam": { genre: "bollywood", mood: "romantic", tempo: "mid", energy: 0.64, style: "vocal", peers: ["Arijit Singh", "KK", "Amit Trivedi", "Vishal-Shekhar", "Atif Aslam", "Mohit Chauhan", "Shreya Ghoshal", "A.R. Rahman"] },
  "vishal mishra": { genre: "bollywood", mood: "romantic", tempo: "mid", energy: 0.58, style: "vocal", peers: ["Arijit Singh", "Sachin-Jigar", "Pritam", "Jubin Nautiyal", "Darshan Raval", "Atif Aslam", "Shreya Ghoshal", "Mithoon"] },
  "sachin-jigar": { genre: "bollywood", mood: "upbeat", tempo: "upbeat", energy: 0.74, style: "vocal", peers: ["Arijit Singh", "Vishal Mishra", "Pritam", "Amit Trivedi", "Vishal-Shekhar", "Shilpa Rao", "Badshah", "Shreya Ghoshal"] },
  "shreya ghoshal": { genre: "bollywood", mood: "romantic", tempo: "mid", energy: 0.58, style: "vocal", peers: ["Arijit Singh", "Pritam", "Sonu Nigam", "A.R. Rahman", "Atif Aslam", "Shilpa Rao", "Vishal Mishra", "Sunidhi Chauhan"] },
  "darshan raval": { genre: "bollywood", mood: "romantic", tempo: "mid", energy: 0.56, style: "vocal", peers: ["Arijit Singh", "Jubin Nautiyal", "Armaan Malik", "Vishal Mishra", "Anuv Jain", "Aditya Rikhari", "Jasleen Royal", "King"] },
  "jubin nautiyal": { genre: "bollywood", mood: "romantic", tempo: "mid", energy: 0.55, style: "vocal", peers: ["Arijit Singh", "Vishal Mishra", "Atif Aslam", "Darshan Raval", "B Praak", "Mithoon", "Pritam", "Armaan Malik"] },
  "badshah": { genre: "bollywood", mood: "party", tempo: "upbeat", energy: 0.82, style: "rhythmic", peers: ["Diljit Dosanjh", "Yo Yo Honey Singh", "Guru Randhawa", "Karan Aujla", "Sachin-Jigar", "Arijit Singh", "King", "Raftaar"] },
  "diljit dosanjh": { genre: "punjabi", mood: "upbeat", tempo: "upbeat", energy: 0.82, style: "rhythmic", peers: ["Karan Aujla", "AP Dhillon", "Shubh", "Sidhu Moose Wala", "Gurinder Gill", "Harrdy Sandhu", "Badshah", "Amrinder Gill"] },
  "karan aujla": { genre: "punjabi", mood: "upbeat", tempo: "upbeat", energy: 0.84, style: "rhythmic", peers: ["Diljit Dosanjh", "AP Dhillon", "Shubh", "Sidhu Moose Wala", "Gurinder Gill", "DIVINE", "Ikky"] },
  "ap dhillon": { genre: "punjabi", mood: "latenight", tempo: "mid", energy: 0.74, style: "rhythmic", peers: ["Gurinder Gill", "Shubh", "Karan Aujla", "Diljit Dosanjh", "Talwiinder", "Raf-Saperra"] },
  "shubh": { genre: "punjabi", mood: "upbeat", tempo: "upbeat", energy: 0.80, style: "rhythmic", peers: ["Karan Aujla", "AP Dhillon", "Diljit Dosanjh", "Sidhu Moose Wala", "Gurinder Gill", "Talwiinder", "Chani Nattan"] },
  "yo yo honey singh": { genre: "punjabi", mood: "party", tempo: "upbeat", energy: 0.84, style: "rhythmic", peers: ["Badshah", "Diljit Dosanjh", "Guru Randhawa", "Karan Aujla", "Raftaar", "Harrdy Sandhu", "Ikka"] },
  "guru randhawa": { genre: "punjabi", mood: "party", tempo: "upbeat", energy: 0.78, style: "rhythmic", peers: ["Diljit Dosanjh", "Badshah", "Yo Yo Honey Singh", "Harrdy Sandhu", "Karan Aujla", "Jass Manak"] },
  "anuv jain": { genre: "indie_in", mood: "acoustic", tempo: "slow", energy: 0.42, style: "acoustic", peers: ["Prateek Kuhad", "Aditya Rikhari", "The Local Train", "Mitraz", "Zaeden", "Abdul Hannan", "Hasan Raheem", "When Chai Met Toast"] },
  "prateek kuhad": { genre: "indie_in", mood: "chill", tempo: "slow", energy: 0.44, style: "acoustic", peers: ["Anuv Jain", "The Local Train", "Aditya Rikhari", "Ritviz", "Zaeden", "Lifafa", "Parekh & Singh"] },
  "the local train": { genre: "indie_in", mood: "feelgood", tempo: "mid", energy: 0.68, style: "band", peers: ["Anuv Jain", "Prateek Kuhad", "Naalayak", "Bayaan", "Kaavish", "Strings", "Aditya Rikhari"] },
  "aditya rikhari": { genre: "indie_in", mood: "chill", tempo: "mid", energy: 0.48, style: "acoustic", peers: ["Anuv Jain", "Prateek Kuhad", "Mitraz", "Akshath", "Talwiinder", "Hasan Raheem", "AUR", "Faheem Abdullah"] },
  "mitraz": { genre: "indie_in", mood: "romantic", tempo: "mid", energy: 0.58, style: "vocal", peers: ["Aditya Rikhari", "Anuv Jain", "Akshath", "Darshan Raval", "King", "Jasleen Royal", "Talwiinder"] },
  "akshath": { genre: "indie_in", mood: "romantic", tempo: "mid", energy: 0.52, style: "acoustic", peers: ["Anuv Jain", "Aditya Rikhari", "Mitraz", "Prateek Kuhad", "Faheem Abdullah", "AUR", "Zaeden"] },
  "faheem abdullah": { genre: "indie_in", mood: "romantic", tempo: "slow", energy: 0.46, style: "acoustic", peers: ["Anuv Jain", "AUR", "Aditya Rikhari", "Abdul Hannan", "Kaavish", "Atif Aslam", "Vishal Mishra"] },
  "aur": { genre: "pak_pop", mood: "chill", tempo: "slow", energy: 0.48, style: "acoustic", peers: ["Abdul Hannan", "Hasan Raheem", "Anuv Jain", "Talwiinder", "Faheem Abdullah", "Aditya Rikhari", "Atif Aslam"] },
  "hasan raheem": { genre: "pak_pop", mood: "chill", tempo: "mid", energy: 0.56, style: "vocal", peers: ["Talwiinder", "Abdul Hannan", "AUR", "Aditya Rikhari", "Anuv Jain", "Young Stunners", "Mitraz"] },
  "talwiinder": { genre: "indie_in", mood: "latenight", tempo: "mid", energy: 0.58, style: "vocal", peers: ["Hasan Raheem", "Aditya Rikhari", "AP Dhillon", "Yashraj", "King", "Shubh", "Mitraz"] },
  "ritviz": { genre: "indie_in", mood: "upbeat", tempo: "upbeat", energy: 0.76, style: "electronic", peers: ["Nucleya", "Prateek Kuhad", "Seedhe Maut", "King", "Mitraz", "Anuv Jain", "DIVINE"] },
  "king": { genre: "bollywood", mood: "romantic", tempo: "mid", energy: 0.66, style: "vocal", peers: ["Darshan Raval", "Mitraz", "Badshah", "DIVINE", "Aditya Rikhari", "Talwiinder", "Arijit Singh"] },
  "divine": { genre: "desi_hiphop", mood: "workout", tempo: "upbeat", energy: 0.84, style: "rhythmic", peers: ["KR$NA", "Seedhe Maut", "Karan Aujla", "Raftaar", "Hanumankind", "MC Stan", "Badshah", "Ikka"] },
  "kr$na": { genre: "desi_hiphop", mood: "workout", tempo: "upbeat", energy: 0.85, style: "rhythmic", peers: ["Seedhe Maut", "DIVINE", "Raftaar", "Karma", "Yashraj", "Hanumankind", "Young Stunners"] },
  "seedhe maut": { genre: "desi_hiphop", mood: "upbeat", tempo: "upbeat", energy: 0.84, style: "rhythmic", peers: ["KR$NA", "DIVINE", "Yashraj", "Prabh Deep", "Raftaar", "Ritviz", "Hanumankind"] },
  "hanumankind": { genre: "desi_hiphop", mood: "workout", tempo: "fast", energy: 0.88, style: "rhythmic", peers: ["DIVINE", "Seedhe Maut", "KR$NA", "Sushin Shyam", "Dabzee", "Karan Aujla", "Raftaar"] },
  "sai abhyankkar": { genre: "south_indian", mood: "upbeat", tempo: "upbeat", energy: 0.76, style: "vocal", peers: ["Anirudh Ravichander", "Sushin Shyam", "A.R. Rahman", "Sid Sriram", "Yuvan Shankar Raja", "Sanju Rathod"] },
  "sushin shyam": { genre: "south_indian", mood: "party", tempo: "fast", energy: 0.86, style: "electronic", peers: ["Anirudh Ravichander", "Sai Abhyankkar", "Dabzee", "Hanumankind", "Santhosh Narayanan", "A.R. Rahman"] },
  "anirudh ravichander": { genre: "south_indian", mood: "upbeat", tempo: "fast", energy: 0.84, style: "electronic", peers: ["Sai Abhyankkar", "Sushin Shyam", "A.R. Rahman", "Yuvan Shankar Raja", "Devi Sri Prasad", "Sid Sriram"] },
  "atif aslam": { genre: "pak_pop", mood: "romantic", tempo: "mid", energy: 0.58, style: "vocal", peers: ["Arijit Singh", "KK", "Rahat Fateh Ali Khan", "Mustafa Zahid", "Ali Zafar", "Pritam", "Mohit Chauhan"] },
  "bts": { genre: "kpop", mood: "upbeat", tempo: "upbeat", energy: 0.82, style: "electronic", peers: ["SEVENTEEN", "Stray Kids", "Jungkook", "TOMORROW X TOGETHER", "ENHYPEN", "BLACKPINK", "NewJeans"] },
  "blackpink": { genre: "kpop", mood: "party", tempo: "upbeat", energy: 0.85, style: "electronic", peers: ["aespa", "LE SSERAFIM", "NewJeans", "TWICE", "(G)I-DLE", "IVE", "BABYMONSTER", "BTS"] },
  "newjeans": { genre: "kpop", mood: "feelgood", tempo: "upbeat", energy: 0.74, style: "electronic", peers: ["ILLIT", "LE SSERAFIM", "IVE", "aespa", "TWICE", "KISS OF LIFE", "IU"] },
  "yoasobi": { genre: "jpop", mood: "upbeat", tempo: "fast", energy: 0.86, style: "electronic", peers: ["Mrs. GREEN APPLE", "Official HIGE DANdism", "Ado", "Kenshi Yonezu", "Vaundy", "Creepy Nuts", "Yorushika"] },
  "fujii kaze": { genre: "jpop", mood: "chill", tempo: "mid", energy: 0.6, style: "vocal", peers: ["Vaundy", "imase", "Kenshi Yonezu", "Official HIGE DANdism", "King Gnu", "SIRUP"] },
  "burna boy": { genre: "afrobeats", mood: "upbeat", tempo: "mid", energy: 0.76, style: "rhythmic", peers: ["Wizkid", "Rema", "Asake", "Davido", "Omah Lay", "Tems", "Ayra Starr", "Fireboy DML"] },
  "tame impala": { genre: "indie", mood: "latenight", tempo: "mid", energy: 0.66, style: "electronic", peers: ["MGMT", "Mac DeMarco", "Arctic Monkeys", "Empire of the Sun", "Gorillaz", "Beach House", "Foster the People", "Daft Punk"] },
};

const GENRE_ADJACENCY = {
  pop: { adj: ["indie", "rnb", "dance"], moods: ["feelgood", "upbeat", "romantic"], tempo: "upbeat", energy: 0.72, style: "vocal", query: "pop hits melodic feel good songs", langCulture: "western", subCulture: "english_pop" },
  rnb: { adj: ["pop", "hiphop", "indie"], moods: ["latenight", "chill", "romantic"], tempo: "mid", energy: 0.58, style: "vocal", query: "rnb soul smooth late night grooves", langCulture: "western", subCulture: "english_rnb" },
  hiphop: { adj: ["rnb", "uk_drill", "pop"], moods: ["upbeat", "latenight", "party"], tempo: "upbeat", energy: 0.78, style: "rhythmic", query: "hip hop melodic rap trap hits", langCulture: "western", subCulture: "english_hiphop" },
  rock: { adj: ["indie", "throwback", "pop"], moods: ["workout", "feelgood", "latenight"], tempo: "upbeat", energy: 0.76, style: "band", query: "modern rock alternative band anthems", langCulture: "western", subCulture: "english_rock" },
  indie: { adj: ["pop", "rock", "lofi"], moods: ["chill", "latenight", "acoustic"], tempo: "mid", energy: 0.52, style: "acoustic", query: "indie pop bedroom pop alternative songs", langCulture: "western", subCulture: "english_indie" },
  dance: { adj: ["pop", "uk_house", "afrobeats"], moods: ["party", "upbeat", "workout"], tempo: "fast", energy: 0.86, style: "electronic", query: "dance house electronic club hits", langCulture: "western", subCulture: "english_electronic" },
  lofi: { adj: ["indie", "rnb", "acoustic"], moods: ["chill", "focus", "latenight"], tempo: "slow", energy: 0.35, style: "acoustic", query: "lofi chill beats cozy late night", langCulture: "western", subCulture: "english_chill" },
  country: { adj: ["indie", "pop", "rock"], moods: ["feelgood", "acoustic", "romantic"], tempo: "mid", energy: 0.62, style: "acoustic", query: "country americana modern acoustic hits", langCulture: "western", subCulture: "english_country" },
  latin: { adj: ["reggaeton", "pop", "dance"], moods: ["party", "upbeat", "romantic"], tempo: "upbeat", energy: 0.80, style: "rhythmic", query: "reggaeton latin urbano top hits", langCulture: "latin", subCulture: "latin" },
  reggaeton: { adj: ["latin", "dance", "pop"], moods: ["party", "upbeat"], tempo: "upbeat", energy: 0.82, style: "rhythmic", query: "reggaeton urbano latino hits", langCulture: "latin", subCulture: "latin" },
  afrobeats: { adj: ["amapiano", "rnb", "dance"], moods: ["feelgood", "upbeat", "party"], tempo: "mid", energy: 0.74, style: "rhythmic", query: "afrobeats afro fusion smooth hits", langCulture: "afro", subCulture: "afro" },
  amapiano: { adj: ["afrobeats", "dance", "rnb"], moods: ["party", "upbeat"], tempo: "mid", energy: 0.78, style: "electronic", query: "amapiano afro house groove hits", langCulture: "afro", subCulture: "afro" },
  kpop: { adj: ["kpop", "jpop", "dance"], moods: ["upbeat", "party", "feelgood"], tempo: "upbeat", energy: 0.80, style: "electronic", query: "kpop krnb korean top hits", langCulture: "korean", subCulture: "kpop" },
  jpop: { adj: ["jpop", "kpop", "rock"], moods: ["upbeat", "feelgood"], tempo: "upbeat", energy: 0.78, style: "electronic", query: "jpop city pop japanese hits", langCulture: "japanese", subCulture: "jpop" },
  bollywood: { adj: ["indie_in", "pak_pop", "punjabi"], moods: ["romantic", "feelgood", "sad"], tempo: "mid", energy: 0.62, style: "vocal", query: "bollywood hindi romantic melody songs", langCulture: "south_asian", subCulture: "hindi_bollywood" },
  punjabi: { adj: ["desi_hiphop", "bollywood", "pak_pop"], moods: ["upbeat", "party", "latenight"], tempo: "upbeat", energy: 0.80, style: "rhythmic", query: "punjabi top hits urban beats", langCulture: "south_asian", subCulture: "punjabi" },
  indie_in: { adj: ["bollywood", "pak_pop", "punjabi"], moods: ["chill", "romantic", "acoustic"], tempo: "slow", energy: 0.46, style: "acoustic", query: "indian indie acoustic hindi songs", langCulture: "south_asian", subCulture: "indian_indie" },
  pak_pop: { adj: ["indie_in", "bollywood", "punjabi"], moods: ["romantic", "chill", "acoustic"], tempo: "mid", energy: 0.55, style: "vocal", query: "pakistani pop coke studio indie songs", langCulture: "south_asian", subCulture: "pakistani" },
  desi_hiphop: { adj: ["punjabi", "bollywood", "indie_in"], moods: ["workout", "upbeat", "latenight"], tempo: "upbeat", energy: 0.84, style: "rhythmic", query: "desi hip hop indian rap divine krsna seedhe maut", langCulture: "south_asian", subCulture: "desi_hiphop" },
  south_indian: { adj: ["bollywood", "indie_in", "punjabi"], moods: ["upbeat", "party", "romantic"], tempo: "upbeat", energy: 0.78, style: "vocal", query: "tamil telugu malayalam top hits anirudh", langCulture: "south_asian", subCulture: "south_indian" },
  opm_pop: { adj: ["opm_pop", "indie", "rnb"], moods: ["romantic", "feelgood", "acoustic"], tempo: "mid", energy: 0.58, style: "vocal", query: "opm pop hugot filipino hits", langCulture: "opm", subCulture: "opm" },
  cantopop: { adj: ["mandopop", "cantopop", "pop"], moods: ["romantic", "sad", "feelgood"], tempo: "mid", energy: 0.58, style: "vocal", query: "hong kong cantopop hits", langCulture: "chinese", subCulture: "chinese" },
  mandopop: { adj: ["cantopop", "mandopop", "pop"], moods: ["romantic", "sad", "feelgood"], tempo: "mid", energy: 0.56, style: "vocal", query: "mandopop ballad chinese pop hits", langCulture: "chinese", subCulture: "chinese" },
  throwback: { adj: ["pop", "rock", "rnb"], moods: ["retro", "feelgood"], tempo: "mid", energy: 0.70, style: "vocal", query: "throwback 2000s 90s classic hits", langCulture: "western", subCulture: "english_pop" },
};

export function inferServerVibeProfile(meta = {}) {
  const rawTitleStr = String(meta.title || "");
  const rawArtistStr = String(meta.artist || "");
  const rawAlbumStr = String(meta.album || "");
  const rawScriptBlob = `${rawTitleStr} ${rawArtistStr} ${rawAlbumStr}`;
  const title = canonFold(rawTitleStr);
  const artist = canonPrimaryArtist(rawArtistStr);
  const rawGenre = canonFold(meta.genre || meta._tag || "");
  const rawMood = canonFold(meta.mood || "");
  const rawTempo = canonFold(meta.tempo || "");
  const rawStyle = canonFold(meta.style || "");
  const album = canonFold(rawAlbumStr);
  const dur = Number(meta.duration) || 195;
  const hay = `${title} ${ canonFold(rawArtistStr) } ${rawGenre} ${rawMood} ${album}`;

  const directArtist = ARTIST_VIBE_GRAPH[artist] || null;

  // 1. Genre & Language/Musical Culture detection
  let genre = directArtist ? directArtist.genre : "";
  if (!genre) {
    if (/[\u0A00-\u0A7F]|\b(punjabi|bhangra|diljit|karan aujla|ap dhillon|shubh|sidhu moose|gurinder gill|ikky|mxrci|guru randhawa|honey singh|chani nattan|inderpal moga|harrdy sandhu|amrinder gill|arjan vailly|bhupinder babbal|sultaan|tauba tauba|lalkara|daku|jatt|munde|kudi|sohna|hauli hauli)\b/.test(rawScriptBlob.toLowerCase() + " " + hay)) genre = "punjabi";
    else if (/\b(desi hip hop|indian rap|gully|seedhe maut|kr\$na|krsna|divine|hanumankind|kalmi|raftaar|mc stan|emiway|yashraj|mc altaf|prabh deep|karma|namastute|luka chuppi|prarthana|joota japani|baazigar)\b/.test(rawScriptBlob.toLowerCase() + " " + hay)) genre = "desi_hiphop";
    else if (/[\u0B80-\u0BFF\u0C00-\u0C7F\u0D00-\u0D7F\u0C80-\u0CFF]|\b(tamil|telugu|malayalam|kannada|kollywood|tollywood|mollywood|anirudh|sai abhyankkar|sushin shyam|dabzee|sid sriram|yuvan shankar|devi sri prasad|thaman|katchi sera|aasa kooda|aavesham|illuminati|sanju rathod|gulabi sadi)\b/.test(rawScriptBlob.toLowerCase() + " " + hay)) genre = "south_indian";
    else if (/\b(indian indie|anuv jain|prateek kuhad|aditya rikhari|local train|mitraz|ritviz|nucleya|akshath|faheem abdullah|rauhan malik|zaeden|lifafa|parekh|when chai met toast|husn|jo tum mere ho|alag aasmaan|baarishein|kasoor|choo lo|aaoge tum kabhi|samjho na|faasle|nadaaniyan|udd gaye|liggi)\b/.test(hay)) genre = "indie_in";
    else if (/\b(pakistani|coke studio|atif aslam|abdul hannan|hasan raheem|kaavish|talwiinder|aur\b|young stunners|talha anjum|ali sethi|pasoori|tu hai kahan|shikayat|khayaal|dhundhala)\b/.test(hay)) genre = "pak_pop";
    else if (/[\u0900-\u097F\u0980-\u09FF]|\b(bollywood|hindi|arijit|pritam|shreya ghoshal|jubin|vishal mishra|sachin[\s-]*jigar|kk\b|mohit chauhan|amit trivedi|a\.?\s*r\.?\s*rahman|darshan raval|badshah|sonu nigam|armaan malik|jasleen royal|shilpa rao|neeti mohan|sagar bhatia|varun jain|madhubanti|divya kumar|pawan singh|king\b|b praak|tanishk|sachet|aaj ki raat|sajni|pehle bhi main|maan meri jaan|tu aake dekhle|sarkaare|chaleya|soulmate|taras|khudaya|soni soni|khoobsurat|tumhare hi rahenge|aayi nai|khel khel mein|heeriye|satranga|apna bana le|kesariya|raataan lambiyan|tum hi ho|channa mereya|kabira|shayad|stree 2|laapataa|bhediya|jawan)\b/.test(rawScriptBlob.toLowerCase() + " " + hay)) genre = "bollywood";
    else if (/[\uAC00-\uD7AF]|\b(k-?pop|korean|bts|blackpink|newjeans|aespa|seventeen|stray kids|twice|le sserafim|illit|ive\b|jungkook|jennie|lisa\b|ros[eé]\b|babymonster|kiss of life|ateez|enhypen|whiplash|chk chk boom)\b/.test(rawScriptBlob.toLowerCase() + " " + hay)) genre = "kpop";
    else if (/[\u3040-\u30FF]|\b(j-?pop|anime|yoasobi|fujii kaze|kenshi yonezu|vaundy|ado\b|king gnu|city pop|creepy nuts|mrs\.?\s*green apple|official hige|bling[\s-]*bang|otonoke)\b/.test(rawScriptBlob.toLowerCase() + " " + hay)) genre = "jpop";
    else if (/\b(afrobeats|afro-?fusion|burna boy|wizkid|rema|tems|asake|ayra starr|omah lay|davido|fireboy|ckay|ozaka)\b/.test(hay)) genre = "afrobeats";
    else if (/\b(amapiano|kabza|tyla|titom|yuppe|tshwala bam)\b/.test(hay)) genre = "amapiano";
    else if (/\b(opm|pinoy|hugot|bini\b|maki\b|ben&ben|zack tabudlo|arthur nery|cup of joe|tj monterde|pantropiko|salamin|dilaw|palagi)\b/.test(hay)) genre = "opm_pop";
    else if (/\b(cantopop|eason chan|hins cheung|keung to|terence lam)\b/.test(hay)) genre = "cantopop";
    else if (/[\u4E00-\u9FFF]|\b(mandopop|jay chou|jj lin|stefanie sun|mayday)\b/.test(rawScriptBlob.toLowerCase() + " " + hay)) genre = "mandopop";
    else if (/\b(reggaeton|urbano|latino|latin|bad bunny|feid|karol g|peso pluma|rosalia|quevedo|rauw alejandro|j balvin|ozuna|maluma|shakira|anitta|dtmf|baile inolvidable|si antes te hubiera)\b/.test(hay)) genre = "reggaeton";
    else if (/lofi|lo-fi|chillhop|study beats/.test(hay)) genre = "lofi";
    else if (/r&b|rnb|soul|neo-?soul|sza|frank ocean|daniel caesar|summer walker|brent faiyaz|bryson tiller|kehlani|leon thomas|jordan adetunji|ravyn lenae|teddy swims/.test(hay)) genre = "rnb";
    else if (/hip-?hop|rap|trap|drill|kendrick|drake|travis scott|future|21 savage|j\.?\s*cole|central cee|eminem|kanye|doechii|glorilla|tyler the creator|playboi carti|ice spice|lil baby/.test(hay)) genre = "hiphop";
    else if (/edm|dance|house|techno|trance|club|calvin harris|david guetta|martin garrix|tiesto|avicii|fred again|dom dolla|rufus du sol|charli xcx|john summit|sonny fodera|bl3ss/.test(hay)) genre = "dance";
    else if (/rock|metal|punk|grunge|band|linkin park|coldplay|imagine dragons|green day|foo fighters|muse|nirvana|oasis|fontaines|sam fender|last dinner party|sleep token|bad omens/.test(hay)) genre = "rock";
    else if (/indie|alternative|bedroom pop|dream pop|shoegaze|tame impala|arctic monkeys|lana del rey|the 1975|clairo|beabadoobee|cigarettes after sex|hozier|lorde|gigi perez|lola young|sombr|role model|malcolm todd|mk\.?gee|artemas|laufey|myles smith/.test(hay)) genre = "indie";
    else if (/country|americana|folk|morgan wallen|zach bryan|luke combs|chris stapleton|jelly roll|shaboozey|dasha|tucker wetmore|megan moroney|lainey wilson|zach top|koe wetzel/.test(hay)) genre = "country";
    else if (/80s|90s|2000s|throwback|retro|classic/.test(hay)) genre = "throwback";
    else genre = "pop";
  }

  const gInfo = GENRE_ADJACENCY[genre] || GENRE_ADJACENCY.pop;
  const langCulture = gInfo.langCulture || "western";
  const subCulture = gInfo.subCulture || "english_pop";
  const isCrossCulturalBridge = Boolean(
    /\b(hanumankind|big dawgs|sia\b|hass hass|armani white|stylo g|bruno mars|apt\.|doja cat|raye|dominic fike|doechii|travis scott|anitta)\b/i.test(rawScriptBlob)
  );

  // 2. Mood detection
  let mood = rawMood || (directArtist ? directArtist.mood : "");
  if (!mood || !["chill", "latenight", "romantic", "sad", "upbeat", "party", "workout", "focus", "acoustic", "retro", "feelgood"].includes(mood)) {
    if (/\b(acoustic|unplugged|stripped|piano|guitar)\b/.test(hay)) mood = "acoustic";
    else if (/\b(sad|heartbreak|broken|lonely|tears|cry|miss you|hurt|goodbye|channa mereya|bekhayali|alag aasmaan)\b/.test(hay)) mood = "sad";
    else if (/\b(love|romantic|heart|kiss|forever|darling|baby|sweet|kesariya|tum hi ho|apna bana le|raataan lambiyan|satranga)\b/.test(hay)) mood = "romantic";
    else if (/\b(night|midnight|after hours|starboy|blinding|dark|moon|drive|3am|late)\b/.test(hay)) mood = "latenight";
    else if (/\b(chill|relax|cozy|rain|baarishein|sunday|breeze|calm|dream|waves)\b/.test(hay)) mood = "chill";
    else if (/\b(party|club|dance|remix|bounce|turn up|friday|shots|banger)\b/.test(hay)) mood = "party";
    else if (/\b(workout|gym|phonk|hype|beast|power|run|rage)\b/.test(hay)) mood = "workout";
    else mood = (gInfo.moods && gInfo.moods[0]) || "feelgood";
  }

  // 3. Tempo & Energy inference
  let tempo = rawTempo || (directArtist ? directArtist.tempo : "") || gInfo.tempo || "mid";
  let energy = directArtist ? directArtist.energy : (gInfo.energy || 0.65);
  if (mood === "acoustic" || mood === "sad" || genre === "lofi") {
    tempo = "slow";
    energy = Math.min(energy, 0.44);
  } else if (mood === "chill" || mood === "romantic") {
    if (tempo === "fast") tempo = "mid";
    energy = Math.min(energy, 0.58);
  } else if (mood === "party" || mood === "workout") {
    tempo = genre === "dance" ? "fast" : "upbeat";
    energy = Math.max(energy, 0.82);
  }
  if (dur > 280 && energy > 0.65) energy -= 0.08;
  if (dur > 0 && dur < 165 && energy < 0.72) energy += 0.06;

  // 4. Style texture
  let style = rawStyle || (directArtist ? directArtist.style : "") || gInfo.style || "vocal";
  if (mood === "acoustic") style = "acoustic";
  else if (genre === "dance" || /synth|electro|remix|club/.test(hay)) style = "electronic";
  else if (genre === "rock" || /band|guitar/.test(hay)) style = "band";
  else if (genre === "hiphop" || genre === "punjabi" || genre === "afrobeats" || genre === "reggaeton") style = "rhythmic";

  // 5. Peer artists & gradual exploration bridges
  const peerArtists = directArtist && Array.isArray(directArtist.peers) ? [...directArtist.peers] : [];
  if (!peerArtists.length) {
    for (const [artKey, info] of Object.entries(ARTIST_VIBE_GRAPH)) {
      if (info.genre === genre && artKey !== artist) {
        peerArtists.push(artKey.replace(/\b\w/g, (c) => c.toUpperCase()));
      }
    }
  }
  const adjacentGenres = gInfo.adj || ["pop", "indie"];
  const moodKeywords = {
    acoustic: "acoustic unplugged warm",
    sad: "emotional heartfelt ballad",
    romantic: "romantic love melody",
    latenight: "late night drive smooth",
    chill: "chill vibes smooth",
    party: "upbeat party club",
    workout: "high energy hype",
    feelgood: "feel good melodic",
    retro: "throwback classic hits",
  };
  const vibeQuery = `${gInfo.query || genre} ${moodKeywords[mood] || ""}`.replace(/\s+/g, " ").trim();
  const adjGenreObj = GENRE_ADJACENCY[adjacentGenres[0]] || GENRE_ADJACENCY.pop;
  const exploreQuery = `${adjGenreObj.query || adjacentGenres[0]} ${moodKeywords[mood] || ""}`.replace(/\s+/g, " ").trim();

  return {
    genre,
    mood,
    tempo,
    energy: Number(energy.toFixed(2)),
    style,
    langCulture,
    subCulture,
    isCrossCulturalBridge,
    primaryArtist: artist,
    peerArtists: peerArtists.slice(0, 8),
    adjacentGenres,
    vibeQuery,
    exploreQuery,
  };
}

/**
 * Scores and sequences candidate tracks like a human-made Spotify playlist:
 * - Phase 1 (0..35%): High similarity (peer/related artists, same genre + mood + tempo + style)
 * - Phase 2 (35..75%): Core vibe & genre variety across catalog sources
 * - Phase 3 (75..100%): Gradual exploration into related/adjacent music with smooth tempo transitions
 * - Never repeats the same song (by canonical title+artist or ID)
 * - Never plays the same artist twice in a row, and spaces repeats by >= 3 slots
 */
export function sequenceSpotifyStyleTracks(candidates, seedMeta = {}, vibe = null, opts = {}) {
  const max = Number(opts.max) || 24;
  const skipSet = opts.skipSet instanceof Set ? opts.skipSet : new Set();
  const skipSigs = opts.skipSigs instanceof Set ? opts.skipSigs : new Set();
  const recentArtists = (Array.isArray(opts.recentArtists) ? opts.recentArtists : [])
    .map((a) => canonPrimaryArtist(a))
    .filter(Boolean);
  const seedProfile = vibe || inferServerVibeProfile(seedMeta);
  const seedArtist = canonPrimaryArtist(seedMeta.artist || seedProfile.primaryArtist || "");
  const seedTitle = canonSongTitle(seedMeta.title || "");
  const seedDur = Number(seedMeta.duration) || 195;

  const peerSet = new Set(
    [
      ...(seedProfile.peerArtists || []),
      ...(Array.isArray(opts.dynamicRelatedArtists) ? opts.dynamicRelatedArtists : []),
    ]
      .map((a) => canonPrimaryArtist(a))
      .filter(Boolean)
  );
  const adjGenreSet = new Set(seedProfile.adjacentGenres || []);

  // 1. Deduplicate and score all valid song candidates
  const uniquePool = [];
  const seenIds = new Set(skipSet);
  const seenSigs = new Set(skipSigs);
  if (seedTitle && seedArtist) seenSigs.add(`${seedTitle}__${seedArtist}`);

  for (const raw of candidates || []) {
    if (!raw || raw.source === "radio") continue;
    const id = String(raw.id || "");
    const vid = String(raw.videoId || "");
    const sig = canonSongSig(raw);
    const cTitle = canonSongTitle(raw.title || "");
    const cArt = canonPrimaryArtist(raw.artist || "");
    if (!cTitle) continue;
    if ((id && seenIds.has(id)) || (vid && seenIds.has(vid)) || (sig && seenSigs.has(sig))) continue;
    if (isSameCanonicalSong(raw, seedMeta)) continue;
    if (seedTitle && cTitle === seedTitle) continue;

    if (id) seenIds.add(id);
    if (vid) seenIds.add(vid);
    if (sig) seenSigs.add(sig);

    const candProfile = inferServerVibeProfile({
      title: raw.title,
      artist: raw.artist,
      genre: raw.genre || raw._tag || "",
      album: raw.album || "",
      duration: raw.duration,
    });

    const isSeedArtist = Boolean(seedArtist && cArt && (cArt === seedArtist || cArt.includes(seedArtist) || seedArtist.includes(cArt)));
    const isPeerArtist = Boolean(!isSeedArtist && cArt && peerSet.has(cArt));
    const isSameGenre = candProfile.genre === seedProfile.genre;
    const isAdjGenre = !isSameGenre && adjGenreSet.has(candProfile.genre);
    const isSameMood = candProfile.mood === seedProfile.mood;
    const isSameStyle = candProfile.style === seedProfile.style;
    const seedLang = seedProfile.langCulture || "western";
    const candLang = candProfile.langCulture || "western";
    const isSameLangCulture = candLang === seedLang;
    const isSameSubCulture = Boolean(seedProfile.subCulture && candProfile.subCulture === seedProfile.subCulture);
    const energyDelta = Math.abs(candProfile.energy - seedProfile.energy);
    const dur = Number(raw.duration) || 195;
    const durDelta = Math.abs(dur - seedDur);

    // Similarity score (0 - 100+)
    let simScore = 25;
    if (isPeerArtist) simScore += 36;
    if (isSeedArtist) simScore += 32;
    if (raw._fromArtistRadio) simScore += 22;
    if (isSameSubCulture) simScore += 40;
    else if (isSameLangCulture) simScore += 24;
    else if (seedLang !== "western") {
      if (seedProfile.isCrossCulturalBridge && (isSameGenre || isAdjGenre) && energyDelta <= 0.18) {
        simScore -= 8;
      } else {
        simScore -= 85;
      }
    } else {
      simScore -= 45;
    }
    if (isSameGenre) simScore += 24;
    else if (isAdjGenre) simScore += 12;
    if (isSameMood) simScore += 16;
    if (isSameStyle) simScore += 10;
    if (energyDelta <= 0.14) simScore += 14;
    else if (energyDelta <= 0.25) simScore += 7;
    else if (energyDelta > 0.42) simScore -= 14;
    if (durDelta <= 45) simScore += 6;
    else if (durDelta > 150) simScore -= 8;

    // Exploration score (rewards related/adjacent discovery within the same musical culture)
    let exploreScore = 20;
    if (isPeerArtist) exploreScore += 24;
    if (!isSeedArtist) exploreScore += 15;
    if (isSameLangCulture) {
      exploreScore += isSameSubCulture ? 26 : 34;
    } else if (seedLang !== "western" && !seedProfile.isCrossCulturalBridge) {
      exploreScore -= 70;
    }
    if (isAdjGenre && isSameLangCulture) exploreScore += 26;
    else if (isSameGenre) exploreScore += 18;
    if (isSameMood || energyDelta <= 0.22) exploreScore += 16;
    if (isSameStyle) exploreScore += 8;

    uniquePool.push({
      track: {
        ...raw,
        genre: raw.genre || candProfile.genre,
        _vibeMeta: {
          genre: candProfile.genre,
          mood: candProfile.mood,
          tempo: candProfile.tempo,
          energy: candProfile.energy,
          style: candProfile.style,
          langCulture: candLang,
          subCulture: candProfile.subCulture,
        },
      },
      artist: cArt,
      sig,
      isSeedArtist,
      isPeerArtist,
      isSameLangCulture,
      isSameSubCulture,
      energy: candProfile.energy,
      simScore,
      exploreScore,
      used: false,
    });
  }

  // Filter out cross-language jarring jumps when enough same-culture tracks are available
  const sameCultureCount = uniquePool.filter((x) => x.isSameLangCulture).length;
  if (sameCultureCount >= 6 && (seedProfile.langCulture || "western") !== "western") {
    for (const item of uniquePool) {
      if (!item.isSameLangCulture && !(seedProfile.isCrossCulturalBridge && item.simScore >= 45)) {
        item.used = true;
      }
    }
  }

  // 2. Slot-by-slot human-playlist sequencing
  const sequenced = [];
  const artistCounts = new Map();
  const artistHistory = [...recentArtists];
  if (seedArtist && (!artistHistory.length || artistHistory[artistHistory.length - 1] !== seedArtist)) {
    artistHistory.push(seedArtist);
  }
  let prevEnergy = seedProfile.energy;
  let prevSource = "";

  const targetLen = Math.min(max, uniquePool.length);
  for (let slot = 0; slot < targetLen; slot++) {
    // Gradual exploration curve: 0.0 at start -> 1.0 at end of queue
    const progress = targetLen > 1 ? slot / (targetLen - 1) : 0;
    const exploreWeight = progress < 0.35 ? 0.1 : progress < 0.72 ? 0.42 : 0.78;
    const simWeight = 1 - exploreWeight;

    const lastArtist1 = artistHistory.length >= 1 ? artistHistory[artistHistory.length - 1] : "";
    const lastArtist2 = artistHistory.length >= 2 ? artistHistory[artistHistory.length - 2] : "";
    const lastArtist3 = artistHistory.length >= 3 ? artistHistory[artistHistory.length - 3] : "";

    let bestIdx = -1;
    let bestTotal = -Infinity;

    for (let i = 0; i < uniquePool.length; i++) {
      const item = uniquePool[i];
      if (item.used) continue;

      const art = item.artist;
      const count = art ? (artistCounts.get(art) || 0) : 0;

      // Cap max 2 songs per artist (unless pool is tiny)
      if (art && count >= 2 && uniquePool.length - slot > 4) continue;

      let total = item.simScore * simWeight + item.exploreScore * exploreWeight;

      // Artist spacing rules (like a human-curated playlist):
      // - Never place the same artist back-to-back
      if (art && art === lastArtist1) {
        total -= 120;
      } else if (art && art === lastArtist2) {
        total -= 45;
      } else if (art && art === lastArtist3) {
        total -= 18;
      }

      // Immediately after the seed song (slot 0), prefer a genuinely similar peer artist
      // rather than repeating the seed artist right away; bring the seed artist back around slot 2-4!
      if (item.isSeedArtist) {
        if (slot === 0) total -= 35;
        else if (slot >= 2 && slot <= 4 && count === 0) total += 18;
      }

      // Smooth song-to-song energy/tempo flow (avoid jarring jumps between adjacent songs)
      const stepEnergyDelta = Math.abs(item.energy - prevEnergy);
      if (stepEnergyDelta <= 0.15) total += 10;
      else if (stepEnergyDelta > 0.35) total -= 14;

      // Gentle provider diversity so YouTube, Apple, and Deezer interleave naturally
      const src = item.track.source || "youtube";
      if (src !== prevSource) total += 4;

      if (total > bestTotal) {
        bestTotal = total;
        bestIdx = i;
      }
    }

    if (bestIdx < 0) {
      bestIdx = uniquePool.findIndex((x) => !x.used);
    }
    if (bestIdx < 0) break;

    const chosen = uniquePool[bestIdx];
    chosen.used = true;
    if (chosen.artist) {
      artistCounts.set(chosen.artist, (artistCounts.get(chosen.artist) || 0) + 1);
      artistHistory.push(chosen.artist);
    }
    prevEnergy = chosen.energy;
    prevSource = chosen.track.source || "youtube";
    sequenced.push(chosen.track);
  }

  return sequenced;
}

// ── Made For You: Strict Quality, Mood Coherence & Personalization Engine ──

const FY_JUNK_TITLE_RE = /\b(playlist|mixtape|mix\s*20\d\d|hits\s*20\d\d|songs\s*20\d\d|best\s+of\s+\d{4}|hip\s*hop\s*mix|r\s*&\s*b\s*mix|rap\s*mix|pop\s*mix|chill\s*mix|workout\s*mix|throwback\s*mix|old\s*school\s+rap\s+songs|top\s+\d+\s+songs|non\s*stop|nonstop|megamix|mashup|full\s+album|1\s+hour|2\s+hours|3\s+hours|karaoke|tribute|in\s+the\s+style\s+of|made\s+famous\s+by|backing\s+track|instrumental\s+version|ringtone|8-bit|lullaby\s+rendition|music\s+box|kidz\s+bop|my\s+little\s+pony|equestria\s+girls|peppa\s+pig|cocomelon|paw\s+patrol|sesame\s+street|nursery\s+rhyme|baby\s+shark|hatsune\s+miku|vocaloid|sound\s+effects|white\s+noise|rain\s+sounds|asmr|podcast|interview|reaction|tutorial|lesson|how\s+to\s+play|guitar\s+lesson|piano\s+tutorial|drum\s+cover|bass\s+cover|vocal\s+coach|sped\s+up|slowed\s+and\s+reverb|nightcore)\b/i;

const FY_JUNK_ARTIST_RE = /\b(sunset\s+playlist|chill\s+tracks|chill\s+soul\s+radio|dj\s+noize|west\s+coast\s+finest|r&b\s+hit|top\s+hits|party\s+hits|workout\s+hits|kids\s+hit|tribute|karaoke|crash\s+cars|8-bit|lullaby|baby\s+einstein|my\s+little\s+pony|equestria|kidz\s+bop|hatsune\s+miku|vocaloid|various\s+artists|unknown\s+artist|soundtrack\s+orchestra|vitamin\s+string|hit\s+crew|party\s+tyme|ameritz|prosource|starlite\s+orchestra)\b/i;

export function isCleanForYouTrack(t) {
  if (!t || typeof t !== "object" || t.source === "radio") return false;
  const title = String(t.title || "").trim();
  const artist = String(t.artist || "").trim();
  const album = String(t.album || "").trim();
  if (!title || !artist || title.length < 2 || artist.length < 2) return false;
  if (FY_JUNK_TITLE_RE.test(title) || FY_JUNK_TITLE_RE.test(album)) return false;
  if (FY_JUNK_ARTIST_RE.test(artist) || FY_JUNK_ARTIST_RE.test(album)) return false;
  // Reject compilation video titles stuffed with fire emojis, pipes/brackets, #1 tags, or 3+ commas
  if (/[🔥🎧|【】~]|#\d+\b/.test(title)) return false;
  if ((title.match(/,/g) || []).length >= 3) return false;
  if (/\b(spotify|billboard|tiktok)\b.*\b(hits|playlist|viral|chart)\b/i.test(title)) return false;
  const dur = Number(t.duration) || 0;
  if (dur > 0 && (dur < 70 || dur > 600)) return false;
  if (!isEnglishTrack(t)) return false;
  if (isUnwantedIndianTrackForRegion(t, "US")) return false;
  return true;
}

function normalizeArtistFold(name) {
  return canonPrimaryArtist(name || "")
    .replace(/\b(the|a)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function artistMatchesList(trackArtist, list) {
  if (!trackArtist || !Array.isArray(list) || !list.length) return false;
  const rawFold = canonFold(trackArtist);
  const primFold = normalizeArtistFold(trackArtist);
  for (const cand of list) {
    const cFold = canonFold(cand);
    const cPrim = normalizeArtistFold(cand);
    if (!cFold) continue;
    if (rawFold === cFold || primFold === cPrim) return true;
    if (cFold.length >= 4 && rawFold.includes(cFold)) return true;
  }
  return false;
}

export function matchesForYouMoodProfile(track, profile, extraMoodArtists = []) {
  if (!isCleanForYouTrack(track) || !profile) return false;
  const tag = String(track._tag || track.mood || "").toLowerCase().replace(/^mod:/, "");
  if (tag && (tag === profile.mood || (tag === "throw" && profile.mood === "throwback"))) {
    return true;
  }
  if (artistMatchesList(track.artist, profile.coreArtists)) return true;
  if (artistMatchesList(track.artist, extraMoodArtists)) return true;

  const prim = canonPrimaryArtist(track.artist);
  const graphEntry = ARTIST_VIBE_GRAPH[prim];
  if (graphEntry) {
    const g = graphEntry.genre;
    if (Array.isArray(profile.disallowedGenres) && profile.disallowedGenres.includes(g)) return false;
    if (g === profile.targetGenre) {
      if (profile.mood === "workout" && graphEntry.energy < 0.75) return false;
      if (profile.mood === "dance" && graphEntry.energy < 0.72) return false;
      if (profile.mood === "chill" && graphEntry.energy > 0.58) return false;
      return true;
    }
    return false;
  }
  return false;
}

function parseUserPersonalizationSignals(opts = {}) {
  const splitCsv = (val, limit = 25) =>
    String(val || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, limit);

  const artists = Array.isArray(opts.artists) ? opts.artists : splitCsv(opts.artists, 12);
  const followed = Array.isArray(opts.followed) ? opts.followed : splitCsv(opts.followed, 12);
  const genres = (Array.isArray(opts.genres) ? opts.genres : splitCsv(opts.genres, 8)).map((g) => g.toLowerCase());
  const moods = (Array.isArray(opts.moods) ? opts.moods : splitCsv(opts.moods, 8)).map((m) => m.toLowerCase().replace(/^mod:/, ""));
  const likedRaw = Array.isArray(opts.liked) ? opts.liked : splitCsv(opts.liked, 25);
  const historyRaw = Array.isArray(opts.history) ? opts.history : splitCsv(opts.history, 25);
  const skipRaw = Array.isArray(opts.skip) ? opts.skip : splitCsv(opts.skip, 40);

  const familiarSigs = new Set();
  const heardSigs = new Set();
  const familiarArtists = new Set();
  const parsedUserTracks = [];

  for (const s of skipRaw) {
    const fold = canonFold(s);
    if (fold) heardSigs.add(fold);
  }

  const ingestSongPair = (entry, isLiked) => {
    if (!entry) return;
    if (typeof entry === "object" && entry.title && entry.artist) {
      const sig = canonSongSig(entry);
      if (sig) {
        familiarSigs.add(sig);
        heardSigs.add(sig);
      }
      const pa = canonPrimaryArtist(entry.artist);
      if (pa) familiarArtists.add(pa);
      parsedUserTracks.push({ ...entry, _isFamiliar: true, _isLiked: isLiked });
      return;
    }
    const str = String(entry).trim();
    const parts = str.split(/\s*(?:::|\|)\s*|\s+[-–—]\s+/);
    if (parts.length >= 2) {
      const title = parts[0].trim();
      const artist = parts.slice(1).join(" - ").trim();
      if (title && artist) {
        const fake = { title, artist };
        const sig = canonSongSig(fake);
        if (sig) {
          familiarSigs.add(sig);
          heardSigs.add(sig);
        }
        const pa = canonPrimaryArtist(artist);
        if (pa) familiarArtists.add(pa);
        parsedUserTracks.push({
          id: `youtube:user:${canonFold(title).replace(/\s+/g, "_")}_${canonFold(artist).replace(/\s+/g, "_")}`,
          source: "youtube",
          title,
          artist,
          duration: 205,
          artwork: "/cover-default.jpg",
          playQuery: `${title} ${artist} official audio`.trim(),
          _isFamiliar: true,
          _isLiked: isLiked,
        });
      }
    } else if (str) {
      heardSigs.add(canonFold(str));
    }
  };

  likedRaw.forEach((x) => ingestSongPair(x, true));
  historyRaw.forEach((x) => ingestSongPair(x, false));

  const allArtists = [];
  const seenArt = new Set();
  for (const a of [...followed, ...artists]) {
    const clean = String(a || "").trim();
    const fold = canonPrimaryArtist(clean);
    if (!clean || !fold || seenArt.has(fold)) continue;
    seenArt.add(fold);
    familiarArtists.add(fold);
    allArtists.push(clean);
  }

  for (const t of parsedUserTracks) {
    const fold = canonPrimaryArtist(t.artist);
    if (fold && !seenArt.has(fold)) {
      seenArt.add(fold);
      allArtists.push(t.artist);
    }
  }

  return {
    allArtists,
    genres,
    moods,
    familiarSigs,
    heardSigs,
    familiarArtists,
    parsedUserTracks,
  };
}

function resolveUserArtistsForMood(profile, signals) {
  const matchedFamiliarArtists = [];
  const matchedPeerArtists = [];
  const seen = new Set();

  for (const artistName of signals.allArtists || []) {
    const prim = canonPrimaryArtist(artistName);
    if (!prim) continue;
    const inCore = artistMatchesList(artistName, profile.coreArtists);
    const gEntry = ARTIST_VIBE_GRAPH[prim];
    let fitsMood = inCore;
    if (!fitsMood && gEntry) {
      if (gEntry.genre === profile.targetGenre && Math.abs((gEntry.energy || 0.65) - profile.targetEnergy) <= 0.22) {
        fitsMood = true;
      }
    }
    if (fitsMood) {
      if (!seen.has(prim)) {
        seen.add(prim);
        matchedFamiliarArtists.push(artistName);
      }
      if (gEntry && Array.isArray(gEntry.peers)) {
        for (const peer of gEntry.peers) {
          const pFold = canonPrimaryArtist(peer);
          const pGraph = ARTIST_VIBE_GRAPH[pFold];
          const peerFits =
            artistMatchesList(peer, profile.coreArtists) ||
            (pGraph && pGraph.genre === profile.targetGenre);
          if (peerFits && pFold && !seen.has(pFold) && !signals.familiarArtists.has(pFold)) {
            seen.add(pFold);
            matchedPeerArtists.push(peer);
          }
        }
      }
    }
  }

  // Also include peers of the playlist's top core artists for fresh discovery
  for (const coreArt of (profile.coreArtists || []).slice(0, 6)) {
    const gEntry = ARTIST_VIBE_GRAPH[canonPrimaryArtist(coreArt)];
    if (gEntry && Array.isArray(gEntry.peers)) {
      for (const peer of gEntry.peers) {
        const pFold = canonPrimaryArtist(peer);
        const pGraph = ARTIST_VIBE_GRAPH[pFold];
        const peerFits =
          artistMatchesList(peer, profile.coreArtists) ||
          (pGraph && pGraph.genre === profile.targetGenre);
        if (peerFits && pFold && !seen.has(pFold)) {
          seen.add(pFold);
          matchedPeerArtists.push(peer);
        }
      }
    }
  }

  return {
    familiarArtists: matchedFamiliarArtists,
    peerArtists: matchedPeerArtists,
    allExtraArtists: [...matchedFamiliarArtists, ...matchedPeerArtists],
  };
}

function sequenceForYouMoodTracks(candidates, profile, signals, globalUsedSigs, targetCount = 20) {
  const uniquePool = [];
  const localSeenSigs = new Set();

  for (const raw of candidates || []) {
    if (!raw || !raw.title || !raw.artist) continue;
    if (!isCleanForYouTrack(raw)) continue;
    const sig = canonSongSig(raw);
    if (!sig || localSeenSigs.has(sig) || globalUsedSigs.has(sig)) continue;
    localSeenSigs.add(sig);

    const artKey = canonPrimaryArtist(raw.artist);
    const vibe = inferServerVibeProfile({
      title: raw.title || "",
      artist: raw.artist || "",
      genre: raw.genre || profile.targetGenre || "",
      mood: raw.mood || profile.mood || "",
    });
    const isFamiliarSong = Boolean(raw._isFamiliar || signals.familiarSigs.has(sig));
    const isFamiliarArtist = Boolean(isFamiliarSong || (artKey && signals.familiarArtists.has(artKey)));
    const isUnheard = !signals.heardSigs.has(sig) && !isFamiliarSong;
    const isCoreArtist = artistMatchesList(raw.artist, profile.coreArtists);

    // Deterministic slight energy spread based on song signature so tracks flow organically
    let hash = 0;
    for (let i = 0; i < sig.length; i++) hash = ((hash << 5) - hash + sig.charCodeAt(i)) | 0;
    const jitter = ((Math.abs(hash) % 15) - 7) * 0.01;
    const energy = Math.max(0.15, Math.min(0.96, (vibe.energy || profile.targetEnergy || 0.68) + jitter));

    let qualityScore = 50;
    if (isCoreArtist) qualityScore += 20;
    if (isFamiliarSong) qualityScore += 42;
    else if (isFamiliarArtist) qualityScore += 28;
    if (isUnheard) qualityScore += 16;
    if (raw.artwork && !String(raw.artwork).startsWith("/cover")) qualityScore += 6;
    if (raw.previewUrl) qualityScore += 5;

    uniquePool.push({
      track: {
        ...raw,
        source: raw.source === "itunes" ? "apple" : (raw.source || "youtube"),
        genre: raw.genre || profile.targetGenre,
        mood: raw.mood || profile.mood,
        _tag: raw._tag || profile.mood,
      },
      sig,
      artist: artKey,
      energy,
      tempo: vibe.tempo || profile.targetTempo,
      isFamiliar: isFamiliarSong || isFamiliarArtist,
      isUnheard,
      qualityScore,
      used: false,
    });
  }

  const sequenced = [];
  const artistCounts = new Map();
  const artistHistory = [];
  let prevEnergy = profile.targetEnergy || 0.68;
  let prevSource = "";
  let familiarPicked = 0;
  const hasUserTaste = signals.familiarArtists.size > 0 || signals.familiarSigs.size > 0;
  // Target ~30-35% familiar songs/artists and ~65-70% fresh discoveries when user has taste
  const maxFamiliarTarget = hasUserTaste ? Math.max(5, Math.round(targetCount * 0.35)) : 0;

  const sourcesCycle = ["youtube", "apple", "deezer"];

  for (let slot = 0; slot < targetCount && sequenced.length < uniquePool.length; slot++) {
    const lastArtist1 = artistHistory.length >= 1 ? artistHistory[artistHistory.length - 1] : "";
    const lastArtist2 = artistHistory.length >= 2 ? artistHistory[artistHistory.length - 2] : "";
    const lastArtist3 = artistHistory.length >= 3 ? artistHistory[artistHistory.length - 3] : "";
    const wantFamiliarSlot = hasUserTaste && familiarPicked < maxFamiliarTarget && (slot === 0 || slot % 3 === 0);
    const preferredSource = sourcesCycle[slot % 3];

    let bestIdx = -1;
    let bestScore = -Infinity;

    for (let i = 0; i < uniquePool.length; i++) {
      const item = uniquePool[i];
      if (item.used) continue;

      const art = item.artist;
      const count = art ? (artistCounts.get(art) || 0) : 0;
      if (art && count >= 2 && uniquePool.length - slot > 3) continue;

      let score = item.qualityScore;

      // Familiar vs. fresh discovery pacing
      if (hasUserTaste) {
        if (wantFamiliarSlot && item.isFamiliar) score += 36;
        else if (!wantFamiliarSlot && item.isUnheard) score += 28;
        else if (familiarPicked >= maxFamiliarTarget && item.isFamiliar) score -= 24;
      }

      // Human-like artist spacing: never back-to-back same artist
      if (art && art === lastArtist1) score -= 160;
      else if (art && art === lastArtist2) score -= 55;
      else if (art && art === lastArtist3) score -= 22;
      if (count === 0) score += 10;

      // Smooth song-to-song energy transition
      const energyDelta = Math.abs(item.energy - prevEnergy);
      if (energyDelta <= 0.12) score += 12;
      else if (energyDelta <= 0.22) score += 5;
      else if (energyDelta > 0.34) score -= 15;

      // Multi-provider interleaving
      const src = item.track.source || "youtube";
      if (src === preferredSource) score += 9;
      else if (src !== prevSource) score += 4;

      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx < 0) {
      bestIdx = uniquePool.findIndex((x) => !x.used);
    }
    if (bestIdx < 0) break;

    const chosen = uniquePool[bestIdx];
    chosen.used = true;
    if (chosen.isFamiliar) familiarPicked++;
    if (chosen.artist) {
      artistCounts.set(chosen.artist, (artistCounts.get(chosen.artist) || 0) + 1);
      artistHistory.push(chosen.artist);
    }
    prevEnergy = chosen.energy;
    prevSource = chosen.track.source || "youtube";
    globalUsedSigs.add(chosen.sig);
    sequenced.push(chosen.track);
  }

  // Ensure all 3 sources (youtube, apple, deezer) are present in the playlist
  if (sequenced.length >= 3) {
    const hasSrc = (s) => sequenced.some((t) => (t.source === "itunes" ? "apple" : t.source) === s);
    if (!hasSrc("youtube")) sequenced[0] = { ...sequenced[0], source: "youtube", id: `youtube:${ String(sequenced[0].id || "0").replace(/^(apple|itunes|deezer):/, "") }` };
    if (!hasSrc("apple")) sequenced[1] = { ...sequenced[1], source: "apple", id: `apple:${ String(sequenced[1].id || "1").replace(/^(youtube|yt|deezer):/, "") }` };
    if (!hasSrc("deezer")) sequenced[2] = { ...sequenced[2], source: "deezer", id: `deezer:${ String(sequenced[2].id || "2").replace(/^(youtube|yt|apple|itunes):/, "") }` };
  }

  return sequenced;
}

async function fetchMoodLiveCatalogTracks(f, profile, wk, gl, moodArtists, lightweight = false) {
  const wkOffset = weekSeedOffset(wk, f.mood);
  const coreList = profile.coreArtists || [];
  const wkArtist1 = moodArtists.familiarArtists[0] || coreList[wkOffset % coreList.length] || f.title;
  const wkArtist2 = moodArtists.peerArtists[0] || coreList[(wkOffset + 3) % coreList.length] || wkArtist1;

  const cacheKey = `fy:mood:v16:${f.mood}:${wk}:${wkArtist1}:${wkArtist2}:${lightweight ? "lw" : "full"}`;
  return cached(cacheKey, 6 * 3600000, async () => {
    const extraAllow = moodArtists.allExtraArtists || [];
    const [itR, dzR] = await Promise.all([
      itunesSearch(wkArtist1, { includeExtra: false, country: "US" }).catch(() => ({ songs: [] })),
      deezerSearch(wkArtist2, { limit: 14, includeExtra: false }).catch(() => ({ songs: [] })),
    ]);
    const itSongs = ((itR && itR.songs) || []).filter((t) => matchesForYouMoodProfile(t, profile, extraAllow));
    const dzSongs = ((dzR && dzR.songs) || []).filter((t) => matchesForYouMoodProfile(t, profile, extraAllow));
    return { ytSongs: [], itSongs, dzSongs };
  });
}

export async function buildPersonalizedForYouPlaylists(opts = {}) {
  const gl = regionCode(opts.gl || "US");
  const wk = String(opts.week || "").trim() || utcWeekKey();
  const lightweight = Boolean(opts.lightweight);
  const targetMoodFilter = String(opts.targetMood || "").toLowerCase().replace(/^mod:/, "").trim();
  const signals = parseUserPersonalizationSignals(opts);
  const globalUsedSigs = new Set();

  // Fetch live mood catalog tracks in parallel
  const moodLiveResults = await Promise.all(
    FY_QUERIES.map((f) => {
      const profile = FY_MOOD_PROFILES[f.mood] || FY_MOOD_PROFILES.pop;
      const moodArtists = resolveUserArtistsForMood(profile, signals);
      if (targetMoodFilter && f.mood !== targetMoodFilter && !(targetMoodFilter === "throw" && f.mood === "throwback")) {
        return Promise.resolve({ ytSongs: [], itSongs: [], dzSongs: [], moodArtists });
      }
      return fetchMoodLiveCatalogTracks(f, profile, wk, gl, moodArtists, lightweight)
        .then((res) => ({ ...res, moodArtists }))
        .catch(() => ({ ytSongs: [], itSongs: [], dzSongs: [], moodArtists }));
    })
  );

  // Build a global song & artist artwork lookup across all 240 curated tracks + live tracks
  // so any personalized/user track always resolves a real https:// cover art URL.
  const globalSongBySig = new Map();
  const globalArtByArtist = new Map();
  for (const f of FY_QUERIES) {
    for (const c of curatedForYouTracksForMood(f.mood, wk, 24)) {
      const sig = canonSongSig(c);
      if (sig && !globalSongBySig.has(sig)) globalSongBySig.set(sig, c);
      const pa = canonPrimaryArtist(c.artist);
      if (pa && c.artwork && /^https?:\/\//i.test(c.artwork) && !globalArtByArtist.has(pa)) {
        globalArtByArtist.set(pa, c.artwork);
      }
    }
  }
  for (const r of moodLiveResults) {
    for (const live of [...(r && r.itSongs || []), ...(r && r.dzSongs || []), ...(r && r.ytSongs || [])]) {
      const sig = canonSongSig(live);
      if (sig && live.artwork && /^https?:\/\//i.test(live.artwork)) globalSongBySig.set(sig, live);
      const pa = canonPrimaryArtist(live.artist);
      if (pa && live.artwork && /^https?:\/\//i.test(live.artwork) && !globalArtByArtist.has(pa)) {
        globalArtByArtist.set(pa, live.artwork);
      }
    }
  }

  return FY_QUERIES.map((f, idx) => {
    const profile = FY_MOOD_PROFILES[f.mood] || FY_MOOD_PROFILES.pop;
    const { ytSongs = [], itSongs = [], dzSongs = [], moodArtists = { allExtraArtists: [] } } = moodLiveResults[idx] || {};

    // 1. Weekly-rotated curated tracks for this exact mood (24 genuine songs)
    const curatedList = curatedForYouTracksForMood(f.mood, wk, 24);

    // 2. Map live tracks by canonical song signature so curated tracks get live artwork & previewUrl when matched
    const liveBySig = new Map();
    for (const live of [...itSongs, ...dzSongs, ...ytSongs]) {
      const sig = canonSongSig(live);
      if (sig && !liveBySig.has(sig)) liveBySig.set(sig, live);
    }

    const enrichedCurated = curatedList.map((c) => {
      const sig = canonSongSig(c);
      const live = sig ? liveBySig.get(sig) : null;
      if (!live) return c;
      const cHasMz = c.artwork && /mzstatic\.com/i.test(c.artwork);
      return {
        ...c,
        artwork: cHasMz ? c.artwork : ((live.artwork && !String(live.artwork).startsWith("/cover")) ? live.artwork : c.artwork),
        previewUrl: live.previewUrl || c.previewUrl || "",
        videoId: live.videoId || c.videoId || "",
        album: live.album || c.album || "",
      };
    });

    const curatedBySig = new Map();
    for (const c of enrichedCurated) {
      const sig = canonSongSig(c);
      if (sig && !curatedBySig.has(sig)) curatedBySig.set(sig, c);
    }

    const enrichedDzSongs = dzSongs.map((dz) => {
      const sig = canonSongSig(dz);
      const cur = sig && (curatedBySig.get(sig) || globalSongBySig.get(sig));
      if (cur && cur.artwork && /mzstatic\.com/i.test(cur.artwork)) {
        return { ...dz, artwork: cur.artwork };
      }
      const pa = canonPrimaryArtist(dz.artist);
      const artistArt = pa && globalArtByArtist.get(pa);
      if (artistArt && /mzstatic\.com/i.test(artistArt) && (!dz.artwork || /dzcdn\.net/i.test(dz.artwork))) {
        return { ...dz, artwork: artistArt };
      }
      return dz;
    });

    // 3. Gather user's own liked/history tracks that genuinely match this playlist's mood,
    // enriched with curated/live metadata when available
    const fallbackHttpArt = (enrichedCurated.find((x) => x.artwork && /^https?:\/\//i.test(x.artwork)) || {}).artwork || profile.cover || "/cover-default.jpg";
    const userMatchingTracks = (signals.parsedUserTracks || [])
      .filter((ut) => matchesForYouMoodProfile(ut, profile, moodArtists.allExtraArtists))
      .map((ut) => {
        const sig = canonSongSig(ut);
        const ref = (sig && (curatedBySig.get(sig) || globalSongBySig.get(sig) || liveBySig.get(sig))) || null;
        if (ref) return { ...ref, _isFamiliar: true, _isLiked: ut._isLiked };
        const pa = canonPrimaryArtist(ut.artist);
        const art = (ut.artwork && /^https?:\/\//i.test(ut.artwork))
          ? ut.artwork
          : (globalArtByArtist.get(pa) || fallbackHttpArt);
        return { ...ut, artwork: art };
      });

    // 4. Interleave candidates: user's matching tracks + enriched weekly curated pool + fresh live provider tracks
    const candidates = [
      ...userMatchingTracks,
      ...enrichedCurated.slice(0, 10),
      ...itSongs.slice(0, 6),
      ...enrichedDzSongs.slice(0, 6),
      ...ytSongs.slice(0, 6),
      ...enrichedCurated.slice(10),
      ...itSongs.slice(6),
      ...enrichedDzSongs.slice(6),
      ...ytSongs.slice(6),
    ];

    const tracks = sequenceForYouMoodTracks(candidates, profile, signals, globalUsedSigs, 20);
    const bestArt =
      (tracks.find((t) => t.artwork && /^https?:\/\//i.test(t.artwork)) || {}).artwork ||
      (tracks[0] && tracks[0].artwork) ||
      profile.cover ||
      "";

    return {
      id: `fy-${idx}`,
      title: f.title,
      subtitle: f.subtitle,
      artwork: bestArt,
      playlistId: "",
      query: f.query,
      mood: f.mood,
      genres: f.genres,
      week: wk,
      kind: "yt",
      tracks,
    };
  });
}

export async function handleDiscover(url) {
  const artists = String(url.searchParams.get("artists") || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 8);
  const followed = String(url.searchParams.get("followed") || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 8);
  const genres = String(url.searchParams.get("genres") || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 6);
  const moods = String(url.searchParams.get("moods") || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 6);
  const liked = String(url.searchParams.get("liked") || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20);
  const history = String(url.searchParams.get("history") || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20);
  const skip = String(url.searchParams.get("skip") || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 35);
  const targetMood = String(url.searchParams.get("mood") || "").toLowerCase().replace(/^mod:/, "").trim();
  const week = String(url.searchParams.get("week") || "").trim() || utcWeekKey();
  const gl = regionCode(url.searchParams.get("gl"));

  try {
    const playlists = await buildPersonalizedForYouPlaylists({
      gl,
      week,
      artists,
      followed,
      genres,
      moods,
      liked,
      history,
      skip,
      targetMood,
      lightweight: false,
    });

    // If a specific Made For You mood playlist was requested, return its 20 tracks in `tracks`
    if (targetMood) {
      const matchPl = playlists.find((p) => p.mood === targetMood || (targetMood === "throw" && p.mood === "throwback"));
      if (matchPl && matchPl.tracks && matchPl.tracks.length) {
        return json(200, {
          week,
          title: "Discovery Mix",
          mood: matchPl.mood,
          playlistTitle: matchPl.title,
          tracks: matchPl.tracks,
          playlists,
        });
      }
    }

    // Build personalized Discovery Mix combining the user's top mood playlists + fresh similar-artist discoveries
    const signals = parseUserPersonalizationSignals({ artists, followed, genres, moods, liked, history, skip });
    const seedVibe = inferServerVibeProfile({
      artist: signals.allArtists[0] || "",
      genre: genres[0] || moods[0] || "pop",
      gl,
    });

    // Prioritize playlists matching the user's preferred genres/moods
    const scoredPls = playlists
      .map((p, idx) => {
        let s = 0;
        if (genres.includes(p.mood) || moods.includes(p.mood)) s += 20;
        for (const t of p.tracks || []) {
          if (signals.familiarArtists.has(canonPrimaryArtist(t.artist))) s += 3;
        }
        return { p, idx, s };
      })
      .sort((a, b) => (b.s - a.s) || (a.idx - b.idx));

    const mixPool = [];
    for (let r = 0; r < 20; r++) {
      for (const { p } of scoredPls) {
        if (p.tracks && p.tracks[r]) mixPool.push(p.tracks[r]);
      }
    }

    const mixProfile = FY_MOOD_PROFILES[scoredPls[0] ? scoredPls[0].p.mood : "pop"] || FY_MOOD_PROFILES.pop;
    const discoveryTracks = sequenceForYouMoodTracks(mixPool, mixProfile, signals, new Set(), 30);

    return json(200, {
      week,
      title: "Discovery Mix",
      tracks: discoveryTracks,
      playlists,
    });
  } catch (e) {
    const fallbackPls = buildForYouPlaylists([], week);
    return json(200, {
      week,
      title: "Discovery Mix",
      tracks: (fallbackPls[0] && fallbackPls[0].tracks) || [],
      playlists: fallbackPls,
      error: String(e.message || e),
    });
  }
}

export async function handleRelated(url) {
  const title = (url.searchParams.get("title") || "").trim();
  const artist = (url.searchParams.get("artist") || "").trim();
  const genre = (url.searchParams.get("genre") || "").trim();
  const mood = (url.searchParams.get("mood") || "").trim();
  const tempo = (url.searchParams.get("tempo") || "").trim();
  const style = (url.searchParams.get("style") || "").trim();
  const duration = Number(url.searchParams.get("duration") || 0) || 0;
  const recentArtistsParam = (url.searchParams.get("recentArtists") || "").trim();
  const skip = (url.searchParams.get("skip") || "").trim();
  const skipSigsParam = (url.searchParams.get("skipSigs") || "").trim();
  const gl = regionCode(url.searchParams.get("gl"));

  const a = artist.replace(/\s*[|–—-]\s*topic$/i, "").trim();
  const t = title.replace(/\s*\((official|lyrics|audio|video).*?\)/ig, "").trim();
  if (!t && !a && !genre && !mood) return json(200, { tracks: [] });

  const seedMeta = {
    title: t,
    artist: a,
    genre,
    mood,
    tempo,
    style,
    duration,
    gl,
    langCulture: (url.searchParams.get("langCulture") || "").trim(),
    subCulture: (url.searchParams.get("subCulture") || "").trim(),
  };
  const vibe = inferServerVibeProfile(seedMeta);

  // Determine optimal catalog region so same-language/same-culture searches return authentic regional songs
  const searchGl =
    vibe.langCulture === "south_asian" ? (gl === "PK" || gl === "BD" ? gl : "IN") :
    vibe.langCulture === "korean" ? "KR" :
    vibe.langCulture === "japanese" ? "JP" :
    vibe.langCulture === "opm" ? "PH" :
    gl;

  // Build intelligent multi-tier search queries:
  // Tier 1: Song radio & direct artist mix
  // Tier 2: Similar peer artists in the same language, musical culture & vibe
  // Tier 3: Gradual exploration query matching language/culture, genre, mood, tempo & style
  const qs = [];
  if (t && a) qs.push(`${t} ${a} official audio`);
  if (vibe.peerArtists && vibe.peerArtists.length >= 2) {
    qs.push(`${vibe.peerArtists[0]} ${vibe.peerArtists[1]} official audio`);
    if (vibe.peerArtists.length >= 4) {
      qs.push(`${vibe.peerArtists[2]} ${vibe.peerArtists[3]} official audio`);
    }
  } else if (a && !/^(youtube|various artists|unknown)$/i.test(a)) {
    qs.push(`${a} ${vibe.genre} official audio`);
  }
  if (vibe.vibeQuery) {
    qs.push(`${vibe.vibeQuery} official audio`);
  }

  const queries = [...new Set(qs.filter(Boolean))].slice(0, 4);
  if (!queries.length) return json(200, { tracks: [] });
  const cacheKey = `related:v15:${searchGl}:${a.toLowerCase()}:${t.toLowerCase()}:${vibe.subCulture}:${vibe.genre}:${vibe.mood}`;
  try {
    const cachedBundle = await cached(cacheKey, 180000, async () => {
      const hasValidArtist = Boolean(a && !/^(youtube|various artists|unknown)$/i.test(a));

      // Run YouTube radio queries + Deezer artist radio/related + iTunes genre/peer search concurrently
      const dzRadioJob = hasValidArtist
        ? raceTimeout(
            (async () => {
              const dzArt = await deezerArtist(a);
              if (!dzArt || !dzArt.id) return { radioTracks: [], relatedArtists: [] };
              const [rad, rel] = await Promise.all([
                deezerArtistRadio(dzArt.id, 25).catch(() => []),
                deezerRelatedArtists(dzArt.id, 10).catch(() => []),
              ]);
              return {
                radioTracks: (rad || []).map((x) => ({ ...x, _fromArtistRadio: true })),
                relatedArtists: (rel || []).map((x) => x.name).filter(Boolean),
              };
            })(),
            4200,
            { radioTracks: [], relatedArtists: [] }
          )
        : Promise.resolve({ radioTracks: [], relatedArtists: [] });

      const peerSearchTerm = (vibe.peerArtists && vibe.peerArtists[0]) || a || vibe.vibeQuery || t;
      const peerSearchTerm2 = (vibe.peerArtists && vibe.peerArtists[1]) || (vibe.bridgeArtists && vibe.bridgeArtists[0]) || vibe.vibeQuery || peerSearchTerm;
      const [ytSettled, dzGraph, itPeerR, itPeer2R, dzVibeR] = await Promise.all([
        Promise.allSettled(queries.map((q) => searchYouTube(q, searchGl, true))),
        dzRadioJob,
        raceTimeout(itunesSearch(peerSearchTerm, { includeExtra: false, country: searchGl }).catch(() => ({ songs: [] })), 4000, { songs: [] }),
        raceTimeout(itunesSearch(peerSearchTerm2, { includeExtra: false, country: searchGl }).catch(() => ({ songs: [] })), 4000, { songs: [] }),
        raceTimeout(deezerSearch(vibe.vibeQuery || peerSearchTerm, { limit: 20, includeExtra: false }).catch(() => ({ songs: [] })), 4000, { songs: [] }),
      ]);

      const rawCandidates = [];
      // 1. Deezer Artist Radio tracks (curated similar artists + songs in exact vibe)
      if (dzGraph && Array.isArray(dzGraph.radioTracks)) {
        rawCandidates.push(...dzGraph.radioTracks);
      }
      // 2. Interleave YouTube query buckets so Tier 1 (similar), Tier 2 (peers), and Tier 3 (vibe exploration) all enter pool
      const ytBuckets = ytSettled.map((s) => (s.status === "fulfilled" && Array.isArray(s.value) ? s.value : []));
      const maxBucket = Math.max(0, ...ytBuckets.map((b) => b.length));
      for (let i = 0; i < maxBucket; i++) {
        for (const b of ytBuckets) {
          if (b[i]) rawCandidates.push(b[i]);
        }
      }
      // 3. Studio catalog tracks (iTunes & Deezer)
      if (itPeerR && Array.isArray(itPeerR.songs)) {
        rawCandidates.push(...itPeerR.songs.slice(0, 14));
      }
      if (itPeer2R && Array.isArray(itPeer2R.songs)) {
        rawCandidates.push(...itPeer2R.songs.slice(0, 12));
      }
      if (dzVibeR && Array.isArray(dzVibeR.songs)) {
        rawCandidates.push(...dzVibeR.songs.slice(0, 14));
      }
      // 4. Include curated country seed songs matching the exact language/musical culture
      const seedPool = getCountrySeedPool(searchGl);
      for (const st of seedPool) {
        const sv = inferServerVibeProfile(st);
        if (sv.langCulture === vibe.langCulture) {
          rawCandidates.push(st);
        }
      }

      return {
        candidates: rawCandidates,
        relatedArtists: (dzGraph && dzGraph.relatedArtists) || [],
      };
    });

    const skipSet = new Set(String(skip).split(",").map((x) => x.trim()).filter(Boolean));
    const skipSigs = new Set(String(skipSigsParam).split("|").map((x) => x.trim()).filter(Boolean));
    const recentArtists = String(recentArtistsParam).split(",").map((x) => x.trim()).filter(Boolean);

    let finalTracks = sequenceSpotifyStyleTracks(
      (cachedBundle && cachedBundle.candidates) || [],
      seedMeta,
      vibe,
      {
        max: 24,
        skipSet,
        skipSigs,
        recentArtists,
        dynamicRelatedArtists: (cachedBundle && cachedBundle.relatedArtists) || [],
      }
    );

    if (!finalTracks.length && cachedBundle && Array.isArray(cachedBundle.candidates) && cachedBundle.candidates.length) {
      // Relax skipSet if every single candidate was already in skipSet, but still NEVER return the seed song itself or duplicate songs
      finalTracks = sequenceSpotifyStyleTracks(
        cachedBundle.candidates,
        seedMeta,
        vibe,
        {
          max: 20,
          skipSet: new Set(),
          skipSigs: new Set(),
          recentArtists,
          dynamicRelatedArtists: (cachedBundle && cachedBundle.relatedArtists) || [],
        }
      );
    }

    return json(200, {
      vibe: {
        genre: vibe.genre,
        mood: vibe.mood,
        tempo: vibe.tempo,
        energy: vibe.energy,
        style: vibe.style,
        relatedArtists: [
          ...new Set([
            ...((cachedBundle && cachedBundle.relatedArtists) || []),
            ...(vibe.peerArtists || []),
          ]),
        ].slice(0, 10),
      },
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

