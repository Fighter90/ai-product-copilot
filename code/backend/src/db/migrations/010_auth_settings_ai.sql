-- v3.0.0 — users & roles, sessions, audit log, encrypted runtime settings, AI providers,
-- DataLens webhook events, assistant usage. See openspec/changes/v3-cabinet.

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT    NOT NULL,
  role          TEXT    NOT NULL CHECK (role IN ('admin', 'analyst')),
  password_hash TEXT    NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1,
  locale        TEXT    NOT NULL DEFAULT 'ru',
  created_at    TEXT    NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT    NOT NULL,
  expires_at  TEXT    NOT NULL,
  ip          TEXT,
  user_agent  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT    NOT NULL,
  user_id    INTEGER,
  user_email TEXT,
  action     TEXT    NOT NULL,
  target     TEXT,
  details    TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);

-- Runtime settings editable by an admin (override .env without a restart).
-- Secrets are stored AES-256-GCM encrypted (value column holds iv:tag:ciphertext, base64).
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT    NOT NULL,
  is_secret  INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT    NOT NULL,
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS ai_providers (
  id          TEXT PRIMARY KEY CHECK (id IN ('openrouter', 'anthropic', 'yandexgpt', 'gigachat')),
  enabled     INTEGER NOT NULL DEFAULT 0,
  priority    INTEGER NOT NULL DEFAULT 100,
  model       TEXT    NOT NULL DEFAULT '',
  secret_enc  TEXT,
  extra_json  TEXT    NOT NULL DEFAULT '{}',
  updated_at  TEXT    NOT NULL,
  updated_by  TEXT,
  last_test_at TEXT,
  last_test_ok INTEGER,
  last_test_message TEXT
);

CREATE TABLE IF NOT EXISTS ai_usage (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT    NOT NULL,
  provider    TEXT    NOT NULL,
  model       TEXT    NOT NULL,
  purpose     TEXT    NOT NULL,
  user_email  TEXT,
  ok          INTEGER NOT NULL,
  input_chars INTEGER NOT NULL DEFAULT 0,
  output_chars INTEGER NOT NULL DEFAULT 0,
  ms          INTEGER NOT NULL DEFAULT 0,
  error       TEXT
);

CREATE TABLE IF NOT EXISTS datalens_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at TEXT NOT NULL,
  kind        TEXT NOT NULL,
  code        TEXT,
  payload     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT    NOT NULL,
  audience   TEXT    NOT NULL CHECK (audience IN ('admin', 'all')),
  kind       TEXT    NOT NULL,
  title      TEXT    NOT NULL,
  body       TEXT,
  read_by    TEXT    NOT NULL DEFAULT '[]'
);
