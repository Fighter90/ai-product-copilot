import type { DB } from '../connection';
import {
  validateHypothesis,
  type Hypothesis,
  type HypothesisSource,
  type HypothesisStatus,
  type HypothesisValidationMode,
  type NewHypothesis,
} from '@pca/shared';

/** Thrown when a hypothesis fails the completeness check at the repo boundary. */
export class HypothesisValidationError extends Error {
  constructor(public readonly errors: readonly string[]) {
    super(`Invalid hypothesis: ${errors.join('; ')}`);
    this.name = 'HypothesisValidationError';
  }
}

interface HypRow {
  id: number;
  diamond_phase: Hypothesis['diamondPhase'];
  kind: Hypothesis['kind'];
  subject: string;
  action: string;
  solution: string;
  condition: string;
  title: string;
  description: string | null;
  parent_id: number | null;
  hidden_assumptions: string;
  validation_methods: string;
  impact: number;
  confidence: number;
  ease: number;
  impact_rationale: string;
  confidence_rationale: string;
  ease_rationale: string;
  ice_score: number;
  green_criteria: string;
  yellow_criteria: string;
  red_criteria: string;
  deadline_days: number;
  deadline_at: string;
  evidence: string | null;
  status: HypothesisStatus;
  is_demo: number;
  source: HypothesisSource | null;
  ai_provider: string | null;
  ai_model: string | null;
  unverified_numbers: string | null;
  created_at: string;
  updated_at: string;
}

function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();
}

function toHypothesis(r: HypRow): Hypothesis {
  return {
    id: r.id,
    diamondPhase: r.diamond_phase,
    kind: r.kind,
    subject: r.subject,
    action: r.action,
    solution: r.solution,
    condition: r.condition,
    title: r.title,
    description: r.description ?? undefined,
    parentId: r.parent_id ?? undefined,
    hiddenAssumptions: JSON.parse(r.hidden_assumptions),
    validationMethods: JSON.parse(r.validation_methods),
    impact: r.impact,
    confidence: r.confidence,
    ease: r.ease,
    impactRationale: r.impact_rationale,
    confidenceRationale: r.confidence_rationale,
    easeRationale: r.ease_rationale,
    iceScore: r.ice_score,
    greenCriteria: r.green_criteria,
    yellowCriteria: r.yellow_criteria,
    redCriteria: r.red_criteria,
    deadlineDays: r.deadline_days,
    deadlineAt: r.deadline_at,
    evidence: r.evidence ? JSON.parse(r.evidence) : undefined,
    status: r.status,
    isDemo: r.is_demo ? true : undefined,
    source: r.source ?? 'manual',
    aiProvider: r.ai_provider ?? undefined,
    aiModel: r.ai_model ?? undefined,
    unverifiedNumbers: r.unverified_numbers ? JSON.parse(r.unverified_numbers) : undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Column values shared by INSERT and UPDATE (everything except id/status/timestamps). */
function contentParams(input: NewHypothesis, createdAt: string): Record<string, unknown> {
  return {
    diamond_phase: input.diamondPhase,
    kind: input.kind,
    subject: input.subject,
    action: input.action,
    solution: input.solution,
    condition: input.condition,
    title: input.title,
    description: input.description ?? null,
    parent_id: input.parentId ?? null,
    hidden_assumptions: JSON.stringify(input.hiddenAssumptions),
    validation_methods: JSON.stringify(input.validationMethods),
    impact: input.impact,
    confidence: input.confidence,
    ease: input.ease,
    impact_rationale: input.impactRationale,
    confidence_rationale: input.confidenceRationale,
    ease_rationale: input.easeRationale,
    green_criteria: input.greenCriteria,
    yellow_criteria: input.yellowCriteria,
    red_criteria: input.redCriteria,
    deadline_days: input.deadlineDays,
    deadline_at: addDays(createdAt, input.deadlineDays),
    evidence: input.evidence ? JSON.stringify(input.evidence) : null,
    source: input.source === 'ai' ? 'ai' : 'manual',
    ai_provider: input.aiProvider ?? null,
    ai_model: input.aiModel ?? null,
    unverified_numbers: input.unverifiedNumbers ? JSON.stringify(input.unverifiedNumbers) : null,
  };
}

/** Thrown when deleting a hypothesis that Decision Log entries still reference. */
export class HypothesisInUseError extends Error {
  constructor(public readonly decisions: number) {
    super(`Hypothesis is referenced by ${decisions} decision(s)`);
    this.name = 'HypothesisInUseError';
  }
}

export class HypothesesRepo {
  constructor(private readonly db: DB) {}

  /**
   * Persists a hypothesis. ANA-129: the default mode is 'draft' — a light draft needs only a
   * title (plus data sanity); callers that require the complete format pass { mode: 'work' }.
   */
  create(input: NewHypothesis, opts: { mode?: HypothesisValidationMode } = {}): Hypothesis {
    const result = validateHypothesis(input, { mode: opts.mode ?? 'draft' });
    if (!result.ok) throw new HypothesisValidationError(result.errors);

    const now = new Date().toISOString();
    const row = this.db
      .prepare(
        `INSERT INTO hypotheses (
           diamond_phase, kind, subject, action, solution, condition, title, description,
           parent_id, hidden_assumptions, validation_methods,
           impact, confidence, ease, impact_rationale, confidence_rationale, ease_rationale,
           green_criteria, yellow_criteria, red_criteria,
           deadline_days, deadline_at, evidence, is_demo,
           source, ai_provider, ai_model, unverified_numbers,
           status, created_at, updated_at
         ) VALUES (
           @diamond_phase, @kind, @subject, @action, @solution, @condition, @title, @description,
           @parent_id, @hidden_assumptions, @validation_methods,
           @impact, @confidence, @ease, @impact_rationale, @confidence_rationale, @ease_rationale,
           @green_criteria, @yellow_criteria, @red_criteria,
           @deadline_days, @deadline_at, @evidence, @is_demo,
           @source, @ai_provider, @ai_model, @unverified_numbers,
           'draft', @created_at, @updated_at
         ) RETURNING *`,
      )
      .get({
        ...contentParams(input, now),
        is_demo: input.isDemo ? 1 : 0,
        created_at: now,
        updated_at: now,
      }) as HypRow;
    return toHypothesis(row);
  }

  /**
   * Replaces the editable content of a hypothesis (status, demo mark and creation time are kept;
   * the deadline is recomputed from the creation time). ANA-129: a draft is edited under the
   * light rules, a work-status hypothesis keeps the complete format.
   */
  update(id: number, input: NewHypothesis): Hypothesis | undefined {
    const existing = this.getById(id);
    if (!existing) return undefined;
    const result = validateHypothesis(input, {
      mode: existing.status === 'draft' ? 'draft' : 'work',
    });
    if (!result.ok) throw new HypothesisValidationError(result.errors);
    if (input.parentId === id) {
      throw new HypothesisValidationError(['parentId must not reference the hypothesis itself']);
    }
    const row = this.db
      .prepare(
        `UPDATE hypotheses SET
           diamond_phase = @diamond_phase, kind = @kind, subject = @subject, action = @action,
           solution = @solution, condition = @condition, title = @title,
           description = @description, parent_id = @parent_id,
           hidden_assumptions = @hidden_assumptions, validation_methods = @validation_methods,
           impact = @impact, confidence = @confidence, ease = @ease,
           impact_rationale = @impact_rationale, confidence_rationale = @confidence_rationale,
           ease_rationale = @ease_rationale, green_criteria = @green_criteria,
           yellow_criteria = @yellow_criteria, red_criteria = @red_criteria,
           deadline_days = @deadline_days, deadline_at = @deadline_at, evidence = @evidence,
           source = @source, ai_provider = @ai_provider, ai_model = @ai_model,
           unverified_numbers = @unverified_numbers, updated_at = @updated_at
         WHERE id = @id RETURNING *`,
      )
      .get({
        ...contentParams(
          {
            ...input,
            // Provenance survives edits: an AI-imported hypothesis stays labelled as AI.
            source: input.source ?? existing.source,
            aiProvider: input.aiProvider ?? existing.aiProvider,
            aiModel: input.aiModel ?? existing.aiModel,
            unverifiedNumbers: input.unverifiedNumbers ?? existing.unverifiedNumbers,
          },
          existing.createdAt,
        ),
        id,
        updated_at: new Date().toISOString(),
      }) as HypRow;
    return toHypothesis(row);
  }

  /**
   * Deletes a hypothesis. Child hypotheses are detached (parent_id → NULL). Refuses (throws
   * HypothesisInUseError) when Decision Log entries reference it — the log must stay intact.
   * Returns false when the id does not exist.
   */
  delete(id: number): boolean {
    const { c } = this.db
      .prepare('SELECT COUNT(*) AS c FROM decisions WHERE hypothesis_id = ?')
      .get(id) as { c: number };
    if (c > 0) throw new HypothesisInUseError(c);
    return this.db.transaction((hid: number): boolean => {
      this.db.prepare('UPDATE hypotheses SET parent_id = NULL WHERE parent_id = ?').run(hid);
      return this.db.prepare('DELETE FROM hypotheses WHERE id = ?').run(hid).changes > 0;
    })(id);
  }

  getById(id: number): Hypothesis | undefined {
    const r = this.db.prepare('SELECT * FROM hypotheses WHERE id = ?').get(id) as
      HypRow | undefined;
    return r ? toHypothesis(r) : undefined;
  }

  /** All hypotheses, highest ICE first (the default dashboard ordering). */
  list(): Hypothesis[] {
    return (
      this.db.prepare('SELECT * FROM hypotheses ORDER BY ice_score DESC, id').all() as HypRow[]
    ).map(toHypothesis);
  }

  /**
   * ANA-129 two-status gate: moving a hypothesis out of 'draft' (взятие в работу) requires the
   * complete format of the stored content — an incomplete draft is rejected and stays a draft.
   * Moving back to 'draft' is always allowed. Returns undefined for a missing id.
   */
  updateStatus(id: number, status: HypothesisStatus): Hypothesis | undefined {
    if (status !== 'draft') {
      const current = this.getById(id);
      if (!current) return undefined;
      const result = validateHypothesis(current, { mode: 'work' });
      if (!result.ok) throw new HypothesisValidationError(result.errors);
    }
    const r = this.db
      .prepare('UPDATE hypotheses SET status = @status, updated_at = @u WHERE id = @id RETURNING *')
      .get({ id, status, u: new Date().toISOString() }) as HypRow | undefined;
    return r ? toHypothesis(r) : undefined;
  }
}
