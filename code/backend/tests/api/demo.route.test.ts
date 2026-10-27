import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildTestApp, type TestApp } from './helpers';
import { B2cPaymentsRepo } from '../../src/db/repositories/b2c-payments-repo';
import { B2bRepo } from '../../src/db/repositories/b2b-repo';

describe('GET /api/demo/status (ANA-18)', () => {
  let t: TestApp;
  beforeEach(() => {
    t = buildTestApp();
  });
  afterEach(() => t.db.close());

  it('reports demo: false on a live-only database', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/demo/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ demo: false, counts: expect.any(Object) });
    const counts = res.json().counts as Record<string, number>;
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
  });

  it('flips to demo: true when any table carries demo-marked rows', async () => {
    const b2b = new B2bRepo(t.db);
    b2b.create({
      company: 'BigCorp',
      tickets: 20,
      stage: 'paid',
      dateAdded: '2025-01-02',
      isDemo: true,
    });
    const res = await t.app.inject({ method: 'GET', url: '/api/demo/status' });
    const body = res.json();
    expect(body.demo).toBe(true);
    expect(body.counts.b2b).toBe(1);
  });

  it('counts demo B2C payment rows too (seed writes them)', async () => {
    const b2c = new B2cPaymentsRepo(t.db);
    b2c.upsert(
      { date: '2025-01-01', tickets: 6 },
      { source: 'manual', isDemo: true, now: () => 'T' },
    );
    const res = await t.app.inject({ method: 'GET', url: '/api/demo/status' });
    expect(res.json().counts.b2c).toBe(1);
  });
});
