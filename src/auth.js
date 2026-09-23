// MUCHI — session token utilities, ported 1:1 from server.js (lines 74–98).
// Token format:  sid + "." + HMAC-SHA256(sid, MUCHI_SESSION_SECRET) base64url
//
// Workers note: `node:crypto` is provided by the nodejs_compat flag.
// createHmac("sha256", ...).digest("base64url") matches server.js exactly, so
// tokens issued by the Render backend remain valid on the Worker and vice
// versa — useful during the migration window and for rollback.

import { createHmac, timingSafeEqual } from "node:crypto";

export function safeCompare(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function hmac(data, secret) {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

/** sid.signature — same as server.js sessionToken(). */
export function sessionToken(sid, secret) {
  return sid + "." + hmac(sid, secret);
}

/**
 * Validates a token and returns the sid, or null.
 * Uses timingSafeEqual to prevent side-channel timing attacks.
 */
export function sidFromToken(token, secret) {
  if (!token || !secret) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const sid = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expectedSig = hmac(sid, secret);
  if (!safeCompare(sig, expectedSig)) return null;
  return sid;
}
