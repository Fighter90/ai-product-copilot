/**
 * ANA-157: the hypothesis-autonomy model — the same «autonomy level × allowed statuses»
 * contract as the decision matrix (ANA-137), applied to hypothesis statuses. AI hypotheses
 * run at the constant REQUIRED_AUTONOMY (A1): the AI may draft (draft) and take its draft
 * into verification (in_progress, «В проверке»), but the verification verdicts (green /
 * yellow / red, «Подтверждена / Частично / Отклонена») and «Просрочена» belong to the PM —
 * an attempt above the level's maximum is refused and escalates. Manual hypotheses are
 * human-made and unrestricted. Pure data and pure functions only — no IO, no LLM, no clock,
 * so the report render path stays untouched.
 */

import {
  REQUIRED_AUTONOMY,
  type AutonomyEscalation,
  type AutonomyLevel,
} from './decision-autonomy';
import type { HypothesisSource, HypothesisStatus } from './hypotheses';

/** All hypothesis statuses in display order (the option list the UI renders). */
export const HYPOTHESIS_STATUSES = [
  'draft',
  'in_progress',
  'green',
  'yellow',
  'red',
  'expired',
] as const satisfies readonly HypothesisStatus[];

/**
 * Status rank by escalation weight: a draft ranks below «В проверке», and the PM verdicts
 * (green/yellow/red are the светофор outcomes — equal weight, all above A1) plus the
 * mechanical «Просрочена» rank highest.
 */
export const HYPOTHESIS_STATUS_RANK: Readonly<Record<HypothesisStatus, number>> = {
  draft: 0,
  in_progress: 1,
  green: 2,
  yellow: 2,
  red: 2,
  expired: 2,
};

/**
 * The maximum status each autonomy level may set: A0 drafts only (AI proposes, PM decides),
 * A1 up to «В проверке» (the ANA-128/ANA-38 draft behaviour), A2 every status — modelled in
 * MVP, never executed (the same convention as the decision matrix).
 */
export const HYPOTHESIS_AUTONOMY_MAX_STATUS: Readonly<Record<AutonomyLevel, HypothesisStatus>> = {
  A0: 'draft',
  A1: 'in_progress',
  A2: 'expired',
};

/** Statuses a level may set: rank ≤ the level's maximum, in display order. */
export function hypothesisStatusesAllowedAt(level: AutonomyLevel): readonly HypothesisStatus[] {
  const maxRank = HYPOTHESIS_STATUS_RANK[HYPOTHESIS_AUTONOMY_MAX_STATUS[level]];
  return HYPOTHESIS_STATUSES.filter((s) => HYPOTHESIS_STATUS_RANK[s] <= maxRank);
}

/**
 * The PM verification verdicts (the светофор outcomes). Once an AI hypothesis carries one,
 * changing it — including clearing it back to a draft — is itself a PM decision (ANA-157
 * review round 3). «Просрочена» is mechanical (deadline-derived) and is not a verdict.
 */
export const HYPOTHESIS_VERDICT_STATUSES: readonly HypothesisStatus[] = ['green', 'yellow', 'red'];

/**
 * PM-escalation verdict for a proposed status against an autonomy level (defaults to the
 * level AI hypotheses actually run at). A status above the level's maximum escalates with
 * the shared machine-readable reason code `autonomy-exceeded`.
 */
export function hypothesisStatusEscalation(
  proposed: HypothesisStatus,
  level: AutonomyLevel = REQUIRED_AUTONOMY,
): AutonomyEscalation {
  const required =
    HYPOTHESIS_STATUS_RANK[proposed] >
    HYPOTHESIS_STATUS_RANK[HYPOTHESIS_AUTONOMY_MAX_STATUS[level]];
  return { required, reason: required ? 'autonomy-exceeded' : null };
}

/**
 * ANA-157 (review round 3): transition-aware escalation for a status change — considers
 * not only the proposed status but also the one it leaves. Escalates when the proposed
 * status is above the level's maximum (the cap) OR when the change leaves a PM verdict:
 * erasing the светофор decision («Подтверждена» / «Частично» / «Отклонена») is itself a
 * PM decision, even when the proposed status (e.g. draft) is below the cap. The reason is
 * the shared machine-readable `autonomy-exceeded`.
 */
export function hypothesisTransitionEscalation(
  from: HypothesisStatus,
  proposed: HypothesisStatus,
  level: AutonomyLevel = REQUIRED_AUTONOMY,
): AutonomyEscalation {
  const aboveCap =
    HYPOTHESIS_STATUS_RANK[proposed] >
    HYPOTHESIS_STATUS_RANK[HYPOTHESIS_AUTONOMY_MAX_STATUS[level]];
  const clearsVerdict = HYPOTHESIS_VERDICT_STATUSES.includes(from);
  const required = aboveCap || clearsVerdict;
  return { required, reason: required ? 'autonomy-exceeded' : null };
}

/** Full autonomy assessment attached to an AI hypothesis by the API. */
export interface HypothesisAutonomyAssessment {
  /** The level the AI hypothesis runs at (MVP constant REQUIRED_AUTONOMY = A1). */
  readonly level: AutonomyLevel;
  /** The highest status the level may set (A1 → in_progress, «В проверке»). */
  readonly maxStatus: HypothesisStatus;
  /** Statuses the level may set, in display order (the UI enables exactly these options). */
  readonly allowedStatuses: readonly HypothesisStatus[];
}

/**
 * Assess one hypothesis's autonomy from its provenance. Manual hypotheses are human-made —
 * they are not assessed (null); AI hypotheses get the deterministic verdict: the constant
 * level, its maximum status and the allowed statuses.
 */
export function assessHypothesisAutonomy(input: {
  readonly source: HypothesisSource;
}): HypothesisAutonomyAssessment | null {
  if (input.source !== 'ai') return null;
  const level = REQUIRED_AUTONOMY;
  return {
    level,
    maxStatus: HYPOTHESIS_AUTONOMY_MAX_STATUS[level],
    allowedStatuses: hypothesisStatusesAllowedAt(level),
  };
}
