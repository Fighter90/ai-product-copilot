-- ANA-153: zero-protection audit. The counter's statistics were RESET (~2026-11-06) while the
-- real history was restored into SQLite from raw_responses (ANA-150). When the sync skips a
-- zero-visits row because the stored row for the same natural key still carries real visits,
-- the defended DATE is recorded here — append-only, INSERT OR IGNORE (a date is protected once,
-- however many rows of it were skipped). GET /api/metrics/coverage reports COUNT(*) as
-- protectedDays so the FilterBar can say «N дней защищены от перезаписи».
CREATE TABLE protected_days (
  date TEXT PRIMARY KEY
);
