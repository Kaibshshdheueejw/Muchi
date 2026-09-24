-- MUCHI — D1 schema, migration 0002: user sync (liked songs, playlists, followed artists).

CREATE TABLE IF NOT EXISTS user_library (
  user_id     TEXT PRIMARY KEY,            -- email or user key
  payload     TEXT NOT NULL,               -- JSON: { liked: [], playlists: [], following: [], prefs: {}, at: number }
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
) WITHOUT ROWID;
