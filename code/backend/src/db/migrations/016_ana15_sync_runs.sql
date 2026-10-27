-- ANA-15: sync errors must be visible in the UI, not only in the console.
-- One row per sync run; the route (POST /api/sync) records the outcome and GET /api/sync/status
-- returns the latest run. `status`: running → ok (every step succeeded) / partial (optional steps
-- failed) / failed (the sync aborted). `summary`/`errors` are JSON (SyncSummary / SyncStepError[]).
CREATE TABLE sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  date_from TEXT NOT NULL,
  date_to TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'partial', 'failed')),
  summary TEXT,
  errors TEXT
);

CREATE INDEX idx_sync_runs_started ON sync_runs (started_at DESC);
