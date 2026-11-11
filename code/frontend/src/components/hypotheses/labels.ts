import type {
  AssumptionCategory,
  DecisionMethod,
  DecisionOutcome,
  FindingConfidence,
  HypothesisStatus,
  ValidationMethodType,
} from '@pca/shared';
import type { DictKey } from '../../i18n';

/** i18n keys for the domain enums — one map per enum, shared by the kanban, table and editor. */
export const STATUS_KEY: Record<HypothesisStatus, DictKey> = {
  draft: 'hyp.status.draft',
  in_progress: 'hyp.status.in_progress',
  green: 'hyp.status.green',
  yellow: 'hyp.status.yellow',
  red: 'hyp.status.red',
  expired: 'hyp.status.expired',
};

/** Kanban columns: «Просрочена» is its own lane — expired ≠ rejected (ANA-75 / БАГ-15).
    ANA-129: drafts live in their own «Черновики» lane until taken into work. */
export const KANBAN_COLUMNS: ReadonlyArray<{
  readonly id: string;
  readonly key: DictKey;
  readonly statuses: readonly HypothesisStatus[];
}> = [
  { id: 'draft', key: 'hyp.col.drafts', statuses: ['draft'] },
  { id: 'in_progress', key: 'hyp.status.in_progress', statuses: ['in_progress'] },
  { id: 'green', key: 'hyp.status.green', statuses: ['green'] },
  { id: 'yellow', key: 'hyp.status.yellow', statuses: ['yellow'] },
  { id: 'red', key: 'hyp.status.red', statuses: ['red'] },
  { id: 'expired', key: 'hyp.status.expired', statuses: ['expired'] },
];

export const CATEGORY_KEY: Record<AssumptionCategory, DictKey> = {
  behavior: 'hyp.cat.behavior',
  market: 'hyp.cat.market',
  tech: 'hyp.cat.tech',
};

export const METHOD_TYPE_KEY: Record<ValidationMethodType, DictKey> = {
  synthetic: 'hyp.mt.synthetic',
  live: 'hyp.mt.live',
  quantitative: 'hyp.mt.quantitative',
  market: 'hyp.mt.market',
};

export const OUTCOME_KEY: Record<DecisionOutcome, DictKey> = {
  green: 'dec.outcome.green',
  yellow: 'dec.outcome.yellow',
  red: 'dec.outcome.red',
};

export const DECISION_METHOD_KEY: Record<DecisionMethod, DictKey> = {
  synthetic: 'hyp.mt.synthetic',
  live: 'hyp.mt.live',
  quantitative: 'hyp.mt.quantitative',
  market: 'hyp.mt.market',
  mixed: 'dec.method.mixed',
};

export const CONFIDENCE_KEY: Record<FindingConfidence, DictKey> = {
  high: 'dec.conf.high',
  medium: 'dec.conf.medium',
  low: 'dec.conf.low',
};

/** Pill tone per hypothesis status (red/expired share the rejected tone). */
export function statusTone(s: HypothesisStatus): 'green' | 'amber' | 'red' | 'neutral' | 'accent' {
  if (s === 'green') return 'green';
  if (s === 'yellow') return 'amber';
  if (s === 'red' || s === 'expired') return 'red';
  if (s === 'in_progress') return 'accent';
  return 'neutral';
}
