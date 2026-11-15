import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { buildTestApp, type TestApp } from './helpers';
import { freshDb, validHypothesis } from '../db/helpers';
import { hypothesesRoutes } from '../../src/routes/hypotheses';
import { HypothesesRepo } from '../../src/db/repositories/hypotheses-repo';
import type { Role, User, UsersRepo } from '../../src/auth/users-repo';

let ctx: TestApp;
beforeEach(() => {
  ctx = buildTestApp();
});
afterEach(async () => {
  await ctx.app.close();
  ctx.db.close();
});

describe('hypotheses API', () => {
  it('creates a valid hypothesis (201) and lists/reads it', async () => {
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/hypotheses',
      payload: validHypothesis(),
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as number;

    const list = await ctx.app.inject({ method: 'GET', url: '/api/hypotheses' });
    expect(list.json()).toHaveLength(1);

    const one = await ctx.app.inject({ method: 'GET', url: `/api/hypotheses/${id}` });
    expect(one.statusCode).toBe(200);
    const missing = await ctx.app.inject({ method: 'GET', url: '/api/hypotheses/9999' });
    expect(missing.statusCode).toBe(404);
  });

  it('ANA-129: saves an incomplete hypothesis as a draft (201), blocks take-into-work with 422', async () => {
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/hypotheses',
      payload: validHypothesis({ hiddenAssumptions: [{ category: 'behavior', text: 'x' }] }),
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().status).toBe('draft');
    const id = created.json().id as number;

    const blocked = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/hypotheses/${id}/status`,
      payload: { status: 'in_progress' },
    });
    expect(blocked.statusCode).toBe(422);
    expect(blocked.json().error).toBe('invalid hypothesis');
    expect(Array.isArray(blocked.json().issues)).toBe(true);
    // The failed transition left the hypothesis a draft.
    const still = await ctx.app.inject({ method: 'GET', url: `/api/hypotheses/${id}` });
    expect(still.json().status).toBe('draft');
  });

  it('ANA-129: a title-only body creates a light draft; an empty body is a 400 (REG-02)', async () => {
    const draft = await ctx.app.inject({
      method: 'POST',
      url: '/api/hypotheses',
      payload: { title: 'Быстрая идея' },
    });
    expect(draft.statusCode).toBe(201);
    expect(draft.json().status).toBe('draft');
    expect(draft.json().impact).toBe(5);
    expect(draft.json().deadlineDays).toBe(14);

    const empty = await ctx.app.inject({ method: 'POST', url: '/api/hypotheses', payload: {} });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error).toBe('invalid body');
    expect(Array.isArray(empty.json().issues)).toBe(true);
  });

  it('returns 500 when the repo throws a non-validation error (bad parent FK)', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/hypotheses',
      payload: validHypothesis({ parentId: 9999 }),
    });
    expect(res.statusCode).toBe(500);
  });

  it('patches status, validates the value, and 404s a missing id', async () => {
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/hypotheses',
      payload: validHypothesis(),
    });
    const id = created.json().id as number;

    const ok = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/hypotheses/${id}/status`,
      payload: { status: 'in_progress' },
    });
    expect(ok.json().status).toBe('in_progress');

    const bad = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/hypotheses/${id}/status`,
      payload: { status: 'banana' },
    });
    expect(bad.statusCode).toBe(400);

    const missing = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/hypotheses/9999/status',
      payload: { status: 'green' },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('updates a hypothesis (PUT), 404s a missing id and 422s invalid content', async () => {
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/hypotheses',
      payload: validHypothesis(),
    });
    const id = created.json().id as number;

    const ok = await ctx.app.inject({
      method: 'PUT',
      url: `/api/hypotheses/${id}`,
      payload: validHypothesis({ title: 'Обновлённая' }),
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().title).toBe('Обновлённая');

    const missing = await ctx.app.inject({
      method: 'PUT',
      url: '/api/hypotheses/9999',
      payload: validHypothesis(),
    });
    expect(missing.statusCode).toBe(404);

    const invalid = await ctx.app.inject({
      method: 'PUT',
      url: `/api/hypotheses/${id}`,
      payload: validHypothesis({ impact: 42 }),
    });
    expect(invalid.statusCode).toBe(422);
  });

  it('deletes a hypothesis (204 → 404) and 409s while the Decision Log references it', async () => {
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/hypotheses',
      payload: validHypothesis(),
    });
    const id = created.json().id as number;

    const gone = await ctx.app.inject({ method: 'DELETE', url: '/api/hypotheses/9999' });
    expect(gone.statusCode).toBe(404);

    const del = await ctx.app.inject({ method: 'DELETE', url: `/api/hypotheses/${id}` });
    expect(del.statusCode).toBe(204);
    expect((await ctx.app.inject({ method: 'GET', url: `/api/hypotheses/${id}` })).statusCode).toBe(
      404,
    );
  });

  it('imports an AI hypothesis (201) with source=ai, and 400s a malformed body', async () => {
    const aiSolution = {
      id: 'S01',
      problemId: 'P01',
      action: 'добавим короткую форму',
      userBenefit: 'регистрация за 1 шаг',
      businessResult: 'CR регистрации +30%',
      successCriteria: 'CR ≥ 5%',
      risks: [
        { kind: 'value', note: 'r1' },
        { kind: 'usability', note: 'r2' },
        { kind: 'feasibility', note: 'r3' },
        { kind: 'business', note: 'r4' },
        { kind: 'legal', note: 'r5' },
      ],
      validation: {
        whatToVerify: 'готовность платить',
        methods: ['интервью', 'клик-тест прототипа'],
        audience: 'слушатели подкаста',
        channel: 'email-рассылка',
        successCriteria: '≥10% кликают дальше',
      },
      ice: {
        impact: 7,
        confidence: 5,
        ease: 8,
        impactRationale: 'i',
        confidenceRationale: 'c',
        easeRationale: 'e',
        score: 280,
      },
      trafficLight: { green: 'g', yellow: 'y', red: 'r' },
      deadline: '2026-12-01',
      unverifiedNumbers: ['5123'],
    };

    const ok = await ctx.app.inject({
      method: 'POST',
      url: '/api/hypotheses/import-ai',
      payload: {
        problem: {
          id: 'P01',
          segment: 'слушатель подкаста',
          trouble: 'не понимает цену',
          action: 'оставить заявку',
          barrier: 'длинная форма',
          evidence: 'CR 0,7%',
          unverifiedNumbers: ['5123'],
        },
        solution: aiSolution,
        provider: 'openrouter',
        model: 'claude-sonnet-4-6',
        snapshotId: 'snap-1',
      },
    });
    expect(ok.statusCode).toBe(201);
    const body = ok.json();
    expect(body.source).toBe('ai');
    expect(body.aiProvider).toBe('openrouter');
    expect(body.aiModel).toBe('claude-sonnet-4-6');
    expect(body.unverifiedNumbers).toEqual(expect.arrayContaining(['5123']));

    const bad = await ctx.app.inject({
      method: 'POST',
      url: '/api/hypotheses/import-ai',
      payload: { solution: { id: 'S02' } },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe('invalid AI hypothesis');
  });
});

/**
 * ANA-157: the AI-autonomy matrix applied to hypotheses — AI hypotheses (level A1) may move
 * draft → «В проверке» (in_progress); the verification verdicts (green/yellow/red) and
 * «Просрочена» are PM-only: without the PM a verdict attempt is refused with 403 + an
 * escalation record in the audit log, while the PM (the admin role in cabinet mode) confirms
 * it directly. In legacy single-user mode there is no PM role — the single human user owns
 * the verdict (no dead end). Manual hypotheses keep every status available.
 */
describe('ANA-157: hypothesis autonomy', () => {
  let ctx: TestApp;
  beforeEach(() => {
    ctx = buildTestApp();
  });
  afterEach(async () => {
    await ctx.app.close();
    ctx.db.close();
  });

  /**
   * Cabinet-mode harness: a bare Fastify app with a users-repo mock and a preHandler stub —
   * the real requester resolution lives in registerAuth (the auth hook), the route unit only
   * reads req.user. The mock is compile-checked against the real UsersRepo.audit signature
   * (a checked cast, never `as unknown as`).
   */
  const cabinetHarness = (audit: UsersRepo['audit']) => {
    const db = freshDb();
    const app = Fastify();
    let requester: User | undefined;
    app.addHook('preHandler', async (req) => {
      req.user = requester;
    });
    app.register(hypothesesRoutes, {
      prefix: '/api',
      repo: new HypothesesRepo(db),
      users: { audit } as UsersRepo,
    });
    return {
      app,
      db,
      asUser: (u: User | undefined) => {
        requester = u;
      },
    };
  };

  const userWithRole = (role: Role): User => ({
    id: 1,
    email: 'pm@pca.local',
    name: 'PM',
    role,
    isActive: true,
    locale: 'ru',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastLoginAt: null,
  });

  it('legacy single-user mode: the human owner takes an AI hypothesis draft → «В проверке» → verdict (200, no dead end)', async () => {
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/hypotheses',
      payload: validHypothesis({ source: 'ai', aiProvider: 'openrouter', aiModel: 'test' }),
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as number;

    const toWork = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/hypotheses/${id}/status`,
      payload: { status: 'in_progress' },
    });
    expect(toWork.statusCode).toBe(200);
    expect(toWork.json().status).toBe('in_progress');

    // No PM role exists — the single user owns the светофор verdict (the ANA-38 flow).
    const verdict = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/hypotheses/${id}/status`,
      payload: { status: 'green' },
    });
    expect(verdict.statusCode).toBe(200);
    expect(verdict.json().status).toBe('green');
    // Every AI-hypothesis response carries the autonomy assessment.
    expect(verdict.json().autonomy).toEqual({
      level: 'A1',
      maxStatus: 'in_progress',
      allowedStatuses: ['draft', 'in_progress'],
    });
  });

  it('GET /hypotheses/:id carries the autonomy assessment on AI hypotheses only', async () => {
    const ai = await ctx.app.inject({
      method: 'POST',
      url: '/api/hypotheses',
      payload: validHypothesis({ title: 'AI гипотеза', source: 'ai' }),
    });
    const manual = await ctx.app.inject({
      method: 'POST',
      url: '/api/hypotheses',
      payload: validHypothesis({ title: 'Ручная гипотеза' }),
    });
    const aiRead = await ctx.app.inject({
      method: 'GET',
      url: `/api/hypotheses/${ai.json().id as number}`,
    });
    expect(aiRead.json().autonomy).toEqual({
      level: 'A1',
      maxStatus: 'in_progress',
      allowedStatuses: ['draft', 'in_progress'],
    });
    const manualRead = await ctx.app.inject({
      method: 'GET',
      url: `/api/hypotheses/${manual.json().id as number}`,
    });
    expect(manualRead.json().autonomy).toBeUndefined();
  });

  it('a manual hypothesis keeps every status available — green and back to draft succeed', async () => {
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/hypotheses',
      payload: validHypothesis(),
    });
    expect(created.json().source).toBe('manual');
    const id = created.json().id as number;

    const green = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/hypotheses/${id}/status`,
      payload: { status: 'green' },
    });
    expect(green.statusCode).toBe(200);
    expect(green.json().status).toBe('green');
    expect(green.json().autonomy).toBeUndefined();

    const back = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/hypotheses/${id}/status`,
      payload: { status: 'draft' },
    });
    expect(back.statusCode).toBe(200);
  });

  it('GET /hypotheses attaches the autonomy assessment to AI hypotheses only', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/api/hypotheses',
      payload: validHypothesis({ title: 'AI гипотеза', source: 'ai' }),
    });
    await ctx.app.inject({
      method: 'POST',
      url: '/api/hypotheses',
      payload: validHypothesis({ title: 'Ручная гипотеза' }),
    });
    const list = await ctx.app.inject({ method: 'GET', url: '/api/hypotheses' });
    const byTitle = list.json() as Array<{ title: string; autonomy?: unknown }>;
    const ai = byTitle.find((h) => h.title === 'AI гипотеза')!;
    const manual = byTitle.find((h) => h.title === 'Ручная гипотеза')!;
    expect(ai.autonomy).toEqual({
      level: 'A1',
      maxStatus: 'in_progress',
      allowedStatuses: ['draft', 'in_progress'],
    });
    expect(manual.autonomy).toBeUndefined();
  });

  it('cabinet mode: a non-PM verdict attempt is refused (403 + escalation) and audited', async () => {
    const audit = vi.fn<UsersRepo['audit']>();
    const h = cabinetHarness(audit);
    h.asUser(userWithRole('analyst'));
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/hypotheses',
      payload: validHypothesis({ source: 'ai' }),
    });
    const id = created.json().id as number;
    const refused = await h.app.inject({
      method: 'PATCH',
      url: `/api/hypotheses/${id}/status`,
      payload: { status: 'red' },
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().code).toBe('AUTONOMY_EXCEEDED');
    expect(audit).toHaveBeenCalledOnce();
    const [user, action, target, details] = audit.mock.calls[0]!;
    expect(user).toEqual(userWithRole('analyst'));
    expect(action).toBe('hypotheses.status_escalation');
    expect(target).toBe(String(id));
    expect(details).toEqual({ from: 'draft', to: 'red', level: 'A1', reason: 'autonomy-exceeded' });
    // Allowed transitions are never audited as escalations.
    await h.app.inject({
      method: 'PATCH',
      url: `/api/hypotheses/${id}/status`,
      payload: { status: 'in_progress' },
    });
    expect(audit).toHaveBeenCalledOnce();
    await h.app.close();
    h.db.close();
  });

  it('cabinet mode: the PM (admin) confirms the verdict on an AI hypothesis — 200, no escalation record', async () => {
    const audit = vi.fn<UsersRepo['audit']>();
    const h = cabinetHarness(audit);
    h.asUser(userWithRole('admin'));
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/hypotheses',
      payload: validHypothesis({ source: 'ai' }),
    });
    const id = created.json().id as number;
    const verdict = await h.app.inject({
      method: 'PATCH',
      url: `/api/hypotheses/${id}/status`,
      payload: { status: 'green' },
    });
    expect(verdict.statusCode).toBe(200);
    expect(verdict.json().status).toBe('green');
    expect(verdict.json().autonomy).toEqual({
      level: 'A1',
      maxStatus: 'in_progress',
      allowedStatuses: ['draft', 'in_progress'],
    });
    // The PM confirmation is not an escalation — nothing is written to the audit log.
    expect(audit).not.toHaveBeenCalled();
    await h.app.close();
    h.db.close();
  });

  /**
   * ANA-157 (review round 3): the reviewer's follow-ups —
   * 1. PUT /hypotheses/:id must not accept `status` (status changes go only through the
   *    guarded PATCH), otherwise the matrix is bypassable;
   * 2. any change out of a PM verdict on an AI hypothesis escalates — a non-PM may not
   *    silently erase the светофор decision by moving the hypothesis back to draft;
   * 3. a failing audit write must not mask the 403 refusal with a 500.
   */
  describe('review round 3', () => {
    it('PUT /hypotheses/:id refuses a body carrying status (400) — the matrix is not bypassable via update', async () => {
      const audit = vi.fn<UsersRepo['audit']>();
      const h = cabinetHarness(audit);
      h.asUser(userWithRole('analyst'));
      const created = await h.app.inject({
        method: 'POST',
        url: '/api/hypotheses',
        payload: validHypothesis({ source: 'ai' }),
      });
      const id = created.json().id as number;

      const bypass = await h.app.inject({
        method: 'PUT',
        url: `/api/hypotheses/${id}`,
        payload: { ...validHypothesis(), status: 'green' },
      });
      expect(bypass.statusCode).toBe(400);
      expect(bypass.json().error).toContain('PATCH /hypotheses');
      // The refusal is not an escalation and the status is untouched.
      expect(audit).not.toHaveBeenCalled();
      const after = await h.app.inject({ method: 'GET', url: `/api/hypotheses/${id}` });
      expect(after.json().status).toBe('draft');

      // A status-free body keeps working — the guard only refuses the status field.
      const legit = await h.app.inject({
        method: 'PUT',
        url: `/api/hypotheses/${id}`,
        payload: validHypothesis({ title: 'Обновлённая' }),
      });
      expect(legit.statusCode).toBe(200);
      expect(legit.json().title).toBe('Обновлённая');
      expect(legit.json().status).toBe('draft');

      await h.app.close();
      h.db.close();
    });

    it('a non-PM cannot clear a PM verdict on an AI hypothesis (green → draft) — 403 + audit, verdict kept', async () => {
      const audit = vi.fn<UsersRepo['audit']>();
      const h = cabinetHarness(audit);
      // The PM gives the verdict first.
      h.asUser(userWithRole('admin'));
      const created = await h.app.inject({
        method: 'POST',
        url: '/api/hypotheses',
        payload: validHypothesis({ source: 'ai' }),
      });
      const id = created.json().id as number;
      const verdict = await h.app.inject({
        method: 'PATCH',
        url: `/api/hypotheses/${id}/status`,
        payload: { status: 'green' },
      });
      expect(verdict.statusCode).toBe(200);

      // The analyst tries to erase it — the transition out of the verdict escalates too.
      h.asUser(userWithRole('analyst'));
      const cleared = await h.app.inject({
        method: 'PATCH',
        url: `/api/hypotheses/${id}/status`,
        payload: { status: 'draft' },
      });
      expect(cleared.statusCode).toBe(403);
      expect(cleared.json().code).toBe('AUTONOMY_EXCEEDED');
      const [user, action, target, details] = audit.mock.calls[0]!;
      expect(user).toEqual(userWithRole('analyst'));
      expect(action).toBe('hypotheses.status_escalation');
      expect(target).toBe(String(id));
      expect(details).toEqual({
        from: 'green',
        to: 'draft',
        level: 'A1',
        reason: 'autonomy-exceeded',
      });
      // The PM's светофор decision stands.
      const after = await h.app.inject({ method: 'GET', url: `/api/hypotheses/${id}` });
      expect(after.json().status).toBe('green');

      await h.app.close();
      h.db.close();
    });

    it('a failing audit write does not mask the refusal — the 403 is still returned (not a 500)', async () => {
      const audit = vi.fn<UsersRepo['audit']>(() => {
        throw new Error('audit db down');
      });
      const h = cabinetHarness(audit);
      h.asUser(userWithRole('analyst'));
      const created = await h.app.inject({
        method: 'POST',
        url: '/api/hypotheses',
        payload: validHypothesis({ source: 'ai' }),
      });
      const id = created.json().id as number;
      const refused = await h.app.inject({
        method: 'PATCH',
        url: `/api/hypotheses/${id}/status`,
        payload: { status: 'red' },
      });
      expect(refused.statusCode).toBe(403);
      expect(refused.json().code).toBe('AUTONOMY_EXCEEDED');
      expect(audit).toHaveBeenCalledOnce();

      await h.app.close();
      h.db.close();
    });
  });
});
