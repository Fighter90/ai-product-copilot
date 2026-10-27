-- ANA-39: author of each report snapshot (user email in cabinet mode, NULL in legacy mode).
-- Lets the History page filter snapshots by who built them.
ALTER TABLE report_snapshots ADD COLUMN created_by TEXT;
