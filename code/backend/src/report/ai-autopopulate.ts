import { createHash } from 'node:crypto';
import type {
  DecisionMethod,
  DecisionType,
  GeneratedDecision,
  GeneratedDecisions,
  GeneratedHypotheses,
  NewDecision,
  NewHypothesis,
  ProblemHypothesis,
} from '@pca/shared';
import { AUTONOMY_LEVEL_RANK, AUTONOMY_MATRIX } from '@pca/shared';
import type { DecisionsRepo } from '../db/repositories/decisions-repo';
import type { HypothesesRepo } from '../db/repositories/hypotheses-repo';
import { ImportAiBody, METHOD_RULES, generatedToNewHypothesis } from './ai-hypotheses';
import { logger } from '../utils/logger';

/**
 * ANA-128: auto-populate the «Гипотезы» and «Решения» sections with the AI-generated content.
 * After a successful report AI analysis (production path, ai-hypotheses) the generated problem
 * and solution hypotheses are written into the `hypotheses` table as AI drafts (source = 'ai',
 * status stays 'draft'), and the AI-proposed Decision Log entries into `decisions` (also AI
 * drafts). Idempotent: a repeated analysis dedupes by a content hash, so re-running never
 * multiplies rows. Failures are isolated per item — auto-population must never break the report
 * and must not require an AI key (without generation there is simply nothing to populate).
 * ANA-134: every per-item skip/fail is logged (item id + reason), so silent data loss in the
 * auto-population is observable in the backend logs.
 */

/**
 * Minimal logger surface for per-item skip/fail observability (ANA-134); pino-compatible.
 * Injectable so tests can capture the entries instead of relying on log output.
 */
export interface AutoPopulateLog {
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
}

const defaultLog: AutoPopulateLog = {
  info: (obj, msg) => logger.info(obj, msg),
  warn: (obj, msg) => logger.warn(obj, msg),
};

/** Human-readable message of an unknown thrown value (ANA-134 log entries). */
const errMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Counts of one auto-population run, persisted onto the snapshot for the report preview. */
export interface AutoPopulateResult {
  /** Hypothesis drafts actually written to `hypotheses` (deduped repeats write 0). */
  readonly hypotheses: number;
  /** AI decision drafts actually written to `decisions`. */
  readonly decisions: number;
  /** Rows skipped because identical AI content was already imported by a previous run. */
  readonly skipped: number;
}

export interface AutoPopulateDeps {
  readonly hypotheses: HypothesesRepo;
  readonly decisions: DecisionsRepo;
  /** Snapshot the generation came from — lands in the draft evidence for traceability. */
  readonly snapshotId: string;
  readonly provider?: string;
  readonly model?: string;
  /** Injectable clock (tests); defaults to now. */
  readonly now?: Date;
  /**
   * ANA-134: injectable logger for per-item skip/fail events; defaults to the app logger
   * (level-silent under tests).
   */
  readonly log?: AutoPopulateLog;
}

const stableHash = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

/**
 * Content hash of a hypothesis draft: the format fields only — never the snapshot id, timestamps
 * or deadline (a re-analysis days later must still dedupe against the first run's drafts).
 */
function hypothesisContentHash(h: NewHypothesis): string {
  return stableHash([
    h.kind,
    h.subject,
    h.action,
    h.solution,
    h.condition,
    h.title,
    h.description ?? '',
  ]);
}

/** Stable content hash of a decision draft (linked hypothesis id + findings, no timestamps). */
function decisionContentHash(d: NewDecision): string {
  return stableHash([
    d.hypothesisId,
    d.method,
    d.scope,
    d.periodDays,
    d.findings.map((f) => f.text),
    d.evidence.map((e) => e.quote),
    d.outcome,
    d.outcomeRationale,
    d.nextStep,
  ]);
}

/**
 * Map a generated problem to a light draft (ANA-129 mode): the model gives segment / trouble /
 * action / barrier / evidence — the analyst completes the format when taking it into work.
 */
function problemToNewHypothesis(p: ProblemHypothesis, deps: AutoPopulateDeps): NewHypothesis {
  return {
    diamondPhase: 'define',
    kind: 'problem',
    subject: p.segment,
    action: p.action,
    solution: '',
    condition: '',
    title: `${p.segment}: ${p.trouble}`,
    description: `${p.segment} испытывает ${p.trouble} при ${p.action}, потому что ${p.barrier}.`,
    hiddenAssumptions: [{ category: 'behavior', text: p.barrier }],
    validationMethods: [],
    impact: 5,
    confidence: 5,
    ease: 5,
    impactRationale: '',
    confidenceRationale: '',
    easeRationale: '',
    greenCriteria: '',
    yellowCriteria: '',
    redCriteria: '',
    deadlineDays: 14,
    evidence: [
      {
        type: 'ai',
        note: p.evidence,
        slice: `snapshot:${deps.snapshotId}`,
      },
    ],
    source: 'ai',
    ...(deps.provider ? { aiProvider: deps.provider } : {}),
    ...(deps.model ? { aiModel: deps.model } : {}),
    unverifiedNumbers: [...(p.unverifiedNumbers ?? [])],
  };
}

/** Classify the free-text AI method into a typed Decision Log method («mixed» as the fallback). */
function toDecisionMethod(method: string): DecisionMethod {
  return METHOD_RULES.find(([re]) => re.test(method))?.[1] ?? 'mixed';
}

/**
 * ANA-137: keyword→decision-type classifier in the spirit of METHOD_RULES — deterministic,
 * no LLM. Runs over the AI-authored content of a proposal (findings / method / scope /
 * rationale). Conservative by construction: when several types match, the one with the
 * LOWEST autonomy maximum wins (worst case an extra PM escalation, never a missed one);
 * unrecognizable text → null (no type stored — assessed later as `strategic`/A0 with
 * reason 'unclassified-type').
 */
export const DECISION_TYPE_RULES: ReadonlyArray<readonly [RegExp, DecisionType]> = [
  [/юридич|правов|152-?фз|закон|персональные данные|gdpr|договор|оферта|legal/iu, 'legal'],
  [/бюджет|budget|закуп|потрат|расход/iu, 'budget'],
  [/цен|прайс|тариф|скидк|pricing|price/iu, 'pricing'],
  [/публ|коммуникац|пресс|рассылк|соцсет|announcement|pr\b/iu, 'public-comms'],
  [/запуск|пилот|эксперимент|a\/b|аб-?тест|mvp|launch/iu, 'experiment-launch'],
  [/стратег|пивот|pivot|позиционир|масштабир/iu, 'strategic'],
  [/гипотез|провер|кастдев|custdev|интервью|опрос/iu, 'hypothesis-draft'],
  [/анализ|разбивк|воронк|дашборд|метрик|конверси|срез|агрегат|статистик|отчет/iu, 'data-analysis'],
];

/** Classify a decision proposal's text into a taxonomy type; null when nothing matches. */
export function classifyDecisionType(text: string): DecisionType | null {
  const matched = DECISION_TYPE_RULES.filter(([re]) => re.test(text)).map(([, type]) => type);
  if (matched.length === 0) return null;
  // Ambiguity → the type with the lowest autonomy maximum wins (ties: first rule wins).
  return matched.reduce((a, b) =>
    AUTONOMY_LEVEL_RANK[AUTONOMY_MATRIX[a].maxAutonomy] <=
    AUTONOMY_LEVEL_RANK[AUTONOMY_MATRIX[b].maxAutonomy]
      ? a
      : b,
  );
}

/** Map one AI-proposed decision to a Decision Log draft linked to the imported hypothesis. */
function generatedToNewDecision(
  d: GeneratedDecision,
  hypothesisId: number,
  provider: string | undefined,
  now: Date,
): NewDecision {
  // Classification reads only the AI-authored content — the template nextStep
  // («Проверить гипотезу: …») is not the model's decision text.
  const decisionType = classifyDecisionType(
    [d.findings, d.method, d.scope, d.outcomeRationale].join(' '),
  );
  return {
    hypothesisId,
    date: now.toISOString().slice(0, 10),
    method: toDecisionMethod(d.method),
    scope: d.scope,
    periodDays: d.periodDays,
    findings: [{ text: d.findings, confidence: d.confidence }],
    evidence: [{ quote: d.evidence, source: d.source }],
    outcome: d.outcome,
    outcomeRationale: d.outcomeRationale,
    nextStep: `Проверить гипотезу: ${d.method}`,
    decidedBy: provider ? `AI · ${provider}` : 'AI',
    // Never blocks the save: an untypable draft simply stays without a type (NULL).
    ...(decisionType ? { decisionType } : {}),
  };
}

/**
 * Write the generated hypotheses + decisions into the backlog and the Decision Log.
 * Returns the per-run counts (persisted onto the snapshot by the caller).
 */
export function autoPopulateGenerated(
  generated: GeneratedHypotheses,
  generatedDecisions: GeneratedDecisions | undefined,
  deps: AutoPopulateDeps,
): AutoPopulateResult {
  const now = deps.now ?? new Date();
  const log = deps.log ?? defaultLog;
  // Mutable tally, returned as the readonly AutoPopulateResult.
  const result = { hypotheses: 0, decisions: 0, skipped: 0 };
  /** AI hypothesis id («P01»/«S01») → id of the imported (or pre-existing duplicate) row. */
  const idMap = new Map<string, number>();

  // AI drafts of previous runs — dedupe by content and reuse their ids for decision links.
  const hashToId = new Map<string, number>();
  for (const h of deps.hypotheses.list()) {
    if (h.source === 'ai') hashToId.set(hypothesisContentHash(h), h.id);
  }

  for (const p of generated.problems) {
    const draft = problemToNewHypothesis(p, deps);
    const key = hypothesisContentHash(draft);
    const existingId = hashToId.get(key);
    if (existingId !== undefined) {
      idMap.set(p.id, existingId);
      result.skipped++;
      log.info(
        { kind: 'problem', itemId: p.id, reason: 'duplicate' },
        'ai-autopopulate: problem skipped (duplicate)',
      );
      continue;
    }
    try {
      const created = deps.hypotheses.create(draft);
      hashToId.set(key, created.id);
      idMap.set(p.id, created.id);
      result.hypotheses++;
    } catch (err) {
      // One invalid draft must not break the auto-population (or the report). ANA-134: log it.
      log.warn(
        { kind: 'problem', itemId: p.id, reason: 'create-failed', err: errMessage(err) },
        'ai-autopopulate: problem skipped (create failed)',
      );
    }
  }

  for (const s of generated.solutions) {
    const problem = generated.problems.find((p) => p.id === s.problemId);
    try {
      // The parsed AI solution carries the complete format — validate in work mode like the
      // manual import route (ANA-129: no light drafts from the model).
      const parsed = ImportAiBody.parse({
        ...(problem ? { problem } : {}),
        solution: { ...s, unverifiedNumbers: s.unverifiedNumbers ?? [] },
        ...(deps.provider ? { provider: deps.provider } : {}),
        ...(deps.model ? { model: deps.model } : {}),
        snapshotId: deps.snapshotId,
      });
      const draft = generatedToNewHypothesis(parsed, now);
      const key = hypothesisContentHash(draft);
      const existingId = hashToId.get(key);
      if (existingId !== undefined) {
        idMap.set(s.id, existingId);
        result.skipped++;
        log.info(
          { kind: 'solution', itemId: s.id, reason: 'duplicate' },
          'ai-autopopulate: solution skipped (duplicate)',
        );
        continue;
      }
      const created = deps.hypotheses.create(draft, { mode: 'work' });
      hashToId.set(key, created.id);
      idMap.set(s.id, created.id);
      result.hypotheses++;
    } catch (err) {
      // Invalid or duplicate-shape item — skip it, keep the rest. ANA-134: log it.
      log.warn(
        { kind: 'solution', itemId: s.id, reason: 'import-failed', err: errMessage(err) },
        'ai-autopopulate: solution skipped (import failed)',
      );
    }
  }

  // AI-proposed decisions → Decision Log drafts, linked to the imported hypotheses.
  const knownDecisions = new Set(
    deps.decisions
      .list()
      .filter((d) => d.source === 'ai')
      .map((d) => decisionContentHash(d)),
  );
  for (const d of generatedDecisions?.decisions ?? []) {
    const hypothesisId = idMap.get(d.hypothesisId);
    if (hypothesisId === undefined) {
      // The model linked an id we did not import — observable skip (ANA-134).
      log.info(
        {
          kind: 'decision',
          itemId: d.id,
          reason: 'unknown-hypothesis',
          hypothesisId: d.hypothesisId,
        },
        'ai-autopopulate: decision skipped (unknown hypothesis id)',
      );
      continue;
    }
    const draft = generatedToNewDecision(d, hypothesisId, deps.provider, now);
    const key = decisionContentHash(draft);
    if (knownDecisions.has(key)) {
      result.skipped++;
      log.info(
        { kind: 'decision', itemId: d.id, reason: 'duplicate' },
        'ai-autopopulate: decision skipped (duplicate)',
      );
      continue;
    }
    try {
      deps.decisions.createAiDraft(draft);
      knownDecisions.add(key);
      result.decisions++;
    } catch (err) {
      // Skip the failed proposal; the rest keep populating. ANA-134: log it.
      log.warn(
        { kind: 'decision', itemId: d.id, reason: 'create-failed', err: errMessage(err) },
        'ai-autopopulate: decision skipped (create failed)',
      );
    }
  }

  return result;
}
