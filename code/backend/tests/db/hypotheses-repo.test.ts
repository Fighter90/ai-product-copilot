import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DB } from '../../src/db/connection';
import {
  HypothesesRepo,
  HypothesisInUseError,
  HypothesisValidationError,
} from '../../src/db/repositories/hypotheses-repo';
import { freshDb, validHypothesis } from './helpers';

let db: DB;
let repo: HypothesesRepo;

beforeEach(() => {
  db = freshDb();
  repo = new HypothesesRepo(db);
});
afterEach(() => db.close());

describe('HypothesesRepo.create', () => {
  it('persists a full hypothesis and computes ice_score as the product', () => {
    const h = repo.create(
      validHypothesis({
        impact: 8,
        confidence: 5,
        ease: 7,
        description: 'desc',
        parentId: undefined,
        evidence: [{ type: 'quantitative', rawResponseId: 1, note: 'n' }],
      }),
    );
    expect(h.id).toBeGreaterThan(0);
    expect(h.iceScore).toBe(280);
    expect(h.status).toBe('draft');
    expect(h.description).toBe('desc');
    expect(h.evidence?.[0]?.rawResponseId).toBe(1);
    expect(new Date(h.deadlineAt).getTime()).toBeGreaterThan(new Date(h.createdAt).getTime());
  });

  it('persists a minimal hypothesis (no description / parent / evidence)', () => {
    const h = repo.create(validHypothesis());
    expect(h.description).toBeUndefined();
    expect(h.parentId).toBeUndefined();
    expect(h.evidence).toBeUndefined();
  });

  it('round-trips the ANA-18 demo mark (isDemo → is_demo → isDemo)', () => {
    const real = repo.create(validHypothesis());
    expect(real.isDemo).toBeUndefined();

    const demo = repo.create(validHypothesis({ title: 'Демо-гипотеза', isDemo: true }));
    expect(demo.isDemo).toBe(true);
    expect(repo.getById(demo.id)?.isDemo).toBe(true);
    expect(repo.getById(real.id)?.isDemo).toBeUndefined();
  });

  it('links a solution hypothesis to its parent problem', () => {
    const problem = repo.create(validHypothesis());
    const solution = repo.create(
      validHypothesis({ kind: 'solution', diamondPhase: 'develop', parentId: problem.id }),
    );
    expect(solution.parentId).toBe(problem.id);
  });

  it('rejects a hypothesis with fewer than 3 assumptions in work mode', () => {
    expect(() =>
      repo.create(validHypothesis({ hiddenAssumptions: [{ category: 'behavior', text: 'x' }] }), {
        mode: 'work',
      }),
    ).toThrowError(HypothesisValidationError);
  });

  it('rejects a hypothesis with fewer than 2 validation methods in work mode', () => {
    try {
      repo.create(validHypothesis({ validationMethods: [{ type: 'synthetic', plan: 'x' }] }), {
        mode: 'work',
      });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(HypothesisValidationError);
      expect((e as HypothesisValidationError).errors.length).toBeGreaterThan(0);
    }
  });

  it('ANA-129: saves a title-only light draft (everything else optional)', () => {
    const h = repo.create(
      validHypothesis({
        subject: '',
        action: '',
        solution: '',
        condition: '',
        hiddenAssumptions: [],
        validationMethods: [],
        impactRationale: '',
        confidenceRationale: '',
        easeRationale: '',
        greenCriteria: '',
        yellowCriteria: '',
        redCriteria: '',
      }),
    );
    expect(h.status).toBe('draft');
    expect(h.title).toBeTruthy();
    expect(h.hiddenAssumptions).toEqual([]);
    expect(h.validationMethods).toEqual([]);
    expect(repo.getById(h.id)?.status).toBe('draft');
  });

  it('ANA-129: a title-only draft still must carry sane ICE factors and deadline', () => {
    expect(() => repo.create(validHypothesis({ impact: 42 }))).toThrowError(
      HypothesisValidationError,
    );
    expect(() => repo.create(validHypothesis({ deadlineDays: 0 }))).toThrowError(
      HypothesisValidationError,
    );
  });
});

describe('HypothesesRepo reads & status', () => {
  it('getById returns a hypothesis or undefined', () => {
    const h = repo.create(validHypothesis());
    expect(repo.getById(h.id)?.id).toBe(h.id);
    expect(repo.getById(9999)).toBeUndefined();
  });

  it('lists hypotheses by ICE descending', () => {
    repo.create(validHypothesis({ impact: 2, confidence: 2, ease: 2 })); // 8
    repo.create(validHypothesis({ impact: 9, confidence: 9, ease: 9 })); // 729
    expect(repo.list().map((h) => h.iceScore)).toEqual([729, 8]);
  });

  it('updateStatus updates an existing hypothesis and returns undefined for a missing one', () => {
    const h = repo.create(validHypothesis());
    const updated = repo.updateStatus(h.id, 'in_progress');
    expect(updated?.status).toBe('in_progress');
    expect(repo.updateStatus(9999, 'green')).toBeUndefined();
  });

  it('ANA-129: blocks taking an incomplete draft into work, the status stays draft', () => {
    const h = repo.create(
      validHypothesis({
        subject: '',
        action: '',
        solution: '',
        condition: '',
        hiddenAssumptions: [],
        validationMethods: [],
        impactRationale: '',
        confidenceRationale: '',
        easeRationale: '',
        greenCriteria: '',
        yellowCriteria: '',
        redCriteria: '',
      }),
    );
    expect(() => repo.updateStatus(h.id, 'in_progress')).toThrowError(HypothesisValidationError);
    expect(repo.getById(h.id)?.status).toBe('draft');
  });

  it('ANA-129: a complete draft passes the gate; moving back to draft is always allowed', () => {
    const h = repo.create(validHypothesis());
    expect(repo.updateStatus(h.id, 'in_progress')?.status).toBe('in_progress');
    expect(repo.updateStatus(h.id, 'green')?.status).toBe('green');
    expect(repo.updateStatus(h.id, 'draft')?.status).toBe('draft');
  });
});

describe('HypothesesRepo.update', () => {
  it('replaces the content, keeps status and recomputes the deadline from creation time', () => {
    const h = repo.create(validHypothesis());
    repo.updateStatus(h.id, 'in_progress');

    const updated = repo.update(h.id, validHypothesis({ title: 'Новое название', impact: 9 }));
    expect(updated?.title).toBe('Новое название');
    expect(updated?.impact).toBe(9);
    expect(updated?.iceScore).toBe(validHypothesis({ impact: 9 }).impact * 6 * 9);
    // Status and creation time survive the edit.
    expect(updated?.status).toBe('in_progress');
    expect(updated?.createdAt).toBe(h.createdAt);
  });

  it('rejects invalid content on a work hypothesis and a self-parent', () => {
    const h = repo.create(validHypothesis());
    // ANA-129: a work-status hypothesis keeps the full format on every edit.
    repo.updateStatus(h.id, 'in_progress');
    expect(() => repo.update(h.id, validHypothesis({ hiddenAssumptions: [] }))).toThrowError(
      HypothesisValidationError,
    );
    expect(() => repo.update(h.id, validHypothesis({ parentId: h.id }))).toThrowError(
      HypothesisValidationError,
    );
  });

  it('ANA-129: a draft is edited under the light rules — partial content persists', () => {
    const h = repo.create(
      validHypothesis({
        subject: '',
        action: '',
        solution: '',
        condition: '',
        hiddenAssumptions: [],
        validationMethods: [],
        impactRationale: '',
        confidenceRationale: '',
        easeRationale: '',
        greenCriteria: '',
        yellowCriteria: '',
        redCriteria: '',
      }),
    );
    const partial = validHypothesis({ title: 'Черновик отредактирован' });
    const edited = repo.update(h.id, {
      ...partial,
      hiddenAssumptions: [],
      validationMethods: [],
    });
    expect(edited?.title).toBe('Черновик отредактирован');
    expect(edited?.status).toBe('draft');
    expect(edited?.hiddenAssumptions).toEqual([]);
  });

  it('returns undefined for a missing id', () => {
    expect(repo.update(9999, validHypothesis())).toBeUndefined();
  });

  it('ANA-38: AI provenance survives an analyst edit (source/aiProvider/aiModel kept)', () => {
    const h = repo.create(
      validHypothesis({
        source: 'ai',
        aiProvider: 'openrouter',
        aiModel: 'claude-sonnet-4-6',
        unverifiedNumbers: ['5123'],
      }),
    );
    const edited = repo.update(h.id, validHypothesis({ title: 'Отредактировано' }));
    expect(edited?.source).toBe('ai');
    expect(edited?.aiProvider).toBe('openrouter');
    expect(edited?.aiModel).toBe('claude-sonnet-4-6');
    expect(edited?.unverifiedNumbers).toEqual(['5123']);
  });
});

describe('HypothesesRepo.delete', () => {
  it('deletes a hypothesis, detaches children and reports a missing id', () => {
    const parent = repo.create(validHypothesis());
    const child = repo.create(validHypothesis({ parentId: parent.id, kind: 'solution' }));

    expect(repo.delete(parent.id)).toBe(true);
    expect(repo.getById(parent.id)).toBeUndefined();
    // The child stays in the backlog, just without a parent link.
    expect(repo.getById(child.id)?.parentId).toBeUndefined();
    expect(repo.delete(9999)).toBe(false);
  });

  it('refuses to delete a hypothesis referenced by the Decision Log', () => {
    const h = repo.create(validHypothesis());
    db.prepare(
      `INSERT INTO decisions (number, hypothesis_id, date, method, scope, period_days,
         findings, evidence, outcome, outcome_rationale, next_step, decided_by,
         is_demo, created_at, updated_at)
       VALUES ('DL-001', ?, '2026-01-01', 'quantitative', 'scope', 14, '[]',
         '[{"quote":"q","source":"s"}]', 'green', 'ok', 'next', 'analyst', 0,
         '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    ).run(h.id);

    try {
      repo.delete(h.id);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(HypothesisInUseError);
      expect((e as HypothesisInUseError).decisions).toBe(1);
    }
    expect(repo.getById(h.id)).toBeDefined();
  });
});
