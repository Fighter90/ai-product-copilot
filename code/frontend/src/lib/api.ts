import type {
  B2bDeal,
  B2bStage,
  B2cPayment,
  ChannelStat,
  Decision,
  DemoStatus,
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
} from '@pca/shared';
import { translate } from '../i18n';
import type { Locale } from '../store/prefs';

const BASE = '/api';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** ANA-155: parsed JSON body (when it was one) — the enriched 429 payload reads it. */
    public readonly body?: unknown,
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

/** ANA-139: POST /sync/gaps answer — the echoed hole report plus each refill run. */
export interface SyncGapsReport {
  from: string;
  to: string;
  gaps: Record<string, Array<{ from: string; to: string }>>;
  synced: Array<{ from: string; to: string; summary: SyncSummary }>;
}

export interface SnapshotSummary {
  id: string;
  generatedAt: string;
  dateFrom: string;
  dateTo: string;
  /** ANA-39: who built the snapshot (user email in cabinet mode; null in legacy mode). */
  author?: string | null;
  /**
   * ANA-193: план→факт, зафиксированные в снапшоте (KPI-цель и подтверждённые оплаты;
   * извлечены бэкендом из payload'а, null — извлечь нельзя). «История» отслеживает план
   * без парсинга payload'ов; «заявка ≠ оплата» — в оплате только подтверждённые деньги.
   */
  kpiTarget?: number | null;
  kpiPaid?: number | null;
}

/** ANA-133: poll-facing view of one background AI generation job (mirrors the backend). */
export interface AiJobView {
  readonly id: string;
  readonly kind: 'insights' | 'hypotheses';
  /** ANA-155: 'pending' = the Auto fallback parked behind the running generation. */
  readonly status: 'pending' | 'running' | 'done' | 'failed';
  /** ANA-155: requested provider choice of the job ('auto' or a pinned provider id). */
  readonly provider?: string;
  /** ANA-155: ISO time the job took the slot (absent while pending). */
  readonly startedAt?: string;
  /** Set when status is 'done' — the generation payload ({narrative} / {hypotheses}). */
  readonly result?: unknown;
  /** Set when status is 'failed' — the extracted error message. */
  readonly error?: string;
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
    // Metrika per-user quota exhausted (ANA-112): tell the UI to show the "stale data" banner.
    // Throttled — several live widgets can 429 within one render pass. Scoped to Metrika-backed
    // endpoints: auth login, help questions and DataLens have their own 429 rate limits and must
    // not trigger a banner that claims Metrika data is stale.
    const text = await res.text();
    // v3.4.1: live-degradation — бэкенд отвечает 503 {code: METRIKA_*} на любой сбой Метрики
    // (квота 429, query_error 400, сеть): тот же баннер «показаны последние доступные данные».
    if (
      res.status === 503 &&
      /METRIKA_(QUOTA|UNAVAILABLE|QUERY_TOO_COMPLEX)/.test(text) &&
      /^\/(live|metrics)\b/.test(path) &&
      typeof window !== 'undefined'
    ) {
      dispatchQuotaBanner();
    }
    if (
      res.status === 429 &&
      /^\/(live|metrics|sync|admin\/metrika)\b/.test(path) &&
      typeof window !== 'undefined'
    ) {
      dispatchQuotaBanner();
    }
    // ANA-155: attach the parsed JSON body (the enriched AI-busy 429 reads it later);
    // non-JSON bodies (HTML error pages) keep body undefined.
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(text) as unknown;
    } catch {
      parsedBody = undefined;
    }
    throw new ApiError(res.status, readableError(res.status, text), parsedBody);
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json()) as T;
  // v3.4.1: stale-on-error — бэкенд отдал прошлые данные с флагом stale (источник упал,
  // кэш спас): показать тот же баннер, чтобы цифры не выглядели «живыми».
  if (
    typeof window !== 'undefined' &&
    /^\/live\b/.test(path) &&
    (data as { stale?: unknown })?.stale === true
  ) {
    dispatchQuotaBanner();
  }
  return data;
}

/** ANA-112 × v3.4.1: баннер «последние доступные данные» — не чаще раза в 30 с. */
function dispatchQuotaBanner(): void {
  const last = (window as { __pcaQuotaAt?: number }).__pcaQuotaAt ?? 0;
  if (Date.now() - last > 30_000) {
    (window as { __pcaQuotaAt?: number }).__pcaQuotaAt = Date.now();
    window.dispatchEvent(new CustomEvent('pca:metrika-quota'));
  }
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
  syncStatus: () => http<{ run: SyncRunStatus | null }>('/sync/status'),
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
  /**
   * ANA-133: AI generation runs in the backend's single-slot background queue — the POST
   * answers 202 {jobId} right away; the narrative/hypotheses arrive via `getAiJob` polling
   * (see lib/ai-jobs.ts). A busy slot surfaces as a 429 ApiError.
   */
  generateInsights: (snapshotId: string, providerId?: string, locale: 'ru' | 'en' = 'ru') =>
    http<{ jobId: string }>('/report/insights', {
      method: 'POST',
      body: JSON.stringify({
        snapshotId,
        ...(providerId && providerId !== 'auto' ? { providerId } : {}),
        // Регресс №4: the narrative language follows the UI locale.
        lang: locale,
      }),
    }),
  /** ANA-133: only starts the background job (202 {jobId}) — the snapshot poll renders it. */
  generateHypotheses: (snapshotId: string, providerId?: string) =>
    http<{ jobId: string }>('/report/hypotheses', {
      method: 'POST',
      body: JSON.stringify({
        snapshotId,
        ...(providerId && providerId !== 'auto' ? { providerId } : {}),
      }),
    }),
  /** ANA-133: poll one background AI job (404 when lost, e.g. after a server restart). */
  getAiJob: (jobId: string) => http<AiJobView>(`/report/ai-jobs/${encodeURIComponent(jobId)}`),
  sync: (body: { from: string; to: string; goalId?: number }) =>
    http<SyncSummary>('/sync', { method: 'POST', body: JSON.stringify(body) }),
  /**
   * ANA-139: refill ONLY the missing days (holes) of the derived stat tables in the period —
   * an interior run of missing days is invisible to per-table coverage and a full re-sync
   * would spend Metrika quota on days that are already good.
   */
  syncGaps: (body: { from: string; to: string }) =>
    http<SyncGapsReport>('/sync/gaps', { method: 'POST', body: JSON.stringify(body) }),
  /** List all report snapshots (for the History page). */
  listSnapshots: () => http<SnapshotSummary[]>('/report/snapshots'),
  /** REG-10: delete a snapshot (admin only; REG-11 reuses it for one-off cleanup). */
  deleteSnapshot: (id: string) =>
    http<{ ok: boolean }>(`/report/snapshots/${id}`, { method: 'DELETE' }),
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
