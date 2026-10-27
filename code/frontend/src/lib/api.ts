import type {
  B2bDeal,
  B2bStage,
  B2cPayment,
  ChannelStat,
  Decision,
  DemoStatus,
  GeneratedHypotheses,
  Goal,
  Hypothesis,
  MarketingCell,
  MarketingGrid,
  MarketingSyncSummary,
  NewB2bDeal,
  NewB2cPayment,
  NewDecision,
  NewHypothesis,
  ReportSnapshot,
  SyncRunStatus,
  UtmStat,
  GeoDeviceStat,
  PageStat,
  RawResponse,
  AiGenerationInfo,
} from '@pca/shared';
import { translate } from '../i18n';
import type { Locale } from '../store/prefs';

const BASE = '/api';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface HealthInfo {
  status: string;
  counterId: number;
  metrikaTokenPresent: boolean;
}

export interface SyncSummary {
  goals: number;
  days: number;
  channelRows: number;
  utmRows: number;
  geoDeviceRows: number;
  pageRows: number;
  exitPageRows: number;
}

export interface SnapshotSummary {
  id: string;
  generatedAt: string;
  dateFrom: string;
  dateTo: string;
  /** ANA-39: who built the snapshot (user email in cabinet mode; null in legacy mode). */
  author?: string | null;
}

export interface SettingsStatus {
  YANDEX_OAUTH_TOKEN: string;
  YANDEX_CLIENT_ID: string;
  YANDEX_CLIENT_SECRET: string;
  COUNTER_ID: number;
  GOAL_ID: number;
  ANTHROPIC_API_KEY: string;
}

/**
 * Proxy error pages (nginx 502/503/504/429 HTML) must never reach the UI verbatim — replace them
 * with a short localized message. JSON bodies are kept as-is: callers parse `{error}` from them.
 */
export function readableError(status: number, body: string): string {
  if (!/^\s*</.test(body)) return body;
  const locale: Locale =
    typeof window !== 'undefined' && window.localStorage?.getItem('pca.locale') === 'en'
      ? 'en'
      : 'ru';
  if (status === 504) return translate(locale, 'i18n.api.err504');
  if (status === 429) return translate(locale, 'i18n.api.err429');
  if (status === 502 || status === 503) return translate(locale, 'i18n.api.err502', { status });
  return translate(locale, 'i18n.api.errGeneric', { status });
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    // Session expired in the cabinet → let AuthProvider redirect to /login.
    if (res.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('pca:unauthorized'));
    }
    throw new ApiError(res.status, readableError(res.status, await res.text()));
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export { http };

export const api = {
  health: () => http<HealthInfo>('/health'),
  channels: (range?: { from: string; to: string }) =>
    http<ChannelStat[]>(`/metrics/channels${range ? `?from=${range.from}&to=${range.to}` : ''}`),
  utm: (range?: { from: string; to: string }) =>
    http<UtmStat[]>(`/metrics/utm${range ? `?from=${range.from}&to=${range.to}` : ''}`),
  geoDevice: (range?: { from: string; to: string }) =>
    http<GeoDeviceStat[]>(
      `/metrics/geo-device${range ? `?from=${range.from}&to=${range.to}` : ''}`,
    ),
  pages: (range?: { from: string; to: string }) =>
    http<PageStat[]>(`/metrics/pages${range ? `?from=${range.from}&to=${range.to}` : ''}`),
  exitPages: (range?: { from: string; to: string }) =>
    http<PageStat[]>(`/metrics/exit-pages${range ? `?from=${range.from}&to=${range.to}` : ''}`),
  goals: (archived = false) => http<Goal[]>(`/metrics/goals${archived ? '?archived=true' : ''}`),
  primaryGoal: () => http<Goal>('/metrics/primary-goal'),
  /** Admin «Цель по оплатам» (paid tickets); the backend defaults it to 300. */
  kpiTarget: () => http<{ target: number }>('/metrics/kpi-target'),
  rawResponse: (id: number) => http<RawResponse>(`/metrics/raw/${id}`),
  hypotheses: () => http<Hypothesis[]>('/hypotheses'),
  createHypothesis: (h: NewHypothesis) =>
    http<Hypothesis>('/hypotheses', { method: 'POST', body: JSON.stringify(h) }),
  decisions: () => http<Decision[]>('/decisions'),
  createDecision: (d: NewDecision) =>
    http<Decision>('/decisions', { method: 'POST', body: JSON.stringify(d) }),
  b2b: () => http<B2bDeal[]>('/b2b'),
  createB2b: (deal: NewB2bDeal) =>
    http<B2bDeal>('/b2b', { method: 'POST', body: JSON.stringify(deal) }),
  updateB2bStage: (input: { id: number; stage: B2bStage; datePaid?: string }) =>
    http<B2bDeal>(`/b2b/${input.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ stage: input.stage, datePaid: input.datePaid }),
    }),
  /** ANA-50: set/clear the deal amount in ₽ (null clears). */
  updateB2bAmount: (input: { id: number; amountRub: number | null }) =>
    http<B2bDeal>(`/b2b/${input.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ amountRub: input.amountRub }),
    }),
  removeB2b: (id: number) => http<void>(`/b2b/${id}`, { method: 'DELETE' }),
  /** ANA-18: demo-data presence — drives the yellow «Демо-данные» banner on every screen. */
  demoStatus: () => http<DemoStatus>('/demo/status'),
  /** ANA-15: the latest sync run (status + per-step errors) for the admin sync-status UI. */
  syncStatus: () => http<SyncRunStatus>('/sync/status'),
  /** ANA-19: manual B2C payments (paid tickets per day, entered or CSV-imported). */
  b2cPayments: (range?: { from: string; to: string }) =>
    http<B2cPayment[]>(`/payments/b2c${range ? `?from=${range.from}&to=${range.to}` : ''}`),
  saveB2cPayment: (input: NewB2cPayment) =>
    http<B2cPayment>('/payments/b2c', { method: 'PUT', body: JSON.stringify(input) }),
  removeB2cPayment: (date: string) => http<void>(`/payments/b2c/${date}`, { method: 'DELETE' }),
  importB2cPayments: (csv: string) =>
    http<{ imported: number; skipped: number; errors: Array<{ line: number; message: string }> }>(
      '/payments/b2c/import',
      { method: 'POST', body: JSON.stringify({ csv }) },
    ),
  /** ANA-19: «Оплачено» = B2C paid + B2B paid. */
  paymentsSummary: (range?: { from: string; to: string }) =>
    http<{ b2cPaid: number; b2bPaid: number; paid: number; days: number }>(
      `/payments/summary${range ? `?from=${range.from}&to=${range.to}` : ''}`,
    ),
  /** ANA-73: the weekly marketing grid (Google Sheet «стата» replacement). */
  marketingWeekly: () => http<MarketingGrid>('/marketing/weekly'),
  saveMarketingCell: (input: {
    weekStart: string;
    metricKey: string;
    value: number;
    note?: string;
  }) => http<MarketingCell>('/marketing/weekly', { method: 'PUT', body: JSON.stringify(input) }),
  removeMarketingCell: (weekStart: string, metricKey: string) =>
    http<void>(`/marketing/weekly/${weekStart}/${metricKey}`, { method: 'DELETE' }),
  /** Admin: optional Metrika backfill of the window, then recompute the syncable cells. */
  marketingSync: (window?: { from: string; to: string }) =>
    http<MarketingSyncSummary>('/marketing/weekly/sync', {
      method: 'POST',
      body: JSON.stringify(window ?? {}),
    }),
  buildSnapshot: (body: { from: string; to: string }) =>
    http<ReportSnapshot>('/report/snapshot', { method: 'POST', body: JSON.stringify(body) }),
  /** Get an existing snapshot by ID (from History page). */
  getSnapshot: (id: string) => http<ReportSnapshot>(`/report/snapshot/${id}`),
  generateReport: (body: { snapshotId: string; format: 'docx' | 'pdf' }) =>
    http<{ filePath: string }>('/report/generate', { method: 'POST', body: JSON.stringify(body) }),
  generateInsights: (snapshotId: string, providerId?: string) =>
    http<{ narrative: string; generatedBy?: AiGenerationInfo }>('/report/insights', {
      method: 'POST',
      body: JSON.stringify({
        snapshotId,
        ...(providerId && providerId !== 'auto' ? { providerId } : {}),
      }),
    }),
  generateHypotheses: (snapshotId: string, providerId?: string) =>
    http<{ hypotheses: GeneratedHypotheses }>('/report/hypotheses', {
      method: 'POST',
      body: JSON.stringify({
        snapshotId,
        ...(providerId && providerId !== 'auto' ? { providerId } : {}),
      }),
    }),
  sync: (body: { from: string; to: string; goalId?: number }) =>
    http<SyncSummary>('/sync', { method: 'POST', body: JSON.stringify(body) }),
  /** List all report snapshots (for the History page). */
  listSnapshots: () => http<SnapshotSummary[]>('/report/snapshots'),
  /** Get current settings (secrets are masked). */
  getSettings: () => http<SettingsStatus>('/settings'),
  /** Save settings to .env. */
  saveSettings: (body: Partial<SettingsStatus>) =>
    http<{ ok: true; message: string }>('/settings', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  /** Trigger a refresh (re-sync from Metrika). */
  refreshData: () => http<{ ok: true }>('/settings/refresh', { method: 'POST' }),
};
