-- kommutator hub schema (DESIGN.md §11). SQLite, WAL mode.
-- Applied only to an empty database; db.ts stamps PRAGMA user_version = SCHEMA_VERSION after
-- this file runs and refuses databases with any other version (no migrations before M1).

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS hosts (
  name            TEXT PRIMARY KEY,
  agentd_version  TEXT,
  last_seen_at    TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id                TEXT PRIMARY KEY,
  host              TEXT NOT NULL REFERENCES hosts(name),
  handle            TEXT NOT NULL,           -- "<name>@<host>"
  name              TEXT NOT NULL,
  requested_name    TEXT,                    -- requested base, retained across collision suffixes and retries
  role              TEXT,
  vendor            TEXT NOT NULL,
  vendor_session_id TEXT,
  cwd               TEXT,
  project_key       TEXT,
  state             TEXT NOT NULL DEFAULT 'active',   -- active|idle|gone|unknown
  status_line       TEXT,
  incarnation       INTEGER NOT NULL DEFAULT 0,
  wake              TEXT NOT NULL DEFAULT 'on',       -- on|off
  capability        TEXT NOT NULL DEFAULT 'none',     -- native|hook|none
  reg_id            TEXT NOT NULL UNIQUE,             -- current registration; historical results live in session_registrations
  next_seq          INTEGER NOT NULL DEFAULT 1,       -- per-recipient delivery counter; survives prune
  started_at        TEXT NOT NULL,
  last_seen_at      TEXT NOT NULL,
  ended_at          TEXT
);
-- One live session per handle: a registration whose name is taken on the same host gets
-- a "-<n>" suffix from the hub (DESIGN.md §3).
CREATE UNIQUE INDEX IF NOT EXISTS sessions_handle_live ON sessions(handle) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS sessions_project ON sessions(project_key) WHERE ended_at IS NULL;

-- Retain every registration/reincarnation result, even after a later update or reincarnation.
CREATE TABLE IF NOT EXISTS session_registrations (
  reg_id       TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES sessions(id),
  op           TEXT NOT NULL CHECK (op IN ('register', 'reincarnate')),
  session_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS topics (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,            -- global | project:<key> | <adhoc>
  kind        TEXT NOT NULL,                   -- global|project|adhoc
  project_key TEXT
);

CREATE TABLE IF NOT EXISTS memberships (
  session_id TEXT NOT NULL REFERENCES sessions(id),
  topic_id   INTEGER NOT NULL REFERENCES topics(id),
  PRIMARY KEY (session_id, topic_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,       -- agentd-chosen; a repeat returns the existing row
  from_session    TEXT NOT NULL,              -- session id
  from_handle     TEXT NOT NULL DEFAULT '',   -- immutable author display at send time
  kind            TEXT NOT NULL,              -- dm|topic|broadcast|request
  priority        TEXT NOT NULL DEFAULT 'normal', -- normal|fyi
  subject         TEXT,
  body            TEXT NOT NULL,
  thread_id       TEXT NOT NULL,
  reply_to        TEXT,
  hops            INTEGER NOT NULL DEFAULT 0,
  origin          TEXT NOT NULL DEFAULT 'agent',  -- agent|human
  force_wake      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_thread ON messages(thread_id, created_at);

CREATE TABLE IF NOT EXISTS message_targets (
  message_id  TEXT NOT NULL REFERENCES messages(id),
  target_type TEXT NOT NULL,                   -- session|role|topic|all
  target_id   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deliveries (
  message_id TEXT NOT NULL REFERENCES messages(id),
  session_id TEXT NOT NULL REFERENCES sessions(id),
  seq        INTEGER NOT NULL,                 -- from sessions.next_seq, assigned in the same transaction
  state      TEXT NOT NULL DEFAULT 'unread',   -- unread|read  ("marked read", DESIGN.md §5)
  wake       INTEGER NOT NULL DEFAULT 0,       -- the hub's wake-rule decision at send time; Stop-time poll filters on it
  updated_at TEXT NOT NULL,
  PRIMARY KEY (message_id, session_id),
  UNIQUE (session_id, seq)
);

CREATE TABLE IF NOT EXISTS board_entries (
  topic_id   INTEGER NOT NULL REFERENCES topics(id),
  key        TEXT NOT NULL,
  body       TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  author     TEXT NOT NULL,                    -- handle, derived from the calling session
  protected  INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (topic_id, key)
);

CREATE TABLE IF NOT EXISTS board_versions (
  topic_id   INTEGER NOT NULL,
  key        TEXT NOT NULL,
  version    INTEGER NOT NULL,
  body       TEXT NOT NULL,
  author     TEXT NOT NULL,
  author_session TEXT REFERENCES sessions(id), -- immutable replay owner; populated by board.put
  protected  INTEGER NOT NULL DEFAULT 0,
  op_id      TEXT NOT NULL UNIQUE,            -- agentd-chosen; a replayed board.put finds its own version here
  created_at TEXT NOT NULL,
  PRIMARY KEY (topic_id, key, version)
);

INSERT OR IGNORE INTO topics (name, kind) VALUES ('global', 'global');
