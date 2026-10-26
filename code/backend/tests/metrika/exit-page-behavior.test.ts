import { describe, it, expect, vi } from 'vitest';
import { exitPageBehavior } from '../../src/metrika/queries/exit-page-behavior';
import type { MetrikaClient } from '../../src/metrika/client';

/**
 * Real Reporting API response (counter 54280963, 2026-10-12…19, ym:s:endURL, test-traffic filter
 * applied). Captured live while fixing ANA-15: `ym:s:exitURL` is rejected (error 4001), `endURL`
 * is the valid exit-page dimension. Note the two home-page variants (`/` and `/#ticketautum2026`)
 * that URL-normalisation must merge into one row.
 */
const REAL_EXIT_PAGE_RESPONSE = {
  query: {
    ids: 54280963,
    dimensions: ['ym:s:endURL'],
    metrics: ['ym:s:visits', 'ym:s:users', 'ym:s:bounceRate'],
    filters: "ym:s:isRobot!='yes' AND ym:s:startURL!~'^file:'",
    date1: '2026-10-12',
    date2: '2026-10-19',
    attribution: 'CROSS_DEVICE_LAST_SIGNIFICANT',
  },
  data: [
    {
      dimensions: [{ name: 'https://productcamp.ru/', favicon: 'productcamp.ru' }],
      metrics: [814.0, 622.0, 24.32432432],
    },
    {
      dimensions: [
        {
          name: 'https://productcamp.ru/registration_popup_pcnext_volunteer_contribution',
          favicon: 'productcamp.ru',
        },
      ],
      metrics: [48.0, 41.0, 6.25],
    },
    {
      dimensions: [{ name: 'https://productcamp.ru/#ticketautum2026', favicon: 'productcamp.ru' }],
      metrics: [23.0, 20.0, 21.73913043],
    },
    {
      dimensions: [
        {
          name: 'https://productcamp.ru/tilda/form2496617341/submitted/',
          favicon: 'productcamp.ru',
        },
      ],
      metrics: [20.0, 20.0, 0.0],
    },
  ],
  total_rows: 9,
  sampled: false,
};

function fakeClient(fixture: unknown): MetrikaClient {
  return { get: vi.fn(async () => fixture) } as unknown as MetrikaClient;
}

describe('exitPageBehavior', () => {
  it('queries ym:s:endURL — the live API rejects ym:s:exitURL (ANA-15)', async () => {
    const client = fakeClient({ data: [] });
    const get = (client as unknown as { get: ReturnType<typeof vi.fn> }).get;
    await exitPageBehavior(client, {
      counterId: 54280963,
      from: '2025-01-01',
      to: '2025-01-01',
    });
    const [, params] = get.mock.calls[0] as [string, Record<string, unknown>];
    expect(params['dimensions']).toBe('ym:s:endURL');
    expect(String(params['dimensions'])).not.toContain('exitURL');
    expect(params['attribution']).toBe('lastsign');
  });

  it('applies the shared test-traffic filter by default (ANA-22)', async () => {
    const client = fakeClient({ data: [] });
    const get = (client as unknown as { get: ReturnType<typeof vi.fn> }).get;
    await exitPageBehavior(client, {
      counterId: 1,
      from: '2025-01-01',
      to: '2025-01-01',
    });
    const [, params] = get.mock.calls[0] as [string, Record<string, unknown>];
    expect(params['filters']).toBe("ym:s:isRobot!='yes' AND ym:s:startURL!~'^file:'");
  });

  it('parses a real API response: maps rows and merges home-page URL variants', async () => {
    const { raw, stats } = await exitPageBehavior(fakeClient(REAL_EXIT_PAGE_RESPONSE), {
      counterId: 54280963,
      from: '2026-10-12',
      to: '2026-10-19',
    });
    expect(raw).toBe(REAL_EXIT_PAGE_RESPONSE);
    // 4 raw rows → 3 stats: `/` and `/#ticketautum2026` canonicalise to the same page.
    expect(stats).toHaveLength(3);
    const home = stats.find((s) => s.page === 'https://productcamp.ru/');
    expect(home).toMatchObject({ date: '2026-10-12', visits: 837, users: 642 });
    // API bounce is a percent; ratio() normalises it to a share.
    expect(home?.bounceRate).toBeCloseTo((24.32432432 * 814 + 21.73913043 * 23) / 837 / 100, 6);
    expect(stats.map((s) => s.page)).toEqual([
      'https://productcamp.ru/',
      'https://productcamp.ru/registration_popup_pcnext_volunteer_contribution',
      'https://productcamp.ru/tilda/form2496617341/submitted',
    ]);
  });

  it('maps exit-page rows without goal metrics', async () => {
    const client = fakeClient({
      data: [{ dimensions: [{ name: '/checkout' }], metrics: [40, 35, 60] }],
    });
    const { stats } = await exitPageBehavior(client, {
      counterId: 1,
      from: '2025-01-01',
      to: '2025-01-01',
    });
    expect(stats[0]).toEqual({
      date: '2025-01-01',
      page: '/checkout',
      visits: 40,
      users: 35,
      bounceRate: 0.6,
      goalReaches: 0,
      conversionRate: 0,
    });
  });

  it('includes goal metrics when goalId is set', async () => {
    const client = fakeClient({
      data: [{ dimensions: [{ name: '/checkout' }], metrics: [40, 35, 60, 2, 5] }],
    });
    const { stats } = await exitPageBehavior(client, {
      counterId: 1,
      from: '2025-01-02',
      to: '2025-01-02',
      goalId: 80,
    });
    expect(stats[0]?.goalReaches).toBe(2);
    expect(stats[0]?.conversionRate).toBe(0.05);
  });

  it('defaults null goal metrics to 0 even when goalId is set', async () => {
    const client = fakeClient({
      data: [{ dimensions: [{ name: '/checkout' }], metrics: [40, 35, 0.6, null, null] }],
    });
    const { stats } = await exitPageBehavior(client, {
      counterId: 1,
      from: '2025-01-04',
      to: '2025-01-04',
      goalId: 80,
    });
    expect(stats[0]?.goalReaches).toBe(0);
    expect(stats[0]?.conversionRate).toBe(0);
  });

  it('normalises a missing page to "(none)" and null metrics to 0', async () => {
    const client = fakeClient({
      data: [{ dimensions: [{ name: null }], metrics: [null, null, null] }],
    });
    const { stats } = await exitPageBehavior(client, {
      counterId: 1,
      from: '2025-01-03',
      to: '2025-01-03',
    });
    expect(stats[0]).toMatchObject({ page: '(none)', visits: 0, users: 0, bounceRate: 0 });
  });
});
