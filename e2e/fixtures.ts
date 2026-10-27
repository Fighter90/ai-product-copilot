import type { Page, Route } from '@playwright/test';

/**
 * Shared API mocks for the e2e suite. The backend is mocked at the network layer so the suite is
 * deterministic and needs no OAuth token. Mutating resources (b2b, hypotheses, decisions) are
 * stateful in-closure, so create/update/delete flows behave end-to-end (POST → list re-fetch shows
 * the change). Read-only metrics return fixed fixtures. Pass `errors` to force 500s for a given
 * endpoint key and exercise the pages' error states.
 */

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

export const CHANNELS = [
  {
    date: '2025-01-01',
    channel: 'podcast',
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    visits: 420,
    users: 380,
    bounceRate: 0.21,
    avgDuration: 64,
    goalReaches: 12,
    conversionRate: 0.0286,
  },
  {
    date: '2025-01-02',
    channel: 'direct',
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    visits: 260,
    users: 240,
    bounceRate: 0.18,
    avgDuration: 71,
    goalReaches: 18,
    conversionRate: 0.0692,
  },
];

export const UTM = [
  {
    date: '2025-01-02',
    utmSource: 'vk',
    utmMedium: 'cpc',
    utmCampaign: 'spring',
    visits: 240,
    users: 210,
    goalReaches: 9,
    conversionRate: 0.0375,
  },
];

export const GEO_DEVICE = [
  {
    date: '2025-01-02',
    country: 'Россия',
    device: 'mobile',
    visits: 520,
    users: 470,
    goalReaches: 22,
    conversionRate: 0.0423,
  },
  {
    date: '2025-01-02',
    country: 'Россия',
    device: 'desktop',
    visits: 280,
    users: 250,
    goalReaches: 16,
    conversionRate: 0.0571,
  },
];

export const PAGES = [
  {
    date: '2025-01-02',
    page: '/lp',
    visits: 380,
    users: 340,
    bounceRate: 0.18,
    goalReaches: 14,
    conversionRate: 0.0368,
  },
];

export const EXIT_PAGES = [
  {
    date: '2025-01-02',
    page: '/checkout',
    visits: 120,
    users: 110,
    bounceRate: 0.55,
    goalReaches: 6,
    conversionRate: 0.05,
  },
];

export const DEFAULT_B2B = [
  { id: 1, company: 'BigCorp', tickets: 20, stage: 'paid', dateAdded: '2025-01-02' },
  { id: 2, company: 'MidMarket', tickets: 8, stage: 'invoiced', dateAdded: '2025-01-03' },
];

export interface MockState {
  b2b: Array<Record<string, unknown> & { id: number }>;
  hypotheses: Array<Record<string, unknown> & { id: number }>;
  decisions: Array<Record<string, unknown> & { id: number }>;
}

export interface MockOptions {
  b2b?: MockState['b2b'];
  hypotheses?: MockState['hypotheses'];
  decisions?: MockState['decisions'];
  /** Endpoint keys to fail with 500 (e.g. 'channels', 'utm', 'geo-device', 'pages', 'exit-pages'). */
  errors?: string[];
  /**
   * Cabinet session (v3): `/api/auth/me` answers with this user so `RequireAuth` lets the page
   * render. Default — analyst; `null` = guest (redirect to /login); pass an admin object for
   * admin-only pages. Registered AFTER the data mocks, so a spec may override it again.
   */
  user?: Record<string, unknown> | null;
}

/** Default signed-in cabinet user (analyst) for specs that don't care about roles. */
export const CABINET_USER: Record<string, unknown> = {
  id: 1,
  email: 'analyst@example.com',
  name: 'Analyst',
  role: 'analyst',
  locale: 'ru',
  isActive: true,
  createdAt: '2025-01-01T00:00:00.000Z',
  lastLoginAt: null,
};

function future(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

/** Register all API mocks on the page. Returns the mutable state for assertions. */
export async function installMocks(page: Page, opts: MockOptions = {}): Promise<MockState> {
  const state: MockState = {
    b2b: opts.b2b ? [...opts.b2b] : [...DEFAULT_B2B],
    hypotheses: opts.hypotheses ? [...opts.hypotheses] : [],
    decisions: opts.decisions ? [...opts.decisions] : [],
  };
  const fail = new Set(opts.errors ?? []);
  let nextB2bId = 100;
  let nextHypId = 100;
  let nextDecId = 100;

  const metric = (key: string, glob: string, body: unknown): Promise<void> =>
    page.route(glob, (r) => (fail.has(key) ? json(r, { error: 'boom' }, 500) : json(r, body)));

  await metric('channels', '**/api/metrics/channels*', CHANNELS);
  await metric('utm', '**/api/metrics/utm*', UTM);
  await metric('geo-device', '**/api/metrics/geo-device*', GEO_DEVICE);
  await metric('pages', '**/api/metrics/pages*', PAGES);
  await metric('exit-pages', '**/api/metrics/exit-pages*', EXIT_PAGES);
  await metric('goals', '**/api/metrics/goals*', []);
  await page.route('**/api/metrics/primary-goal', (r) =>
    fail.has('primary-goal')
      ? json(r, { error: 'no primary goal detected' }, 404)
      : json(r, {
          id: 8,
          name: 'Ecommerce: покупка',
          type: 'action',
          isB2b: false,
          isArchived: false,
          syncedAt: '2025-01-01T00:00:00.000Z',
        }),
  );

  await page.route('**/api/metrics/raw/*', (r) => {
    const id = r.request().url().split('/').pop() ?? '';
    if (id === '999') return json(r, { error: 'not found' }, 404);
    return json(r, {
      id: Number(id),
      endpoint: '/stat/v1/data',
      queryHash: 'abc123',
      dateFrom: '2025-01-01',
      dateTo: '2025-01-02',
      payload: { data: [{ metrics: [100] }] },
      fetchedAt: '2025-01-02T00:00:00.000Z',
    });
  });

  // Report snapshots list (for History page).
  await page.route('**/api/report/snapshots', (r) => json(r, []));

  // Settings — read/write (stateful in-closure).
  let settingsState = {
    YANDEX_OAUTH_TOKEN: 'test-token-xxxx',
    YANDEX_CLIENT_ID: 'test-client-id',
    YANDEX_CLIENT_SECRET: 'test-secret-xxxx',
    COUNTER_ID: 12345,
    GOAL_ID: 0,
    ANTHROPIC_API_KEY: 'sk-test-xxxx',
  };
  await page.route('**/api/settings', async (r) => {
    if (r.request().method() === 'POST') {
      const body = JSON.parse(r.request().postData() ?? '{}') as Record<string, string | number>;
      settingsState = { ...settingsState, ...body };
      return json(r, { ok: true, message: 'Настройки сохранены.' });
    }
    return json(r, {
      YANDEX_OAUTH_TOKEN: 'test****xx',
      YANDEX_CLIENT_ID: settingsState.YANDEX_CLIENT_ID,
      YANDEX_CLIENT_SECRET: 'test****xx',
      COUNTER_ID: settingsState.COUNTER_ID,
      GOAL_ID: settingsState.GOAL_ID,
      ANTHROPIC_API_KEY: 'sk-t****xx',
    });
  });
  await page.route('**/api/settings/refresh', (r) => json(r, { ok: true }));

  // B2B — stateful CRUD.
  await page.route('**/api/b2b', async (r) => {
    if (r.request().method() === 'POST') {
      const body = JSON.parse(r.request().postData() ?? '{}') as Record<string, unknown>;
      const deal = { id: nextB2bId++, ...body };
      state.b2b.push(deal);
      return json(r, deal, 201);
    }
    return json(r, state.b2b);
  });
  await page.route('**/api/b2b/*', async (r) => {
    const id = Number(r.request().url().split('/').pop());
    const method = r.request().method();
    if (method === 'DELETE') {
      state.b2b = state.b2b.filter((d) => d.id !== id);
      return json(r, { ok: true });
    }
    const body = JSON.parse(r.request().postData() ?? '{}') as Record<string, unknown>;
    state.b2b = state.b2b.map((d) => (d.id === id ? { ...d, ...body } : d));
    return json(r, state.b2b.find((d) => d.id === id) ?? {});
  });

  // Hypotheses — stateful create.
  await page.route('**/api/hypotheses', async (r) => {
    if (r.request().method() === 'POST') {
      const body = JSON.parse(r.request().postData() ?? '{}') as Record<string, number | string>;
      const score = Number(body.impact) * Number(body.confidence) * Number(body.ease);
      const hyp = {
        id: nextHypId++,
        ...body,
        iceScore: score,
        status: 'draft',
        deadlineAt: future(Number(body.deadlineDays) || 7),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      state.hypotheses.push(hyp);
      return json(r, hyp, 201);
    }
    return json(r, state.hypotheses);
  });

  // Hypothesis detail — status change (PATCH …/status) and delete (DELETE), for the kanban.
  // `**` (not `*`): the status URL has two trailing segments (/100/status) and a single `*`
  // does not match across `/` — the PATCH then went unmocked and the kanban card never moved.
  await page.route('**/api/hypotheses/**', async (r) => {
    const parts = r.request().url().split('?')[0]!.split('/').filter(Boolean);
    const method = r.request().method();
    const id = Number(
      parts[parts.length - 1] === 'status' ? parts[parts.length - 2] : parts[parts.length - 1],
    );
    if (method === 'PATCH') {
      const body = JSON.parse(r.request().postData() ?? '{}') as { status?: string };
      state.hypotheses = state.hypotheses.map((h) =>
        h.id === id ? { ...h, status: body.status ?? h.status } : h,
      );
      return json(r, state.hypotheses.find((h) => h.id === id) ?? {});
    }
    if (method === 'DELETE') {
      state.hypotheses = state.hypotheses.filter((h) => h.id !== id);
      return r.fulfill({ status: 204 });
    }
    return json(r, state.hypotheses.find((h) => h.id === id) ?? {});
  });

  // Decisions — stateful create (also flips the linked hypothesis status to the outcome).
  await page.route('**/api/decisions', async (r) => {
    if (r.request().method() === 'POST') {
      const body = JSON.parse(r.request().postData() ?? '{}') as Record<string, unknown>;
      const dec = {
        id: nextDecId,
        number: `DL-${String(nextDecId - 99).padStart(3, '0')}`,
        ...body,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      nextDecId++;
      state.decisions.push(dec);
      state.hypotheses = state.hypotheses.map((h) =>
        h.id === body.hypothesisId ? { ...h, status: body.outcome } : h,
      );
      return json(r, dec, 201);
    }
    return json(r, state.decisions);
  });

  // Report.
  await page.route('**/api/report/snapshot', (r) =>
    json(
      r,
      {
        id: 'snap-e2e',
        generatedAt: '2025-01-05T00:00:00.000Z',
        period: { from: '2025-01-01', to: '2025-01-07' },
        kpi: { target: 300, b2cApplications: 30, b2bPaidTickets: 20, gap: 280 },
        channels: CHANNELS,
        hypotheses: { problems: [], solutions: [] },
        decisions: [],
        b2bSummary: { totalTickets: 0, paidTickets: 0, dealsCount: 0, deals: [], byStage: [] },
        funnel: { visits: 2647, b2cApplications: 30, b2bPipelineTickets: 0, b2bPaidTickets: 20 },
        // Breakdown rows are the report shapes (UtmBreakdownRow etc.), NOT the raw UtmStat/…
        // API rows — the section builders read `source`/`medium`, not `utmSource`/`utmMedium`.
        breakdowns: {
          utm: [{ source: 'vk', medium: 'cpc', campaign: 'spring', visits: 240, goalReaches: 9 }],
          geoDevice: [
            { country: 'Россия', device: 'mobile', visits: 520, goalReaches: 22 },
            { country: 'Россия', device: 'desktop', visits: 280, goalReaches: 16 },
          ],
          entryPages: [{ page: '/lp', visits: 380, bounceRate: 0.18, goalReaches: 14 }],
          exitPages: [{ page: '/checkout', visits: 120, bounceRate: 0.55, goalReaches: 6 }],
        },
      },
      201,
    ),
  );
  await page.route('**/api/report/insights', (r) =>
    json(r, { narrative: 'AI-анализ: визиты растут, конверсия стабильна.' }),
  );
  await page.route('**/api/report/hypotheses', (r) =>
    json(r, {
      hypotheses: {
        problems: [
          {
            id: 'P01',
            segment: 'мобильный посетитель',
            trouble: 'не завершает оплату',
            action: 'покупке билета',
            barrier: 'форма оплаты не адаптирована',
            evidence: '68% мобильного трафика, CR 1.2%',
          },
        ],
        solutions: [
          {
            id: 'S01',
            problemId: 'P01',
            action: 'заменим форму оплаты',
            userBenefit: 'оплатить в 2 клика',
            businessResult: 'росту CR +150%',
            successCriteria: 'CR mobile ≥ 3% через 14 дней',
            risks: [
              { kind: 'value', note: 'Пользователи не ценят скорость' },
              { kind: 'usability', note: 'Новая форма может путать' },
              { kind: 'feasibility', note: 'Интеграция шлюза' },
              { kind: 'business', note: 'Нужен бюджет' },
              { kind: 'legal', note: '152-ФЗ' },
            ],
            validation: {
              whatToVerify: 'Готовность к новой форме',
              methods: ['интервью', 'A/B тест'],
              audience: 'мобильные посетители',
              channel: 'email',
              successCriteria: '≥60% подтверждают удобство',
            },
            ice: {
              impact: 9,
              confidence: 7,
              ease: 6,
              impactRationale: 'Крупнейший сегмент',
              confidenceRationale: 'Данные убедительны',
              easeRationale: 'Готовая библиотека',
              score: 378,
            },
          },
        ],
      },
    }),
  );
  await page.route('**/api/report/generate', (r) => {
    const body = JSON.parse(r.request().postData() ?? '{}') as { format?: string };
    const ext = body.format === 'pdf' ? 'pdf' : 'docx';
    return json(r, { filePath: `data/reports/snap-e2e.${ext}` });
  });

  await page.route('**/api/report/download/**', (r) => {
    const ext = r.request().url().endsWith('/pdf') ? 'pdf' : 'docx';
    return r.fulfill({
      status: 200,
      headers: {
        'content-type': ext === 'pdf' ? 'application/pdf' : 'application/octet-stream',
        'content-disposition': `attachment; filename="productcamp-report-snap-e2e.${ext}"`,
      },
      body: 'FILE-BYTES',
    });
  });

  // --- Cabinet v3 endpoints (ANA-66/72/73): pages fetch these on mount; without mocks the
  // catch-all of some specs ([]) answers where an object is expected and the render crashes.
  await page.route('**/api/notifications', (r) => json(r, []));
  // The report page enables the AI actions only with ≥1 AVAILABLE provider (v3.availableProviders
  // → GET /api/ai/available, ANA-33); the admin list lives at /api/admin/ai/providers.
  await page.route('**/ai/available', (r) =>
    json(r, [{ id: 'anthropic', name: 'Anthropic', model: 'claude-opus-5-5' }]),
  );
  // NOTE: the real admin path is /api/admin/ai/providers — a '**/api/ai/providers' glob misses it.
  await page.route('**/ai/providers', (r) =>
    json(r, [
      {
        id: 'anthropic',
        name: 'Anthropic',
        enabled: true,
        priority: 1,
        model: 'claude-opus-5-5',
        models: ['claude-opus-5-5'],
        secretLabel: 'API-ключ',
        secretMask: 'sk-ant-****',
        hasSecret: true,
        extras: [],
        docs: '',
        lastTest: { at: '2025-01-01T00:00:00.000Z', ok: true, message: 'ok' },
      },
    ]),
  );
  await page.route('**/api/demo/status', (r) => json(r, { demo: false, counts: {} }));
  await page.route('**/api/sync/status', (r) =>
    json(r, {
      id: 1,
      startedAt: '2025-01-02T00:00:00.000Z',
      finishedAt: '2025-01-02T00:01:00.000Z',
      from: '2025-01-01',
      to: '2025-01-02',
      status: 'ok',
      errors: [],
    }),
  );
  await page.route('**/api/payments/summary', (r) =>
    json(r, { b2cPaid: 12, b2bPaid: 20, paid: 32, days: 14 }),
  );
  await page.route('**/api/payments/b2c', (r) => json(r, []));
  await page.route('**/api/marketing/weekly', (r) =>
    json(r, {
      months: [{ key: '2025-01', ru: 'Январь', en: 'January' }],
      weeks: [
        {
          key: '2025-01-01',
          start: '2025-01-01',
          end: '2025-01-07',
          month: '2025-01',
          labelRu: '1 неделя (1-7)',
          labelEn: 'Week 1 (Jan 1-7)',
        },
      ],
      sections: [{ key: 'content', ru: 'Контент-маркетинг', en: 'Content marketing' }],
      metrics: [
        {
          key: 'tg_clicks',
          ru: 'переходы по ссылкам тг',
          en: 'Telegram link clicks',
          section: 'content',
          sync: false,
        },
      ],
      cells: [],
    }),
  );
  // Live pc-goals funnel (ANA-21 stages on /app/funnel): the page reads `stages` — an array
  // from a catch-all (or a proxy 500) would crash the render. Well-shaped LiveFunnel instead.
  await page.route('**/api/live/funnel*', (r) =>
    json(r, {
      from: '2025-01-01',
      to: '2025-01-14',
      updatedAt: '2025-01-14T00:00:00.000Z',
      stages: [
        {
          key: 'visits',
          ru: 'Визит',
          en: 'Visit',
          value: 800,
          goalId: null,
          source: 'visits',
          fromPrevious: null,
          fromFirst: 100,
        },
        {
          key: 'reg_open',
          ru: 'Открыл регистрацию',
          en: 'Opened registration',
          value: 120,
          goalId: 1,
          source: 'goal',
          fromPrevious: 15,
          fromFirst: 15,
        },
        {
          key: 'payment',
          ru: 'Оплата',
          en: 'Payment',
          value: 4,
          goalId: 2,
          source: 'manual',
          fromPrevious: 3,
          fromFirst: 0.5,
        },
      ],
      tickets: [],
    }),
  );

  // Cabinet session: LAST registered route wins, so a spec can still override /api/auth/me.
  const user = opts.user === undefined ? CABINET_USER : opts.user;
  await page.route('**/api/auth/me', (r) => json(r, { user }));

  // Deterministic RU interface + skip the first-visit onboarding and the role tour (pca.tour.v1.*
  // — see lib/onboarding.ts, components/onboarding/tour.ts). Specs may override the locale with
  // their own addInitScript AFTER installMocks (init scripts run in registration order).
  await page.addInitScript(() => {
    localStorage.setItem('pca.onboarded', '1');
    localStorage.setItem('pca.locale', 'ru');
    localStorage.setItem('pca.tour.v1.analyst', 'done');
    localStorage.setItem('pca.tour.v1.admin', 'done');
  });

  return state;
}
