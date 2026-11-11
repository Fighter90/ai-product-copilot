import { createHash } from 'node:crypto';
import type {
  DecisionMethod,
  GeneratedDecision,
  GeneratedDecisions,
  GeneratedHypotheses,
  NewDecision,
  NewHypothesis,
  ProblemHypothesis,
} from '@pca/shared';
import type { DecisionsRepo } from '../db/repositories/decisions-repo';
import type { HypothesesRepo } from '../db/repositories/hypotheses-repo';
import { ImportAiBody, METHOD_RULES, generatedToNewHypothesis } from './ai-hypotheses';

/**
 * ANA-128: auto-populate the «Гипотезы» and «Решения» sections with the AI-generated content.
 * After a successful report AI analysis (production path, ai-hypotheses) the generated problem
 * and solution hypotheses are written into the `hypotheses` table as AI drafts (source = 'ai',
 * status stays 'draft'), and the AI-proposed Decision Log entries into `decisions` (also AI
 * drafts). Idempotent: a repeated analysis dedupes by a content hash, so re-running never
 * multiplies rows. Failures are isolated per item — auto-population must never break the report
 * and must not require an AI key (without generation there is simply nothing to populate).
 */

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

/** Map one AI-proposed decision to a Decision Log draft linked to the imported hypothesis. */
function generatedToNewDecision(
  d: GeneratedDecision,
  hypothesisId: number,
  provider: string | undefined,
  now: Date,
): NewDecision {
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
      continue;
    }
    try {
      const created = deps.hypotheses.create(draft);
      hashToId.set(key, created.id);
      idMap.set(p.id, created.id);
      result.hypotheses++;
    } catch {
      // One invalid draft must not break the auto-population (or the report).
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
        continue;
      }
      const created = deps.hypotheses.create(draft, { mode: 'work' });
      hashToId.set(key, created.id);
      idMap.set(s.id, created.id);
      result.hypotheses++;
    } catch {
      // Invalid or duplicate-shape item — skip it, keep the rest.
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
    if (hypothesisId === undefined) continue; // the model linked an id we did not import
    const draft = generatedToNewDecision(d, hypothesisId, deps.provider, now);
    const key = decisionContentHash(draft);
    if (knownDecisions.has(key)) {
      result.skipped++;
      continue;
    }
    try {
      deps.decisions.createAiDraft(draft);
      knownDecisions.add(key);
      result.decisions++;
    } catch {
      // Skip the failed proposal; the rest keep populating.
    }
  }

  return result;
}
