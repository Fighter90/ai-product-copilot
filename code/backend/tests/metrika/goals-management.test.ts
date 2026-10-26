import { describe, it, expect, vi, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MetrikaClient, MetrikaHttpError, type FetchLike } from '../../src/metrika/client';
import type { RateLimiter } from '../../src/utils/rate-limiter';
import {
  archiveGoal,
  createGoal,
  describeGoalError,
  GoalInputError,
  parseGoalSpec,
  unarchiveGoal,
} from '../../src/metrika/goals-management';

const noLimiter = { take: () => 0 } as unknown as RateLimiter;

function res(body: unknown, init: { ok?: boolean; status?: number; text?: string } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
    text: async () => init.text ?? '',
  };
}

function clientOf(fetchFn: ReturnType<typeof vi.fn>): MetrikaClient {
  return new MetrikaClient({
    token: 'secret',
    baseUrl: 'https://api.example',
    fetchFn: fetchFn as unknown as FetchLike,
    limiter: noLimiter,
    sleep: vi.fn().mockResolvedValue(undefined),
    jitter: () => 0,
    retries: 3,
    errorDumpDir: join(tmpdir(), 'pca-dump-goals'),
    now: () => 1,
  });
}

const created = {
  goal: { id: 222, name: 'MyGoal', type: 'url', conditions: [{ type: 'contains', url: '/cart' }] },
};

afterEach(() => vi.clearAllMocks());

describe('createGoal', () => {
  it('POSTs the spec wrapped in the {"goal": ...} envelope and returns the created goal', async () => {
    const fetchFn = vi.fn().mockResolvedValue(res(created));
    const goal = await createGoal(clientOf(fetchFn), 123, {
      name: 'MyGoal',
      type: 'url',
      conditions: [{ type: 'contains', url: '/cart' }],
    });
    expect(goal.id).toBe(222);

    const [url, init] = fetchFn.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('https://api.example/management/v1/counter/123/goals');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      Authorization: 'OAuth secret',
      'Content-Type': 'application/json',
    });
    // The documented envelope: an unwrapped body fails with 400 "must not be null, location goal".
    expect(JSON.parse(init.body as string)).toEqual({
      goal: { name: 'MyGoal', type: 'url', conditions: [{ type: 'contains', url: '/cart' }] },
    });
  });

  it('passes a JS-event (action) goal with `value` conditions through unchanged', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(res({ goal: { id: 7, name: 'flag', type: 'action' } }));
    const spec = {
      name: 'flag',
      type: 'action' as const,
      conditions: [{ type: 'exact' as const, url: 'window.flag' }],
    };
    await createGoal(clientOf(fetchFn), 123, spec);
    const [, init] = fetchFn.mock.calls[0] as [string, Record<string, unknown>];
    expect(JSON.parse(init.body as string).goal.conditions).toEqual([
      { type: 'exact', url: 'window.flag' },
    ]);
  });
});

describe('archiveGoal / unarchiveGoal', () => {
  it('POSTs to the SINGULAR goal archive endpoint, forwarding folderid when given', async () => {
    const fetchFn = vi.fn().mockResolvedValue(res({ success: true }));
    await archiveGoal(clientOf(fetchFn), 123, 456, 3);
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe('https://api.example/management/v1/counter/123/goal/456/archive?folderid=3');
    expect(init?.method).toBe('POST');
  });

  it('omits folderid when not given', async () => {
    const fetchFn = vi.fn().mockResolvedValue(res({ success: true }));
    await archiveGoal(clientOf(fetchFn), 123, 456);
    expect(fetchFn.mock.calls[0]?.[0]).toBe(
      'https://api.example/management/v1/counter/123/goal/456/archive',
    );
  });

  it('restores via the unarchive counterpart', async () => {
    const fetchFn = vi.fn().mockResolvedValue(res({ success: true }));
    await unarchiveGoal(clientOf(fetchFn), 123, 456);
    expect(fetchFn.mock.calls[0]?.[0]).toBe(
      'https://api.example/management/v1/counter/123/goal/456/unarchive',
    );
  });
});

describe('parseGoalSpec validation (fails before any HTTP call)', () => {
  const fetchFn = vi.fn();
  const cases: Array<[string, unknown]> = [
    ['empty name', { name: '', type: 'url', conditions: [{ type: 'contains', url: '/x' }] }],
    [
      'unknown type',
      { name: 'x', type: 'teleport', conditions: [{ type: 'contains', url: '/x' }] },
    ],
    ['url goal without conditions', { name: 'x', type: 'url' }],
    ['action goal without conditions', { name: 'x', type: 'action' }],
    ['step goal without steps', { name: 'x', type: 'step' }],
    ['not an object', 'url-goal'],
  ];
  for (const [label, input] of cases) {
    it(`rejects ${label}`, () => {
      expect(() => parseGoalSpec(input)).toThrow(GoalInputError);
      expect(fetchFn).not.toHaveBeenCalled();
    });
  }

  it('accepts the valid url / action / step specs from the task brief', () => {
    expect(
      parseGoalSpec({ name: 'a', type: 'url', conditions: [{ type: 'contains', url: '/p' }] }).type,
    ).toBe('url');
    expect(
      parseGoalSpec({
        name: 'b',
        type: 'action',
        conditions: [{ type: 'exact', url: 'window.flag' }],
      }).type,
    ).toBe('action');
    expect(parseGoalSpec({ name: 'c', type: 'step', steps: [{ name: 's1' }] }).type).toBe('step');
    // types that need no conditions
    expect(parseGoalSpec({ name: 'd', type: 'number', depth: 2 }).type).toBe('number');
  });
});

describe('error handling', () => {
  it('surfaces a Metrika 400 (e.g. missing goal envelope / bad params) as MetrikaHttpError', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        res(
          { errors: [{ error_type: 'invalid_parameter' }] },
          { ok: false, status: 400, text: 'must not be null, location goal' },
        ),
      );
    await expect(
      createGoal(clientOf(fetchFn), 123, {
        name: 'x',
        type: 'url',
        conditions: [{ type: 'contains', url: '/p' }],
      }),
    ).rejects.toThrow('must not be null, location goal');
    // 4xx is NOT retried (non-idempotent write).
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('retries a 429 then succeeds', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(res({}, { ok: false, status: 429, text: 'limit' }))
      .mockResolvedValueOnce(res(created));
    const goal = await createGoal(clientOf(fetchFn), 123, {
      name: 'MyGoal',
      type: 'url',
      conditions: [{ type: 'contains', url: '/cart' }],
    });
    expect(goal.id).toBe(222);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe('describeGoalError', () => {
  const mk = (status: number, text: string) =>
    new MetrikaHttpError(status, `Metrika ${status}: ${text}`);

  it('maps "No object with specified ID" to a 404 GOAL_NOT_FOUND', () => {
    const mapped = describeGoalError(mk(400, 'No object with specified ID'));
    expect(mapped).toMatchObject({ status: 404, code: 'GOAL_NOT_FOUND' });
  });

  it('explains 403 as missing edit rights and 429 as rate limit', () => {
    expect(describeGoalError(mk(403, 'access denied'))).toMatchObject({
      status: 403,
      code: 'METRIKA_FORBIDDEN',
    });
    expect(describeGoalError(mk(403, 'access denied'))?.message).toContain('metrika:write');
    expect(describeGoalError(mk(429, 'limit'))?.code).toBe('RATE_LIMITED');
  });

  it('keeps other statuses with the API text attached; passes non-Metrika errors through', () => {
    expect(describeGoalError(mk(401, 'Invalid oauth_token'))?.code).toBe('METRIKA_UNAUTHORIZED');
    expect(describeGoalError(mk(420, 'weird'))).toMatchObject({
      status: 420,
      code: 'METRIKA_ERROR',
    });
    expect(describeGoalError(new Error('boom'))).toBeUndefined();
  });
});
