import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildTestApp, type TestApp } from './helpers';
import { validHypothesis } from '../db/helpers';

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

  it('rejects an incomplete hypothesis with 422 and the error list', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/hypotheses',
      payload: validHypothesis({ hiddenAssumptions: [{ category: 'behavior', text: 'x' }] }),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('invalid hypothesis');
    expect(Array.isArray(res.json().issues)).toBe(true);
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
