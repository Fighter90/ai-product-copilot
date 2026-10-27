import { describe, it, expect, vi } from 'vitest';
import { utmBreakdown, utmMetrics } from '../../src/metrika/queries/utm-breakdown';
import type { MetrikaClient } from '../../src/metrika/client';

function fakeClient(fixture: unknown): MetrikaClient {
  return { get: vi.fn(async () => fixture) } as unknown as MetrikaClient;
}

describe('utmMetrics', () => {
  it('returns the base two metrics without a goal', () => {
    expect(utmMetrics().split(',')).toEqual(['ym:s:visits', 'ym:s:users']);
  });

  it('appends goal metrics when a goalId is given', () => {
    const metrics = utmMetrics(80);
    expect(metrics).toContain('ym:s:goal80reaches');
    expect(metrics).toContain('ym:s:goal80conversionRate');
  });
});

describe('utmBreakdown', () => {
  it('requests last-significant UTM dimensions and no isRobot filter (ANA-65 findings 1+2)', async () => {
    // Same reasoning as trafficBySource: plain UTMSource dims are last-click and disagree with
    // the live screens; isRobot + breakdown silently drops small rows (contains_sensitive_data).
    const client = fakeClient({ data: [] });
    await utmBreakdown(client, { counterId: 1, from: '2025-01-01', to: '2025-01-01' });
    const [, params] = (client.get as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(params['dimensions']).toBe(
      'ym:s:lastsignUTMSource,ym:s:lastsignUTMMedium,ym:s:lastsignUTMCampaign',
    );
    expect(params['filters']).toBe("ym:s:startURL!~'^file:'");
    expect(JSON.stringify(params)).not.toContain('isRobot');
  });

  it('maps source/medium/campaign rows without goal metrics', async () => {
    const client = fakeClient({
      data: [
        {
          dimensions: [{ name: 'vk' }, { name: 'cpc' }, { name: 'spring' }],
          metrics: [100, 90],
        },
      ],
    });
    const { stats } = await utmBreakdown(client, {
      counterId: 1,
      from: '2025-01-01',
      to: '2025-01-01',
    });
    expect(stats[0]).toEqual({
      date: '2025-01-01',
      utmSource: 'vk',
      utmMedium: 'cpc',
      utmCampaign: 'spring',
      visits: 100,
      users: 90,
      goalReaches: 0,
      conversionRate: 0,
    });
  });

  it('includes goal metrics when goalId is set', async () => {
    const client = fakeClient({
      data: [
        {
          dimensions: [{ name: 'vk' }, { name: 'cpc' }, { name: 'spring' }],
          metrics: [100, 90, 7, 7],
        },
      ],
    });
    const { stats } = await utmBreakdown(client, {
      counterId: 1,
      from: '2025-01-02',
      to: '2025-01-02',
      goalId: 80,
    });
    expect(stats[0]?.goalReaches).toBe(7);
    expect(stats[0]?.conversionRate).toBe(0.07);
  });

  it('defaults null goal metrics to 0 even when goalId is set', async () => {
    const client = fakeClient({
      data: [
        {
          dimensions: [{ name: 'vk' }, { name: 'cpc' }, { name: 'spring' }],
          metrics: [100, 90, null, null],
        },
      ],
    });
    const { stats } = await utmBreakdown(client, {
      counterId: 1,
      from: '2025-01-04',
      to: '2025-01-04',
      goalId: 80,
    });
    expect(stats[0]?.goalReaches).toBe(0);
    expect(stats[0]?.conversionRate).toBe(0);
  });

  it('normalises missing dimensions to "(none)" and null metrics to 0', async () => {
    const client = fakeClient({
      data: [{ dimensions: [{ name: null }], metrics: [null, null] }],
    });
    const { stats } = await utmBreakdown(client, {
      counterId: 1,
      from: '2025-01-03',
      to: '2025-01-03',
    });
    expect(stats[0]).toMatchObject({
      utmSource: '(none)',
      utmMedium: '(none)',
      utmCampaign: '(none)',
      visits: 0,
      users: 0,
    });
  });
});
