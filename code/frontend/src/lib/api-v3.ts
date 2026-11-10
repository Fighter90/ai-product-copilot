import { http } from './api';

/** Typed client for the v3 cabinet endpoints (auth, users, providers, live mode, help, DataLens). */

export type Role = 'admin' | 'analyst';
export interface CabinetUser {
  id: number;
  email: string;
  name: string;
  role: Role;
  locale: 'ru' | 'en';
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface CounterOption {
  id: number;
  name: string | null;
  site: string | null;
  configured: boolean;
  source: 'settings' | 'metrika' | 'assigned';
}

export interface CounterOptionsView {
  configured: number;
  counters: CounterOption[];
  metrikaError?: string;
}

export interface ProviderView {
  id: 'openrouter' | 'anthropic' | 'yandexgpt' | 'gigachat';
  name: string;
  enabled: boolean;
  priority: number;
  model: string;
  models: string[];
  secretLabel: string;
  secretMask: string;
  hasSecret: boolean;
  extras: Array<{ key: string; label: string; value: string }>;
  docs: string;
  lastTest: { at: string; ok: boolean; message: string } | null;
  updatedAt: string;
  updatedBy: string | null;
}

export interface LiveSummary {
  from: string;
  to: string;
  updatedAt: string;
  totals: {
    visits: number;
    users: number;
    pageviews: number;
    bounceRate: number;
    avgDurationSec: number;
  };
  series: Array<{ bucket: string; visits: number; users: number }>;
}

export interface LiveGoal {
  id: number;
  name: string;
  type: string;
  event: string | null;
  reaches: number;
  goalVisits: number;
  conversionRate: number;
  previousReaches: number;
  delta: number;
  reaches14: number;
  reaches90: number;
  status: 'live' | 'sleeping' | 'dead';
  duplicateOf: number[];
}

/** One pc-goals reference entry (GET /api/metrics/goal-roles, ANA-34): the funnel role of a JS-event goal. */
export interface GoalRole {
  code: string;
  event: string;
  ru: string;
  en: string;
  group: 'funnel' | 'ticket' | 'role';
}

export interface LiveGoals {
  from: string;
  to: string;
  previous: { from: string; to: string };
  visits: number;
  updatedAt: string;
  goals: LiveGoal[];
}

export interface BreakdownRow {
  key: string;
  visits: number;
  reaches: number;
  conversionRate: number;
}

export interface LiveGoalDetail {
  goal: {
    id: number;
    name: string;
    type: string;
    event: string | null;
    conditions: Array<{ type?: string; url?: string }>;
  };
  from: string;
  to: string;
  updatedAt: string;
  totals: { visits: number; reaches: number; conversionRate: number };
  series: Array<{ bucket: string; visits: number; reaches: number }>;
  bySource: BreakdownRow[];
  byUtm: BreakdownRow[];
  byPage: BreakdownRow[];
  byDevice: BreakdownRow[];
  byCountry: BreakdownRow[];
}

export interface LiveFunnel {
  from: string;
  to: string;
  updatedAt: string;
  /** «Визит» → goal steps → «Оплата»; `source` tells where the value comes from. */
  stages: Array<{
    key: string;
    ru: string;
    en: string;
    value: number;
    goalId: number | null;
    source: 'visits' | 'goal' | 'manual' | 'none';
    fromPrevious: number | null;
    fromFirst: number | null;
  }>;
  tickets: Array<{
    type: 'standard' | 'optimal' | 'max';
    pick: number;
    buy: number;
    checkout: number;
  }>;
  /** ANA-35: role application funnels (clevel / speaker / volunteer / partner). */
  roleFunnels: Array<{
    key: string;
    ru: string;
    en: string;
    steps: Array<{
      key: string;
      ru: string;
      en: string;
      value: number;
      goalId: number | null;
      fromPrevious: number | null;
    }>;
  }>;
  missing: string[];
}

export interface LiveTable {
  from: string;
  to: string;
  goalId: number | null;
  updatedAt: string;
  columns: string[];
  totals: number[];
  rows: Array<{ dims: string[]; values: number[] }>;
}

export interface HelpArticleMeta {
  slug: string;
  lang: 'ru' | 'en';
  title: string;
  section: string;
  order: number;
  summary: string;
}
export interface HelpArticle extends HelpArticleMeta {
  markdown: string;
}
export interface HelpHit {
  slug: string;
  articleTitle: string;
  heading: string;
  text: string;
  score: number;
}
export interface AssistantAnswer {
  mode: 'llm' | 'search';
  answer: string;
  provider?: string;
  model?: string;
  sources: Array<{ slug: string; title: string; heading: string }>;
}

export interface SettingView {
  value: string;
  isSecret: boolean;
  source: 'db' | 'env' | 'unset';
}

export interface AuditEntry {
  id: number;
  at: string;
  userEmail: string | null;
  action: string;
  target: string | null;
  details: string | null;
}

export interface Notification {
  id: number;
  at: string;
  kind: string;
  title: string;
  body: string;
  read: boolean;
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });
const q = (p: Record<string, string | number | undefined | boolean>) => {
  const s = Object.entries(p)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v === true ? 1 : v === false ? 0 : v))}`)
    .join('&');
  return s ? `?${s}` : '';
};

export const v3 = {
  me: () => http<{ user: CabinetUser | null }>('/auth/me'),
  login: (email: string, password: string) =>
    http<{ user: CabinetUser }>('/auth/login', { method: 'POST', ...json({ email, password }) }),
  logout: () => http<{ ok: true }>('/auth/logout', { method: 'POST', ...json({}) }),
  updateMe: (patch: { locale?: 'ru' | 'en'; name?: string }) =>
    http<{ user: CabinetUser }>('/auth/me', { method: 'PATCH', ...json(patch) }),
  changePassword: (current: string, next: string) =>
    http<{ ok: true }>('/auth/password', { method: 'POST', ...json({ current, next }) }),

  users: () => http<CabinetUser[]>('/users'),
  createUser: (u: {
    email: string;
    name: string;
    role: Role;
    password?: string;
    /** ANA-29: counter access granted at invite time (analysts). */
    counterIds?: number[];
  }) =>
    http<{ user: CabinetUser; temporaryPassword: string }>('/users', {
      method: 'POST',
      ...json(u),
    }),
  updateUser: (id: number, patch: { name?: string; role?: Role; isActive?: boolean }) =>
    http<{ user: CabinetUser }>(`/users/${id}`, { method: 'PATCH', ...json(patch) }),
  resetPassword: (id: number) =>
    http<{ temporaryPassword: string }>(`/users/${id}/reset-password`, {
      method: 'POST',
      ...json({}),
    }),
  /** ANA-123: irreversible hard delete (the UI must confirm first). */
  deleteUser: (id: number) => http<{ ok: true }>(`/users/${id}`, { method: 'DELETE' }),
  audit: (limit = 200) => http<AuditEntry[]>(`/admin/audit?limit=${limit}`),

  /** ANA-29: counters an admin can assign to analysts. */
  adminCounters: () => http<CounterOptionsView>('/admin/counters'),
  adminUserCounters: () => http<Record<string, number[]>>('/admin/user-counters'),
  setUserCounters: (id: number, counterIds: number[]) =>
    http<{ userId: number; counterIds: number[] }>(`/users/${id}/counters`, {
      method: 'PUT',
      ...json({ counterIds }),
    }),

  providers: () => http<ProviderView[]>('/admin/ai/providers'),
  updateProvider: (
    id: ProviderView['id'],
    patch: {
      enabled?: boolean;
      priority?: number;
      model?: string;
      secret?: string;
      extra?: Record<string, string>;
    },
  ) => http<ProviderView>(`/admin/ai/providers/${id}`, { method: 'PUT', ...json(patch) }),
  testProvider: (id: ProviderView['id']) =>
    http<{ ok: boolean; message: string; ms: number }>(`/admin/ai/providers/${id}/test`, {
      method: 'POST',
      ...json({}),
    }),
  aiUsage: () =>
    http<Array<{ provider: string; calls: number; failures: number; outputChars: number }>>(
      '/admin/ai/usage',
    ),
  availableProviders: () =>
    http<Array<{ id: string; name: string; model: string }>>('/ai/available'),

  settings: () => http<Record<string, SettingView>>('/settings'),
  /** REG-12: public (any logged-in role) slice — KPI target + event date for the KPI bar/goals. */
  settingsPublic: () =>
    http<{ KPI_TARGET: { value: string }; EVENT_DATE: { value: string } }>('/settings/public'),
  saveSettings: (patch: Record<string, string | number>) =>
    http<{ ok: true; changed: string[] }>('/settings', { method: 'POST', ...json(patch) }),
  // ANA-107: обмен verification code резервного аккаунта на OAuth-токен (admin).
  exchangeBackupToken: (code: string) =>
    http<{ ok: true; tokenLength: number }>('/goals/backup-token/exchange', {
      method: 'POST',
      ...json({ code }),
    }),
  rotateDatalensToken: () =>
    http<{ token: string }>('/settings/datalens-token', { method: 'POST', ...json({}) }),
  clearMetrikaData: () =>
    http<{ ok: true }>(
      '/data/metrika',
      // i18n: ignore — protocol word validated server-side (z.literal('УДАЛИТЬ'))
      { method: 'DELETE', ...json({ confirm: 'УДАЛИТЬ' }) },
    ),

  // ANA-75: pages pass react-query settings (e.g. `refetchInterval`) inside `p`; destructure so
  // only the API params are serialized into the URL, never UI-only fields.
  liveSummary: ({ from, to, test }: { from?: string; to?: string; test?: boolean }) =>
    http<LiveSummary>(`/live/summary${q({ from, to, test })}`),
  liveGoals: ({ from, to, test }: { from?: string; to?: string; test?: boolean }) =>
    http<LiveGoals>(`/live/goals${q({ from, to, test })}`),
  goalRoles: () => http<{ roles: GoalRole[] }>('/metrics/goal-roles'),
  liveGoal: (id: number, { from, to, test }: { from?: string; to?: string; test?: boolean }) =>
    http<LiveGoalDetail>(`/live/goals/${id}${q({ from, to, test })}`),
  liveFunnel: ({ from, to, test }: { from?: string; to?: string; test?: boolean }) =>
    http<LiveFunnel>(`/live/funnel${q({ from, to, test })}`),
  liveTable: (
    preset: string,
    { from, to, test, goal }: { from?: string; to?: string; test?: boolean; goal?: number },
  ) => http<LiveTable>(`/live/table/${preset}${q({ from, to, test, goal })}`),

  helpArticles: (lang: string) => http<HelpArticleMeta[]>(`/help/articles?lang=${lang}`),
  helpArticle: (slug: string, lang: string) =>
    http<HelpArticle>(`/help/articles/${slug}?lang=${lang}`),
  helpSearch: (qs: string, lang: string) =>
    http<HelpHit[]>(`/help/search?lang=${lang}&q=${encodeURIComponent(qs)}`),
  ask: (question: string, lang: string) =>
    http<AssistantAnswer>('/help/ask', { method: 'POST', ...json({ question, lang }) }),

  datasets: () =>
    http<
      Array<{
        id: string;
        ru: string;
        en: string;
        ranged: boolean;
        columns: Array<{ name: string; type: string; ru: string; en: string }>;
      }>
    >('/integrations/datalens/datasets'),
  datalensAdmin: () =>
    http<{
      hasToken: boolean;
      token: string;
      events: Array<{
        id: number;
        receivedAt: string;
        kind: string;
        code: string | null;
        payload: string;
      }>;
      lastCode: { code: string; receivedAt: string } | null;
    }>('/admin/integrations/datalens'),
  checkDatalens: () =>
    http<{ ok: boolean; message: string; workbookTitle?: string }>(
      '/admin/integrations/datalens/check',
      { method: 'POST', ...json({}) },
    ),
  requestDatalens: (note: string) =>
    http<{ ok: true }>('/integrations/datalens/request', { method: 'POST', ...json({ note }) }),

  notifications: () => http<Notification[]>('/notifications'),
  readNotifications: () =>
    http<{ ok: true }>('/notifications/read', { method: 'POST', ...json({}) }),
};

/* ---- Metrika goal management (admin, ANA-36) ---------------------------------------------- */

export interface GoalCondition {
  type: 'exact' | 'contain' | 'start' | 'regexp';
  url: string;
}
export interface GoalSpecInput {
  name: string;
  type: 'url' | 'action';
  conditions: GoalCondition[];
}
export interface GoalRefView {
  id: number;
  name: string;
  type: string;
  reference: string | null;
}
export interface GoalsAuditView {
  expected: Array<{
    ref: {
      code: string;
      event: string;
      ru: string;
      en: string;
      group: 'funnel' | 'ticket' | 'role';
      name: string;
    };
    status: 'present' | 'missing' | 'mismatch';
    goalId?: number;
    goalName?: string;
    issues?: string[];
    archivedGoalId?: number;
    spec: GoalSpecInput;
  }>;
  dead: Array<GoalRefView & { reaches: number }>;
  duplicates: Array<{ reason: 'conditions' | 'name'; key: string; goals: GoalRefView[] }>;
  goals: Array<
    GoalRefView & { archived: boolean; conditions: Array<{ type?: string; url?: string }> }
  >;
  days: number;
  permission: string | null;
  canWrite: boolean | null;
  warnings: string[];
}
export interface GoalPreview {
  method: 'POST';
  path: string;
  body: { goal: GoalSpecInput };
}
/** Either a pc-goals reference (`{ref}`) or a custom spec. */
export type GoalCreateInput = { ref: string } | GoalSpecInput;

export const goalsApi = {
  audit: (days = 90) => http<GoalsAuditView>(`/admin/metrika/goals/audit?days=${days}`),
  preview: (input: GoalCreateInput) =>
    http<GoalPreview>('/admin/metrika/goals/preview', { method: 'POST', ...json(input) }),
  create: (input: GoalCreateInput) =>
    http<{ goal: { id: number; name: string; type: string } }>('/admin/metrika/goals', {
      method: 'POST',
      ...json({ ...input, confirm: true }),
    }),
  archiveBulk: (ids: number[], confirm: string) =>
    http<{
      archived: number[];
      failed: Array<{ id: number; code: string; error: string }>;
      skipped: number[];
    }>('/admin/metrika/goals/archive-bulk', { method: 'POST', ...json({ ids, confirm }) }),
  restore: (id: number) =>
    http<{ ok: true }>(`/admin/metrika/goals/${id}/restore`, {
      method: 'POST',
      ...json({ confirm: true }),
    }),
};
