import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { dataCoverage, findGaps, MIN_GAP_DAYS } from '../../src/data/coverage';
import { b2bRoutes, parseB2bCsv } from '../../src/routes/b2b';
import { paymentsRoutes } from '../../src/routes/payments';
import { B2bRepo } from '../../src/db/repositories/b2b-repo';
import { B2cPaymentsRepo } from '../../src/db/repositories/b2c-payments-repo';
import { freshDb } from '../db/helpers';
import type { B2bDeal } from '@pca/shared';

const deal = (id: number, dateAdded: string, datePaid?: string): B2bDeal => ({
  id,
  company: `Company ${id}`,
  tickets: 2,
  stage: datePaid ? 'paid' : 'lead',
  dateAdded,
  ...(datePaid ? { datePaid } : {}),
});

describe('findGaps (ANA-72)', () => {
  it('reports a 7-day hole like the customer saw in the b2b sheet', () => {
    // 09.10 → (10..18 missing) → 19.10
    const gaps = findGaps('b2b_added', ['2026-10-09', '2026-10-19']);
    expect(gaps).toEqual([
      { kind: 'b2b_added', from: '2026-10-09', to: '2026-10-19', missingDays: 9 },
    ]);
    expect(gaps[0]!.missingDays).toBeGreaterThanOrEqual(MIN_GAP_DAYS);
  });

  it('ignores short intervals and duplicate dates', () => {
    expect(
      findGaps('b2c_payments', ['2026-10-01', '2026-10-02', '2026-10-02', '2026-10-04']),
    ).toEqual([]);
  });
});

describe('dataCoverage', () => {
  it('summarises the three series and merges sorted gaps', () => {
    const coverage = dataCoverage(
      { from: '2026-10-12', to: '2026-10-26', days: 15 },
      [deal(1, '2026-10-09'), deal(2, '2026-10-19'), deal(3, '2026-10-20', '2026-10-21')],
      [
        { date: '2026-10-01', tickets: 3, source: 'manual', updatedAt: '' },
        { date: '2026-10-15', tickets: 5, source: 'manual', updatedAt: '' },
      ],
    );
    expect(coverage.metrika).toEqual({ from: '2026-10-12', to: '2026-10-26', days: 15 });
    expect(coverage.b2b).toEqual({ firstAdded: '2026-10-09', lastAdded: '2026-10-20', count: 3 });
    expect(coverage.b2c).toEqual({ first: '2026-10-01', last: '2026-10-15', count: 2 });
    expect(coverage.gaps).toEqual([
      { kind: 'b2c_payments', from: '2026-10-01', to: '2026-10-15', missingDays: 13 },
      { kind: 'b2b_added', from: '2026-10-09', to: '2026-10-19', missingDays: 9 },
    ]);
  });

  it('empty data → nulls and no gaps', () => {
    const coverage = dataCoverage(null, [], []);
    expect(coverage.b2b.firstAdded).toBeNull();
    expect(coverage.gaps).toEqual([]);
  });
});

describe('GET /api/payments/coverage', () => {
  it('returns the coverage report over the DB contents', async () => {
    const db = freshDb();
    const b2b = new B2bRepo(db);
    const b2c = new B2cPaymentsRepo(db);
    b2b.create({
      company: 'ООО «Сбер»',
      tickets: 4,
      stage: 'paid',
      dateAdded: '2026-10-09',
      datePaid: '2026-10-10',
    });
    b2b.create({ company: 'ООО «ООО»', tickets: 2, stage: 'lead', dateAdded: '2026-10-19' });
    const now = () => '2026-10-27T00:00:00.000Z';
    b2c.upsert({ date: '2026-10-09', tickets: 1 }, { source: 'manual', now });
    b2c.upsert({ date: '2026-10-19', tickets: 2 }, { source: 'manual', now });

    const app = Fastify();
    await app.register(paymentsRoutes, {
      prefix: '/api',
      b2c,
      b2b,
      statsCoverage: () => ({ from: '2026-10-12', to: '2026-10-26', days: 15 }),
    });
    const res = await app.inject({ method: 'GET', url: '/api/payments/coverage' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.metrika).toEqual({ from: '2026-10-12', to: '2026-10-26', days: 15 });
    expect(body.b2b.count).toBe(2);
    expect(body.b2c.count).toBe(2);
    // The customer's hole: 09.10 → 19.10 in both b2b_added and b2c_payments.
    const kinds = body.gaps.map((g: { kind: string }) => g.kind).sort();
    expect(kinds).toEqual(['b2b_added', 'b2c_payments']);
    await app.close();
  });
});

describe('parseB2bCsv + POST /api/b2b/import (ANA-72 backfill)', () => {
  const csv = [
    'company,tickets,stage,date_added,date_paid,amount_rub,contact_email,notes',
    'ООО «Сбер»,4,paid,2026-10-09,2026-10-10,120000,mail@sber.ru,Осень',
    '"ООО, Ромашка",2,lead,2026-10-19,,,anna@rmk.ru,',
  ].join('\n');

  it('parses quoted companies, validates rows, keeps the header out', () => {
    const { rows, errors } = parseB2bCsv(csv);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      company: 'ООО «Сбер»',
      tickets: 4,
      stage: 'paid',
      datePaid: '2026-10-10',
      amountRub: 120000,
    });
    expect(rows[1]).toMatchObject({ company: 'ООО, Ромашка', stage: 'lead', datePaid: undefined });
  });

  it('imports deals, skips exact duplicates on re-import, reports bad rows', async () => {
    const app = Fastify();
    await app.register(b2bRoutes, { prefix: '/api', repo: new B2bRepo(freshDb()) });

    const first = await app.inject({
      method: 'POST',
      url: '/api/b2b/import',
      payload: { csv },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ imported: 2, skipped: 0, errors: [] });

    // Re-importing the same file is safe — exact duplicates are skipped.
    const second = await app.inject({
      method: 'POST',
      url: '/api/b2b/import',
      payload: { csv },
    });
    expect(second.json()).toMatchObject({ imported: 0, skipped: 2 });

    const listed = await app.inject({ method: 'GET', url: '/api/b2b' });
    expect(listed.json()).toHaveLength(2);
    expect(listed.json()[0]).toMatchObject({
      company: 'ООО «Сбер»',
      stage: 'paid',
      datePaid: '2026-10-10',
    });

    const bad = await app.inject({
      method: 'POST',
      url: '/api/b2b/import',
      payload: { csv: 'BadCo,0,lead,2026-10-01\n,3,lead,2026-10-02' },
    });
    expect(bad.json().errors).toHaveLength(2);

    const noCsv = await app.inject({ method: 'POST', url: '/api/b2b/import', payload: {} });
    expect(noCsv.statusCode).toBe(400);
    await app.close();
  });
});
