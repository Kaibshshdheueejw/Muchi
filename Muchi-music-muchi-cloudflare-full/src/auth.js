// MUCHI — session token utilities, ported 1:1 from server.js (lines 74–98).
// Token format:  sid + "." + HMAC-SHA256(sid, MUCHI_SESSION_SECRET) base64url
//
// Workers note: `node:crypto` is provided by the nodejs_compat flag.
// createHmac("sha256", ...).digest("base64url") matches server.js exactly, so
// tokens issued by the Render backend remain valid on the Worker and vice
// versa — useful during the migration window and for rollback.

import { createHmac } from "node:crypto";

export function hmac(data, secret) {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

/** sid.signature — same as server.js sessionToken(). */
export function sessionToken(sid, secret) {
  return sid + "." + hmac(sid, secret);
}

/**
 * Validates a token and returns the sid, or null.
 * Mirrors server.js sessionFromToken() — NOTE: the server.js version also
 * checks the in-memory Map + TTL; on the Worker the D1 lookup (db.js) does
 * the TTL check, so this returns the sid only.
 */
export function sidFromToken(token, secret) {
  if (!token || !secret) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const sid = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (hmac(sid, secret) !== sig) return null;
  return sid;
}
