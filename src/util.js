// MUCHI — shared utilities: fetchJSON, in-memory + KV caches, response helpers.
// Ported from server.js (cached/fetchJSON/send/sendJSON, lines 251–314) with
// two documented additions for the Worker runtime:
//   1. `cached()` is size-capped (isolates have 128 MB; the Node server's Map
//      was unbounded) — evicts oldest entries first.
//   2. `kvCached()` mirrors a bounded set of long-TTL keys (home/shelf only)
//      into the CACHE KV namespace so all isolates share the daily payload
//      (protects the YouTube quota + keeps CPU ~0 on cache hits). Key space is
//      bounded (~30 writes/day) — inside KV free's 1k writes/day.

export function securityHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "X-XSS-Protection": "1; mode=block",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  };
}

export function corsHeaders(reqOrOrigin) {
  let origin = "";
  if (typeof reqOrOrigin === "string") {
    origin = reqOrOrigin;
  } else if (reqOrOrigin && reqOrOrigin.headers && typeof reqOrOrigin.headers.get === "function") {
    origin = reqOrOrigin.headers.get("origin") || "";
  }
  const headers = {
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Key, X-Hub-Signature-256, X-Webhook-Signature, X-Webhook-Timestamp",
    ...securityHeaders(),
  };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
    headers["Vary"] = "Origin";
  } else {
    headers["Access-Control-Allow-Origin"] = "*";
  }
  return headers;
}

export function json(status, obj, reqOrOrigin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(reqOrOrigin),
      ...securityHeaders(),
    },
  });
}

export function redirect(location) {
  return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store" } });
}

// ── In-memory cache (same semantics as server.js cached(), size-capped) ──
const cache = new Map();
const inflight = new Map();
const CACHE_MAX = 500;

export function invalidateCached(key) {
  cache.delete(key);
  inflight.delete(key);
}

export function hasCached(key, ttlMs) {
  const hit = cache.get(key);
  return Boolean(hit && (!ttlMs || Date.now() - hit.at < ttlMs));
}

export function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.value);
  if (inflight.has(key)) return inflight.get(key);
  const p = fn()
    .then((value) => {
      cache.set(key, { at: Date.now(), value });
      inflight.delete(key);
      if (cache.size > CACHE_MAX) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      return value;
    })
    .catch((err) => {
      inflight.delete(key);
      throw err;
    });
  inflight.set(key, p);
  return p;
}

/**
 * KV-backed long-TTL cache for BOUNDED key spaces only (home/shelf daily
 * keys). Never store user-generated keys here — KV free allows 1k writes/day.
 * `fn` throwing = nothing stored (never cache an empty/failed build).
 */
export async function kvCached(env, key, ttlMs, fn) {
  const k = "cache:" + key;
  if (env && env.CACHE) {
    try {
      const hit = await env.CACHE.get(k);
      if (hit != null) return JSON.parse(hit);
    } catch {}
  }
  const value = await fn();
  if (env && env.CACHE) {
    try {
      await env.CACHE.put(k, JSON.stringify(value), {
        expirationTtl: Math.max(60, Math.floor(ttlMs / 1000)),
      });
    } catch {}
  }
  return value;
}

// ── fetchJSON (server.js:271) — Chrome UA, 14 s default timeout ──
export async function fetchJSON(url, opts = {}, timeoutMs = 14000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...opts,
      signal: ctrl.signal,
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        ...(opts.headers || {}),
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${url} ${text.slice(0, 120)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export function tidyTitle(title) {
  return String(title || "")
    .replace(/\s*[\[(][^)\]]*(official|audio|video|lyric|visualizer|hd|4k|hq|remaster|topic|feat\.?|ft\.?|with\s|prod\.?|from\s|full\s+song|full\s+video|music\s+video|live|acoustic\s+version|radio\s+edit|bonus\s+track|explicit|clean)[^)\]]*[)\]]/gi, "")
    .replace(/\s*[-–—|]\s*(official|audio|lyrics?|video|visualizer|full\s+song|full\s+video|remaster(ed)?|hd|4k|hq|from\s+["']?.*).*$/i, "")
    .replace(/\b(official\s+music\s+video|official\s+audio|official\s+video|lyrics?\s+video|visualizer|audio\s+only|full\s+audio|full\s+video)\b/gi, "")
    .replace(/\s*\b(feat\.?|ft\.?)\s+[^-–—|(\[]+$/i, "")
    .replace(/#[a-z0-9_]+/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function tidyArtist(artist) {
  let s = String(artist || "").split("·")[0].split("|")[0];
  s = s
    .replace(/\s*-\s*Topic$/i, "")
    .replace(/VEVO$/i, "")
    .replace(/\bVEVO\b/gi, "")
    .replace(/\s*\b(official|music|channel|records|recordings|entertainment)\b$/i, "")
    .replace(/\s*\b(feat\.?|ft\.?|with|x|&|,)\s+.*$/i, "")
    .trim();
  if (/^(youtube|various artists|unknown|unknown artist|topic|t-series|zee music company|sony music india|yash raj films|yrf|saregama|tips official|speed records|desi melodies)$/i.test(s)) {
    return "";
  }
  return s;
}

export function codecMatch(raw, want) {
  const c = String(raw || "").toLowerCase();
  if (!want || want === "auto") return true;
  if (want === "mp3") return /mp3|mpeg/.test(c);
  if (want === "aac") return /aac/.test(c);
  if (want === "opus") return /opus|ogg|vorbis/.test(c);
  return true;
}

/**
 * English-only guard for taste/curated mixes (\"Made for you\", discovery).
 * A track is considered English when it has NO strong non-Latin script in its
 * title/artist and is not a known regional-language track. This keeps the
 * mixes from loading Hindi/regional songs when the user's listening history
 * (taste profile) includes them — the reported bug where \"Made for you\"
 * turned up mixed Hindi songs instead of English-only.
 *
 * Returns true if the text is clearly NOT English (e.g. Devanagari/Hindi,
 * Hebrew, Arabic, Chinese/Japanese/Korean, Cyrillic).
 */
const NON_LATIN = /[\u0900-\u097F\u0B80-\u0BFF\u0C00-\u0C7F\u0D00-\u0D7F\u0980-\u09FF\u0A80-\u0AFF\u0A00-\u0A7F\u0E00-\u0E7F\u0590-\u05FF\u0600-\u06FF\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF\u0400-\u04FF\u1E00-\u1EFF]/;
const REGIONAL_HINTS = [
  // Explicit regional-language markers (safe, unambiguous).
  /\bbollywood\b/i, /\btollywood\b/i, /\bkollywood\b/i, /\btamil\b/i, /\btelegu\b/i,
  /\btelugu\b/i, /\bmalayalam\b/i, /\bkannada\b/i, /\bmaharashtra\b/i, /\bdesi\b/i,
  /\bmarathi\b/i, /\bsinhala\b/i, /\bthai\b/i, /\bpunjab\b/i, /\bhindi\b/i,
  /\bharyanvi\b/i, /\bbhojpuri\b/i, /\bgarhwali\b/i, /\bkumaoni\b/i, /\bangrezi\b/i,
  /\bbengali\b/i, /\bodia\b/i, /\bassamese\b/i, /\bpunjabi\b/i,
  // Non-English Latin-script song titles / singers (Indian & worldwide pop)
  // that would otherwise look English but are not English-language.
  /\barijit\b/i, /\batif aslam\b/i, /\bshreya ghoshal\b/i, /\bneha kakkar\b/i,
  /\bsunidhi\b/i, /\bnusrat\b/i, /\brabba\b/i, /\bsonu nigam\b/i, /\bkishore\b/i,
  /\bdilbar\b/i, /\bkesariya\b/i, /\bchanna mereya\b/i, /\bhumma humma\b/i,
  /\blut geya\b/i, /\btum hi ho\b/i, /\bae dil hai\b/i,
  // Spanish/Latin pop (common, not English).
  /\bdespacito\b/i, /\bcalma\b/i, /\bbailando\b/i, /\bmacarena\b/i, /\bcorazon\b/i,
  // Korean.
  /\bgangnam style\b/i,
];

export function detectsNonEnglish(text) {
  const s = String(text || "");
  if (!s) return false;
  if (NON_LATIN.test(s)) return true; // non-Latin script (Devanagari, CJK, Cyrillic, Arabic, etc.)
  return REGIONAL_HINTS.some((re) => re.test(s));
}

/** True when a single track's title/artist are plausibly English. */
export function isEnglishTrack(t) {
  if (!t) return false;
  return !detectsNonEnglish(`${t.title || ""} ${t.artist || ""} ${t.album || ""}`);
}

/**
 * Normalizes and validates an International Standard Recording Code (ISRC).
 * Standard format: 2 country letters + 3 alphanumeric registrant + 2-digit year + 5-digit designation (12 alphanumeric chars).
 * Strips dashes, hyphens, and whitespace, forces uppercase.
 * Returns the 12-character normalized string if valid, or null if invalid or missing.
 */
export function normalizeIsrc(raw) {
  if (!raw || typeof raw !== "string") return null;
  const clean = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(clean)) {
    return clean;
  }
  return null;
}

/**
 * Extracts an explicit ISRC code from description or free text if explicitly labeled
 * (e.g. "ISRC: USUM72412345" or "ISRC US-UM7-24-12345").
 * Returns the normalized 12-char ISRC, or null if not explicitly present.
 */
export function extractIsrcFromText(text) {
  if (!text || typeof text !== "string") return null;
  const m = text.match(/\b(?:ISRC|isrc)[:\s#-]*([A-Za-z]{2}[-\s]?[A-Za-z0-9]{3}[-\s]?\d{2}[-\s]?\d{5})\b/);
  if (m && m[1]) {
    return normalizeIsrc(m[1]);
  }
  return null;
}

/**
 * Detects the version type of a track from its title and artist.
 * Possible types:
 * - 'live'
 * - 'remix'
 * - 'acoustic'
 * - 'instrumental'
 * - 'cover'
 * - 'karaoke'
 * - 'speed_up'
 * - 'slowed'
 * - 'radio_edit'
 * - 'studio' (default canonical)
 */
export function detectVersionType(title, artist = "") {
  const t = String(title || "");
  const a = String(artist || "");
  const blob = `${t} ${a}`.toLowerCase();

  if (/\b(sped\s*up|speed\s*up|nightcore)\b/i.test(blob)) return "speed_up";
  if (/\b(slowed(?:\s*\+?\s*reverb)?|reverb)\b/i.test(blob)) return "slowed";
  if (/\b(karaoke|sing-along|sing\s*along)\b/i.test(blob)) return "karaoke";
  if (/\b(instrumental|backing\s*track|piano\s*version|orchestral\s*version|string\s*version)\b/i.test(blob)) return "instrumental";
  if (/\b(cover|tribute\s*to|originally\s*by|performed\s*by)\b/i.test(blob)) return "cover";
  if (/\b(acoustic(?:\s*version)?|unplugged|stripped(?:\s*version)?)\b/i.test(blob)) return "acoustic";
  if (/\b(live(?:\s+at|\s+from|\s+in|\s+version|\s+session)?|in\s+concert|mtv\s+unplugged)\b/i.test(blob)) return "live";
  if (/\b(remix|rmx|vip\s*mix|vip\s*edit|club\s*mix|extended\s*mix|extended\s*version|dub\s*mix)\b/i.test(blob)) return "remix";
  if (/\b(radio\s*edit|single\s*version|album\s*version|original\s*mix)\b/i.test(blob)) return "radio_edit";

  return "studio";
}

/**
 * Detects if the user query explicitly requested a specific recording version.
 * Returns: { requestedVersion: 'live' | 'remix' | 'acoustic' | 'instrumental' | 'cover' | 'speed_up' | 'slowed' | null, cleanQuery: string }
 */
export function detectQueryIntent(query) {
  const raw = String(query || "").trim();
  const lower = raw.toLowerCase();
  let requestedVersion = null;

  if (/\b(sped\s*up|speed\s*up|nightcore)\b/i.test(lower)) {
    requestedVersion = "speed_up";
  } else if (/\b(slowed(?:\s*\+?\s*reverb)?|reverb)\b/i.test(lower)) {
    requestedVersion = "slowed";
  } else if (/\b(karaoke)\b/i.test(lower)) {
    requestedVersion = "karaoke";
  } else if (/\b(instrumental|backing\s*track)\b/i.test(lower)) {
    requestedVersion = "instrumental";
  } else if (/\b(cover|tribute)\b/i.test(lower)) {
    requestedVersion = "cover";
  } else if (/\b(acoustic|unplugged|stripped)\b/i.test(lower)) {
    requestedVersion = "acoustic";
  } else if (/\b(live(?:\s+at|\s+from|\s+version)?|in\s+concert)\b/i.test(lower)) {
    requestedVersion = "live";
  } else if (/\b(remix|rmx|club\s*mix|vip)\b/i.test(lower)) {
    requestedVersion = "remix";
  }

  let cleanQuery = raw;
  if (requestedVersion) {
    cleanQuery = raw
      .replace(/\b(sped\s*up|speed\s*up|nightcore|slowed(?:\s*\+?\s*reverb)?|reverb|karaoke|instrumental|backing\s*track|cover|tribute|acoustic|unplugged|stripped|live(?:\s+at|\s+from|\s+version)?|in\s+concert|remix|rmx|club\s*mix|vip)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleanQuery) cleanQuery = raw;
  }

  return { requestedVersion, cleanQuery };
}

/**
 * Generates at most 2 targeted query variations for expanding catalog coverage
 * when initial results are scarce.
 */
export function generateTargetedQueryVariations(query) {
  const raw = String(query || "").trim();
  if (!raw || raw.length < 3) return [];

  const variations = [];
  const addVar = (v) => {
    const s = String(v || "").trim();
    if (s && s.toLowerCase() !== raw.toLowerCase() && !variations.some((x) => x.toLowerCase() === s.toLowerCase())) {
      if (variations.length < 2) variations.push(s);
    }
  };

  // 1. Strip feat / ft / featuring and guest artists
  if (/\b(?:feat\.?|ft\.?|featuring|with)\b/i.test(raw)) {
    const noFeat = raw
      .replace(/\s*[\[(]?(?:feat\.?|ft\.?|featuring|with)\s+[^)\]]+[)\]]?/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    addVar(noFeat);
  }

  // 2. Strip smart quotes and standard apostrophes / punctuation
  if (/['"’“”.,;!?\-_]/.test(raw)) {
    const noPunct = raw
      .replace(/['"’“”]/g, "")
      .replace(/[-–—_]/g, " ")
      .replace(/[.,;!?]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    addVar(noPunct);
  }

  // 3. Artist - Title swap or title-only if formatted with dash
  if (variations.length < 2 && / - /.test(raw)) {
    const parts = raw.split(" - ").map((s) => s.trim()).filter(Boolean);
    if (parts.length === 2) {
      addVar(`${parts[1]} ${parts[0]}`);
    }
  }

  return variations;
}

/**
 * Computes a conservative recording deduplication key for a track.
 *
 * Tier 1 (ISRC): If valid normalized ISRC is present, key is `isrc:${isrc}`.
 *
 * Tier 2 (Conservative metadata + duration bucket):
 * If no ISRC, requires:
 * - Normalized core title (stripping noisy decorations like [Official Video])
 * - Normalized primary artist
 * - Version type ('studio', 'live', 'remix', etc.)
 * - Duration rounded to 3-second bucket.
 * If duration is missing (0), duration bucket is 'nodur_${id}' so tracks without duration never merge with arbitrary tracks!
 */
export function computeRecordingDedupeKey(track) {
  if (!track) return `null_${Math.random()}`;

  const isrc = normalizeIsrc(track.isrc);
  if (isrc) {
    return `isrc:${isrc}`;
  }

  const title = String(track.title || "")
    .toLowerCase()
    .replace(/\s*[\[(][^)\]]*(?:official|audio|video|lyrics?|visualizer|hd|4k)[^)\]]*[)\]]/gi, "")
    .replace(/[^a-z0-9]/g, "");

  const artist = String(track.artist || "")
    .toLowerCase()
    .split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b)\s*/i)[0]
    .replace(/[^a-z0-9]/g, "");

  const versionType = detectVersionType(track.title, track.artist);
  const dur = Number(track.duration) || 0;

  const durBucket = dur > 0 ? `d${Math.round(dur / 3) * 3}` : `id_${track.id || track.videoId || Math.random()}`;

  return `meta:${artist}:${title}:${versionType}:${durBucket}`;
}

/**
 * Ranks tracks according to user version intent:
 * - If query explicitly asked for an alternative (e.g. 'live', 'remix'), prioritize that version.
 * - If query did not ask for an alternative, rank official studio recordings higher,
 *   while retaining alternatives in the list.
 */
export function rankTracksByVersionIntent(tracks, query) {
  if (!Array.isArray(tracks) || tracks.length <= 1) return tracks || [];
  const intent = detectQueryIntent(query);

  const scored = tracks.map((t, idx) => {
    const vType = detectVersionType(t.title, t.artist);
    let boost = 0;

    if (intent.requestedVersion) {
      if (vType === intent.requestedVersion) boost += 500;
      else if (vType === "studio") boost += 100;
      else boost -= 100;
    } else {
      if (vType === "studio" || vType === "radio_edit") boost += 300;
      else if (vType === "live") boost += 50;
      else if (vType === "acoustic") boost += 40;
      else if (vType === "remix") boost -= 50;
      else if (vType === "cover" || vType === "karaoke" || vType === "speed_up" || vType === "slowed") boost -= 200;
    }

    return { track: t, score: boost - idx, origIdx: idx };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.track);
}


