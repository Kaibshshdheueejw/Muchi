// MUCHI — Cloudflare D1 + KV persistence layer.
//
// D1 (DB binding):
//   sessions   — persistent server-side sessions (source of truth; replaces
//                Render's memory Map + .muchi-sessions.json, which the
//                ephemeral filesystem destroyed on every sleep/redeploy)
//   oauth_state — single-use Google OAuth `state` values. Stored in D1, not
//                KV, because a callback may hit a different edge PoP than the
//                /url request and KV is eventually consistent (a missed state
//                would fail a login). D1 is strongly consistent.
//
// KV (CACHE binding):
//   cache:<key> — long-TTL bounded caches only (home/shelf daily keys).
//                NEVER user-generated keys (KV free = 1k writes/day).

import { SESSION_TTL_MS } from "./config.js";

const now = () => Date.now();

// ── sessions ────────────────────────────────────────────────────────────────

/** Returns the parsed session object for a sid, or null (missing/expired). */
export async function getSession(env, sid) {
  if (!sid) return null;
  const row = await env.DB.prepare(
    "SELECT payload FROM sessions WHERE sid = ? AND expires_at > ?"
  )
    .bind(sid, now())
    .first();
  if (!row) return null;
  try {
    const s = JSON.parse(row.payload);
    s.sid = sid;
    return s;
  } catch {
    return null;
  }
}

/** Creates or refreshes a session row. `session` must include sid + profile fields. */
export async function putSession(env, session) {
  const payload = JSON.stringify(session);
  const expires = now() + SESSION_TTL_MS;
  await env.DB.prepare(
    `INSERT INTO sessions (sid, payload, expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(sid) DO UPDATE SET
       payload = excluded.payload,
       expires_at = excluded.expires_at,
       updated_at = excluded.updated_at`
  )
    .bind(session.sid, payload, expires, now(), now())
    .run();
}

/** Deletes a session row (sign-out, disconnect). */
export async function deleteSession(env, sid) {
  if (!sid) return;
  await env.DB.prepare("DELETE FROM sessions WHERE sid = ?").bind(sid).run();
}

// ── oauth state (D1 — strong consistency, single-use) ──────────────────────

export async function putOAuthState(env, state, obj) {
  await env.DB.prepare(
    `INSERT INTO oauth_state (state, payload, expires_at) VALUES (?, ?, ?)
     ON CONFLICT(state) DO UPDATE SET payload = excluded.payload, expires_at = excluded.expires_at`
  )
    .bind(state, JSON.stringify(obj), obj.exp || now() + 600000)
    .run();
}

/** Atomic get-and-delete of a single-use OAuth state. */
export async function takeOAuthState(env, state) {
  if (!state) return null;
  const row = await env.DB.prepare("SELECT payload FROM oauth_state WHERE state = ? AND expires_at > ?")
    .bind(state, now())
    .first();
  if (!row) return null;
  await env.DB.prepare("DELETE FROM oauth_state WHERE state = ?").bind(state).run();
  try {
    return JSON.parse(row.payload);
  } catch {
    return null;
  }
}

/**
 * Opportunistic expiry sweep — called at most ~1 in 100 requests so the free
 * write budget (100k rows/day) is untouched even at hundreds of users.
 * No background jobs exist on Workers; this replaces server.js's debounced
 * file rewrite without needing a cron.
 */
let sweepCounter = 0;
export async function maybeSweep(env) {
  sweepCounter = (sweepCounter + 1) % 100;
  if (sweepCounter !== 0) return;
  await Promise.allSettled([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now()).run(),
    env.DB.prepare("DELETE FROM oauth_state WHERE expires_at < ?").bind(now()).run(),
  ]);
}
