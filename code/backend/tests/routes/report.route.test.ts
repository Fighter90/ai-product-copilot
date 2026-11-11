import { describe, it, expect, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { GeneratedHypotheses, ReportSnapshot } from '@pca/shared';
import type { User, UsersRepo } from '../../src/auth/users-repo';
import { reportRoutes, type InsightsResult, type ReportRunner } from '../../src/routes/report';
import { createAiJobQueue } from '../../src/report/ai-job-queue';

const snap = {
  id: 'snap-1',
  generatedAt: 'T',
  period: { from: '2025-01-01', to: '2025-01-07' },
  kpi: { target: 300, b2cApplications: 7, b2bPaidTickets: 20, gap: 280 },
  channels: [],
  hypotheses: { problems: [], solutions: [] },
  decisions: [],
  b2bSummary: {
    totalTickets: 20,
    paidTickets: 20,
    dealsCount: 1,
    deals: [{ company: 'BigCorp', tickets: 20, stage: 'paid' }],
    byStage: [{ stage: 'paid', tickets: 20, deals: 1 }],
  },
  funnel: { visits: 100, b2cApplications: 7, b2bPipelineTickets: 0, b2bPaidTickets: 20 },
} as unknown as ReportSnapshot;

function appWith(runner: ReportRunner, opts: { users?: UsersRepo } = {}): FastifyInstance {
  const app = Fastify();
  // ANA-133: a fresh single-slot AI queue per app so tests never share job state.
  app.register(reportRoutes, { prefix: '/api', runner, aiJobs: createAiJobQueue(), ...opts });
  return app;
}

/** One macrotask turn — the queued AI job's setImmediate + promise bookkeeping lands. */
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('report routes', () => {
  it('POST /api/report/snapshot builds and returns a snapshot', async () => {
    const runner: ReportRunner = {
      build: vi.fn().mockResolvedValue(snap),
      get: vi.fn(),
      list: vi.fn().mockReturnValue([]),
      generate: vi.fn(),
      remove: vi.fn(),
      download: vi.fn(),
      insights: vi.fn(),
      hypotheses: vi.fn(),
    };
    const app = appWith(runner);
    const res = await app.inject({
      method: 'POST',
      url: '/api/report/snapshot',
      payload: { from: '2025-01-01', to: '2025-01-07' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBe('snap-1');
    // ANA-39: no authenticated user in this bare app → author is null.
    expect(runner.build).toHaveBeenCalledWith({ from: '2025-01-01', to: '2025-01-07', by: null });
    await app.close();
  });

  it('POST /api/report/snapshot records the authenticated author (ANA-39)', async () => {
    const runner: ReportRunner = {
      build: vi.fn().mockResolvedValue(snap),
      get: vi.fn(),
      list: vi.fn().mockReturnValue([]),
      generate: vi.fn(),
      remove: vi.fn(),
      download: vi.fn(),
      insights: vi.fn(),
      hypotheses: vi.fn(),
    };
    const app = appWith(runner);
    // Same decoration registerAuth performs; the getter yields a fresh user per request.
    app.decorateRequest('user', {
      getter: () =>
        ({
          id: 2,
          email: 'analyst@example.com',
          name: 'Analyst',
          role: 'analyst',
          isActive: true,
          locale: 'ru',
          createdAt: '',
          passwordHash: '',
        }) as unknown as User,
    });
    await app.inject({
      method: 'POST',
      url: '/api/report/snapshot',
      payload: { from: '2025-01-01', to: '2025-01-07' },
    });
    expect(runner.build).toHaveBeenCalledWith({
      from: '2025-01-01',
      to: '2025-01-07',
      by: 'analyst@example.com',
    });
    await app.close();
  });

  it('POST rejects an invalid body with 400', async () => {
    const app = appWith({
      build: vi.fn(),
      get: vi.fn(),
      list: vi.fn(),
      generate: vi.fn(),
      remove: vi.fn(),
      download: vi.fn(),
      insights: vi.fn(),
      hypotheses: vi.fn(),
    } as ReportRunner);
    const res = await app.inject({
      method: 'POST',
      url: '/api/report/snapshot',
      payload: { from: 1 },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('GET /api/report/snapshot/:id returns the snapshot or 404', async () => {
    const runner: ReportRunner = {
      build: vi.fn(),
      get: vi.fn((id: string) => (id === 'snap-1' ? snap : undefined)),
      list: vi.fn(),
      generate: vi.fn(),
      remove: vi.fn(),
      download: vi.fn(),
      insights: vi.fn(),
      hypotheses: vi.fn(),
    };
    const app = appWith(runner);
    const found = await app.inject({ method: 'GET', url: '/api/report/snapshot/snap-1' });
    expect(found.statusCode).toBe(200);
    const missing = await app.inject({ method: 'GET', url: '/api/report/snapshot/none' });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });

  it('GET /api/report/snapshots lists all snapshots', async () => {
    const summaries = [
      { id: 'snap-1', generatedAt: 'T1', dateFrom: '2025-01-01', dateTo: '2025-01-07' },
      { id: 'snap-2', generatedAt: 'T2', dateFrom: '2025-01-08', dateTo: '2025-01-14' },
    ];
    const runner: ReportRunner = {
      build: vi.fn(),
      get: vi.fn(),
      list: vi.fn().mockReturnValue(summaries),
      generate: vi.fn(),
      remove: vi.fn(),
      download: vi.fn(),
      insights: vi.fn(),
      hypotheses: vi.fn(),
    };
    const app = appWith(runner);
    const res = await app.inject({ method: 'GET', url: '/api/report/snapshots' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(summaries);
    await app.close();
  });

  it('POST /api/report/generate returns a file path, 400 on bad body, 404 on missing snapshot', async () => {
    const runner: ReportRunner = {
      build: vi.fn(),
      get: vi.fn(),
      list: vi.fn(),
      remove: vi.fn(),
      generate: vi.fn(async (id: string, format: string) =>
        id === 'snap-1' ? { filePath: `data/reports/snap-1.${format}` } : undefined,
      ),
      download: vi.fn(),
      insights: vi.fn(),
      hypotheses: vi.fn(),
    };
    const app = appWith(runner);

    const ok = await app.inject({
      method: 'POST',
      url: '/api/report/generate',
      payload: { snapshotId: 'snap-1', format: 'docx' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().filePath).toBe('data/reports/snap-1.docx');

    const pdf = await app.inject({
      method: 'POST',
      url: '/api/report/generate',
      payload: { snapshotId: 'snap-1', format: 'pdf' },
    });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.json().filePath).toBe('data/reports/snap-1.pdf');

    const bad = await app.inject({
      method: 'POST',
      url: '/api/report/generate',
      payload: { snapshotId: 'snap-1', format: 'xlsx' },
    });
    expect(bad.statusCode).toBe(400);

    const missing = await app.inject({
      method: 'POST',
      url: '/api/report/generate',
      payload: { snapshotId: 'none', format: 'docx' },
    });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });

  it('POST /api/report/insights enqueues a background job (202), the result arrives via the job poll (ANA-133)', async () => {
    const runner: ReportRunner = {
      build: vi.fn(),
      // ANA-133: the sync 404 pre-check reads the snapshot from the runner before enqueueing.
      get: vi.fn((id: string) => (id === 'ok' || id === 'nokey' ? snap : undefined)),
      list: vi.fn(),
      generate: vi.fn(),
      remove: vi.fn(),
      download: vi.fn(),
      insights: vi.fn(async (id: string) => {
        if (id === 'ok') return { ok: true as const, narrative: 'анализ' };
        return { ok: false as const, reason: 'unavailable' as const, message: 'no key' };
      }),
      hypotheses: vi.fn(),
    };
    const app = appWith(runner);

    const ok = await app.inject({
      method: 'POST',
      url: '/api/report/insights',
      payload: { snapshotId: 'ok' },
    });
    expect(ok.statusCode).toBe(202);
    const { jobId } = ok.json() as { jobId: string };
    expect(jobId).toBeTruthy();

    // The generation runs in the background; the job poll reports it.
    await settle();
    const done = await app.inject({ method: 'GET', url: `/api/report/ai-jobs/${jobId}` });
    expect(done.statusCode).toBe(200);
    expect(done.json()).toMatchObject({
      id: jobId,
      kind: 'insights',
      status: 'done',
      result: { narrative: 'анализ' },
    });

    // ANA-33: the optional providerId is forwarded to the runner inside the job.
    const pinned = await app.inject({
      method: 'POST',
      url: '/api/report/insights',
      payload: { snapshotId: 'ok', providerId: 'yandexgpt' },
    });
    expect(pinned.statusCode).toBe(202);
    await settle();
    expect(runner.insights).toHaveBeenCalledWith('ok', 'yandexgpt');
    const auto = await app.inject({
      method: 'POST',
      url: '/api/report/insights',
      payload: { snapshotId: 'ok', providerId: 'auto' },
    });
    expect(auto.statusCode).toBe(202);
    await settle();
    expect(runner.insights).toHaveBeenCalledWith('ok', 'auto');
    const noProvider = await app.inject({
      method: 'POST',
      url: '/api/report/insights',
      payload: { snapshotId: 'ok' },
    });
    expect(noProvider.statusCode).toBe(202);
    await settle();
    expect(runner.insights).toHaveBeenLastCalledWith('ok', undefined);
    // Unknown provider → validation error, not a silent fallback.
    const badProvider = await app.inject({
      method: 'POST',
      url: '/api/report/insights',
      payload: { snapshotId: 'ok', providerId: 'chatgpt' },
    });
    expect(badProvider.statusCode).toBe(400);

    // A runner failure (no AI key) becomes a failed job with the message — not a hung request.
    const nokey = await app.inject({
      method: 'POST',
      url: '/api/report/insights',
      payload: { snapshotId: 'nokey' },
    });
    expect(nokey.statusCode).toBe(202);
    await settle();
    const failed = await app.inject({
      method: 'GET',
      url: `/api/report/ai-jobs/${(nokey.json() as { jobId: string }).jobId}`,
    });
    expect(failed.json()).toMatchObject({ status: 'failed', error: 'no key' });

    // A missing snapshot is still rejected synchronously (no pointless job is created).
    const missing = await app.inject({
      method: 'POST',
      url: '/api/report/insights',
      payload: { snapshotId: 'missing' },
    });
    expect(missing.statusCode).toBe(404);
    expect(runner.insights).not.toHaveBeenCalledWith('missing', expect.anything());

    const bad = await app.inject({ method: 'POST', url: '/api/report/insights', payload: {} });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });

  it('ANA-133: 3 concurrent AI requests → 1 job runs, 2 get 429 with Retry-After', async () => {
    let release!: (r: InsightsResult) => void;
    const gate = new Promise<InsightsResult>((resolve) => {
      release = resolve;
    });
    const runner: ReportRunner = {
      build: vi.fn(),
      get: vi.fn(() => snap),
      list: vi.fn(),
      generate: vi.fn(),
      remove: vi.fn(),
      download: vi.fn(),
      insights: vi.fn(() => gate),
      hypotheses: vi.fn(),
    };
    const app = appWith(runner);

    const first = await app.inject({
      method: 'POST',
      url: '/api/report/insights',
      payload: { snapshotId: 'ok' },
    });
    expect(first.statusCode).toBe(202);
    const { jobId } = first.json() as { jobId: string };
    await settle(); // the job is running now

    // While the single slot is taken, further requests are throttled — not queued.
    const second = await app.inject({
      method: 'POST',
      url: '/api/report/insights',
      payload: { snapshotId: 'ok' },
    });
    const third = await app.inject({
      method: 'POST',
      url: '/api/report/hypotheses',
      payload: { snapshotId: 'ok' },
    });
    expect(second.statusCode).toBe(429);
    expect(second.headers['retry-after']).toBe('30');
    expect(second.json().code).toBe('AI_BUSY');
    expect(third.statusCode).toBe(429);
    expect(runner.insights).toHaveBeenCalledTimes(1);
    expect(runner.hypotheses).not.toHaveBeenCalled();

    release({ ok: true as const, narrative: 'анализ' });
    await settle();
    const done = await app.inject({ method: 'GET', url: `/api/report/ai-jobs/${jobId}` });
    expect(done.json().status).toBe('done');
    await app.close();
  });

  it('GET /api/report/ai-jobs/:jobId → 404 for an unknown id (job lost, e.g. after a restart)', async () => {
    const runner: ReportRunner = {
      build: vi.fn(),
      get: vi.fn(),
      list: vi.fn(),
      generate: vi.fn(),
      remove: vi.fn(),
      download: vi.fn(),
      insights: vi.fn(),
      hypotheses: vi.fn(),
    };
    const app = appWith(runner);
    const res = await app.inject({ method: 'GET', url: '/api/report/ai-jobs/nope' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('POST /api/report/hypotheses enqueues a background job (202), the result arrives via the job poll (ANA-133)', async () => {
    const fakeHypotheses: GeneratedHypotheses = { problems: [], solutions: [] };
    const runner: ReportRunner = {
      build: vi.fn(),
      get: vi.fn((id: string) => (id === 'ok' || id === 'nokey' ? snap : undefined)),
      list: vi.fn(),
      generate: vi.fn(),
      remove: vi.fn(),
      download: vi.fn(),
      insights: vi.fn(),
      hypotheses: vi.fn(async (id: string) => {
        if (id === 'ok') return { ok: true as const, hypotheses: fakeHypotheses };
        return { ok: false as const, reason: 'unavailable' as const, message: 'no key' };
      }),
    };
    const app = appWith(runner);

    const ok = await app.inject({
      method: 'POST',
      url: '/api/report/hypotheses',
      payload: { snapshotId: 'ok' },
    });
    expect(ok.statusCode).toBe(202);
    const { jobId } = ok.json() as { jobId: string };
    await settle();
    const done = await app.inject({ method: 'GET', url: `/api/report/ai-jobs/${jobId}` });
    expect(done.statusCode).toBe(200);
    expect(done.json()).toMatchObject({
      kind: 'hypotheses',
      status: 'done',
      result: { hypotheses: fakeHypotheses },
    });

    // ANA-33: the optional providerId is forwarded to the runner here as well.
    const pinned = await app.inject({
      method: 'POST',
      url: '/api/report/hypotheses',
      payload: { snapshotId: 'ok', providerId: 'gigachat' },
    });
    expect(pinned.statusCode).toBe(202);
    await settle();
    expect(runner.hypotheses).toHaveBeenCalledWith('ok', 'gigachat');

    // Runner failure inside the job → failed job with the message.
    const nokey = await app.inject({
      method: 'POST',
      url: '/api/report/hypotheses',
      payload: { snapshotId: 'nokey' },
    });
    expect(nokey.statusCode).toBe(202);
    await settle();
    const failed = await app.inject({
      method: 'GET',
      url: `/api/report/ai-jobs/${(nokey.json() as { jobId: string }).jobId}`,
    });
    expect(failed.json()).toMatchObject({ status: 'failed', error: 'no key' });

    const missing = await app.inject({
      method: 'POST',
      url: '/api/report/hypotheses',
      payload: { snapshotId: 'missing' },
    });
    expect(missing.statusCode).toBe(404);

    const bad = await app.inject({ method: 'POST', url: '/api/report/hypotheses', payload: {} });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });

  it('GET /api/report/download streams bytes with attachment headers, 404 / 400 otherwise', async () => {
    const runner: ReportRunner = {
      build: vi.fn(),
      get: vi.fn(),
      list: vi.fn(),
      generate: vi.fn(),
      remove: vi.fn(),
      download: vi.fn(async (id: string, format: 'docx' | 'pdf') =>
        id === 'snap-1'
          ? {
              body: Buffer.from('FILE-BYTES'),
              filename: `productcamp-report-snap-1.${format}`,
              contentType: format === 'pdf' ? 'application/pdf' : 'application/octet-stream',
            }
          : undefined,
      ),
      insights: vi.fn(),
      hypotheses: vi.fn(),
    };
    const app = appWith(runner);

    const ok = await app.inject({ method: 'GET', url: '/api/report/download/snap-1/docx' });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-disposition']).toContain('attachment');
    expect(ok.headers['content-disposition']).toContain('productcamp-report-snap-1.docx');
    expect(ok.body).toBe('FILE-BYTES');

    const missing = await app.inject({ method: 'GET', url: '/api/report/download/none/pdf' });
    expect(missing.statusCode).toBe(404);

    const bad = await app.inject({ method: 'GET', url: '/api/report/download/snap-1/xlsx' });
    expect(bad.statusCode).toBe(400);

    // ANA-42: ?lang=en is forwarded to the runner (ru stays the default).
    await app.inject({ method: 'GET', url: '/api/report/download/snap-1/docx' });
    expect(runner.download).toHaveBeenLastCalledWith('snap-1', 'docx', 'ru');
    await app.inject({ method: 'GET', url: '/api/report/download/snap-1/pdf?lang=en' });
    expect(runner.download).toHaveBeenLastCalledWith('snap-1', 'pdf', 'en');
    // Unknown lang degrades to ru instead of failing the download.
    await app.inject({ method: 'GET', url: '/api/report/download/snap-1/docx?lang=de' });
    expect(runner.download).toHaveBeenLastCalledWith('snap-1', 'docx', 'ru');
    await app.close();
  });
});

describe('DELETE /api/report/snapshots/:id (REG-10)', () => {
  const admin: User = {
    id: 1,
    email: 'admin@example.com',
    name: 'Admin',
    role: 'admin',
    isActive: true,
    locale: 'ru',
    createdAt: '',
    lastLoginAt: null,
  };
  const analyst: User = { ...admin, id: 2, email: 'analyst@example.com', role: 'analyst' };
  const fakeUsers = (): UsersRepo => ({ audit: vi.fn() }) as unknown as UsersRepo;

  function runnerWithRemove(): ReportRunner {
    return {
      build: vi.fn(),
      get: vi.fn(),
      list: vi.fn(),
      generate: vi.fn(),
      download: vi.fn(),
      remove: vi.fn((id: string) => id === 'snap-1'),
      insights: vi.fn(),
      hypotheses: vi.fn(),
    } as unknown as ReportRunner;
  }

  function asUser(app: FastifyInstance, user: User | null): void {
    // Same decoration registerAuth performs; the getter yields a fresh object per request.
    app.decorateRequest('user', { getter: () => user ?? undefined });
  }

  it('admin deletes a snapshot; the deletion is audited; unknown id → 404', async () => {
    const runner = runnerWithRemove();
    const users = fakeUsers();
    const app = appWith(runner, { users });
    asUser(app, admin);

    const ok = await app.inject({ method: 'DELETE', url: '/api/report/snapshots/snap-1' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ ok: true });
    expect(runner.remove).toHaveBeenCalledWith('snap-1');
    expect(users.audit).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'admin@example.com' }),
      'report.snapshot_delete',
      'snap-1',
    );

    const missing = await app.inject({ method: 'DELETE', url: '/api/report/snapshots/none' });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });

  it('analyst gets 403 — nothing is deleted and nothing is audited', async () => {
    const runner = runnerWithRemove();
    const users = fakeUsers();
    const app = appWith(runner, { users });
    asUser(app, analyst);

    const res = await app.inject({ method: 'DELETE', url: '/api/report/snapshots/snap-1' });
    expect(res.statusCode).toBe(403);
    expect(runner.remove).not.toHaveBeenCalled();
    expect(users.audit).not.toHaveBeenCalled();
    await app.close();
  });

  it('legacy mode (no users repo) allows deletion without a session', async () => {
    const runner = runnerWithRemove();
    const app = appWith(runner); // no users → legacy single-user mode

    const res = await app.inject({ method: 'DELETE', url: '/api/report/snapshots/snap-1' });
    expect(res.statusCode).toBe(200);
    expect(runner.remove).toHaveBeenCalledWith('snap-1');
    await app.close();
  });
});
