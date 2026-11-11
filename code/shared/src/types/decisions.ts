/** Decision Log types (skill-decision-log.md), shared across backend and frontend. */

import type { HypothesisSource } from './hypotheses';

export type DecisionMethod = 'synthetic' | 'live' | 'quantitative' | 'market' | 'mixed';
export type DecisionOutcome = 'green' | 'yellow' | 'red';
export type FindingConfidence = 'high' | 'medium' | 'low';

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
  readonly method: DecisionMethod;
  readonly scope: string;
  readonly periodDays: number;
  readonly findings: readonly DecisionFinding[];
  readonly evidence: readonly DecisionEvidence[];
  readonly outcome: DecisionOutcome;
  readonly outcomeRationale: string;
  readonly nextStep: string;
  readonly responsible?: string;
  readonly nextDeadline?: string;
  readonly previousDecisionId?: number;
  readonly spawnedHypothesisIds?: readonly number[];
  readonly decidedBy: string;
  readonly participants?: string;
  /** True for seeded demo content (ANA-18) — the report renders a «ДЕМО» badge for it. */
  readonly isDemo?: boolean;
}

export interface Decision extends NewDecision {
  readonly id: number;
  readonly number: string;
  /**
   * ANA-128: provenance — `ai` marks an auto-populated AI proposal (report AI path),
   * `manual` a human-created entry. Absent in legacy rows before migration 019.
   */
  readonly source?: HypothesisSource;
  readonly exportedMdPath?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
