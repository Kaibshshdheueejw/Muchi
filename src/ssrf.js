// MUCHI — SSRF guard for the URL-proxy endpoints (/api/img, /api/stream,
// /api/audius/file). Ported 1:1 from server.js lines 312–360.
//
// Workers has no node:dns, so hostname resolution uses Cloudflare's DNS-over-
// HTTPS JSON API (1 extra subrequest; well inside the free 50/request). Every
// resolved A/AAAA record must be a public address, exactly like the Node
// version (which blocks if ANY resolved address is private).

const DOH = "https://cloudflare-dns.com/dns-query";

/** Verbatim port of server.js isPrivateIp(). */
export function isPrivateIp(ip) {
  if (!ip) return true;
  const v6 = ip.includes(":");
  if (v6) {
    const norm = ip.toLowerCase().replace(/^\[|\]$/g, "");
    if (norm === "::" || norm === "::1") return true; // unspecified / loopback
    if (norm.startsWith("fc") || norm.startsWith("fd")) return true; // fc00::/7 ULA
    if (/^fe[89ab]/.test(norm)) return true; // fe80::/10 link-local
    if (norm.startsWith("::ffff:")) return isPrivateIp(norm.slice(7)); // v4-mapped
    return false;
  }
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return true; // 0/8, 10/8, loopback, multicast/reserved
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 169 && b === 254) return true; // link-local 169.254/16 (metadata services)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 benchmarking
  return false;
}

async function dnsLookup(host, type) {
  const url = `${DOH}?name=${encodeURIComponent(host)}&type=${type}`;
  const r = await fetch(url, { headers: { accept: "application/dns-json" } });
  if (!r.ok) throw new Error("dns failed");
  const j = await r.json();
  const answers = Array.isArray(j.Answer) ? j.Answer : [];
  return answers
    .filter((a) => a.type === (type === "AAAA" ? 28 : 1) || a.type === (type === "AAAA" ? 1 : 28))
    .map((a) => String(a.data || "").trim())
    .filter((d) => d && !d.endsWith("."));
}

/**
 * Mirrors server.js assertPublicUrl(): throws unless the host resolves to at
 * least one public IPv4/IPv6 address and ALL resolved addresses are public.
 */
export async function assertPublicUrl(src) {
  if (!/^https?:\/\//i.test(src)) throw new Error("bad url");
  const u = new URL(src);
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) throw new Error("bad host");
  const [a4, a6] = await Promise.all([dnsLookup(host, "A"), dnsLookup(host, "AAAA")]);
  const addrs = [...a4, ...a6];
  if (!addrs.length) throw new Error("dns failed");
  for (const addr of addrs) {
    if (isPrivateIp(addr)) throw new Error("private address blocked");
  }
  return true;
}
