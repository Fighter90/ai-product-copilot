/**
 * ANA-137: the decision-autonomy model — «decision type × maximum AI autonomy».
 * A static contract in code (not in the DB): a taxonomy of 8 decision types, 3 autonomy
 * levels, the type→max-level matrix and deterministic PM-escalation rules. Pure data and
 * pure functions only — no IO, no LLM, no clock, so assessments are reproducible and the
 * report render path stays untouched.
 */

import type { HypothesisSource } from './hypotheses';

/** Taxonomy of AI decisions (spec `decision-autonomy`): exactly these 8 values. */
export const DECISION_TYPES = [
  'data-analysis',
  'hypothesis-draft',
  'experiment-launch',
  'pricing',
  'budget',
  'public-comms',
  'strategic',
  'legal',
] as const;

export type DecisionType = (typeof DECISION_TYPES)[number];

/**
 * AI autonomy levels:
 * - `A0` — AI only proposes, a PM decides (confirmation before any application);
 * - `A1` — AI acts by template, PM reviews post-factum (the ANA-128 draft behaviour);
 * - `A2` — AI acts autonomously within limits — modelled in MVP, never executed.
 */
export type AutonomyLevel = 'A0' | 'A1' | 'A2';

/** All levels in ascending autonomy order (display order + rank source of truth). */
export const AUTONOMY_LEVELS = ['A0', 'A1', 'A2'] as const satisfies readonly AutonomyLevel[];

/** Rank of each level in ascending autonomy order (A0 < A1 < A2) for comparisons. */
export const AUTONOMY_LEVEL_RANK: Readonly<Record<AutonomyLevel, number>> = {
  A0: 0,
  A1: 1,
  A2: 2,
};

/**
 * Machine-readable escalation reason codes. The API returns the raw code; the UI maps it
 * to localized text (ru and en).
 */
export type AutonomyEscalationReason = 'autonomy-exceeded' | 'unclassified-type';

export interface AutonomyMatrixEntry {
  /** Maximum autonomy level this decision type may ever reach. */
  readonly maxAutonomy: AutonomyLevel;
  /** Human-readable type label (code-level RU default; the UI may localize it). */
  readonly label: string;
}

/**
 * Static matrix «decision type → maximum AI autonomy» (MVP): `data-analysis` is reversible
 * (A2), `hypothesis-draft` codifies the ANA-128 draft behaviour (A1); everything else —
 * including `legal`, which is never delegated to AI — stays at A0 (AI proposes, PM decides).
 */
export const AUTONOMY_MATRIX: Readonly<Record<DecisionType, AutonomyMatrixEntry>> = {
  'data-analysis': { maxAutonomy: 'A2', label: 'Анализ данных' },
  'hypothesis-draft': { maxAutonomy: 'A1', label: 'Черновик гипотезы' },
  'experiment-launch': { maxAutonomy: 'A0', label: 'Запуск эксперимента' },
  pricing: { maxAutonomy: 'A0', label: 'Ценообразование' },
  budget: { maxAutonomy: 'A0', label: 'Бюджет' },
  'public-comms': { maxAutonomy: 'A0', label: 'Публичные коммуникации' },
  strategic: { maxAutonomy: 'A0', label: 'Стратегия' },
  legal: { maxAutonomy: 'A0', label: 'Юридическое решение' },
};

/** Human-readable level labels (code-level RU default; the UI may localize them). */
export const AUTONOMY_LEVEL_LABELS: Readonly<Record<AutonomyLevel, string>> = {
  A0: 'ИИ только предлагает — решает PM',
  A1: 'ИИ действует по шаблону — PM ревьюит постфактум',
  A2: 'ИИ автономно в лимитах (в MVP не исполняется)',
};

/**
 * The autonomy level every AI decision actually runs at in MVP: AI writes drafts, PM
 * reviews post-factum (the ANA-128 behaviour). The model does not derive a per-decision
 * required level from the content yet.
 */
export const REQUIRED_AUTONOMY: AutonomyLevel = 'A1';

export interface AutonomyEscalation {
  /** True when the proposed level exceeds what the type allows (or the type is missing). */
  readonly required: boolean;
  /** Machine-readable reason code; null when no escalation is required. */
  readonly reason: AutonomyEscalationReason | null;
}

/**
 * PM-escalation verdict for a proposed autonomy level against a decision type. A missing
 * type (`null`) is read conservatively as `strategic` (max `A0`) — any proposed level above
 * that escalates with reason `unclassified-type`. A classified type whose maximum is below
 * the proposed level escalates with `autonomy-exceeded`.
 */
export function needsEscalation(
  type: DecisionType | null,
  proposedLevel: AutonomyLevel,
): AutonomyEscalation {
  if (type === null) {
    const required =
      AUTONOMY_LEVEL_RANK[proposedLevel] >
      AUTONOMY_LEVEL_RANK[AUTONOMY_MATRIX.strategic.maxAutonomy];
    return { required, reason: required ? 'unclassified-type' : null };
  }
  const required =
    AUTONOMY_LEVEL_RANK[proposedLevel] > AUTONOMY_LEVEL_RANK[AUTONOMY_MATRIX[type].maxAutonomy];
  return { required, reason: required ? 'autonomy-exceeded' : null };
}

/** Full autonomy assessment attached to an AI decision by the API. */
export interface AutonomyAssessment {
  /** The assessed type: the stored one, or `strategic` when the stored type is missing. */
  readonly type: DecisionType;
  /** True when the stored type was missing and `strategic` was applied conservatively. */
  readonly unclassified: boolean;
  /** Maximum autonomy allowed for the assessed type. */
  readonly maxAutonomy: AutonomyLevel;
  /** The level the AI decision actually runs at (MVP constant `A1`). */
  readonly required: AutonomyLevel;
  /** PM-escalation verdict + machine-readable reason code. */
  readonly escalation: AutonomyEscalation;
}

/**
 * Assess one decision's autonomy from its provenance and stored type. Manual decisions are
 * human-made — they are not assessed (null); AI decisions get the full deterministic
 * verdict: type (conservative `strategic` reading when missing), the type's maximum, the
 * constant required level and the escalation with its reason code.
 */
export function assessDecisionAutonomy(input: {
  readonly source: HypothesisSource;
  readonly decisionType?: DecisionType | null;
}): AutonomyAssessment | null {
  if (input.source !== 'ai') return null;
  const unclassified = input.decisionType == null;
  const type: DecisionType = unclassified ? 'strategic' : input.decisionType;
  const maxAutonomy = AUTONOMY_MATRIX[type].maxAutonomy;
  return {
    type,
    unclassified,
    maxAutonomy,
    required: REQUIRED_AUTONOMY,
    escalation: needsEscalation(unclassified ? null : type, REQUIRED_AUTONOMY),
  };
}

/** Type guard for a stored `decision_type` value (legacy/garbage rows map to undefined). */
export function isDecisionType(value: string | null | undefined): value is DecisionType {
  return DECISION_TYPES.some((t) => t === value);
}
