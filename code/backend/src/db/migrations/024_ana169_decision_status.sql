-- ANA-169: decision kanban — every decision gets a formulation («что делаем») and a
-- workflow status (the kanban lane, по аналогии с канбаном гипотез). The status is distinct
-- from the outcome светофор: outcome = what the data said, status = what happens now.
-- Allowed lanes: accepted / in_progress / deferred / rejected.

ALTER TABLE decisions ADD COLUMN decision TEXT;
-- No SQL CHECK on the lane: the POST/PATCH API validates it (zod) and the repo degrades an
-- unknown stored value to «accepted» — the same garbage-tolerance pattern as decision_type.
ALTER TABLE decisions ADD COLUMN status TEXT NOT NULL DEFAULT 'accepted';

-- Backfill the formulation from the stored «что делаем»: next_step is NOT NULL on every
-- legacy row and already carries the actionable formulation — no text is invented here
-- (anti-hallucination: the formulation is derived from stored data only).
UPDATE decisions SET decision = next_step;

-- A manual decision was made by a human → «accepted». An AI draft is a proposal awaiting
-- a human decision → «in_progress» (the lane of items being processed), never auto-accepted.
UPDATE decisions SET status = 'in_progress' WHERE source = 'ai';
