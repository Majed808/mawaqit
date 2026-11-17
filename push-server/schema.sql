CREATE TABLE IF NOT EXISTS subs (
  id TEXT PRIMARY KEY,          -- sha256(endpoint)
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'en',
  synced_at INTEGER NOT NULL,
  horizon INTEGER NOT NULL,     -- time of the last scheduled alert
  nudged INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS events (
  sub_id TEXT NOT NULL,
  tag TEXT NOT NULL,            -- e.g. 2026-11-17:dhuhr:after (dedupe key)
  at INTEGER NOT NULL,          -- epoch ms
  payload TEXT NOT NULL,        -- {"title","body","tag","at"}
  PRIMARY KEY (sub_id, tag)
);
CREATE INDEX IF NOT EXISTS events_at ON events (at);
CREATE INDEX IF NOT EXISTS subs_horizon ON subs (nudged, horizon);
