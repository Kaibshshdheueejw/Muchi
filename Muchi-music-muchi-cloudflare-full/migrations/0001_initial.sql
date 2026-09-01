-- MUCHI — D1 schema, migration 0001: sessions + OAuth state.
--
-- WHY D1 (not KV) for both tables: strong read-after-write consistency.
--   - sessions: the request right after the OAuth callback MUST see the
--     session; KV free is 1k writes/day + eventually consistent — wrong tool.
--   - oauth_state: a Google callback can land on a different edge PoP than
--     the /url request; KV's eventual consistency could drop the single-use
--     state and fail a login. D1 is strongly consistent.
-- KV is used only for long-TTL bounded caches (home/shelf daily keys).
--
-- Session token format (identical to server.js): sid + "." + HMAC-SHA256(sid)
-- base64url, keyed by MUCHI_SESSION_SECRET. The token travels in an httpOnly
-- cookie (web) or via the muchi:// deep link as a Bearer token (native app).
-- The D1 row is the source of truth; the token only proves "who".

CREATE TABLE IF NOT EXISTS sessions (
  sid        TEXT PRIMARY KEY,            -- opaque session id (token prefix)
  payload    TEXT NOT NULL,               -- JSON: { name, email, picture, yt:{access,refresh,expiresAt,at}, at }
  expires_at INTEGER NOT NULL,            -- epoch milliseconds (30-day TTL, mirrored from server.js SESSION_TTL_MS)
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- Single-use Google OAuth `state` values (10-minute TTL, server.js oauthStates).
CREATE TABLE IF NOT EXISTS oauth_state (
  state      TEXT PRIMARY KEY,
  payload    TEXT NOT NULL,               -- JSON: { step, sid, platform, exp }
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_oauth_state_expires_at ON oauth_state(expires_at);
