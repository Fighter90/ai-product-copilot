-- ANA-147: purge the UNMARKED pre-launch era so KPI/coverage shows the honest window.
-- The one-off 365-day Metrika backfill (progress.md: 2025-04-29..2026-11-03) went through the
-- normal sync path, so its rows carry is_demo = 0 — ANA-142's live-wins reads treat the era as
-- real data and coverage stretches to «563 дн. (с 2025-04-29)» while the ProductCamp counter
-- only lives from 2026-11-06 (the honest KPI base, see CHANGELOG v3.4.16 / ANA-142).
-- Real Metrika responses have real dimension values, so fingerprints (like 015) cannot match
-- them — the date boundary is the only honest predicate: before the counter's first real day
-- EVERY derived stat row is noise, regardless of the demo mark. After the purge the existing
-- ANA-142 read paths and statsCoverage() report the window from 2026-11-06 on their own.
--
-- Kept on purpose: user-entered tables (b2b_manual, b2c_payments, marketing_weekly), the goals
-- catalog (no dates, real counter goals) and raw_responses — the anti-hallucination audit
-- trail of the purged era stays traceable.

DELETE FROM channel_stats WHERE date < '2026-11-06';
DELETE FROM utm_stats WHERE date < '2026-11-06';
DELETE FROM geo_device_stats WHERE date < '2026-11-06';
DELETE FROM page_stats WHERE date < '2026-11-06';
DELETE FROM exit_page_stats WHERE date < '2026-11-06';
