import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { DB } from '../../src/db/connection';
import { freshDb } from '../db/helpers';
import { B2cPaymentsRepo } from '../../src/db/repositories/b2c-payments-repo';
import { B2bRepo } from '../../src/db/repositories/b2b-repo';
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
});
