import { describe, it, expect, vi } from 'vitest';
import type { MetrikaClient } from '../../src/metrika/client';
import {
  auditGoals,
  compareWithReference,
  fetchGoalReaches,
  findDead,
  findDuplicates,
  normalizeGoalName,
} from '../../src/metrika/goals-audit';
import {
  assertWritePermission,
  describeGoalError,
  isArchivedGoal,
  WritePermissionError,
  type CounterGoal,
} from '../../src/metrika/goals-management';
import { findRef, PC_GOALS_REFERENCE, refGoalSpec } from '../../src/metrika/pc-goals-reference';
import { PC_FUNNEL_GOAL_STEPS, ROLE_EVENTS, TICKET_TYPES } from '../../src/live/live';

const g = (
  id: number,
  name: string,
  type: string,
  conditions: Array<{ type: string; url: string }> = [],
  status?: string,
): CounterGoal => ({ id, name, type, conditions, ...(status ? { status } : {}) });

describe('PC_GOALS_REFERENCE', () => {
  it('covers exactly the events the live funnel reads, coded G-01…G-18', () => {
    const live = [
      ...PC_FUNNEL_GOAL_STEPS.map((s) => s.event),
      ...TICKET_TYPES.flatMap((t) => [
        `ticket_pick_${t}`,
        `ticket_buy_${t}`,
        `ticket_checkout_${t}`,
      ]),
      ...ROLE_EVENTS.map((r) => r.event),
    ];
    expect(PC_GOALS_REFERENCE.map((r) => r.event).sort()).toEqual([...live].sort());
    expect(PC_GOALS_REFERENCE[0]!.code).toBe('G-01');
    expect(PC_GOALS_REFERENCE.at(-1)!.code).toBe('G-18');
    for (const r of PC_GOALS_REFERENCE) {
      expect(r.type).toBe('action');
      expect(r.condition).toEqual({ type: 'exact', url: r.event });
    }
  });

  it('findRef resolves by code or event; refGoalSpec is a valid action/exact spec', () => {
    expect(findRef('g-05')?.event).toBe('reg_step1');
    expect(findRef('speaker_apply')?.group).toBe('role');
    expect(findRef('nope')).toBeUndefined();
    expect(refGoalSpec(findRef('price_view')!)).toEqual({
      name: 'G-01 Увидел блок билетов (price_view)',
      type: 'action',
      conditions: [{ type: 'exact', url: 'price_view' }],
    });
  });
});

describe('compareWithReference', () => {
  it('present / mismatch (type, condition type, name) / missing (+archived restore hint)', () => {
    const rows = compareWithReference([
      g(1, 'Price', 'action', [{ type: 'exact', url: 'price_view' }]),
      g(2, 'CTA', 'url', [{ type: 'exact', url: 'cta_click' }]),
      g(3, 'Reg', 'action', [{ type: 'regexp', url: 'reg_open' }]),
      g(4, 'G-04 корзина', 'action', [{ type: 'exact', url: 'cart' }]),
      g(5, 'Old', 'action', [{ type: 'exact', url: 'reg_step1' }], 'Archived'),
    ]);
    const by = (e: string) => rows.find((r) => r.ref.event === e)!;
    expect(by('price_view')).toMatchObject({ status: 'present', goalId: 1 });
    expect(by('cta_click')).toMatchObject({ status: 'mismatch', goalId: 2 });
    expect(by('cta_click').issues).toEqual(['type: url (expected action)']);
    expect(by('reg_open').issues).toEqual(['condition type: regexp (expected exact)']);
    expect(by('cart_open')).toMatchObject({ status: 'mismatch', goalId: 4 });
    expect(by('cart_open').issues?.[0]).toMatch(/expected exact:cart_open/);
    expect(by('reg_step1')).toMatchObject({ status: 'missing', archivedGoalId: 5 });
    expect(by('volunteer_apply')).toMatchObject({ status: 'missing' });
    expect(by('volunteer_apply').spec.conditions).toEqual([
      { type: 'exact', url: 'volunteer_apply' },
    ]);
  });
});

describe('findDuplicates / findDead', () => {
  const goals = [
    g(1, 'Price', 'action', [{ type: 'exact', url: 'price_view' }]),
    g(2, 'Price copy', 'action', [{ type: 'exact', url: 'price_view' }]),
    g(3, 'Контакты', 'url', [{ type: 'contain', url: '/contacts' }]),
    g(4, '  контакты. ', 'url', [{ type: 'start', url: '/contacts' }]),
    g(5, 'Arch', 'action', [{ type: 'exact', url: 'price_view' }], 'Archived'),
    g(6, 'Phone', 'phone'),
  ];

  it('groups identical type+conditions and same normalized names; ignores archived', () => {
    const groups = findDuplicates(goals);
    expect(groups).toEqual([
      {
        reason: 'conditions',
        key: 'action|exact:price_view',
        goals: [
          { id: 1, name: 'Price', type: 'action', reference: 'G-01' },
          { id: 2, name: 'Price copy', type: 'action', reference: null },
        ],
      },
      {
        reason: 'name',
        key: 'контакты',
        goals: [
          { id: 3, name: 'Контакты', type: 'url', reference: null },
          { id: 4, name: '  контакты. ', type: 'url', reference: null },
        ],
      },
    ]);
  });

  it('dead = active goals with 0 reaches in the window (unknown reaches are not dead)', () => {
    const dead = findDead(
      goals,
      new Map([
        [1, 10],
        [2, 0],
        [3, 0],
        [5, 0],
      ]),
    );
    expect(dead.map((d) => d.id)).toEqual([2, 3]);
    expect(findDead(goals, new Map([[1, 0]]))[0]).toMatchObject({ id: 1, reference: 'G-01' });
  });

  it('auditGoals lists all goals with archived flag and reference code', () => {
    const a = auditGoals(goals, new Map());
    expect(a.goals.find((x) => x.id === 5)).toMatchObject({ archived: true, reference: null });
    expect(a.goals.find((x) => x.id === 1)).toMatchObject({ archived: false, reference: 'G-01' });
    expect(a.dead).toEqual([]);
  });

  it('normalizeGoalName / isArchivedGoal', () => {
    expect(normalizeGoalName('[archive]  Ёлка  ЗАКАЗ!')).toBe('елка заказ');
    expect(isArchivedGoal({ status: 'Archived' })).toBe(true);
    expect(isArchivedGoal({ status: 'Active' })).toBe(false);
    expect(isArchivedGoal({})).toBe(false);
  });
});

describe('fetchGoalReaches', () => {
  it('chunks 20 goal metrics per Reporting API request over NdaysAgo..today', async () => {
    const get = vi.fn(async (_p: string, params: { metrics: string }) => ({
      data: [],
      totals: params.metrics.split(',').map((_, i) => i),
    }));
    const ids = Array.from({ length: 25 }, (_, i) => i + 1);
    const out = await fetchGoalReaches({ get } as unknown as MetrikaClient, 7, ids, 90);
    expect(get).toHaveBeenCalledTimes(2);
    const [path, params] = get.mock.calls[0]!;
    expect(path).toBe('/stat/v1/data');
    expect(params).toMatchObject({ ids: 7, date1: '90daysAgo', date2: 'today' });
    expect(params.metrics.split(',')).toHaveLength(20);
    expect(out.get(1)).toBe(0);
    expect(out.get(21)).toBe(0);
    expect(out.get(25)).toBe(4);
  });
});

describe('assertWritePermission', () => {
  const clientWith = (permission?: string) =>
    ({ get: vi.fn(async () => ({ counter: { permission } })) }) as unknown as MetrikaClient;

  it('refuses a view-only grant with the metrika:write message', async () => {
    await expect(assertWritePermission(clientWith('view'), 1)).rejects.toBeInstanceOf(
      WritePermissionError,
    );
    const mapped = describeGoalError(new WritePermissionError('view'));
    expect(mapped).toMatchObject({ status: 403, code: 'METRIKA_WRITE_FORBIDDEN' });
    expect(mapped?.message).toMatch(/токену нужен доступ metrika:write/);
  });

  it('passes edit / own / unknown', async () => {
    await expect(assertWritePermission(clientWith('edit'), 1)).resolves.toBeUndefined();
    await expect(assertWritePermission(clientWith('own'), 1)).resolves.toBeUndefined();
    await expect(assertWritePermission(clientWith(undefined), 1)).resolves.toBeUndefined();
  });
});
