import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type {
  GeneratedDecisions,
  GeneratedHypotheses,
  ProblemHypothesis,
  SolutionHypothesis,
} from '@pca/shared';
import { assessDecisionAutonomy, validateHypothesis } from '@pca/shared';
import { freshDb } from '../db/helpers';
import type { DB } from '../../src/db/connection';
import { HypothesesRepo } from '../../src/db/repositories/hypotheses-repo';
import { DecisionsRepo } from '../../src/db/repositories/decisions-repo';
import { autoPopulateGenerated, classifyDecisionType } from '../../src/report/ai-autopopulate';
import type { AutoPopulateDeps } from '../../src/report/ai-autopopulate';

/**
 * ANA-128: after a successful AI analysis the generated hypotheses land in the «Гипотезы»
 * backlog and the proposed decisions in the Decision Log («Решения») as AI drafts —
 * automatically, idempotently (re-analysis creates no duplicates), and without ever
 * breaking the report when an item fails validation.
 */

const problem: ProblemHypothesis = {
  id: 'P01',
  segment: 'посетитель с мобильного',
  trouble: 'не находит цену билета',
  action: 'ищет билеты',
  barrier: 'цены скрыты за формой',
  evidence: '287 заявок B2C',
  unverifiedNumbers: [],
};

const solution = (over: Partial<SolutionHypothesis> = {}): SolutionHypothesis => ({
  id: 'S01',
  problemId: 'P01',
  action: 'показать цены прямо на лендинге',
  userBenefit: 'посетитель сразу видит стоимость',
  businessResult: 'конверсия в заявку растёт',
  successCriteria: 'конверсия +10%',
  risks: [
    { kind: 'value', note: 'цены могут отпугнуть' },
    { kind: 'usability', note: 'страница перегружена' },
    { kind: 'feasibility', note: 'нужна интеграция с биллингом' },
    { kind: 'business', note: 'конкуренты publish дешевле' },
    { kind: 'legal', note: 'персональные данные по 152-ФЗ' },
  ],
  validation: {
    whatToVerify: 'готовность платить до формы',
    methods: ['интервью', 'A/B-тест'],
    audience: 'B2C-посетители',
    channel: 'лендинг',
    successCriteria: 'CR ≥ 10%',
  },
  ice: {
    impact: 8,
    confidence: 6,
    ease: 5,
    impactRationale: 'влияет на CR напрямую',
    confidenceRationale: 'данные интервью есть',
    easeRationale: 'правка одного экрана',
    score: 240,
  },
  trafficLight: { green: 'CR +10%', yellow: 'CR +3%', red: 'без изменений' },
  deadline: '2026-12-01',
  unverifiedNumbers: [],
  ...over,
});

const generated: GeneratedHypotheses = {
  problems: [problem],
  solutions: [solution(), solution({ id: 'S02', action: 'упростить форму заявки' })],
  meta: { provider: 'yandexgpt', model: 'yandexgpt/latest' },
};

const generatedDecisions: GeneratedDecisions = {
  decisions: [
    {
      id: 'DL01',
      hypothesisId: 'S01',
      method: 'количественный анализ воронки',
      periodDays: 14,
      scope: 'лендинг, мобильный трафик',
      findings: 'конверсия не выросла после правки',
      confidence: 'medium',
      evidence: 'CR 3.2% на срезе',
      source: 'snap-1',
      outcome: 'yellow',
      outcomeRationale: 'эффект частичный',
    },
    {
      id: 'DL02',
      hypothesisId: 'P01',
      method: 'интервью с B2C-посетителями',
      periodDays: 7,
      scope: '5 интервью',
      findings: 'цена действительно скрыта',
      confidence: 'high',
      evidence: '287 заявок B2C',
      source: 'snap-1',
      outcome: 'green',
      outcomeRationale: 'барьер подтверждён',
    },
    {
      id: 'DL03',
      hypothesisId: 'P99',
      method: 'A/B-тест',
      periodDays: 14,
      scope: 'весь трафик',
      findings: 'неизвестная гипотеза',
      confidence: 'low',
      evidence: 'нет данных',
      source: 'snap-1',
      outcome: 'red',
      outcomeRationale: 'нет связи',
    },
  ],
};

const NOW = new Date('2026-11-11T00:00:00Z');

let db: DB;
let hyps: HypothesesRepo;
let decisions: DecisionsRepo;
let deps: AutoPopulateDeps;

beforeEach(() => {
  db = freshDb();
  hyps = new HypothesesRepo(db);
  decisions = new DecisionsRepo(db);
  deps = {
    hypotheses: hyps,
    decisions,
    snapshotId: 'snap-1',
    provider: 'yandexgpt',
    model: 'yandexgpt/latest',
    now: NOW,
  };
});
afterEach(() => db.close());

describe('autoPopulateGenerated (ANA-128)', () => {
  it('writes generated problems + solutions as AI drafts and proposed decisions into the log', () => {
    const result = autoPopulateGenerated(generated, generatedDecisions, deps);

    // 1 problem draft + 2 solution drafts; both model decisions that link known ids.
    expect(result).toEqual({ hypotheses: 3, decisions: 2, skipped: 0 });

    const rows = hyps.list();
    expect(rows).toHaveLength(3);

    const solutionRow = rows.find((h) => h.kind === 'solution')!;
    expect(solutionRow.source).toBe('ai');
    expect(solutionRow.aiProvider).toBe('yandexgpt');
    expect(solutionRow.aiModel).toBe('yandexgpt/latest');
    expect(solutionRow.status).toBe('draft');
    expect(solutionRow.title).toContain('показать цены');
    // Complete format — the draft can be taken into work without re-entering fields (ANA-129).
    expect(validateHypothesis(solutionRow, { mode: 'work' }).ok).toBe(true);
    // ICE stays the deterministic product (never the AI's or a mean).
    expect(solutionRow.iceScore).toBe(8 * 6 * 5);

    const problemRow = rows.find((h) => h.kind === 'problem')!;
    expect(problemRow.source).toBe('ai');
    expect(problemRow.status).toBe('draft');
    expect(problemRow.title).toContain('не находит цену');

    const log = decisions.list();
    expect(log).toHaveLength(2);
    expect(log.every((d) => d.source === 'ai')).toBe(true);
    const byNumber = (n: string) => log.find((d) => d.number === n)!;
    expect(byNumber('DL-001').hypothesisId).toBe(solutionRow.id);
    expect(byNumber('DL-002').hypothesisId).toBe(problemRow.id);
    // An AI proposal must not flip the linked hypothesis status — that stays a human decision.
    expect(hyps.getById(solutionRow.id)?.status).toBe('draft');
    expect(hyps.getById(problemRow.id)?.status).toBe('draft');
    expect(byNumber('DL-001').date).toBe('2026-11-11');
    expect(byNumber('DL-001').decidedBy).toBe('AI · yandexgpt');
  });

  it('is idempotent: a repeated analysis (new snapshot id, same content) creates no duplicates', () => {
    autoPopulateGenerated(generated, generatedDecisions, deps);
    const result = autoPopulateGenerated(generated, generatedDecisions, {
      ...deps,
      snapshotId: 'snap-2',
    });
    expect(result).toEqual({ hypotheses: 0, decisions: 0, skipped: 5 });
    expect(hyps.list()).toHaveLength(3);
    expect(decisions.list()).toHaveLength(2);
  });

  it('links a repeated analysis to the existing drafts (no re-import) and skips known decisions', () => {
    const first = autoPopulateGenerated(generated, generatedDecisions, deps);
    const second = autoPopulateGenerated(generated, generatedDecisions, deps);
    expect(second.hypotheses).toBe(0);
    expect(second.decisions).toBe(0);
    // DL03 references the unknown P99 → never imported, never created. list() orders by
    // date DESC, id DESC — same date, so compare as a set.
    expect(
      decisions
        .list()
        .map((d) => d.number)
        .sort(),
    ).toEqual(['DL-001', 'DL-002']);
    expect(first.decisions).toBe(2);
  });

  it('does nothing on an empty generation and stays silent without decisions', () => {
    const result = autoPopulateGenerated({ problems: [], solutions: [] }, undefined, deps);
    expect(result).toEqual({ hypotheses: 0, decisions: 0, skipped: 0 });
    expect(hyps.list()).toHaveLength(0);
    expect(decisions.list()).toHaveLength(0);
  });

  it('skips decisions whose hypothesis was not imported (unknown id) without crashing', () => {
    const result = autoPopulateGenerated({ problems: [], solutions: [] }, generatedDecisions, deps);
    expect(result.decisions).toBe(0);
    expect(decisions.list()).toHaveLength(0);
  });

  it('imports the remaining items when one create fails — the report never breaks', () => {
    // First create (the problem draft) blows up; both solutions must still land.
    const spy = vi.spyOn(hyps, 'create').mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const result = autoPopulateGenerated(generated, undefined, deps);
    expect(result.hypotheses).toBe(2);
    expect(result.skipped).toBe(0);
    expect(hyps.list()).toHaveLength(2);
    spy.mockRestore();
  });

  it('keeps populating decisions when one decision insert fails', () => {
    autoPopulateGenerated(generated, undefined, deps);
    const spy = vi.spyOn(decisions, 'createAiDraft').mockImplementationOnce(() => {
      throw new Error('boom');
    });
    // Both proposals are new for the log (previous run imported none) — first fails, second lands.
    const result = autoPopulateGenerated(generated, generatedDecisions, deps);
    expect(result.decisions).toBe(1);
    spy.mockRestore();
  });
});

describe('per-item skip/fail logging (ANA-134 observability)', () => {
  it('warns with the item id and error when a problem create fails', () => {
    const log = { info: vi.fn(), warn: vi.fn() };
    const spy = vi.spyOn(hyps, 'create').mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const result = autoPopulateGenerated(generated, undefined, { ...deps, log });
    expect(result.hypotheses).toBe(2); // P01 failed, S01/S02 landed
    expect(log.warn).toHaveBeenCalledWith(
      { kind: 'problem', itemId: 'P01', reason: 'create-failed', err: 'boom' },
      'ai-autopopulate: problem skipped (create failed)',
    );
    spy.mockRestore();
  });

  it('warns with the item id and error when a solution fails the import validation', () => {
    const log = { info: vi.fn(), warn: vi.fn() };
    // deadline must be a string — a number deterministically breaks ImportAiBody.parse.
    const broken: GeneratedHypotheses = {
      ...generated,
      solutions: [solution({ deadline: 42 as unknown as string })],
    };
    const result = autoPopulateGenerated(broken, undefined, { ...deps, log });
    expect(result.hypotheses).toBe(1); // only the problem draft landed
    expect(log.warn).toHaveBeenCalledTimes(1);
    const entry = log.warn.mock.calls[0]?.[0] as Record<string, unknown>;
    const message = log.warn.mock.calls[0]?.[1] as string;
    expect(entry).toMatchObject({ kind: 'solution', itemId: 'S01', reason: 'import-failed' });
    expect(String(entry.err)).not.toBe('');
    expect(message).toBe('ai-autopopulate: solution skipped (import failed)');
    expect(log.info).not.toHaveBeenCalled();
  });

  it('warns with String(err) for non-Error throws', () => {
    const log = { info: vi.fn(), warn: vi.fn() };
    const spy = vi.spyOn(hyps, 'create').mockImplementationOnce(() => {
      throw 'str-boom';
    });
    autoPopulateGenerated(generated, undefined, { ...deps, log });
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: 'P01', err: 'str-boom' }),
      'ai-autopopulate: problem skipped (create failed)',
    );
    spy.mockRestore();
  });

  it('logs an info entry for every duplicate of a re-run', () => {
    autoPopulateGenerated(generated, generatedDecisions, deps);
    const log = { info: vi.fn(), warn: vi.fn() };
    const second = autoPopulateGenerated(generated, generatedDecisions, { ...deps, log });
    expect(second).toEqual({ hypotheses: 0, decisions: 0, skipped: 5 });
    // DL03 is logged again too — P99 was never imported, so it is still an unknown id.
    const itemIds = log.info.mock.calls.map((c) => (c[0] as { itemId: string }).itemId).sort();
    expect(itemIds).toEqual(['DL01', 'DL02', 'DL03', 'P01', 'S01', 'S02']);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('logs the decision whose hypothesis id was not imported', () => {
    const log = { info: vi.fn(), warn: vi.fn() };
    const result = autoPopulateGenerated({ problems: [], solutions: [] }, generatedDecisions, {
      ...deps,
      log,
    });
    expect(result.decisions).toBe(0);
    expect(log.info).toHaveBeenCalledWith(
      { kind: 'decision', itemId: 'DL03', reason: 'unknown-hypothesis', hypothesisId: 'P99' },
      'ai-autopopulate: decision skipped (unknown hypothesis id)',
    );
  });

  it('warns with the item id and error when a decision insert fails', () => {
    autoPopulateGenerated(generated, undefined, deps);
    const log = { info: vi.fn(), warn: vi.fn() };
    const spy = vi.spyOn(decisions, 'createAiDraft').mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const result = autoPopulateGenerated(generated, generatedDecisions, { ...deps, log });
    expect(result.decisions).toBe(1);
    expect(log.warn).toHaveBeenCalledWith(
      { kind: 'decision', itemId: 'DL01', reason: 'create-failed', err: 'boom' },
      'ai-autopopulate: decision skipped (create failed)',
    );
    spy.mockRestore();
  });

  it('defaults to the silent app logger when no log is injected', () => {
    // Existing deps carry no `log` — must not crash (pino is level-silent in tests).
    const result = autoPopulateGenerated(generated, undefined, deps);
    expect(result.hypotheses).toBe(3);
  });
});

describe('decision type classification (ANA-137)', () => {
  it('stamps every AI decision draft with decisionType and the escalation verdict', () => {
    autoPopulateGenerated(generated, generatedDecisions, deps);
    const log = decisions.list();
    const byNumber = (n: string) => log.find((d) => d.number === n)!;
    // «количественный анализ воронки» + «конверсия…» — a reversible data-analysis draft (A2).
    expect(byNumber('DL-001').decisionType).toBe('data-analysis');
    // «цена действительно скрыта» also matches pricing (A0) — the conservative lowest-max
    // type wins, so the draft is escalated to the PM (worst case: one extra badge).
    expect(byNumber('DL-002').decisionType).toBe('pricing');
    expect(
      assessDecisionAutonomy({ source: 'ai', decisionType: byNumber('DL-002').decisionType })
        ?.escalation,
    ).toEqual({ required: true, reason: 'autonomy-exceeded' });
    expect(
      assessDecisionAutonomy({ source: 'ai', decisionType: byNumber('DL-001').decisionType })
        ?.escalation,
    ).toEqual({ required: false, reason: null });
  });

  it('leaves decisionType unset when nothing matches (stored NULL, assessed conservatively)', () => {
    const untypable: GeneratedDecisions = {
      decisions: [
        {
          id: 'DL01',
          hypothesisId: 'S01',
          method: 'обсуждение на созвоне',
          periodDays: 14,
          scope: 'общий разговор',
          findings: 'команда согласилась продолжать',
          confidence: 'medium',
          evidence: 'протокол встречи',
          source: 'snap-1',
          outcome: 'yellow',
          outcomeRationale: 'пока неясно',
        },
      ],
    };
    const result = autoPopulateGenerated(generated, untypable, deps);
    expect(result.decisions).toBe(1);
    const draft = decisions.list()[0]!;
    expect(draft.decisionType).toBeUndefined();
    expect(assessDecisionAutonomy({ source: 'ai', decisionType: draft.decisionType })).toEqual({
      type: 'strategic',
      unclassified: true,
      maxAutonomy: 'A0',
      required: 'A1',
      escalation: { required: true, reason: 'unclassified-type' },
    });
  });

  it('classifyDecisionType picks the lowest-maximum type when several patterns match', () => {
    // «анализ воронки» (data-analysis, A2) + «запуск пилота» (experiment-launch, A0) →
    // the A0 type wins: worst case an extra escalation, never a missed one.
    expect(classifyDecisionType('анализ воронки перед запуском пилота')).toBe('experiment-launch');
    expect(classifyDecisionType('закупить рекламу в подкасте, бюджет 50к')).toBe('budget');
    expect(classifyDecisionType('проверить гипотезу кастдев-интервью')).toBe('hypothesis-draft');
    expect(classifyDecisionType('юридическая проверка 152-ФЗ')).toBe('legal');
    expect(classifyDecisionType('пресс-релиз и публикации в соцсетях')).toBe('public-comms');
    expect(classifyDecisionType('пересмотр тарифов и скидок')).toBe('pricing');
    expect(classifyDecisionType('пивот позиционирования продукта')).toBe('strategic');
    expect(classifyDecisionType('разбивка конверсий по каналам воронки')).toBe('data-analysis');
    expect(classifyDecisionType('никаких узнаваемых слов')).toBeNull();
  });
});
