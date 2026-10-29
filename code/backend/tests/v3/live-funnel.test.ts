import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { liveRoutes, type LiveDeps, type LiveGoal } from '../../src/live/live';
import type { MetrikaClient } from '../../src/metrika/client';

/** ANA-35: «Визит» → pc-goals → «Оплата» and the role application funnels. */

const action = (id: number, event: string): LiveGoal =>
  ({ id, name: event, type: 'action', conditions: [{ type: 'exact', url: event }] }) as LiveGoal;

/** Reaches per goal id: deterministic so the ratios are easy to assert. */
const REACHES: Record<number, number> = {
  1: 400, // price_view
  2: 200, // cta_click
  3: 100, // reg_open
  4: 50, // cart_open
  5: 20, // reg_step1
  6: 8, // payment_success
  20: 40, // clevel_view
  21: 30, // clevel_form_start (alias)
  22: 15, // clevel_part1
  // clevel_part2 not configured
  24: 5, // clevel_apply
  30: 7, // clevel_view — REG-06 scenario: stale intermediate goal
  32: 24, // clevel_apply — REG-06 scenario: outgrows the previous step
};

let app: FastifyInstance;

async function build(goals: LiveGoal[], over: Partial<LiveDeps> = {}): Promise<void> {
  const get = async (path: string, params: Record<string, unknown>) => {
    if (path.includes('/goals')) return { goals };
    const metrics = String(params.metrics).split(',');
    if (metrics[0] === 'ym:s:visits') return { data: [], totals: [1000] };
    const totals = metrics.map((m) => REACHES[Number(/goal(\d+)reaches/.exec(m)?.[1])] ?? 0);
    return { data: [], totals };
  };
  app = Fastify({ logger: false });
  await app.register(liveRoutes, {
    prefix: '/api',
    token: () => 'tok',
    counterId: () => 1,
    clientFactory: () => ({ get }) as unknown as MetrikaClient,
    today: () => '2026-10-24',
    ...over,
  });
  await app.ready();
}

afterEach(async () => {
  await app.close();
});

const BASE = [
  action(1, 'price_view'),
  action(2, 'cta_click'),
  action(3, 'reg_open'),
  action(4, 'cart_open'),
  action(5, 'reg_step1'),
];

describe('GET /live/funnel — Визит … Оплата', () => {
  it('first step is the visits, last is a payment goal when the counter has one', async () => {
    await build([...BASE, action(6, 'payment_success')]);
    const body = (await app.inject({ method: 'GET', url: '/api/live/funnel' })).json();
    const keys = body.stages.map((s: { key: string }) => s.key);
    expect(keys).toEqual([
      'visits',
      'price_view',
      'cta_click',
      'reg_open',
      'cart_open',
      'reg_step1',
      'payment',
    ]);
    expect(body.stages[0]).toMatchObject({ ru: 'Визит', value: 1000, source: 'visits' });
    const pay = body.stages.at(-1);
    expect(pay).toMatchObject({ ru: 'Оплата', value: 8, goalId: 6, source: 'goal' });
    expect(pay.fromPrevious).toBeCloseTo(8 / 20);
    expect(pay.fromFirst).toBeCloseTo(8 / 1000);
    // Optional events never show up as missing goals.
    expect(body.missing).not.toContain('payment_success');
    expect(body.missing).not.toContain('clevel_view');
  });

  it('falls back to manual payments (B2B paid in the period) without a payment goal', async () => {
    const calls: Array<[string, string]> = [];
    await build(BASE, {
      manualPayments: (from, to) => {
        calls.push([from, to]);
        return 12;
      },
    });
    const body = (
      await app.inject({ method: 'GET', url: '/api/live/funnel?from=2026-10-19&to=2026-10-24' })
    ).json();
    expect(body.stages.at(-1)).toMatchObject({ value: 12, goalId: null, source: 'manual' });
    expect(calls).toEqual([['2026-10-19', '2026-10-24']]);
  });

  it('reports source "none" with null ratios when payments are not tracked at all', async () => {
    await build(BASE);
    const body = (await app.inject({ method: 'GET', url: '/api/live/funnel' })).json();
    expect(body.stages.at(-1)).toMatchObject({
      value: 0,
      source: 'none',
      fromPrevious: null,
      fromFirst: null,
    });
  });
});

describe('GET /live/funnel — role funnels', () => {
  it('C-level: view → start → part1 → part2 → apply, aliases resolved, gaps are null', async () => {
    await build([
      ...BASE,
      action(20, 'clevel_view'),
      action(21, 'clevel_form_start'),
      action(22, 'clevel_part1'),
      action(24, 'clevel_apply'),
    ]);
    const body = (await app.inject({ method: 'GET', url: '/api/live/funnel' })).json();
    expect(body.roleFunnels.map((f: { key: string }) => f.key)).toEqual([
      'clevel',
      'speaker',
      'volunteer',
      'partner',
    ]);
    const clevel = body.roleFunnels[0];
    expect(clevel.steps.map((s: { key: string; value: number }) => [s.key, s.value])).toEqual([
      ['view', 40],
      ['start', 30],
      ['part1', 15],
      ['part2', 0],
      ['apply', 5],
    ]);
    expect(clevel.steps[0].fromPrevious).toBeNull();
    expect(clevel.steps[1]).toMatchObject({ goalId: 21, fromPrevious: 30 / 40 });
    expect(clevel.steps[3]).toMatchObject({ goalId: null, fromPrevious: null });
    // part2 is missing → apply is compared to part1, the closest configured step.
    expect(clevel.steps[4].fromPrevious).toBeCloseTo(5 / 15);
    // Speaker has no goals at all: zeros and no ratios.
    const speaker = body.roleFunnels[1];
    expect(speaker.steps.every((s: { goalId: number | null }) => s.goalId === null)).toBe(true);
  });

  it('REG-06: a step outgrowing the previous one reports no ratio; the chain keeps its values', async () => {
    // Only view (stale, 7) and apply (24) exist in the counter — apply «converts» 342.9 %.
    await build([...BASE, action(30, 'clevel_view'), action(32, 'clevel_apply')]);
    const body = (await app.inject({ method: 'GET', url: '/api/live/funnel' })).json();
    const clevel = body.roleFunnels[0];
    expect(clevel.steps.map((s: { key: string; value: number }) => [s.key, s.value])).toEqual([
      ['view', 7],
      ['start', 0],
      ['part1', 0],
      ['part2', 0],
      ['apply', 24],
    ]);
    // 24/7 > 100 % → the ratio is dropped, not shown.
    expect(clevel.steps[4].fromPrevious).toBeNull();
    // The intermediate gap (start, no goal) does not zero the chain — apply keeps its 24.
    expect(clevel.steps[1]).toMatchObject({ goalId: null, value: 0, fromPrevious: null });
  });
});
