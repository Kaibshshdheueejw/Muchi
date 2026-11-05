// MUCHI — SSRF guard for URL-proxy endpoints.
//
// Every user/provider-supplied URL is checked before the request is made, and
// every redirect hop is checked again. Redirects are followed manually so an
// allowed public URL cannot redirect the proxy into localhost, a private
// network, or a cloud metadata service.

const DOH = "https://cloudflare-dns.com/dns-query";
const MAX_REDIRECTS = 5;
// Keep this short enough to reduce DNS-rebinding exposure while still avoiding
// two DoH lookups for every range chunk of a long stream.
const DNS_CACHE_TTL = 10 * 1000;
const verifiedHostCache = new Map();

function isIpv4Literal(host) {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host);
}

/** Returns true for non-routable, reserved, loopback, link-local, or private IPs. */
export function isPrivateIp(ip) {
  if (!ip) return true;
  const raw = String(ip).trim().replace(/^\[|\]$/g, "").toLowerCase();

  if (raw.includes(":")) {
    // IPv4-mapped/compatible IPv6 forms still need the IPv4 blocklist.
    if (raw.includes(".")) {
      const v4Tail = raw.slice(raw.lastIndexOf(":") + 1);
      if (isIpv4Literal(v4Tail)) return isPrivateIp(v4Tail);
    }

    // Exact/prefix checks cover the special IPv6 ranges without depending on
    // node:net, which is not available in a Cloudflare Worker.
    if (raw === "::" || raw === "::1") return true;
    if (raw.startsWith("fc") || raw.startsWith("fd")) return true; // fc00::/7 ULA
    if (/^fe[89ab]/.test(raw)) return true; // fe80::/10 link-local
    if (raw.startsWith("ff")) return true; // multicast
    if (raw.startsWith("2001:db8")) return true; // documentation range
    return false;
  }

  const p = raw.split(".").map((part) => Number(part));
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = p;

  if (a === 0 || a === 10 || a === 127 || a >= 224) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0 && c === 0) return true; // IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return true; // TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return true; // deprecated 6to4 relay anycast
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  return false;
}

async function dnsLookup(host, type) {
  const url = `${DOH}?name=${encodeURIComponent(host)}&type=${type}`;
  const r = await fetch(url, { headers: { accept: "application/dns-json" } });
  if (!r.ok) throw new Error("dns failed");
  const j = await r.json();
  const expectedType = type === "AAAA" ? 28 : 1;
  const answers = Array.isArray(j.Answer) ? j.Answer : [];
  return answers
    .filter((a) => a && a.type === expectedType)
    .map((a) => String(a.data || "").trim())
    .filter(Boolean);
}

function validateUrlShape(src) {
  if (typeof src !== "string" || src.length < 1 || src.length > 8192) throw new Error("bad url");
  let u;
  try {
    u = new URL(src);
  } catch {
    throw new Error("bad url");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("bad url");
  if (u.username || u.password) throw new Error("credentials in url blocked");
  if (u.port && u.port !== "80" && u.port !== "443") throw new Error("port blocked");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan") ||
    host.endsWith(".home.arpa") ||
    host.endsWith(".test") ||
    host.endsWith(".invalid") ||
    host.endsWith(".example")
  ) {
    throw new Error("bad host");
  }
  return { u, host };
}

/**
 * Throws unless the URL host is public. All resolved A/AAAA answers must be
 * public; a mixed public/private DNS response is rejected rather than using the
 * first answer only.
 */
export async function assertPublicUrl(src) {
  const { u, host } = validateUrlShape(src);

  if (isIpv4Literal(host) || host.includes(":")) {
    if (isPrivateIp(host)) throw new Error("private address blocked");
    return true;
  }

  const now = Date.now();
  const cached = verifiedHostCache.get(host);
  if (cached && cached.expiresAt > now && cached.addresses.every((addr) => !isPrivateIp(addr))) {
    return true;
  }

  const [a4, a6] = await Promise.all([
    dnsLookup(host, "A").catch(() => []),
    dnsLookup(host, "AAAA").catch(() => []),
  ]);
  const addrs = [...new Set([...a4, ...a6])];
  if (!addrs.length) throw new Error("dns failed");
  if (addrs.some((addr) => isPrivateIp(addr))) throw new Error("private address blocked");

  if (verifiedHostCache.size > 500) {
    const first = verifiedHostCache.keys().next().value;
    if (first) verifiedHostCache.delete(first);
  }
  verifiedHostCache.set(host, { expiresAt: now + DNS_CACHE_TTL, addresses: addrs });
  // Keep this reference so callers can use the parsed URL during debugging
  // without reparsing; the returned value remains boolean for compatibility.
  void u;
  return true;
}

function isRedirect(status) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/**
 * Fetch an upstream URL while validating every redirect destination.
 * `init.redirect` is deliberately overwritten with `manual` so a caller
 * cannot accidentally reintroduce redirect-follow SSRF.
 */
export async function fetchPublic(src, init = {}, maxRedirects = MAX_REDIRECTS) {
  let current = String(src || "");
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    await assertPublicUrl(current);
    const response = await fetch(current, { ...init, redirect: "manual" });
    if (!isRedirect(response.status)) return response;

    const location = response.headers.get("location") || "";
    if (!location) return response;
    if (hop >= maxRedirects) throw new Error("too many redirects");

    let next;
    try {
      next = new URL(location, current).toString();
    } catch {
      throw new Error("bad redirect");
    }
    // Validate the destination before the next network request. This also
    // rejects javascript:, file:, credentials, private IPs, and bad ports.
    await assertPublicUrl(next);
    current = next;
  }
  throw new Error("too many redirects");
}
