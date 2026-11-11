import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildTestApp, type TestApp } from './helpers';
import { validHypothesis } from '../db/helpers';
import type { NewDecision } from '@pca/shared';

let ctx: TestApp;
let hypothesisId: number;

beforeEach(() => {
  ctx = buildTestApp();
  hypothesisId = ctx.deps.hypotheses.create(validHypothesis()).id;
});
afterEach(async () => {
  await ctx.app.close();
  ctx.db.close();
});

function decision(over: Partial<NewDecision> = {}): NewDecision {
  return {
    hypothesisId,
    date: '2025-01-10',
    method: 'mixed',
    scope: '5 интервью',
    periodDays: 5,
    findings: [{ text: 'finding', confidence: 'medium' }],
    evidence: [{ quote: 'q', source: 's', rawResponseId: 1 }],
    outcome: 'yellow',
    outcomeRationale: 'partial',
    nextStep: 'next',
    decidedBy: 'team',
    ...over,
  };
}

describe('decisions API', () => {
  it('creates a decision (201), updating the hypothesis status, and lists/reads it', async () => {
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/decisions',
      payload: decision(),
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().number).toBe('DL-001');
    expect(ctx.deps.hypotheses.getById(hypothesisId)?.status).toBe('yellow');

    const list = await ctx.app.inject({ method: 'GET', url: '/api/decisions' });
    expect(list.json()).toHaveLength(1);

    const one = await ctx.app.inject({ method: 'GET', url: `/api/decisions/${created.json().id}` });
    expect(one.statusCode).toBe(200);
    const missing = await ctx.app.inject({ method: 'GET', url: '/api/decisions/9999' });
    expect(missing.statusCode).toBe(404);
  });

  it('rejects a decision without evidence (422)', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/decisions',
      payload: decision({ evidence: [] }),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('invalid decision');
  });

  it('rejects an incomplete body with 400 instead of 500 (REG-02)', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/decisions',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid body');
    expect(Array.isArray(res.json().issues)).toBe(true);
  });

  it('returns 500 on a non-validation error (bad hypothesis FK)', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/decisions',
      payload: decision({ hypothesisId: 9999 }),
    });
    expect(res.statusCode).toBe(500);
  });

  it('does not accept decisionType through POST (the type is not editable in MVP)', async () => {
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/decisions',
      payload: decision({ decisionType: 'legal' } as Partial<NewDecision>),
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().decisionType).toBeUndefined();
  });
});

describe('decision autonomy (ANA-137)', () => {
  it('GET /api/decisions/autonomy-matrix returns the static matrix and rules', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/decisions/autonomy-matrix' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.required).toBe('A1');
    expect(Object.keys(body.levels)).toEqual(['A0', 'A1', 'A2']);
    expect(Object.keys(body.matrix)).toEqual([
      'data-analysis',
      'hypothesis-draft',
      'experiment-launch',
      'pricing',
      'budget',
      'public-comms',
      'strategic',
      'legal',
    ]);
    expect(body.matrix['data-analysis'].maxAutonomy).toBe('A2');
    expect(body.matrix['hypothesis-draft'].maxAutonomy).toBe('A1');
    expect(body.matrix.legal.maxAutonomy).toBe('A0');
    expect(body.matrix['data-analysis'].label.length).toBeGreaterThan(0);
  });

  it('attaches the autonomy block to AI decisions and omits it for manual ones', async () => {
    ctx.deps.decisions.createAiDraft(decision({ decisionType: 'budget' }));
    await ctx.app.inject({ method: 'POST', url: '/api/decisions', payload: decision() });

    const list = await ctx.app.inject({ method: 'GET', url: '/api/decisions' });
    const rows = list.json() as Array<Record<string, unknown>>;
    const ai = rows.find((r) => r.source === 'ai')!;
    const manual = rows.find((r) => r.source === 'manual')!;
    expect(ai.autonomy).toEqual({
      type: 'budget',
      unclassified: false,
      maxAutonomy: 'A0',
      required: 'A1',
      escalation: { required: true, reason: 'autonomy-exceeded' },
    });
    expect(manual.autonomy).toBeUndefined();
  });

  it('assesses a legacy AI row with decision_type NULL conservatively (strategic / A0 / unclassified-type)', async () => {
    // An AI draft whose text the classifier could not type — stored without decision_type.
    ctx.deps.decisions.createAiDraft(decision());
    const list = await ctx.app.inject({ method: 'GET', url: '/api/decisions' });
    const ai = (list.json() as Array<Record<string, unknown>>).find((r) => r.source === 'ai')!;
    expect(ai.autonomy).toEqual({
      type: 'strategic',
      unclassified: true,
      maxAutonomy: 'A0',
      required: 'A1',
      escalation: { required: true, reason: 'unclassified-type' },
    });
  });
});
