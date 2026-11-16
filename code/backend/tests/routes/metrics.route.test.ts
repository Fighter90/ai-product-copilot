import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { metricsRoutes } from '../../src/routes/metrics';
import type { MetricsRepo } from '../../src/db/repositories/metrics-repo';

// ANA-139 (12.11 prod feedback): GET /metrics/gaps is the machine-readable «Метрика vs дашборд»
// hole report — the evidence JSON for the UTM reconciliation and the refill source.
describe('GET /api/metrics/gaps', () => {
  function appWith(repo: Partial<MetricsRepo>): ReturnType<typeof Fastify> {
    const app = Fastify();
    app.register(metricsRoutes, { prefix: '/api', repo: repo as MetricsRepo });
    return app;
  }

  it('returns the per-table missing-day ranges for the requested window', async () => {
    const statGaps = vi
      .fn()
      .mockReturnValue({ channels: [], utm: [{ from: '2025-01-02', to: '2025-01-05' }] });
    const app = appWith({ statsCoverageGaps: statGaps });
    const res = await app.inject({ url: '/api/metrics/gaps?from=2025-01-01&to=2025-01-07' });
    expect(res.statusCode).toBe(200);
    expect(statGaps).toHaveBeenCalledWith('2025-01-01', '2025-01-07');
    expect(res.json()).toEqual({
      from: '2025-01-01',
      to: '2025-01-07',
      tables: { channels: [], utm: [{ from: '2025-01-02', to: '2025-01-05' }] },
    });
    await app.close();
  });

  it('requires both window bounds with 400 otherwise', async () => {
    const app = appWith({ statsCoverageGaps: vi.fn() });
    const missing = await app.inject({ url: '/api/metrics/gaps' });
    expect(missing.statusCode).toBe(400);
    const half = await app.inject({ url: '/api/metrics/gaps?from=2025-01-01' });
    expect(half.statusCode).toBe(400);
    expect(half.json().error).toBe('from and to are required');
    await app.close();
  });

  // ANA-139 (round-3 review): a garbage date made statsCoverageGaps iterate zero days → a
  // clean-looking «всё покрыто» report for an invalid window. Reject the format up front.
  it('rejects a malformed window with 400 and never asks the repo', async () => {
    const statGaps = vi.fn();
    const app = appWith({ statsCoverageGaps: statGaps });
    const malformed = [
      'from=not-a-date&to=2025-01-07',
      'from=2025-01-01&to=07.01.2025',
      'from=2025-13-01&to=2025-01-07',
      'from=2025-02-30&to=2025-03-01',
    ];
    for (const q of malformed) {
      const res = await app.inject({ url: `/api/metrics/gaps?${q}` });
      expect(res.statusCode, q).toBe(400);
      expect(res.json().error).toBe('from and to must be YYYY-MM-DD');
    }
    expect(statGaps).not.toHaveBeenCalled();
    await app.close();
  });
});
