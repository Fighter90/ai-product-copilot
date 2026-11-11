-- ANA-137: decision autonomy model — the AI-decision type feeding the static autonomy
-- matrix (@pca/shared AUTONOMY_MATRIX). Nullable: an unclassifiable AI text stays NULL
-- and is assessed conservatively as `strategic` (max A0, reason 'unclassified-type').

ALTER TABLE decisions ADD COLUMN decision_type TEXT NULL;

-- Backfill legacy AI rows: every AI decision created before this migration came from
-- ai-autopopulate (ANA-128) as a hypothesis-verification draft, so its type is known from
-- provenance — without the backfill each legacy row would turn into a «requires PM
-- escalation» badge wave on deploy. After this, NULL is allowed only for unclassifiable
-- AI rows (and manual rows, which are never assessed).
UPDATE decisions SET decision_type = 'hypothesis-draft'
WHERE source = 'ai' AND decision_type IS NULL;
