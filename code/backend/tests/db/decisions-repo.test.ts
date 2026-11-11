import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DB } from '../../src/db/connection';
import { HypothesesRepo } from '../../src/db/repositories/hypotheses-repo';
import { DecisionsRepo, DecisionValidationError } from '../../src/db/repositories/decisions-repo';
import { freshDb, validHypothesis } from './helpers';
import type { NewDecision } from '@pca/shared';

let db: DB;
let hyps: HypothesesRepo;
let decisions: DecisionsRepo;

beforeEach(() => {
  db = freshDb();
  hyps = new HypothesesRepo(db);
  decisions = new DecisionsRepo(db);
});
afterEach(() => db.close());

function decisionFor(hypothesisId: number, over: Partial<NewDecision> = {}): NewDecision {
  return {
    hypothesisId,
    date: '2025-01-10',
    method: 'mixed',
    scope: '5 интервью + 12k сессий',
    periodDays: 5,
    findings: [{ text: 'подкаст конвертит хуже', confidence: 'medium' }],
    evidence: [{ quote: 'если надо счёт — отложу', source: 'synthetic CTO', rawResponseId: 1 }],
    outcome: 'yellow',
    outcomeRationale: 'разрыв подтверждён частично',
    nextStep: 'solution: онлайн-оплата',
    decidedBy: 'команда трека',
    ...over,
  };
}

describe('DecisionsRepo.create', () => {
  it('numbers decisions sequentially and auto-updates the linked hypothesis status', () => {
    const h = hyps.create(validHypothesis());
    const d1 = decisions.create(decisionFor(h.id, { outcome: 'yellow' }));
    expect(d1.number).toBe('DL-001');
    expect(hyps.getById(h.id)?.status).toBe('yellow');

    const h2 = hyps.create(validHypothesis());
    const d2 = decisions.create(
      decisionFor(h2.id, { outcome: 'green', spawnedHypothesisIds: [h.id], responsible: 'Лиза' }),
    );
    expect(d2.number).toBe('DL-002');
    expect(d2.spawnedHypothesisIds).toEqual([h.id]);
    expect(d2.responsible).toBe('Лиза');
    expect(hyps.getById(h2.id)?.status).toBe('green');
  });

  it('maps optional fields to undefined when absent', () => {
    const h = hyps.create(validHypothesis());
    const d = decisions.create(decisionFor(h.id));
    expect(d.responsible).toBeUndefined();
    expect(d.spawnedHypothesisIds).toBeUndefined();
    expect(d.previousDecisionId).toBeUndefined();
  });

  it('round-trips the ANA-18 demo mark (isDemo → is_demo → isDemo)', () => {
    const h = hyps.create(validHypothesis());
    const real = decisions.create(decisionFor(h.id));
    expect(real.isDemo).toBeUndefined();

    const demo = decisions.create(decisionFor(h.id, { isDemo: true }));
    expect(demo.isDemo).toBe(true);
    expect(decisions.getById(demo.id)?.isDemo).toBe(true);
    expect(decisions.getById(real.id)?.isDemo).toBeUndefined();
  });

  it('requires at least one evidence item', () => {
    const h = hyps.create(validHypothesis());
    expect(() => decisions.create(decisionFor(h.id, { evidence: [] }))).toThrowError(
      DecisionValidationError,
    );
  });

  it('rejects a decision for a non-existent hypothesis (FK)', () => {
    expect(() => decisions.create(decisionFor(9999))).toThrow();
  });
});

describe('DecisionsRepo.createAiDraft (ANA-128)', () => {
  it('stores an AI-source draft without flipping the linked hypothesis status', () => {
    const h = hyps.create(validHypothesis());
    const d = decisions.createAiDraft(decisionFor(h.id, { outcome: 'green' }));
    expect(d.number).toBe('DL-001');
    expect(d.source).toBe('ai');
    // An AI proposal is not a human decision — the hypothesis stays a draft.
    expect(hyps.getById(h.id)?.status).toBe('draft');
    // The manual sibling keeps numbering and the manual source (and applies its outcome).
    const manual = decisions.create(decisionFor(h.id, { outcome: 'green' }));
    expect(manual.number).toBe('DL-002');
    expect(manual.source).toBe('manual');
    expect(hyps.getById(h.id)?.status).toBe('green');
  });

  it('requires evidence like the manual path', () => {
    const h = hyps.create(validHypothesis());
    expect(() => decisions.createAiDraft(decisionFor(h.id, { evidence: [] }))).toThrowError(
      DecisionValidationError,
    );
  });
});

describe('DecisionsRepo reads', () => {
  it('getById, list and listByHypothesis', () => {
    const h = hyps.create(validHypothesis());
    const d = decisions.create(decisionFor(h.id));
    expect(decisions.getById(d.id)?.number).toBe('DL-001');
    expect(decisions.getById(9999)).toBeUndefined();
    expect(decisions.list()).toHaveLength(1);
    expect(decisions.listByHypothesis(h.id)).toHaveLength(1);
    expect(decisions.listByHypothesis(9999)).toHaveLength(0);
  });
});

describe('DecisionsRepo decision type (ANA-137)', () => {
  it('round-trips decisionType on AI drafts and leaves manual rows unset', () => {
    const h = hyps.create(validHypothesis());
    const typed = decisions.createAiDraft(decisionFor(h.id, { decisionType: 'budget' }));
    expect(typed.decisionType).toBe('budget');
    expect(decisions.getById(typed.id)?.decisionType).toBe('budget');
    expect(decisions.list()[0]?.decisionType).toBe('budget');

    const manual = decisions.create(decisionFor(h.id));
    expect(manual.decisionType).toBeUndefined();
    expect(decisions.getById(manual.id)?.decisionType).toBeUndefined();
  });

  it('maps an unknown stored decision_type to undefined (garbage/legacy tolerance)', () => {
    const h = hyps.create(validHypothesis());
    const d = decisions.createAiDraft(decisionFor(h.id));
    db.prepare('UPDATE decisions SET decision_type = ? WHERE id = ?').run('bogus', d.id);
    expect(decisions.getById(d.id)?.decisionType).toBeUndefined();
  });
});
