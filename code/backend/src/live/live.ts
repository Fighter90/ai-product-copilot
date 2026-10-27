import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MetrikaClient } from '../metrika/client';

/** Loose Reporting API shape — we only need dimensions/metrics/totals. */
const StatSchema = z.object({
  data: z.array(
    z.object({
      dimensions: z.array(z.record(z.string(), z.unknown())),
      metrics: z.array(z.number().nullable()),
    }),
  ),
  totals: z.array(z.number().nullable()).optional(),
  total_rows: z.number().optional(),
  sampled: z.boolean().optional(),
});
type Stat = z.infer<typeof StatSchema>;

const GoalsSchema = z.object({
  goals: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      type: z.string(),
      conditions: z
        .array(z.object({ type: z.string().optional(), url: z.string().optional() }))
        .optional(),
      steps: z.array(z.unknown()).optional(),
      archived: z.boolean().optional(),
      status: z.string().optional(),
    }),
  ),
});
export type LiveGoal = z.infer<typeof GoalsSchema>['goals'][number];

/** Funnel stages built from the pc-goals JS events on productcamp.ru (see docs/goals.md). */
export const PC_FUNNEL: ReadonlyArray<{ key: string; event: string; ru: string; en: string }> = [
  { key: 'price_view', event: 'price_view', ru: 'Увидел блок билетов', en: 'Saw ticket block' },
  { key: 'cta_click', event: 'cta_click', ru: 'Клик по CTA', en: 'CTA click' },
  { key: 'reg_open', event: 'reg_open', ru: 'Открыл регистрацию', en: 'Opened registration' },
  { key: 'cart_open', event: 'cart_open', ru: 'Открыл корзину', en: 'Opened cart' },
  {
    key: 'reg_step1',
    event: 'reg_step1',
    ru: 'Оставил контакты (заказ)',
    en: 'Left contacts (order)',
  },
];

/**
 * Steps of PC_FUNNEL backed by a pc-goals JS event (the audit reference uses only these).
 * In the current funnel shape every step is goal-backed, so this is PC_FUNNEL itself; the
 * visits/payment split and the filtered version live in the upcoming live.ts refactor —
 * replace this alias with it when that lands.
 */
export const PC_FUNNEL_GOAL_STEPS = PC_FUNNEL;

export const TICKET_TYPES = ['standard', 'optimal', 'max'] as const;

export const ROLE_EVENTS: ReadonlyArray<{ key: string; event: string; ru: string; en: string }> = [
  {
    key: 'volunteer',
    event: 'volunteer_apply',
    ru: 'Заявка волонтёра',
    en: 'Volunteer application',
  },
  { key: 'speaker', event: 'speaker_apply', ru: 'Заявка спикера', en: 'Speaker application' },
  { key: 'clevel', event: 'clevel_apply', ru: 'Заявка C-level', en: 'C-level application' },
  { key: 'partner', event: 'partner_apply', ru: 'Заявка партнёра', en: 'Partner application' },
];

/** JS event identifier of an `action` goal, if any. */
export const eventOf = (g: LiveGoal): string | undefined =>
  g.type === 'action' ? g.conditions?.find((c) => c.url)?.url : undefined;

/** Status of a goal from reaches over 14 and 90 days. */
export function goalStatus(r14: number, r90: number): 'live' | 'sleeping' | 'dead' {
  if (r14 > 0) return 'live';
  if (r90 > 0) return 'sleeping';
  return 'dead';
}

/**
 * Metrika's archive state of a goal: the explicit `archived` flag wins, otherwise the free-form
 * Management API `status` ("Archived"). The frontend hides archived goals unless the
 * «Архивные цели» filter is on.
 */
export const isArchivedLiveGoal = (g: Pick<LiveGoal, 'archived' | 'status'>): boolean =>
  g.archived ?? /archiv/i.test(g.status ?? '');

/** Group goals whose type + conditions are identical (duplicates). */
export function duplicateGroups(goals: LiveGoal[]): Map<number, number[]> {
  const sig = new Map<string, number[]>();
  for (const g of goals) {
    if (!g.conditions?.length) continue;
    const key = `${g.type}|${JSON.stringify([...g.conditions].map((c) => [c.type, c.url]).sort())}`;
    sig.set(key, [...(sig.get(key) ?? []), g.id]);
  }
  const out = new Map<number, number[]>();
  for (const ids of sig.values())
    if (ids.length > 1)
      for (const id of ids)
        out.set(
          id,
          ids.filter((x) => x !== id),
        );
  return out;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const Range = z.object({
  from: z.string().regex(ISO).optional(),
  to: z.string().regex(ISO).optional(),
  test: z.enum(['0', '1']).optional(),
});

/** Visit filter that drops test traffic marked by pc-goals (`env: test`) and sandbox URLs. */
export const TEST_FILTER = "ym:s:startURL!~'^file:'";

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Previous period of the same length, ending the day before `from`. */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const len = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  return { from: shiftDays(from, -len), to: shiftDays(from, -1) };
}

/** Small TTL cache so live mode never hammers Metrika quotas (default 60 s). */
export class TtlCache {
  private readonly m = new Map<string, { at: number; v: unknown }>();
  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}
  async get<T>(
    key: string,
    load: () => Promise<T>,
    ttl = this.ttlMs,
  ): Promise<{ value: T; cachedAt: number }> {
    const hit = this.m.get(key);
    if (hit && this.now() - hit.at < ttl) return { value: hit.v as T, cachedAt: hit.at };
    const v = await load();
    const at = this.now();
    this.m.set(key, { at, v });
    if (this.m.size > 500) this.m.delete(this.m.keys().next().value!);
    return { value: v, cachedAt: at };
  }
}

export interface LiveDeps {
  readonly token: () => string;
  readonly counterId: () => number;
  readonly orderGoalId?: () => number;
  readonly tz?: string;
  readonly clientFactory?: (token: string) => MetrikaClient;
  readonly cache?: TtlCache;
  readonly today?: () => string;
}

const dimName = (d: Record<string, unknown>): string => String(d.name ?? d.id ?? '(не определено)');

/** Live Reporting API routes (real-time mode + data grids + goal drill-down). */
export async function liveRoutes(app: FastifyInstance, deps: LiveDeps): Promise<void> {
  const cache = deps.cache ?? new TtlCache(60_000);
  const today =
    deps.today ??
    (() => new Date().toLocaleDateString('sv-SE', { timeZone: deps.tz ?? 'Europe/Moscow' }));
  const client = () =>
    (deps.clientFactory ?? ((t) => new MetrikaClient({ token: t, retries: 2 })))(deps.token());

  const ready = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
    if (!deps.token() || !deps.counterId()) {
      reply.code(409).send({ error: 'Metrika is not configured', code: 'METRIKA_NOT_CONFIGURED' });
      return false;
    }
    return true;
  };

  const stat = (params: Record<string, string | number | undefined>, ttl?: number) =>
    cache.get(
      JSON.stringify(params),
      () =>
        client().get(
          '/stat/v1/data',
          { ids: deps.counterId(), accuracy: 'full', lang: 'ru', ...params },
          StatSchema,
        ),
      ttl,
    );

  const goals = () =>
    cache.get(
      `goals:${deps.counterId()}`,
      async () =>
        (await client().get(`/management/v1/counter/${deps.counterId()}/goals`, {}, GoalsSchema))
          .goals,
      10 * 60_000,
    );

  const period = (q: unknown, reply?: { code(c: number): { send(b: unknown): unknown } }) => {
    const parsed = Range.safeParse(q ?? {});
    if (!parsed.success) {
      reply?.code(400).send({ error: 'invalid range' });
      return null;
    }
    const p = parsed.data;
    const to = p.to ?? today();
    const from = p.from ?? to;
    return { from, to, filters: p.test === '1' ? undefined : TEST_FILTER };
  };

  /** Real-time summary: totals for the period, by hour when it is a single day. */
  app.get('/live/summary', async (req, reply) => {
    if (!ready(reply)) return;
    const pr = period(req.query, reply);
    if (!pr) return;
    const { from, to, filters } = pr;
    const single = from === to;
    const metrics =
      'ym:s:visits,ym:s:users,ym:s:pageviews,ym:s:bounceRate,ym:s:avgVisitDurationSeconds';
    const [totals, series] = await Promise.all([
      stat({ metrics, date1: from, date2: to, filters }),
      stat({
        metrics: 'ym:s:visits,ym:s:users',
        dimensions: single ? 'ym:s:hour' : 'ym:s:date',
        sort: single ? 'ym:s:hour' : 'ym:s:date',
        date1: from,
        date2: to,
        filters,
        limit: 400,
      }),
    ]);
    const t = totals.value.totals ?? totals.value.data[0]?.metrics ?? [];
    return {
      from,
      to,
      updatedAt: new Date(totals.cachedAt).toISOString(),
      totals: {
        visits: t[0] ?? 0,
        users: t[1] ?? 0,
        pageviews: t[2] ?? 0,
        bounceRate: t[3] ?? 0,
        avgDurationSec: t[4] ?? 0,
      },
      series: series.value.data.map((r) => ({
        bucket: dimName(r.dimensions[0] ?? {}),
        visits: r.metrics[0] ?? 0,
        users: r.metrics[1] ?? 0,
      })),
    };
  });

  /** All goals with reaches / conversion for the period vs the previous one (+ status, duplicates). */
  app.get('/live/goals', async (req, reply) => {
    if (!ready(reply)) return;
    const pr = period(req.query, reply);
    if (!pr) return;
    const { from, to, filters } = pr;
    const prev = previousPeriod(from, to);
    const list = (await goals()).value;
    const dupes = duplicateGroups(list);
    // Metrika allows 20 metrics per request: the current period asks reaches + converted visits
    // (10 goals/request), comparison periods only reaches (20 goals/request).
    const reach = async (d1: string, d2: string, withVisits: boolean, ttl?: number) => {
      const out = new Map<number, { reaches: number; goalVisits: number }>();
      const per = withVisits ? 10 : 20;
      for (let i = 0; i < list.length; i += per) {
        const chunk = list.slice(i, i + per);
        const metrics = chunk
          .flatMap((g) =>
            withVisits
              ? [`ym:s:goal${g.id}reaches`, `ym:s:goal${g.id}visits`]
              : [`ym:s:goal${g.id}reaches`],
          )
          .join(',');
        const r = await stat({ metrics, date1: d1, date2: d2, filters }, ttl);
        const t = r.value.totals ?? r.value.data[0]?.metrics ?? [];
        const w = withVisits ? 2 : 1;
        chunk.forEach((g, j) =>
          out.set(g.id, {
            reaches: t[j * w] ?? 0,
            goalVisits: withVisits ? (t[j * w + 1] ?? 0) : 0,
          }),
        );
      }
      return out;
    };
    const end = today();
    const visits = (await stat({ metrics: 'ym:s:visits', date1: from, date2: to, filters })).value;
    const totalVisits = (visits.totals ?? [0])[0] ?? 0;
    const [cur, before, d14, d90] = await Promise.all([
      reach(from, to, true),
      reach(prev.from, prev.to, false, 30 * 60_000),
      reach(shiftDays(end, -13), end, false, 30 * 60_000),
      reach(shiftDays(end, -89), end, false, 60 * 60_000),
    ]);
    return {
      from,
      to,
      previous: prev,
      visits: totalVisits,
      updatedAt: new Date().toISOString(),
      goals: list.map((g) => {
        const c = cur.get(g.id)!;
        const p = before.get(g.id)!;
        return {
          id: g.id,
          name: g.name,
          type: g.type,
          event: eventOf(g) ?? null,
          reaches: c.reaches,
          goalVisits: c.goalVisits,
          conversionRate: totalVisits ? (c.goalVisits / totalVisits) * 100 : 0,
          previousReaches: p.reaches,
          delta: p.reaches > 0 ? (c.reaches - p.reaches) / p.reaches : c.reaches > 0 ? 1 : 0,
          reaches14: d14.get(g.id)!.reaches,
          reaches90: d90.get(g.id)!.reaches,
          status: goalStatus(d14.get(g.id)!.reaches, d90.get(g.id)!.reaches),
          archived: isArchivedLiveGoal(g),
          duplicateOf: dupes.get(g.id) ?? [],
        };
      }),
    };
  });

  /** Drill-down of one goal: series + breakdowns by source, UTM, entry page, device, country. */
  app.get('/live/goals/:id', async (req, reply) => {
    if (!ready(reply)) return;
    const id = Number((req.params as { id: string }).id);
    const pr = period(req.query, reply);
    if (!pr) return;
    const { from, to, filters } = pr;
    const g = (await goals()).value.find((x) => x.id === id);
    if (!g) return reply.code(404).send({ error: 'goal not found' });
    const m = `ym:s:visits,ym:s:goal${id}reaches,ym:s:goal${id}conversionRate`;
    const single = from === to;
    const by = (dimension: string, limit = 50) =>
      stat({
        metrics: m,
        dimensions: dimension,
        date1: from,
        date2: to,
        filters,
        sort: `-ym:s:goal${id}reaches`,
        limit,
      });
    const [series, source, utm, page, device, country] = await Promise.all([
      stat({
        metrics: m,
        dimensions: single ? 'ym:s:hour' : 'ym:s:date',
        sort: single ? 'ym:s:hour' : 'ym:s:date',
        date1: from,
        date2: to,
        filters,
        limit: 400,
      }),
      by('ym:s:lastsignTrafficSource'),
      by('ym:s:lastsignUTMSource'),
      by('ym:s:startURLPath'),
      by('ym:s:deviceCategory', 10),
      by('ym:s:regionCountry', 20),
    ]);
    const rows = (s: Stat) =>
      s.data.map((r) => ({
        key: dimName(r.dimensions[0] ?? {}),
        visits: r.metrics[0] ?? 0,
        reaches: r.metrics[1] ?? 0,
        conversionRate: r.metrics[2] ?? 0,
      }));
    const totals = series.value.totals ?? [];
    return {
      goal: {
        id: g.id,
        name: g.name,
        type: g.type,
        event: eventOf(g) ?? null,
        archived: isArchivedLiveGoal(g),
        conditions: g.conditions ?? [],
      },
      from,
      to,
      updatedAt: new Date(series.cachedAt).toISOString(),
      totals: { visits: totals[0] ?? 0, reaches: totals[1] ?? 0, conversionRate: totals[2] ?? 0 },
      series: series.value.data.map((r) => ({
        bucket: dimName(r.dimensions[0] ?? {}),
        visits: r.metrics[0] ?? 0,
        reaches: r.metrics[1] ?? 0,
      })),
      bySource: rows(source.value),
      byUtm: rows(utm.value),
      byPage: rows(page.value),
      byDevice: rows(device.value),
      byCountry: rows(country.value),
    };
  });

  /** pc-goals funnel: visit → … → order, plus tariff and role breakdowns. */
  app.get('/live/funnel', async (req, reply) => {
    if (!ready(reply)) return;
    const pr = period(req.query, reply);
    if (!pr) return;
    const { from, to, filters } = pr;
    const list = (await goals()).value;
    const byEvent = new Map<string, LiveGoal>();
    for (const g of list) {
      const ev = eventOf(g);
      if (ev && !byEvent.has(ev)) byEvent.set(ev, g);
    }
    const wanted = [
      ...PC_FUNNEL.map((s) => s.event),
      ...TICKET_TYPES.flatMap((t) => [
        `ticket_pick_${t}`,
        `ticket_buy_${t}`,
        `ticket_checkout_${t}`,
      ]),
      ...ROLE_EVENTS.map((r) => r.event),
    ];
    const present = wanted.filter((e) => byEvent.has(e));
    const values = new Map<string, number>();
    for (let i = 0; i < present.length; i += 18) {
      const chunk = present.slice(i, i + 18);
      const r = await stat({
        metrics: chunk.map((e) => `ym:s:goal${byEvent.get(e)!.id}reaches`).join(','),
        date1: from,
        date2: to,
        filters,
      });
      const t = r.value.totals ?? r.value.data[0]?.metrics ?? [];
      chunk.forEach((e, j) => values.set(e, t[j] ?? 0));
    }
    const visits =
      ((await stat({ metrics: 'ym:s:visits', date1: from, date2: to, filters })).value.totals ?? [
        0,
      ])[0] ?? 0;
    const stages = [
      { key: 'visits', ru: 'Визиты', en: 'Visits', value: visits, goalId: null as number | null },
      ...PC_FUNNEL.map((s) => ({
        key: s.key,
        ru: s.ru,
        en: s.en,
        value: values.get(s.event) ?? 0,
        goalId: byEvent.get(s.event)?.id ?? null,
      })),
    ];
    return {
      from,
      to,
      updatedAt: new Date().toISOString(),
      stages: stages.map((s, i) => ({
        ...s,
        fromPrevious: i === 0 || !stages[i - 1]!.value ? null : s.value / stages[i - 1]!.value,
        fromFirst: i === 0 || !visits ? null : s.value / visits,
      })),
      tickets: TICKET_TYPES.map((t) => ({
        type: t,
        pick: values.get(`ticket_pick_${t}`) ?? 0,
        buy: values.get(`ticket_buy_${t}`) ?? 0,
        checkout: values.get(`ticket_checkout_${t}`) ?? 0,
      })),
      roles: ROLE_EVENTS.map((r) => ({
        key: r.key,
        ru: r.ru,
        en: r.en,
        value: values.get(r.event) ?? 0,
      })),
      missing: wanted.filter((e) => !byEvent.has(e)),
    };
  });

  /** Generic data grids (whitelisted presets) for the analytics pages. */
  const PRESETS: Record<string, string> = {
    sources: 'ym:s:lastsignTrafficSource',
    engines: 'ym:s:lastsignSearchEngine',
    utm: 'ym:s:lastsignUTMSource,ym:s:lastsignUTMMedium,ym:s:lastsignUTMCampaign',
    pages: 'ym:s:startURLPath',
    exits: 'ym:s:endURLPath',
    devices: 'ym:s:deviceCategory,ym:s:operatingSystemRoot',
    browsers: 'ym:s:browser',
    geo: 'ym:s:regionCountry,ym:s:regionCity',
    referers: 'ym:s:lastsignReferalSource',
    days: 'ym:s:date',
    hours: 'ym:s:hour',
  };
  app.get('/live/table/:preset', async (req, reply) => {
    if (!ready(reply)) return;
    const preset = (req.params as { preset: string }).preset;
    const dims = PRESETS[preset];
    if (!dims) return reply.code(404).send({ error: 'unknown preset' });
    const pr = period(req.query, reply);
    if (!pr) return;
    const { from, to, filters } = pr;
    let goalId = Number((req.query as { goal?: string }).goal ?? deps.orderGoalId?.() ?? 0) || 0;
    if (!goalId) {
      // Default to the pc-goals "order" event (reg_step1) when no KPI goal is configured.
      goalId = (await goals()).value.find((g) => eventOf(g) === 'reg_step1')?.id ?? 0;
    }
    const base = [
      'ym:s:visits',
      'ym:s:users',
      'ym:s:bounceRate',
      'ym:s:pageDepth',
      'ym:s:avgVisitDurationSeconds',
    ];
    const metrics = goalId
      ? [...base, `ym:s:goal${goalId}reaches`, `ym:s:goal${goalId}conversionRate`]
      : base;
    const r = await stat({
      metrics: metrics.join(','),
      dimensions: dims,
      date1: from,
      date2: to,
      filters,
      sort: preset === 'days' || preset === 'hours' ? dims : '-ym:s:visits',
      limit: 1000,
    });
    const dimNames = dims.split(',');
    return {
      from,
      to,
      goalId: goalId || null,
      updatedAt: new Date(r.cachedAt).toISOString(),
      columns: [...dimNames, ...metrics],
      totals: r.value.totals ?? [],
      rows: r.value.data.map((row) => ({
        dims: row.dimensions.map(dimName),
        values: row.metrics.map((v) => v ?? 0),
      })),
    };
  });
}
