/** Decision Log types (skill-decision-log.md), shared across backend and frontend. */

import type { HypothesisSource } from './hypotheses';
import type { AutonomyAssessment } from './decision-autonomy';
import type { DecisionType } from './decision-autonomy';

export type DecisionMethod = 'synthetic' | 'live' | 'quantitative' | 'market' | 'mixed';
export type DecisionOutcome = 'green' | 'yellow' | 'red';
export type FindingConfidence = 'high' | 'medium' | 'low';

/**
 * ANA-169: workflow status of a decision — the lane it occupies on the Decision Log kanban
 * (по аналогии с канбаном гипотез). Distinct from the validation outcome светофор: the
 * outcome is what the data said, the status is what happens to the decision now.
 */
export const DECISION_STATUSES = ['accepted', 'in_progress', 'deferred', 'rejected'] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export function isDecisionStatus(value: string | null | undefined): value is DecisionStatus {
  return DECISION_STATUSES.some((s) => s === value);
}

export interface DecisionFinding {
  readonly text: string;
  readonly confidence: FindingConfidence;
}

export interface DecisionEvidence {
  readonly quote: string;
  readonly source: string;
  readonly rawResponseId?: number;
}

export interface NewDecision {
  readonly hypothesisId: number;
  readonly date: string;
  /**
   * ANA-169: the decision formulation — «что делаем». Every decision carries one (the UI
   * and the POST API require it; the migration backfills legacy rows from `next_step`).
   */
  readonly decision: string;
  readonly method: DecisionMethod;
  readonly scope: string;
  readonly periodDays: number;
  readonly findings: readonly DecisionFinding[];
  readonly evidence: readonly DecisionEvidence[];
  readonly outcome: DecisionOutcome;
  readonly outcomeRationale: string;
  readonly nextStep: string;
  /**
   * ANA-169: the kanban status. Optional on input — on create it defaults by source
   * (manual → accepted, AI draft → in_progress); absent everywhere it defaults to accepted.
   */
  readonly status?: DecisionStatus;
  readonly responsible?: string;
  readonly nextDeadline?: string;
  readonly previousDecisionId?: number;
  readonly spawnedHypothesisIds?: readonly number[];
  readonly decidedBy: string;
  readonly participants?: string;
  /** True for seeded demo content (ANA-18) — the report renders a «ДЕМО» badge for it. */
  readonly isDemo?: boolean;
  /**
   * ANA-137: autonomy classification of an AI draft (taxonomy + static matrix in
   * @pca/shared). Set only by the ai-autopopulate classifier; manual decisions never
   * carry it and the POST API does not accept it — the type is not editable in MVP.
   */
  readonly decisionType?: DecisionType;
}

export interface Decision extends NewDecision {
  readonly id: number;
  readonly number: string;
  /** ANA-169: the kanban lane of the decision (always resolved — see `isDecisionStatus`). */
  readonly status: DecisionStatus;
  /**
   * ANA-128: provenance — `ai` marks an auto-populated AI proposal (report AI path),
   * `manual` a human-created entry. Absent in legacy rows before migration 019.
   */
  readonly source?: HypothesisSource;
  readonly exportedMdPath?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * ANA-138: one row of GET /api/decisions. AI rows (`source = 'ai'`) additionally carry the
 * autonomy assessment (assessed type, max level, required level, escalation verdict);
 * manual rows carry no `autonomy` block at all.
 */
export interface DecisionListItem extends Decision {
  readonly autonomy?: AutonomyAssessment;
}
