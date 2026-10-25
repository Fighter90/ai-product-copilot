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
  stages: Array<{
    key: string;
    ru: string;
    en: string;
    value: number;
    goalId: number | null;
    fromPrevious: number | null;
    fromFirst: number | null;
  }>;
  tickets: Array<{
    type: 'standard' | 'optimal' | 'max';
    pick: number;
    buy: number;
    checkout: number;
  }>;
  roles: Array<{ key: string; ru: string; en: string; value: number }>;
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
  me: () => http<{ user: CabinetUser }>('/auth/me'),
  login: (email: string, password: string) =>
    http<{ user: CabinetUser }>('/auth/login', { method: 'POST', ...json({ email, password }) }),
  logout: () => http<{ ok: true }>('/auth/logout', { method: 'POST', ...json({}) }),
  updateMe: (patch: { locale?: 'ru' | 'en'; name?: string }) =>
    http<{ user: CabinetUser }>('/auth/me', { method: 'PATCH', ...json(patch) }),
  changePassword: (current: string, next: string) =>
    http<{ ok: true }>('/auth/password', { method: 'POST', ...json({ current, next }) }),

  users: () => http<CabinetUser[]>('/users'),
  createUser: (u: { email: string; name: string; role: Role; password?: string }) =>
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
  audit: (limit = 200) => http<AuditEntry[]>(`/admin/audit?limit=${limit}`),

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
  saveSettings: (patch: Record<string, string | number>) =>
    http<{ ok: true; changed: string[] }>('/settings', { method: 'POST', ...json(patch) }),
  rotateDatalensToken: () =>
    http<{ token: string }>('/settings/datalens-token', { method: 'POST', ...json({}) }),
  clearMetrikaData: () =>
    http<{ ok: true }>('/data/metrika', { method: 'DELETE', ...json({ confirm: 'УДАЛИТЬ' }) }),

  liveSummary: (p: { from?: string; to?: string; test?: boolean }) =>
    http<LiveSummary>(`/live/summary${q(p)}`),
  liveGoals: (p: { from?: string; to?: string; test?: boolean }) =>
    http<LiveGoals>(`/live/goals${q(p)}`),
  liveGoal: (id: number, p: { from?: string; to?: string; test?: boolean }) =>
    http<LiveGoalDetail>(`/live/goals/${id}${q(p)}`),
  liveFunnel: (p: { from?: string; to?: string; test?: boolean }) =>
    http<LiveFunnel>(`/live/funnel${q(p)}`),
  liveTable: (preset: string, p: { from?: string; to?: string; test?: boolean; goal?: number }) =>
    http<LiveTable>(`/live/table/${preset}${q(p)}`),

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
  requestDatalens: (note: string) =>
    http<{ ok: true }>('/integrations/datalens/request', { method: 'POST', ...json({ note }) }),

  notifications: () => http<Notification[]>('/notifications'),
  readNotifications: () =>
    http<{ ok: true }>('/notifications/read', { method: 'POST', ...json({}) }),
};
