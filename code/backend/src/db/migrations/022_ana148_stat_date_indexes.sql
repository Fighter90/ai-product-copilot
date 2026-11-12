-- ANA-148: GET /api/metrics/utm answered in ~10s on the 1-CPU prod. The derived stat tables
-- only had their composite PKs (date-leading), while the live-wins reads (ANA-142) filter
-- `is_demo = 0` and order by `date` over the whole table. Explicit single-column date indexes
-- keep every date-ranged GET and the ordered scans index-driven as the tables grow.
CREATE INDEX IF NOT EXISTS idx_channel_stats_date ON channel_stats(date);
CREATE INDEX IF NOT EXISTS idx_utm_stats_date ON utm_stats(date);
CREATE INDEX IF NOT EXISTS idx_geo_device_stats_date ON geo_device_stats(date);
CREATE INDEX IF NOT EXISTS idx_page_stats_date ON page_stats(date);
CREATE INDEX IF NOT EXISTS idx_exit_page_stats_date ON exit_page_stats(date);
