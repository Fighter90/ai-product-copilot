-- ANA-37/38: hypotheses workspace. Track where a hypothesis came from (manual / AI import),
-- which provider + model generated it, and the AI-cited numbers missing from the snapshot facts.

ALTER TABLE hypotheses ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'
  CHECK(source IN ('manual','ai'));
ALTER TABLE hypotheses ADD COLUMN ai_provider TEXT;
ALTER TABLE hypotheses ADD COLUMN ai_model TEXT;
ALTER TABLE hypotheses ADD COLUMN unverified_numbers JSON;
