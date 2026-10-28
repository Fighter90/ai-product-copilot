import { useMutation, useQuery } from '@tanstack/react-query';
import {
  aiGenerationLabel,
  reportPeriodLabel,
  reportSections,
  type AiGenerationInfo,
  type ReportSnapshot,
} from '@pca/shared';
import { api } from '../lib/api';
import { v3 } from '../lib/api-v3';
import { useFilters } from '../store/filters';
import { formatInt, formatPercent } from '../lib/format';
import { errorMessage } from '../lib/error-message';
import { downloadFileViaFetch, reportDownloadUrl } from '../lib/download';
import { ErrorBox } from '../components/ui';
import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { mdToHtml } from '../lib/md-to-html';
import { fmtDate, useT, type DictKey } from '../i18n';
import {
  hasSeed,
  loadHypothesisSeed,
  storeHypothesisSeed,
  clearHypothesisSeed,
  dropHypothesisSeedParams,
  parseHypothesisSeed,
  type HypothesisSeed,
} from '../lib/hypothesis-prefill';

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}): JSX.Element {
  return (
    <div className="rounded border border-slate-200 p-2">
      <div className="text-xs uppercase text-slate-500">{label}</div>
      <div className="text-lg font-bold">{value}</div>
      {hint ? <div className="text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}

/**
 * On-screen render of the full report — the exact same sections DOCX and PDF produce
 * (via the shared reportSections), so what you read here is byte-for-byte the exported content.
 * ANA-39: a table of contents with anchor links + collapsible sections (`<details>`), so 30+
 * sections are navigable instead of one wall of text. The first two sections start open.
 */
export function ReportFullView({ snapshot }: { snapshot: ReportSnapshot }): JSX.Element {
  const { t } = useT();
  const sections = reportSections(snapshot);
  return (
    <article
      aria-label={t('rep.fullReport')}
      className="max-h-[70vh] space-y-4 overflow-auto rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm"
    >
      <p className="text-xs text-slate-500">{t('rep.fullReportNote', { n: sections.length })}</p>
      {/* ANA-39: оглавление — every heading is an anchor into the collapsible body */}
      {sections.length > 1 && (
        <nav
          aria-label={t('fx.toc.title')}
          className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600"
        >
          <div className="mb-1 font-semibold uppercase tracking-wide text-slate-400">
            {t('fx.toc.title')}
          </div>
          <ol className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2 lg:grid-cols-3">
            {sections.map((sec, i) => (
              <li key={`${sec.heading}-${i}`}>
                <a href={`#rep-sec-${i}`} className="hover:text-indigo-700 hover:underline">
                  {sec.heading}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      )}
      {sections.map((sec, i) => (
        <details
          key={`${sec.heading}-${i}`}
          id={`rep-sec-${i}`}
          // First two sections open ( Краткие итоги first), the rest collapsed — uncontrolled
          // afterwards, so the reader expands what they need without fighting React state.
          open={i < 2 ? true : undefined}
          className="scroll-mt-4 rounded-md border border-slate-100"
        >
          <summary className="cursor-pointer select-none border-b border-slate-200 px-2 py-1.5 font-semibold text-slate-800 hover:bg-slate-50">
            {sec.heading}
          </summary>
          <div className="space-y-1 p-2">
            {/* Same markdown the DOCX/PDF builders consume — tables/lists render as such
                (mdToHtml escapes first, so section text can't inject markup). */}
            <div
              className="report-md space-y-1 text-slate-600 [&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-slate-200 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-slate-200 [&_th]:bg-slate-50 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left"
              dangerouslySetInnerHTML={{ __html: mdToHtml(sec.lines.join('\n')) }}
            />
          </div>
        </details>
      ))}
    </article>
  );
}

/** Render AI analysis narrative as formatted HTML. */
function AINarrativeView({ narrative }: { narrative: string }): JSX.Element {
  const { t } = useT();
  return (
    <div className="space-y-1">
      <p className="text-xs text-violet-700">{t('rep.ai.note')}</p>
      <div
        className="ai-narrative overflow-auto rounded bg-slate-50 p-4 text-sm text-slate-700"
        dangerouslySetInnerHTML={{ __html: mdToHtml(narrative) }}
      />
    </div>
  );
}

/** Progress bar component for AI analysis */
function AIProgress({ progress, stage }: { progress: number; stage: string }): JSX.Element {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-violet-700">
        <span>{stage}</span>
        <span className="font-mono">{progress}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-violet-100">
        <div
          className="h-full rounded-full bg-violet-600 transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

export interface ReportPreviewProps {
  snapshot: ReportSnapshot | undefined;
  isPending: boolean;
  onBuild: () => void;
  onExport: (snapshotId: string, format: 'docx' | 'pdf') => void;
  insightsPending: boolean;
  narrative: string | undefined;
  insightsError: string | undefined;
  /** ANA-33: the selected provider rides along («auto» walks the admin-defined chain). */
  onInsights: (snapshotId: string, providerId: string) => void;
  /** ANA-33: providers currently usable (enabled + key set) from the admin API; [] = none. */
  providers: Array<{ id: string; name: string; model: string }>;
  providersPending?: boolean;
  /** ANA-33: attribution of the freshest generation (mutation result) — wins over the snapshot's. */
  aiGeneratedBy?: AiGenerationInfo;
  /** ANA-24: hypothesis draft prefilled from a «→ гипотеза» deep link (Overview/Traffic). */
  prefillSeed?: HypothesisSeed;
  onPrefillChange?: (next: HypothesisSeed) => void;
  onDiscardPrefill?: () => void;
}

// 5 stages matching the backend ANALYSIS_CHUNKS
const AI_STAGES: readonly DictKey[] = [
  'rep.stage.prepare',
  'rep.stage.summary',
  'rep.stage.channels',
  'rep.stage.pages',
  'rep.stage.risks',
  'rep.stage.hypotheses',
];

/** Localised B2B stage label; unknown stages fall back to the raw value. */
const STAGE_KEYS: Record<string, DictKey> = {
  lead: 'b2b.stage.lead',
  negotiation: 'b2b.stage.negotiation',
  invoiced: 'b2b.stage.invoiced',
  paid: 'b2b.stage.paid',
};

/**
 * ANA-24: editable hypothesis draft prefilled from the «→ гипотеза» deep link. Lives on the
 * report page because that is where hypotheses work happens in v3; the draft persists in
 * sessionStorage, so a refresh keeps it until the user discards it.
 */
export function HypothesisDraftCard({
  seed,
  onChange,
  onDiscard,
}: {
  seed: HypothesisSeed;
  onChange?: (next: HypothesisSeed) => void;
  onDiscard?: () => void;
}): JSX.Element | null {
  const { t } = useT();
  if (!hasSeed(seed)) return null;

  const update = (key: keyof HypothesisSeed, value: string): HypothesisSeed => {
    const next: { -readonly [K in keyof HypothesisSeed]: HypothesisSeed[K] } = {
      segment: seed.segment,
      trouble: seed.trouble,
      action: seed.action,
      barrier: seed.barrier,
      evidence: seed.evidence,
    };
    next[key] = value;
    return next;
  };

  const field = (key: keyof HypothesisSeed, label: string): JSX.Element => (
    <label key={key} className="block text-xs">
      <span className="mb-0.5 block font-medium text-slate-600">{label}</span>
      <input
        value={seed[key] ?? ''}
        onChange={(e) => onChange?.(update(key, e.target.value))}
        className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
      />
    </label>
  );

  return (
    <div
      data-testid="hypothesis-draft"
      className="space-y-2 rounded-lg border border-indigo-200 bg-indigo-50/60 p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-indigo-900">{t('rep.draft.title')}</h3>
        <button
          type="button"
          onClick={() => onDiscard?.()}
          className="text-xs text-slate-500 hover:text-slate-800"
        >
          {t('rep.draft.discard')}
        </button>
      </div>
      <p className="text-xs text-indigo-700">{t('rep.draft.hint')}</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {field('segment', t('rep.draft.segment'))}
        {field('trouble', t('rep.draft.trouble'))}
        {field('action', t('rep.draft.action'))}
        {field('barrier', t('rep.draft.barrier'))}
        {field('evidence', t('rep.draft.evidence'))}
      </div>
    </div>
  );
}

/** Pure preview: the snapshot summary that DOCX/PDF render from, plus export. */
export function ReportPreviewView({
  snapshot,
  isPending,
  onBuild,
  onExport,
  insightsPending,
  narrative,
  insightsError,
  onInsights,
  providers,
  providersPending,
  aiGeneratedBy,
  prefillSeed,
  onPrefillChange,
  onDiscardPrefill,
}: ReportPreviewProps): JSX.Element {
  const { t, locale } = useT();
  const [aiProgress, setAiProgress] = useState(0);
  const [aiStage, setAiStage] = useState<DictKey | null>(null);
  const [providerId, setProviderId] = useState('auto');
  const aiReady = providers.length > 0;
  const stageLabel = (stage: string): string => {
    const key = STAGE_KEYS[stage];
    return key ? t(key) : stage;
  };
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Simulate progress when AI analysis is pending
  useEffect(() => {
    if (!insightsPending) {
      setAiProgress(0);
      setAiStage(null);
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    // Start from stage 0
    setAiStage(AI_STAGES[0] ?? null);
    setAiProgress(0);

    let step = 0;
    const totalSteps = AI_STAGES.length;
    // Each step takes ~60 seconds (total ~5-10 minutes for 5 chunks with 6000 tokens)
    const stepDuration = 60000;

    intervalRef.current = setInterval(() => {
      step++;
      if (step >= totalSteps) {
        // Stay at 95% until response arrives (never hit 100% until done)
        setAiProgress(95);
        setAiStage(AI_STAGES[totalSteps - 1] ?? 'rep.stage.finishing');
      } else {
        const progress = Math.round((step / totalSteps) * 90);
        setAiProgress(progress);
        const stage = AI_STAGES[step];
        if (stage) setAiStage(stage);
      }
    }, stepDuration);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [insightsPending]);

  // When narrative arrives, snap to 100%
  useEffect(() => {
    if (narrative) {
      setAiProgress(100);
      setAiStage('rep.stage.done');
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
  }, [narrative]);

  // When error arrives, show error state
  useEffect(() => {
    if (insightsError) {
      setAiProgress(0);
      setAiStage('common.error');
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
  }, [insightsError]);

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold">{t('rep.title')}</h2>
        {/* ANA-39: exactly one main action. Before the first snapshot this is it; afterwards the
            primary "Build report" action in the snapshot card takes over (single button, one meaning). */}
        {!snapshot && (
          <button
            type="button"
            onClick={onBuild}
            disabled={isPending}
            className="rounded bg-indigo-600 px-3 py-1 text-sm text-white disabled:opacity-40"
          >
            {isPending ? t('rep.building') : t('rep.build')}
          </button>
        )}
      </div>

      {/* ANA-24: prefill from the «→ гипотеза» deep link lands in this editable draft. */}
      <HypothesisDraftCard
        seed={prefillSeed ?? {}}
        onChange={onPrefillChange}
        onDiscard={onDiscardPrefill}
      />

      {snapshot ? (
        <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          {/* ANA-39: no UUID in the UI — a human-readable period names the report; the raw id
              stays available in the technical tooltip (the "i" hint icon). */}
          <p
            className="text-xs text-slate-500"
            title={t('fx.snapshot.uuidTitle', { id: snapshot.id })}
          >
            {t('fx.snapshot.meta', {
              period: reportPeriodLabel(snapshot.period),
              at: fmtDate(snapshot.generatedAt, locale, true),
            })}
          </p>

          {/* KPI strip — primary-goal label follows the snapshot («Заказов» for a purchase goal:
              the Ecommerce goal fires on order creation, not on payment — ANA-19). */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label={t('rep.kpi.target')} value={formatInt(snapshot.kpi.target)} />
            <Stat
              label={
                snapshot.goalLabel?.isPaid ? t('rep.kpi.orders') : t('rep.kpi.applicationsB2c')
              }
              value={formatInt(snapshot.kpi.b2cApplications)}
              hint={
                snapshot.goalLabel?.showApplicationsCaveat === false
                  ? undefined
                  : t('rep.kpi.applicationNotPayment')
              }
            />
            <Stat label={t('rep.kpi.b2bOrders')} value={formatInt(snapshot.kpi.b2bPaidTickets)} />
            <Stat label={t('rep.kpi.gap')} value={formatInt(snapshot.kpi.gap)} />
          </div>

          {/* Funnel summary */}
          {snapshot.funnel && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label={t('rep.funnel.visits')} value={formatInt(snapshot.funnel.visits)} />
              <Stat
                label={t('rep.funnel.toApplications')}
                value={formatInt(snapshot.funnel.b2cApplications)}
                hint={
                  snapshot.funnel.visits > 0
                    ? `CR ${formatPercent(snapshot.funnel.b2cApplications / snapshot.funnel.visits)}`
                    : undefined
                }
              />
              <Stat
                label={t('rep.funnel.b2bInProgress')}
                value={formatInt(snapshot.funnel.b2bPipelineTickets)}
              />
              {/* БАГ-21: плитка «Заказов создано (B2B)» уже есть в KPI-полосе выше — дубль убран. */}
            </div>
          )}

          {/* B2B summary */}
          {snapshot.b2bSummary && snapshot.b2bSummary.dealsCount > 0 && (
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-slate-700">{t('rep.b2b.title')}</h3>
              <p className="text-xs text-slate-600">
                {t('rep.b2b.summary', {
                  deals: snapshot.b2bSummary.dealsCount,
                  tickets: formatInt(snapshot.b2bSummary.totalTickets),
                  paid: formatInt(snapshot.b2bSummary.paidTickets),
                })}
              </p>
              <div className="flex gap-2 text-xs text-slate-500">
                {snapshot.b2bSummary.byStage.map((s) => (
                  <span key={s.stage} className="rounded bg-slate-100 px-2 py-0.5">
                    {stageLabel(s.stage)}: {s.tickets} ({s.deals})
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Data summary */}
          <ul className="text-sm text-slate-600">
            {/* ANA-20: DISTINCT channels, not channel × day rows (the «Каналов: 82» bug) */}
            <li>
              {t('rep.data.channels', {
                n: new Set(snapshot.channels.map((c) => c.channel)).size,
              })}
            </li>
            <li>
              {t('rep.data.hypotheses', {
                value: snapshot.generatedHypotheses
                  ? t('rep.data.hypothesesCount', {
                      problems: snapshot.generatedHypotheses.problems.length,
                      solutions: snapshot.generatedHypotheses.solutions.length,
                    })
                  : t('rep.data.hypothesesNone'),
              })}
            </li>
            <li>{t('rep.data.decisions', { n: snapshot.decisions.length })}</li>
          </ul>

          {/* ANA-39: one main action — "Build report" creates a fresh snapshot in place
              (the old "Build slice" + "Rebuild report" pair meant the same). */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onBuild}
              disabled={isPending}
              className="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
            >
              {isPending ? t('rep.building') : t('rep.build')}
            </button>
            <button
              type="button"
              onClick={() => onExport(snapshot.id, 'docx')}
              className="rounded border border-indigo-600 px-3 py-1.5 text-sm text-indigo-700"
            >
              {t('rep.exportDocx')}
            </button>
            <button
              type="button"
              onClick={() => onExport(snapshot.id, 'pdf')}
              className="rounded border border-rose-600 px-3 py-1.5 text-sm text-rose-700"
            >
              {t('rep.exportPdf')}
            </button>
          </div>

          {/* Optional AI narrative with progress bar + provider choice (ANA-33) */}
          <div className="space-y-2 border-t border-slate-100 pt-3">
            {insightsPending ? (
              <div className="space-y-2">
                <AIProgress progress={aiProgress} stage={aiStage ? t(aiStage) : ''} />
                <p className="text-xs text-violet-500">{t('rep.ai.pendingNote')}</p>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onInsights(snapshot.id, providerId)}
                  disabled={!aiReady || !!narrative}
                  title={
                    !aiReady ? t('fx.ai.noProviders') : narrative ? t('rep.ai.alreadyTitle') : ''
                  }
                  className="rounded bg-violet-600 px-3 py-1 text-sm text-white disabled:opacity-40"
                >
                  {narrative ? t('rep.ai.done') : t('rep.ai.generate')}
                </button>
                {/* Provider selector: «Авто» + only the enabled providers (admin API). */}
                <label className="flex items-center gap-1 text-xs text-slate-600">
                  <span>{t('fx.ai.provider')}</span>
                  <select
                    value={providerId}
                    disabled={!aiReady}
                    onChange={(e) => setProviderId(e.target.value)}
                    aria-label={t('fx.ai.providerAria')}
                    className="rounded border border-slate-300 px-1.5 py-1"
                  >
                    <option value="auto">{t('fx.ai.providerAuto')}</option>
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {p.model}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            {!providersPending && !aiReady && (
              <p className="text-xs text-amber-700">{t('fx.ai.noProviders')}</p>
            )}
            {insightsError ? (
              <p role="alert" className="text-xs text-red-700">
                {t('rep.ai.unavailable', { error: insightsError })}
              </p>
            ) : null}
            {/* ANA-33: «Сгенерировано: YandexGPT · yandexgpt/latest» — who actually answered. */}
            {(() => {
              const by = aiGeneratedBy ?? snapshot.aiGeneratedBy?.insights;
              return narrative && by ? (
                <p className="text-xs text-violet-700">
                  {t('fx.ai.generatedBy', {
                    label: aiGenerationLabel(by),
                    at: fmtDate(by.at, locale, true),
                  })}
                </p>
              ) : null;
            })()}
            {narrative ? <AINarrativeView narrative={narrative} /> : null}
          </div>

          <ReportFullView snapshot={snapshot} />
        </div>
      ) : (
        <p className="text-slate-500">{t('rep.empty')}</p>
      )}
    </section>
  );
}

/** Data wrapper: builds/rebuilds a snapshot and downloads DOCX/PDF to the user's computer. */
export function ReportPreview(): JSX.Element {
  const { from, to } = useFilters();
  const location = useLocation();
  const navigate = useNavigate();
  const buildMut = useMutation({ mutationFn: api.buildSnapshot });
  const insightsMut = useMutation({
    mutationFn: (input: { snapshotId: string; providerId: string }) =>
      api.generateInsights(input.snapshotId, input.providerId),
  });

  // ANA-33: usable AI providers (enabled + key set) — analysts read them from /ai/available.
  const providersQ = useQuery({
    queryKey: ['v3', 'available-providers'],
    queryFn: () => v3.availableProviders(),
    staleTime: 60_000,
    retry: false,
  });

  // Check for existing snapshot ID in URL (from History page)
  const searchParams = new URLSearchParams(location.search);
  const snapshotId = searchParams.get('snapshot');

  const existingSnapshot = useQuery({
    queryKey: ['snapshot', snapshotId],
    queryFn: () => api.getSnapshot(snapshotId!),
    enabled: !!snapshotId,
  });

  const snapshot = existingSnapshot.data ?? buildMut.data;
  // БАГ-21: AI-гипотезы дорисовываются на бэке после сборки среза (fire-and-forget), поэтому
  // опрашиваем срез, пока они не появятся — строка «AI-гипотез: …» обновляется сама, без
  // перезагрузки страницы. Опрос останавливается на результате или после ~5 минут.
  const activeId = snapshot?.id;
  const pollCount = useRef(0);
  useEffect(() => {
    pollCount.current = 0;
  }, [activeId]);
  const refreshed = useQuery({
    queryKey: ['snapshot-refresh', activeId],
    queryFn: () => {
      pollCount.current += 1;
      return api.getSnapshot(activeId!);
    },
    enabled: !!activeId && !snapshot?.generatedHypotheses,
    refetchInterval: (q) =>
      (q.state.data?.generatedHypotheses ?? snapshot?.generatedHypotheses) ||
      pollCount.current >= 60
        ? false
        : 5000,
  });
  // Свежий payload с тем же id (уже с гипотезами) выигрывает у исходного ответа сборки.
  const effectiveSnapshot =
    refreshed.data && refreshed.data.id === snapshot?.id ? refreshed.data : snapshot;
  // БАГ-04: ошибка скачивания отчёта видна в UI (fetch→blob вместо navigation-запроса).
  const [exportError, setExportError] = useState<string | null>(null);
  const doExport = (snapshotId: string, format: 'docx' | 'pdf'): void => {
    setExportError(null);
    downloadFileViaFetch(
      reportDownloadUrl(snapshotId, format),
      `productcamp-report-${snapshotId}.${format}`,
    ).catch((e: unknown) => setExportError(e instanceof Error ? e.message : String(e)));
  };

  // When viewing from History, use the saved AI narrative if present
  const savedNarrative = effectiveSnapshot?.aiNarrative;
  const narrative = insightsMut.data?.narrative ?? savedNarrative;
  const insightsPending = insightsMut.isPending;

  // ANA-24: the «→ гипотеза» deep link carries the prefill in the query string. Capture it once,
  // persist to sessionStorage (survives reloads) and clean the seed params from the URL, keeping
  // any other params (e.g. ?snapshot=…) intact.
  const [prefill, setPrefill] = useState<HypothesisSeed>(() => loadHypothesisSeed());
  const search = location.search;
  useEffect(() => {
    const fromUrl = parseHypothesisSeed(search);
    if (!hasSeed(fromUrl)) return;
    storeHypothesisSeed(fromUrl);
    setPrefill(fromUrl);
    navigate(
      { pathname: '/app/report', search: dropHypothesisSeedParams(search) },
      { replace: true },
    );
  }, [search, navigate]);

  return (
    <>
      {exportError && <ErrorBox error={exportError} />}
      <ReportPreviewView
        snapshot={effectiveSnapshot}
        isPending={buildMut.isPending}
        onBuild={() => buildMut.mutate({ from, to })}
        onExport={doExport}
        insightsPending={insightsPending}
        narrative={narrative}
        insightsError={errorMessage(insightsMut.error)}
        onInsights={(snapshotId, providerId) => insightsMut.mutate({ snapshotId, providerId })}
        providers={providersQ.data ?? []}
        providersPending={providersQ.isPending}
        aiGeneratedBy={insightsMut.data?.generatedBy}
        prefillSeed={prefill}
        onPrefillChange={(next) => {
          storeHypothesisSeed(next);
          setPrefill(next);
        }}
        onDiscardPrefill={() => {
          clearHypothesisSeed();
          setPrefill({});
        }}
      />
    </>
  );
}
