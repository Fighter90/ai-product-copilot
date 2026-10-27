-- ANA-18: demo rows must never mix with live data.
-- 1) Every Metrika-derived table gets an is_demo mark (011 covered hypotheses/decisions only).
-- 2) Old seed rows (written before the marks, on the fixed dates 2025-01-01..05 with the
--    known seed fingerprints) are purged from live databases. The deletes below match ONLY the
--    known demo fingerprints — company names, seed goal ids+names, the fixed date window AND the
--    seed dimension values — so real Metrika rows can never be removed by this migration.

ALTER TABLE goals ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE channel_stats ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE utm_stats ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE geo_device_stats ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE page_stats ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE exit_page_stats ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE b2b_manual ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;

-- Demo hypotheses/decisions are already marked (011) — drop them first (decisions reference
-- hypotheses), then the unmarked legacy seed rows by their known fingerprints.
DELETE FROM decisions WHERE is_demo = 1;
DELETE FROM hypotheses WHERE is_demo = 1;

DELETE FROM b2b_manual
WHERE company IN ('BigCorp', 'MidMarket', 'StartupZ', 'LeadCo');

DELETE FROM goals
WHERE id IN (12, 80, 81)
  AND name IN ('Заявка на билет', 'Оплата', 'Старая цель');

DELETE FROM channel_stats
WHERE date BETWEEN '2025-01-01' AND '2025-01-05'
  AND channel IN ('podcast', 'direct', 'social', 'referral');

DELETE FROM utm_stats
WHERE date BETWEEN '2025-01-01' AND '2025-01-05'
  AND utm_source IN ('vk', 'telegram', 'email', '(none)');

DELETE FROM geo_device_stats
WHERE date BETWEEN '2025-01-01' AND '2025-01-05'
  AND country IN ('Россия', 'Казахстан', 'Беларусь');

DELETE FROM page_stats
WHERE date BETWEEN '2025-01-01' AND '2025-01-05'
  AND page IN ('/', '/tickets', '/program', '/checkout');

DELETE FROM exit_page_stats
WHERE date BETWEEN '2025-01-01' AND '2025-01-05'
  AND page IN ('/', '/tickets', '/checkout');
