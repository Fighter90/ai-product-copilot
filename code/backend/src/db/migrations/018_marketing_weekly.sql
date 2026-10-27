-- ANA-73: weekly marketing / influence-partner metrics — dashboard replacement for the
-- Google Sheet «Инфопартнеры ProductCamp | лето 2026» (лист «стата»). One value per
-- (week_start, metric_key). `source` records who produced the value:
--   manual  — entered by an admin/analyst in the UI; the sync never overwrites it
--   import  — bulk-loaded from the historical Google Sheet (real campaign data)
--   metrika — computed by the weekly sync from synced Metrika tables / DB entries
CREATE TABLE marketing_weekly (
  week_start TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  value REAL NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'metrika', 'import')),
  note TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  PRIMARY KEY (week_start, metric_key)
);
