-- ANA-29: analyst access to Metrika counters. Admins always have access; an analyst may read
-- counter data (metrics / live / report / DataLens) only for counters listed here.

CREATE TABLE IF NOT EXISTS user_counters (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  counter_id INTEGER NOT NULL CHECK (counter_id > 0),
  granted_at TEXT    NOT NULL,
  granted_by TEXT,
  PRIMARY KEY (user_id, counter_id)
);
CREATE INDEX IF NOT EXISTS idx_user_counters_counter ON user_counters(counter_id);

-- Upgrade path: analysts that exist when this ships keep access to the configured counter.
-- COUNTER_ID may live only in .env (not in app_settings), so SQL cannot resolve it here — the
-- grant is applied by UserCountersRepo.applyLegacyGrant() on first use while this marker exists.
CREATE TABLE IF NOT EXISTS user_counters_legacy_grant (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  created_at TEXT    NOT NULL
);
INSERT OR IGNORE INTO user_counters_legacy_grant (id, created_at)
  VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
