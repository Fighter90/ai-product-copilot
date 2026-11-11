-- ANA-128: track where a Decision Log entry came from (manual / AI auto-population draft).
-- AI drafts are created by the report AI path (ai-autopopulate) and never flip the linked
-- hypothesis status — taking a proposal into work stays a human decision.

ALTER TABLE decisions ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'
  CHECK(source IN ('manual','ai'));
