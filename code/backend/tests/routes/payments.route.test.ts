import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { DB } from '../../src/db/connection';
import { freshDb } from '../db/helpers';
import { B2cPaymentsRepo } from '../../src/db/repositories/b2c-payments-repo';
import { B2bRepo } from '../../src/db/repositories/b2b-repo';
import type { User } from '../../src/auth/users-repo';
import { paymentsRoutes, parsePaymentsCsv } from '../../src/routes/payments';

/**
 * ANA-19: manual B2C payments — Metrika only sees orders, so paid B2C tickets are entered per day
 * (or CSV-imported) here. «Оплачено» = B2C paid + B2B paid (GET /payments/summary).
 */
describe('payments routes (ANA-19)', () => {
  let db: DB;
  let app: FastifyInstance;

  const build = (): void => {
    db = freshDb();
    app = Fastify();
    app.register(paymentsRoutes, {
      prefix: '/api',
      b2c: new B2cPaymentsRepo(db),
      b2b: new B2bRepo(db),
      now: () => '2026-10-27T00:00:00.000Z',
    });
  };

  afterEach(async () => {
    await app?.close();
    db?.close();
  });

  it('PUT /payments/b2c upserts one day; GET lists it; a second PUT replaces the day', async () => {
    build();
    const put = await app.inject({
      method: 'PUT',
      url: '/api/payments/b2c',
      payload: { date: '2026-10-20', tickets: 7, amountRub: 98000, note: 'sat evening' },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ date: '2026-10-20', tickets: 7, source: 'manual' });

    const put2 = await app.inject({
      method: 'PUT',
      url: '/api/payments/b2c',
      payload: { date: '2026-10-20', tickets: 9 },
    });
    expect(put2.statusCode).toBe(200);

    const list = await app.inject({ method: 'GET', url: '/api/payments/b2c' });
    expect(list.json()).toHaveLength(1); // one row per ISO day
    expect(list.json()[0]).toMatchObject({ tickets: 9 });
  });

  it('rejects an invalid body with 400', async () => {
    build();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/payments/b2c',
      payload: { date: '20.10.2026', tickets: -3 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid body');
  });

  // Security pass v3.3.x: unbounded numbers would silently poison the «Оплачено» KPI and every
  // report snapshot (1e21 IS an integer in JS — min(0) alone does not save the totals).
  it('rejects absurd magnitudes with 400 (tickets/amountRub upper bounds)', async () => {
    build();
    for (const payload of [
      { date: '2026-10-20', tickets: 1e21 }, // integer per Number.isInteger, still absurd
      { date: '2026-10-20', tickets: 3, amountRub: -1 },
      { date: '2026-10-20', tickets: 3, amountRub: 1e12 },
      { date: '2026-10-20', tickets: 2.5 },
      { date: '2026-10-20', tickets: '5' }, // strings are not numbers
    ]) {
      const res = await app.inject({ method: 'PUT', url: '/api/payments/b2c', payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
    const list = await app.inject({ method: 'GET', url: '/api/payments/b2c' });
    expect(list.json()).toHaveLength(0); // nothing leaked in
  });

  it('records updatedBy for manual entry and CSV import (row-level attribution)', async () => {
    build();
    // Same decoration registerAuth performs; the getter yields a fresh object per request.
    app.decorateRequest('user', {
      getter: () => ({ id: 2, email: 'analyst@x.ru', role: 'analyst' }) as unknown as User,
    });
    await app.inject({
      method: 'PUT',
      url: '/api/payments/b2c',
      payload: { date: '2026-10-20', tickets: 7 },
    });
    await app.inject({
      method: 'POST',
      url: '/api/payments/b2c/import',
      payload: { csv: '2026-10-21,4\n' },
    });
    const list = await app.inject({ method: 'GET', url: '/api/payments/b2c' });
    expect(list.json()).toEqual([
      expect.objectContaining({ date: '2026-10-20', updatedBy: 'analyst@x.ru' }),
      expect.objectContaining({ date: '2026-10-21', updatedBy: 'analyst@x.ru' }),
    ]);
  });

  it('DELETE /payments/b2c/:date removes the day (204) or 404', async () => {
    build();
    await app.inject({
      method: 'PUT',
      url: '/api/payments/b2c',
      payload: { date: '2026-10-20', tickets: 7 },
    });
    const ok = await app.inject({ method: 'DELETE', url: '/api/payments/b2c/2026-10-20' });
    expect(ok.statusCode).toBe(204);
    const missing = await app.inject({ method: 'DELETE', url: '/api/payments/b2c/2026-10-20' });
    expect(missing.statusCode).toBe(404);
  });

  it('POST /payments/b2c/import parses date,tickets[,amount] rows and reports bad lines', async () => {
    build();
    const res = await app.inject({
      method: 'POST',
      url: '/api/payments/b2c/import',
      payload: {
        csv: 'date,tickets,amount\n2026-10-19,4,56000\n2026-10-20,6\noops,x\n',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ imported: 2, skipped: 1 });
    const list = await app.inject({ method: 'GET', url: '/api/payments/b2c' });
    expect(list.json()).toHaveLength(2);
    expect(list.json()[0]).toMatchObject({ source: 'csv', note: 'CSV import' });
  });

  // Security pass v3.3.x: hostile/malformed CSV lines are skipped, never partially imported.
  it('import rejects unbounded tickets, negative amounts and formula-looking cells', async () => {
    build();
    const res = await app.inject({
      method: 'POST',
      url: '/api/payments/b2c/import',
      payload: {
        csv: [
          'date,tickets,amount',
          '2026-10-19,1000000000000000000000000', // 1e24 — "integer", still absurd
          '2026-10-19,3,-5', // negative amount (manual entry rejects it too)
          '2026-10-19,=1+1', // spreadsheet formula, not a number
          '2026-10-19,', // empty tickets would coerce to 0
          '2026-10-19,2,1000000000000', // amount above the bound
        ].join('\n'),
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ imported: 0, skipped: 5, errors: expect.any(Array) });
    expect((await app.inject({ method: 'GET', url: '/api/payments/b2c' })).json()).toHaveLength(0);
  });

  it('GET /payments/summary returns «Оплачено» = B2C paid + B2B paid, honouring the range', async () => {
    build();
    const b2c = new B2cPaymentsRepo(db);
    b2c.upsert({ date: '2026-10-19', tickets: 4 }, { source: 'csv', now: () => 'T' });
    b2c.upsert({ date: '2026-10-25', tickets: 6 }, { source: 'manual', now: () => 'T' });
    const b2b = new B2bRepo(db);
    b2b.create({
      company: 'Acme',
      tickets: 20,
      stage: 'paid',
      dateAdded: '2026-10-01',
      datePaid: '2026-10-20',
    });
    b2b.create({
      company: 'Unpaid',
      tickets: 50,
      stage: 'invoiced',
      dateAdded: '2026-10-01',
    });

    const all = await app.inject({ method: 'GET', url: '/api/payments/summary' });
    expect(all.json()).toEqual({ b2cPaid: 10, b2bPaid: 20, paid: 30, days: 2 });

    const ranged = await app.inject({
      method: 'GET',
      url: '/api/payments/summary?from=2026-10-21&to=2026-10-31',
    });
    expect(ranged.json()).toEqual({ b2cPaid: 6, b2bPaid: 0, paid: 6, days: 1 });
  });
});

describe('parsePaymentsCsv (ANA-19)', () => {
  it('skips the header row and blank lines, accepts ; and tab separators', () => {
    const { rows, errors } = parsePaymentsCsv('Дата;Билеты\n2026-10-19;4;56000\n\n2026-10-20\t6\n');
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { date: '2026-10-19', tickets: 4, amountRub: 56000, note: 'CSV import' },
      { date: '2026-10-20', tickets: 6, amountRub: undefined, note: 'CSV import' },
    ]);
  });

  it('collects per-line errors without aborting the import', () => {
    const { rows, errors } = parsePaymentsCsv('2026-13-99,1\n2026-10-21,-2\n2026-10-22,3\n');
    expect(rows).toHaveLength(1);
    expect(errors).toEqual([
      { line: 1, message: 'bad date "2026-13-99" (YYYY-MM-DD expected)' },
      { line: 2, message: 'bad tickets "-2"' },
    ]);
  });

  // Security pass v3.3.x: the parser enforces the same bounds as the manual-entry zod schema.
  it('rejects unbounded tickets and negative amounts (same bounds as manual entry)', () => {
    const { rows, errors } = parsePaymentsCsv(
      '2026-10-21,1000000000000000000000\n2026-10-21,3,-5\n2026-10-21,3,1000000000000\n',
    );
    expect(rows).toEqual([]);
    expect(errors.map((e) => e.message)).toEqual([
      'bad tickets "1000000000000000000000"',
      'bad amount "-5"',
      'bad amount "1000000000000"',
    ]);
  });
});
