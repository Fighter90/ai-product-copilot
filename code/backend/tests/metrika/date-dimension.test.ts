import { describe, it, expect, vi } from 'vitest';
import { trafficBySource } from '../../src/metrika/queries/traffic-by-source';
import { utmBreakdown } from '../../src/metrika/queries/utm-breakdown';
import { geoDeviceBreakdown } from '../../src/metrika/queries/geo-device-breakdown';
import { browserOsBreakdown } from '../../src/metrika/queries/browser-os-breakdown';
import { newReturningBreakdown } from '../../src/metrika/queries/new-returning';
import { rangeLimit, RANGE_MAX_DAYS } from '../../src/metrika/queries/date-dimension';
import type { MetrikaClient } from '../../src/metrika/client';

/**
 * ANA-113: the range variant (one request for the whole window, `ym:s:date` prepended) must
 * produce EXACTLY the rows the per-day loop produces — same dates, same business dimensions,
 * same metrics. This is the mapping half of the quota optimisation; the live-API diff runs
 * against prod data after a real sync (see openspec/changes/metrika-quota-5000/tasks.md 1.2).
 */

type Row = { dimensions: Array<{ name: string | null }>; metrics: number[] };

const days = ['2025-03-01', '2025-03-02'] as const;
/** One distinct business value per dimension column (col i → COL_VALUES[i]). */
const COL_VALUES = ['alpha', 'beta', 'gamma'] as const;

const cases = [
  {
    fn: trafficBySource,
    baseDims: ['ym:s:lastsignTrafficSource'],
    keys: ['channel'],
  },
  {
    fn: utmBreakdown,
    baseDims: ['ym:s:lastsignUTMSource', 'ym:s:lastsignUTMMedium', 'ym:s:lastsignUTMCampaign'],
    keys: ['utmSource', 'utmMedium', 'utmCampaign'],
  },
  {
    fn: geoDeviceBreakdown,
    baseDims: ['ym:s:regionCountry', 'ym:s:deviceCategory'],
    keys: ['country', 'device'],
  },
  {
    fn: browserOsBreakdown,
    baseDims: ['ym:s:browser', 'ym:s:operatingSystem'],
    keys: ['browser', 'os'],
  },
  {
    fn: newReturningBreakdown,
    baseDims: ['ym:s:isNewUser'],
    keys: ['segment'],
  },
] as const;

/** One row per day: business columns filled from COL_VALUES. */
function perDayRows(cols: number): Row[] {
  return [
    {
      dimensions: Array.from({ length: cols }, (_, i) => ({ name: COL_VALUES[i] ?? 'v' })),
      metrics: [10, 8, 1, 0.125],
    },
  ];
}
/** Range shape: the date column first, then the same business columns — one row per day. */
function rangeRows(cols: number): Row[] {
  return days.map((d) => ({
    dimensions: [
      { name: d },
      ...Array.from({ length: cols }, (_, i) => ({ name: COL_VALUES[i] ?? 'v' })),
    ],
    metrics: [10, 8, 1, 0.125],
  }));
}

function fakeClient(fixture: unknown) {
  return { get: vi.fn(async () => fixture) } as unknown as MetrikaClient;
}

describe('ANA-113 range queries', () => {
  for (const c of cases) {
    describe(c.fn.name, () => {
      it('range request prepends ym:s:date and raises the row cap', async () => {
        const client = fakeClient({ data: [] });
        await c.fn(client, {
          counterId: 1,
          from: '2025-03-01',
          to: '2025-03-02',
          dateDimension: true,
        });
        const [, params] = (client.get as ReturnType<typeof vi.fn>).mock.calls[0] as [
          string,
          Record<string, unknown>,
        ];
        expect(params['dimensions']).toBe(`ym:s:date,${c.baseDims.join(',')}`);
        expect(params['limit']).toBe(10_000);
        expect(params['date1']).toBe('2025-03-01');
        expect(params['date2']).toBe('2025-03-02');
      });

      it('per-day mode stays unchanged (no ym:s:date, no limit)', async () => {
        const client = fakeClient({ data: [] });
        await c.fn(client, { counterId: 1, from: '2025-03-01', to: '2025-03-01' });
        const [, params] = (client.get as ReturnType<typeof vi.fn>).mock.calls[0] as [
          string,
          Record<string, unknown>,
        ];
        expect(params['dimensions']).toBe(c.baseDims.join(','));
        expect(params).not.toHaveProperty('limit');
      });

      it('range mapping ≡ per-day mapping (dates from ym:s:date, business dims shifted)', async () => {
        // Per-day: one call per day, date = opts.from, business dims from index 0.
        const perDay = [];
        for (const d of days) {
          const { stats } = await c.fn(fakeClient({ data: perDayRows(c.baseDims.length) }), {
            counterId: 1,
            from: d,
            to: d,
          });
          perDay.push(...stats);
        }
        // Range: one call, date from the first dimension, business dims shifted by one.
        const { stats: ranged } = await c.fn(fakeClient({ data: rangeRows(c.baseDims.length) }), {
          counterId: 1,
          from: days[0],
          to: days[1],
          dateDimension: true,
        });
        expect(ranged).toEqual(perDay);
        // Sanity: business keys carry the values (not the date column), dates cover both days.
        for (const [i, key] of c.keys.entries()) {
          expect(ranged.map((r) => (r as unknown as Record<string, string>)[key])).toEqual(
            days.map(() => COL_VALUES[i]),
          );
        }
        expect(ranged.map((r) => (r as { date: string }).date)).toEqual([...days]);
      });
    });
  }

  it('rangeLimit off → no extra params; RANGE_MAX_DAYS guards the row cap', () => {
    expect(rangeLimit(undefined)).toEqual({});
    expect(rangeLimit(false)).toEqual({});
    expect(rangeLimit(true)).toEqual({ limit: 10_000 });
    expect(RANGE_MAX_DAYS).toBe(31);
  });
});
