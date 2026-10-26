-- ANA-18: mark seeded demo rows so they never mix with real data unnoticed.
-- The CLI seeder (npm run seed → cli-seed.ts) sets is_demo = 1 on everything it creates;
-- rows created through the API stay 0. The report renders a «ДЕМО» badge for such rows.

ALTER TABLE hypotheses ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE decisions ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;
