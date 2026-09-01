// MUCHI — shared utilities: fetchJSON, in-memory + KV caches, response helpers.
// Ported from server.js (cached/fetchJSON/send/sendJSON, lines 251–314) with
// two documented additions for the Worker runtime:
//   1. `cached()` is size-capped (isolates have 128 MB; the Node server's Map
//      was unbounded) — evicts oldest entries first.
//   2. `kvCached()` mirrors a bounded set of long-TTL keys (home/shelf only)
//      into the CACHE KV namespace so all isolates share the daily payload
//      (protects the YouTube quota + keeps CPU ~0 on cache hits). Key space is
//      bounded (~30 writes/day) — inside KV free's 1k writes/day.

export function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

export function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders() },
  });
}

export function redirect(location) {
  return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store" } });
}

// ── In-memory cache (same semantics as server.js cached(), size-capped) ──
const cache = new Map();
const inflight = new Map();
const CACHE_MAX = 500;

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
    .replace(/\s*[\[(][^)\]]*(official|audio|video|lyric|visualizer|hd|4k|remaster|topic)[^)\]]*[)\]]/gi, "")
    .replace(/\s*[-–—]\s*(official|audio|lyrics?|video).*$/i, "")
    .replace(/\b(official audio|official video|lyrics? video|visualizer|audio only)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function tidyArtist(artist) {
  let s = String(artist || "").split("·")[0].split("|")[0].split(",")[0];
  s = s.replace(/\s*-\s*Topic$/i, "").replace(/VEVO/gi, "").trim();
  if (/^(youtube|various artists|unknown)$/i.test(s)) return "";
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
