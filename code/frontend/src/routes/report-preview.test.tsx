import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReportSnapshot } from '@pca/shared';
import { renderWithProviders } from '../test/utils';
import { expectNoCyrillic, setTestLocale } from '../test/i18n-utils';

vi.mock('../lib/api', () => ({
  api: {
    buildSnapshot: vi.fn(),
    generateInsights: vi.fn(),
    generateHypotheses: vi.fn(),
    getSnapshot: vi.fn(),
    getAiJob: vi.fn(),
  },
}));
vi.mock('../lib/api-v3', () => ({
  // A provider is configured by default so the wrapper's AI button is enabled; the empty case
  // (disabled + hint) is covered at the View level.
  v3: {
    availableProviders: vi
      .fn()
      .mockResolvedValue([
        { id: 'yandexgpt', name: 'YandexGPT (AI Studio)', model: 'yandexgpt/latest' },
      ]),
  },
}));
vi.mock('../lib/download', () => ({
  downloadFile: vi.fn(),
  downloadFileViaFetch: vi.fn().mockResolvedValue(undefined),
  reportDownloadUrl: (id: string, format: string) => `/api/report/download/${id}/${format}`,
}));
import { api } from '../lib/api';
import { downloadFileViaFetch } from '../lib/download';
import { ReportPreviewView, ReportPreview, ReportFullView } from './report-preview';

const snapshot: ReportSnapshot = {
  id: 'snap-1',
  generatedAt: 'T',
  period: { from: '2025-01-01', to: '2025-01-07' },
  kpi: { target: 300, b2cApplications: 7, b2bPaidTickets: 20, gap: 280 },
  channels: [],
  hypotheses: { problems: [], solutions: [] },
  decisions: [],
  b2bSummary: { totalTickets: 0, paidTickets: 0, dealsCount: 0, deals: [], byStage: [] },
  funnel: { visits: 0, b2cApplications: 7, b2bPipelineTickets: 0, b2bPaidTickets: 20 },
  breakdowns: { utm: [], geoDevice: [], entryPages: [], exitPages: [] },
};

const snapshotWithData: ReportSnapshot = {
  ...snapshot,
  funnel: { visits: 1000, b2cApplications: 50, b2bPipelineTickets: 15, b2bPaidTickets: 20 },
  b2bSummary: {
    totalTickets: 35,
    paidTickets: 20,
    dealsCount: 2,
    deals: [
      { company: 'BigCorp', tickets: 20, stage: 'paid' },
      { company: 'SmallCo', tickets: 15, stage: 'lead' },
    ],
    byStage: [
      { stage: 'paid', tickets: 20, deals: 1 },
      { stage: 'lead', tickets: 15, deals: 1 },
    ],
  },
};

const baseProps = {
  snapshot: undefined,
  isPending: false,
  onBuild: vi.fn(),
  onExport: vi.fn(),
  insightsPending: false,
  narrative: undefined,
  insightsError: undefined,
  onInsights: vi.fn(),
  // ANA-33: the wrapper feeds the enabled providers; tests override as needed.
  providers: [{ id: 'yandexgpt', name: 'YandexGPT (AI Studio)', model: 'yandexgpt/latest' }],
  providersPending: false,
  aiGeneratedBy: undefined,
};

describe('ReportPreviewView', () => {
  it('prompts to build, and the single main button reflects pending state (ANA-39)', () => {
    const onBuild = vi.fn();
    const { rerender } = render(<ReportPreviewView {...baseProps} onBuild={onBuild} />);
    expect(screen.getByText(/Нажмите «Собрать отчёт»/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Собрать отчёт' }));
    expect(onBuild).toHaveBeenCalled();

    rerender(<ReportPreviewView {...baseProps} isPending />);
    expect(screen.getByRole('button', { name: 'Собираю…' })).toBeDisabled();
  });

  it('shows a human-readable meta line and keeps the UUID only in the tooltip (ANA-39)', () => {
    render(<ReportPreviewView {...baseProps} snapshot={snapshot} />);
    // Not month-aligned → the shared reportPeriodLabel prints «01.01.2025 – 07.01.2025», no UUID.
    const meta = screen.getByText(/Отчёт «01\.01\.2025 – 07\.01\.2025»/);
    expect(meta).toHaveAttribute('title', 'Срез данных: snap-1');
    // The visible meta text carries no UUID (the raw id may stay in technical hints only).
    expect(meta.textContent).not.toContain('snap-1');
  });

  it('has one main build action — no separate «Перестроить отчёт» button (ANA-39)', () => {
    const onBuild = vi.fn();
    render(<ReportPreviewView {...baseProps} snapshot={snapshot} onBuild={onBuild} />);
    expect(screen.queryByRole('button', { name: 'Перестроить отчёт' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Собрать отчёт' }));
    expect(onBuild).toHaveBeenCalled();
  });

  it('shows the snapshot summary and triggers DOCX + PDF export', () => {
    const onExport = vi.fn();
    render(<ReportPreviewView {...baseProps} snapshot={snapshot} onExport={onExport} />);
    // No goalLabel on the fixture → KPI falls back to «Заявок B2C».
    expect(screen.getByText('Заявок B2C')).toBeInTheDocument();
    expect(screen.getByText(/не сгенерированы/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Export DOCX' }));
    expect(onExport).toHaveBeenCalledWith('snap-1', 'docx');
    fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
    expect(onExport).toHaveBeenCalledWith('snap-1', 'pdf');
  });

  it('reports the ANA-128 auto-population result next to the data summary', () => {
    render(
      <ReportPreviewView
        {...baseProps}
        snapshot={{
          ...snapshot,
          autoPopulate: { hypotheses: 7, decisions: 3, skipped: 2 },
        }}
      />,
    );
    const line = screen.getByTestId('rep-autopopulate');
    expect(line).toHaveTextContent('Автопополнение: 7 гипотез и 3 решений перенесено в разделы');
    expect(line).toHaveTextContent('(дубликатов пропущено: 2)');
  });

  it('hides the auto-population line while AI analysis has not populated anything', () => {
    render(<ReportPreviewView {...baseProps} snapshot={snapshot} />);
    expect(screen.queryByText(/Автопополнение/)).not.toBeInTheDocument();
  });

  it('ANA-132: shows the hypotheses-failure hint only while drafts are still missing', () => {
    const { rerender } = render(
      <ReportPreviewView
        {...baseProps}
        snapshot={snapshot}
        hypothesesError="AI returned invalid JSON"
      />,
    );
    expect(screen.getByTestId('rep-hypotheses-error')).toHaveTextContent(
      'Гипотезы не сгенерированы: AI returned invalid JSON',
    );
    // Once the drafts exist (snapshot refreshed by the poll), the hint is gone.
    rerender(
      <ReportPreviewView
        {...baseProps}
        snapshot={{
          ...snapshot,
          generatedHypotheses: { problems: [], solutions: [] },
        }}
        hypothesesError="AI returned invalid JSON"
      />,
    );
    expect(screen.queryByTestId('rep-hypotheses-error')).not.toBeInTheDocument();
  });

  it('KPI label follows the snapshot goalLabel (Заявок for a purchase goal — БАГ-02: заявки, не «заказы»)', () => {
    const paidSnapshot = {
      ...snapshot,
      goalLabel: {
        title: 'Заявок',
        isPaid: true,
        showApplicationsCaveat: true,
        showEstimate: false,
      },
    };
    render(<ReportPreviewView {...baseProps} snapshot={paidSnapshot} />);
    expect(screen.getByText('Заявок')).toBeInTheDocument();
    expect(screen.queryByText('Заявок B2C')).not.toBeInTheDocument();
  });

  it('ANA-167: the order-goal tile explains «Заказ» with the period and a definition tooltip', () => {
    render(
      <ReportPreviewView
        {...baseProps}
        snapshot={{
          ...snapshot,
          goalLabel: {
            title: 'Заказов',
            isPaid: true,
            showApplicationsCaveat: false,
            showEstimate: false,
          },
        }}
      />,
    );
    // Visible dates: the «how counted + period» line under the value.
    expect(
      screen.getByText('Считается: сумма goal_reaches за период 01.01.2025 – 07.01.2025'),
    ).toBeInTheDocument();
    // The «i» tooltip carries the full order-goal definition with the ISO period.
    const hint = screen.getByText(/Заказ ≠ платный билет/);
    expect(hint.textContent).toContain('с 2025-01-01 до 2025-01-07');
  });

  it('REG-04 (ANA-93): shows «Покрытие данных» when the slice covers the period partially', () => {
    const partial = {
      ...snapshot,
      coverage: { from: '2025-01-04', to: '2025-01-07', days: 4 },
    };
    render(<ReportPreviewView {...baseProps} snapshot={partial} />);
    expect(screen.getByTestId('report-coverage')).toHaveTextContent(
      'Покрытие данных: 04.01–07.01 (4 из 7 дн.): период покрыт данными частично',
    );
  });

  it('REG-04 (ANA-93): no coverage note for a fully covered period or a legacy slice', () => {
    const { unmount } = render(
      <ReportPreviewView
        {...baseProps}
        snapshot={{ ...snapshot, coverage: { from: '2024-12-01', to: '2025-01-07', days: 38 } }}
      />,
    );
    expect(screen.queryByTestId('report-coverage')).not.toBeInTheDocument();
    unmount();
    // Legacy snapshot without the coverage field — unchanged rendering.
    render(<ReportPreviewView {...baseProps} snapshot={snapshot} />);
    expect(screen.queryByTestId('report-coverage')).not.toBeInTheDocument();
  });

  it('AI insights: the chosen provider rides along, «Авто» is the default (ANA-33)', () => {
    const onInsights = vi.fn();
    render(<ReportPreviewView {...baseProps} snapshot={snapshot} onInsights={onInsights} />);
    const select = screen.getByRole('combobox', { name: 'AI-провайдер для генерации анализа' });
    fireEvent.change(select, { target: { value: 'yandexgpt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сгенерировать AI-анализ' }));
    expect(onInsights).toHaveBeenCalledWith('snap-1', 'yandexgpt');

    fireEvent.change(select, { target: { value: 'auto' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сгенерировать AI-анализ' }));
    expect(onInsights).toHaveBeenLastCalledWith('snap-1', 'auto');
  });

  it('AI button is disabled with a hint when no provider is configured (ANA-33)', () => {
    render(<ReportPreviewView {...baseProps} snapshot={snapshot} providers={[]} />);
    expect(screen.getByRole('button', { name: 'Сгенерировать AI-анализ' })).toBeDisabled();
    expect(screen.getByText(/AI-провайдеры не настроены/)).toBeInTheDocument();
  });

  it('shows «Сгенерировано: provider · model · date» next to the narrative (ANA-33)', () => {
    render(
      <ReportPreviewView
        {...baseProps}
        snapshot={snapshot}
        narrative="Итог: рост."
        aiGeneratedBy={{
          provider: 'yandexgpt',
          providerName: 'YandexGPT (AI Studio)',
          model: 'yandexgpt/latest',
          at: '2026-10-27T10:00:00.000Z',
        }}
      />,
    );
    expect(
      screen.getByText(/Сгенерировано: YandexGPT \(AI Studio\) · yandexgpt\/latest/),
    ).toBeInTheDocument();
  });

  it('AI insights pending progress, the narrative, and an error', () => {
    const onInsights = vi.fn();
    const { rerender } = render(
      <ReportPreviewView {...baseProps} snapshot={snapshot} onInsights={onInsights} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Сгенерировать AI-анализ' }));
    expect(onInsights).toHaveBeenCalledWith('snap-1', 'auto');

    // When pending, show progress bar instead of disabled button
    rerender(<ReportPreviewView {...baseProps} snapshot={snapshot} insightsPending />);
    // Progress bar should be visible - check for the progress text specifically
    expect(screen.getByText(/Генерация AI-анализа/)).toBeInTheDocument();
    // Use getAllByText since there may be other percentage elements
    expect(screen.getAllByText(/\d+%/).length).toBeGreaterThanOrEqual(1);

    rerender(
      <ReportPreviewView {...baseProps} snapshot={snapshot} narrative="Итог: рост заявок." />,
    );
    expect(screen.getByText(/Итог: рост заявок\./)).toBeInTheDocument();

    rerender(<ReportPreviewView {...baseProps} snapshot={snapshot} insightsError="нет ключа" />);
    expect(screen.getByRole('alert')).toHaveTextContent(/нет ключа/);
  });

  it('shows funnel summary with CR hint when visits > 0', () => {
    render(<ReportPreviewView {...baseProps} snapshot={snapshotWithData} />);
    expect(screen.getAllByText('Визиты')[0]).toBeInTheDocument();
    expect(screen.getByText('Воронка → Заявки')).toBeInTheDocument();
    // CR hint appears in the funnel section - use getAllByText since it also appears in report sections
    expect(screen.getAllByText(/CR 5\.0%/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('B2B в работе')).toBeInTheDocument();
    // REG-08: the tile shows paid B2B tickets under the same label as the Overview («Оплачено B2B»).
    expect(screen.getAllByText('Оплачено B2B').length).toBeGreaterThanOrEqual(1);
  });

  it('shows B2B summary when there are deals', () => {
    render(<ReportPreviewView {...baseProps} snapshot={snapshotWithData} />);
    // B2B-пайплайн appears in both preview and report sections
    expect(screen.getAllByText('B2B-пайплайн').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/2 сделок/)).toBeInTheDocument();
    // «35 билетов» встречается и в B2B-сводке, и в итоговой строке после переименования терминов (ANA-19)
    expect(screen.getAllByText(/35 билетов/).length).toBeGreaterThanOrEqual(1);
    // Deal stages are localised in the preview strip (raw «paid» stays in the report document).
    expect(screen.getByText('Оплачено: 20 (1)')).toBeInTheDocument();
    expect(screen.getByText('Лид: 15 (1)')).toBeInTheDocument();
  });
});

describe('ReportPreviewView (EN locale)', () => {
  beforeEach(() => setTestLocale('en'));
  afterEach(() => setTestLocale('ru'));

  // The full report body comes from the shared Russian report document (identical to DOCX/PDF).
  const ignore = ['article'];

  it('renders the empty state without Cyrillic', () => {
    const { container } = render(<ReportPreviewView {...baseProps} />);
    expect(screen.getByRole('button', { name: 'Build report' })).toBeInTheDocument();
    expectNoCyrillic(container);
  });

  it('renders the snapshot summary, draft and AI states without Cyrillic', () => {
    const { container, rerender } = render(
      <ReportPreviewView
        {...baseProps}
        snapshot={
          {
            ...snapshotWithData,
            generatedHypotheses: { problems: [], solutions: [] },
          } as ReportSnapshot
        }
        prefillSeed={{ segment: 'Students', trouble: 'Drop-off' }}
      />,
    );
    expect(screen.getByText('Hypothesis draft')).toBeInTheDocument();
    expect(screen.getByText('Paid: 20 (1)')).toBeInTheDocument();
    expect(screen.getByText('B2C applications')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Build report' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Full report' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Table of contents' })).toBeInTheDocument();
    expectNoCyrillic(container, { ignore });

    rerender(<ReportPreviewView {...baseProps} snapshot={snapshotWithData} insightsPending />);
    expect(screen.getByText('Preparing data')).toBeInTheDocument();
    expectNoCyrillic(container, { ignore });

    rerender(
      <ReportPreviewView
        {...baseProps}
        snapshot={snapshotWithData}
        narrative="Summary: growth."
        insightsError="no key"
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('AI analysis unavailable: no key');
    expect(screen.getByRole('button', { name: 'AI analysis generated' })).toHaveAttribute(
      'title',
      'AI analysis has already been generated for this snapshot',
    );
    expectNoCyrillic(container, { ignore });
  });
});

describe('ReportPreview (wrapper)', () => {
  beforeEach(() => {
    vi.mocked(api.buildSnapshot).mockResolvedValue(snapshot);
    // БАГ-21 backfill calls this after the narrative; default to a resolved promise so the
    // mutation chain never rejects on an incomplete mock.
    vi.mocked(api.generateHypotheses).mockResolvedValue({
      hypotheses: { problems: [], solutions: [] },
    } as never);
  });

  it('builds a snapshot then downloads the DOCX export', async () => {
    renderWithProviders(<ReportPreview />);
    fireEvent.click(screen.getByRole('button', { name: 'Собрать отчёт' }));
    // ANA-39: the human-readable period names the report; the UUID lives only in the tooltip.
    expect(await screen.findByText(/Отчёт «01\.01\.2025 – 07\.01\.2025»/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Export DOCX' }));
    // БАГ-04: скачивание через fetch→blob (downloadFileViaFetch), а не navigation.
    expect(vi.mocked(downloadFileViaFetch)).toHaveBeenCalledWith(
      '/api/report/download/snap-1/docx',
      'productcamp-report-snap-1.docx',
    );
  });

  it('generates an AI narrative for the snapshot', async () => {
    // ANA-133: the POST returns a jobId, the narrative arrives via the job poll.
    vi.mocked(api.generateInsights).mockResolvedValue({ jobId: 'job-1' });
    vi.mocked(api.getAiJob).mockResolvedValue({
      id: 'job-1',
      kind: 'insights',
      status: 'done',
      result: { narrative: 'AI: рост заявок' },
    });
    renderWithProviders(<ReportPreview />);
    fireEvent.click(screen.getByRole('button', { name: 'Собрать отчёт' }));
    expect(await screen.findByText(/Отчёт «01\.01\.2025 – 07\.01\.2025»/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Сгенерировать AI-анализ' }));
    expect(await screen.findByText(/AI: рост заявок/)).toBeInTheDocument();
    // ANA-33: «Авто» is the default choice — no providerId is pinned in the request.
    expect(vi.mocked(api.generateInsights).mock.calls[0]?.slice(0, 2)).toEqual(['snap-1', 'auto']);
    expect(vi.mocked(api.getAiJob)).toHaveBeenCalledWith('job-1');
  });

  it('БАГ-21: after the narrative, hypotheses are backfilled — «не сгенерированы» не зависает', async () => {
    vi.mocked(api.generateInsights).mockResolvedValue({ jobId: 'job-1' });
    vi.mocked(api.getAiJob).mockImplementation(async (id: string) =>
      id === 'job-1'
        ? { id, kind: 'insights', status: 'done', result: { narrative: 'AI: рост заявок' } }
        : {
            id,
            kind: 'hypotheses',
            status: 'done',
            result: { hypotheses: { problems: [{ title: 'p1' }], solutions: [{ title: 's1' }] } },
          },
    );
    vi.mocked(api.generateHypotheses).mockResolvedValue({ jobId: 'job-2' } as never);
    // getSnapshot powers the existing poll (enabled while the snapshot has no hypotheses yet).
    vi.mocked(api.getSnapshot).mockResolvedValue({ ...snapshot });
    renderWithProviders(<ReportPreview />);
    fireEvent.click(screen.getByRole('button', { name: 'Собрать отчёт' }));
    expect(await screen.findByText(/Отчёт «01\.01\.2025 – 07\.01\.2025»/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Сгенерировать AI-анализ' }));
    await screen.findByText(/AI: рост заявок/);
    // The narrative alone used to leave «AI-гипотез: не сгенерированы» forever when the backend's
    // fire-and-forget auto-generation was lost — now the same provider backfills the hypotheses
    // once the single AI slot is free again (ANA-133).
    await waitFor(() =>
      expect(vi.mocked(api.generateHypotheses)).toHaveBeenCalledWith('snap-1', 'auto'),
    );
    expect(screen.getByText(/AI-гипотез: не сгенерированы/)).toBeInTheDocument();
    // ANA-132: the backfill settled successfully — no failure hint is rendered.
    expect(screen.queryByTestId('rep-hypotheses-error')).not.toBeInTheDocument();
  });

  it('ANA-132: a failed follow-up hypotheses generation is shown, not silently swallowed', async () => {
    vi.mocked(api.generateInsights).mockResolvedValue({ jobId: 'job-1' });
    vi.mocked(api.getAiJob).mockImplementation(async (id: string) =>
      id === 'job-1'
        ? { id, kind: 'insights', status: 'done', result: { narrative: 'AI: рост заявок' } }
        : { id, kind: 'hypotheses', status: 'failed', error: 'AI returned invalid JSON' },
    );
    vi.mocked(api.generateHypotheses).mockResolvedValue({ jobId: 'job-2' } as never);
    vi.mocked(api.getSnapshot).mockResolvedValue({ ...snapshot });
    renderWithProviders(<ReportPreview />);
    fireEvent.click(screen.getByRole('button', { name: 'Собрать отчёт' }));
    expect(await screen.findByText(/Отчёт «01\.01\.2025 – 07\.01\.2025»/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Сгенерировать AI-анализ' }));
    await screen.findByText(/AI: рост заявок/);
    // On prod the follow-up generation used to fail invisibly («AI-гипотез: не сгенерированы»
    // hung forever, 0 drafts, no hint). ANA-132: the tracked job failure becomes a visible hint,
    // while the successful narrative stays on screen.
    const hint = await screen.findByTestId('rep-hypotheses-error');
    expect(hint).toHaveTextContent('Гипотезы не сгенерированы');
    expect(hint).toHaveTextContent('AI returned invalid JSON');
    expect(screen.getByText(/AI: рост заявок/)).toBeInTheDocument();
  });

  it('ANA-132: a busy AI slot (429) on the follow-up hypotheses call is reported too', async () => {
    vi.mocked(api.generateInsights).mockResolvedValue({ jobId: 'job-1' });
    vi.mocked(api.getAiJob).mockResolvedValue({
      id: 'job-1',
      kind: 'insights',
      status: 'done',
      result: { narrative: 'AI: рост заявок' },
    });
    vi.mocked(api.generateHypotheses).mockRejectedValue(
      Object.assign(new Error('{"error":"другая генерация","code":"AI_BUSY"}'), { status: 429 }),
    );
    vi.mocked(api.getSnapshot).mockResolvedValue({ ...snapshot });
    renderWithProviders(<ReportPreview />);
    fireEvent.click(screen.getByRole('button', { name: 'Собрать отчёт' }));
    expect(await screen.findByText(/Отчёт «01\.01\.2025 – 07\.01\.2025»/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Сгенерировать AI-анализ' }));
    await screen.findByText(/AI: рост заявок/);
    // 429 on the backfill is a legit state (another generation holds the slot) — it gets the
    // same localized hint instead of vanishing (ANA-132).
    const hint = await screen.findByTestId('rep-hypotheses-error');
    expect(hint).toHaveTextContent('уже выполняется');
    expect(screen.getByText(/AI: рост заявок/)).toBeInTheDocument();
  });

  it('ANA-132: the narrative stays on screen while the follow-up hypotheses job is still running', async () => {
    vi.mocked(api.generateInsights).mockResolvedValue({ jobId: 'job-1' });
    // The insights job settles at once; the follow-up hypotheses job (job-2) never settles
    // within the test — in the awaited wrapper this withheld insightsMut.data (and the
    // narrative with it) until the 10-minute jobTimeout.
    vi.mocked(api.getAiJob).mockImplementation(async (id: string) =>
      id === 'job-1'
        ? { id, kind: 'insights', status: 'done', result: { narrative: 'AI: рост заявок' } }
        : new Promise(() => {}),
    );
    vi.mocked(api.generateHypotheses).mockResolvedValue({ jobId: 'job-2' } as never);
    vi.mocked(api.getSnapshot).mockResolvedValue({ ...snapshot });
    renderWithProviders(<ReportPreview />);
    fireEvent.click(screen.getByRole('button', { name: 'Собрать отчёт' }));
    expect(await screen.findByText(/Отчёт «01\.01\.2025 – 07\.01\.2025»/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Сгенерировать AI-анализ' }));
    // The mutation resolves with the narrative — it must be on screen immediately, not after
    // the backfill job finishes (ordering regression: comment promises «нарратив уже готов
    // и должен остаться на экране»).
    await screen.findByText(/AI: рост заявок/);
    // The backfill has started, is still running (no failure hint yet)…
    expect(vi.mocked(api.generateHypotheses)).toHaveBeenCalledWith('snap-1', 'auto');
    expect(screen.queryByTestId('rep-hypotheses-error')).not.toBeInTheDocument();
    // …and the generation progress UI has already settled.
    expect(screen.queryByText(/Генерация AI-анализа/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'AI-анализ сгенерирован' })).toBeInTheDocument();
  });

  it('ANA-132: a raw-JSON job.error from the provider is mapped to a readable hint', async () => {
    vi.mocked(api.generateInsights).mockResolvedValue({ jobId: 'job-1' });
    vi.mocked(api.getAiJob).mockImplementation(async (id: string) =>
      id === 'job-1'
        ? { id, kind: 'insights', status: 'done', result: { narrative: 'AI: рост заявок' } }
        : {
            id,
            kind: 'hypotheses',
            status: 'failed',
            // ANA-133 precedent: a failed job's error can be the raw proxy/provider JSON.
            error: '{"error":{"code":429,"message":"quota exceeded"}}',
          },
    );
    vi.mocked(api.generateHypotheses).mockResolvedValue({ jobId: 'job-2' } as never);
    vi.mocked(api.getSnapshot).mockResolvedValue({ ...snapshot });
    renderWithProviders(<ReportPreview />);
    fireEvent.click(screen.getByRole('button', { name: 'Собрать отчёт' }));
    expect(await screen.findByText(/Отчёт «01\.01\.2025 – 07\.01\.2025»/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Сгенерировать AI-анализ' }));
    const hint = await screen.findByTestId('rep-hypotheses-error');
    // The machine JSON is replaced by the localized generic failure note…
    expect(hint).toHaveTextContent('AI-генерация не удалась');
    expect(screen.queryByText(/quota exceeded/)).not.toBeInTheDocument();
    // …and the successful narrative stays on screen.
    expect(screen.getByText(/AI: рост заявок/)).toBeInTheDocument();
  });

  it('ANA-133: a busy AI slot (429) shows the localized hint instead of the raw proxy JSON', async () => {
    vi.mocked(api.generateInsights).mockRejectedValue(
      Object.assign(new Error('{"error":"другая генерация","code":"AI_BUSY"}'), { status: 429 }),
    );
    renderWithProviders(<ReportPreview />);
    fireEvent.click(screen.getByRole('button', { name: 'Собрать отчёт' }));
    expect(await screen.findByText(/Отчёт «01\.01\.2025 – 07\.01\.2025»/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Сгенерировать AI-анализ' }));
    await screen.findByText(/уже выполняется/);
    // The raw JSON body of the 429 never reaches the UI.
    expect(screen.queryByText(/AI_BUSY/)).not.toBeInTheDocument();
  });

  it('ANA-155: the enriched 429 names the holder with its start/expected release and offers «Повторить»', async () => {
    vi.mocked(api.generateInsights).mockReset();
    vi.mocked(api.getAiJob).mockReset();
    // First attempt: the slot is busy with a yandexgpt generation (the enriched 429 body).
    // The retry then succeeds — the retry button must actually re-run the generation.
    vi.mocked(api.generateInsights)
      .mockRejectedValueOnce(
        Object.assign(new Error('{"error":"занято","code":"AI_BUSY"}'), {
          status: 429,
          body: {
            code: 'AI_BUSY',
            job: {
              kind: 'insights',
              provider: 'yandexgpt',
              startedAt: '2026-11-15T10:00:00.000Z',
              expectedReleaseAt: '2026-11-15T10:15:00.000Z',
            },
          },
        }),
      )
      .mockResolvedValueOnce({ jobId: 'job-2' });
    vi.mocked(api.getAiJob).mockResolvedValue({
      id: 'job-2',
      kind: 'insights',
      status: 'done',
      result: { narrative: 'AI: рост заявок' },
    });
    renderWithProviders(<ReportPreview />);
    fireEvent.click(screen.getByRole('button', { name: 'Собрать отчёт' }));
    expect(await screen.findByText(/Отчёт «01\.01\.2025 – 07\.01\.2025»/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Сгенерировать AI-анализ' }));
    // The busy hint now names WHO holds the slot (localized provider name) and when it frees.
    await screen.findByText(/Слот занят: YandexGPT \(AI Studio\)/);
    expect(screen.getByText(/Запущено:/)).toBeInTheDocument();
    expect(screen.getByText(/ожидаемое освобождение/)).toBeInTheDocument();
    // …and the wait is actionable: «Повторить» re-runs the generation with the same choice.
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await screen.findByText(/AI: рост заявок/);
    expect(vi.mocked(api.generateInsights)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.generateInsights)).toHaveBeenLastCalledWith('snap-1', 'auto');
    // The holder details are gone once a retry is in flight.
    expect(screen.queryByText(/Слот занят/)).not.toBeInTheDocument();
  });

  it('ANA-155: a plain 429 (old backend body) keeps the simple busy hint without the holder line', async () => {
    vi.mocked(api.generateInsights).mockReset();
    vi.mocked(api.generateInsights).mockRejectedValue(
      Object.assign(new Error('{"error":"занято","code":"AI_BUSY"}'), { status: 429 }),
    );
    renderWithProviders(<ReportPreview />);
    fireEvent.click(screen.getByRole('button', { name: 'Собрать отчёт' }));
    expect(await screen.findByText(/Отчёт «01\.01\.2025 – 07\.01\.2025»/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Сгенерировать AI-анализ' }));
    await screen.findByText(/уже выполняется/);
    expect(screen.queryByText(/Слот занят:/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Повторить' })).not.toBeInTheDocument();
  });
});

describe('ReportFullView markdown tables', () => {
  it('renders pipe tables as <table>, not raw "| … |" text', () => {
    const { container } = render(<ReportFullView snapshot={snapshotWithData} />);
    expect(container.querySelector('article table')).not.toBeNull();
    expect(container.textContent ?? '').not.toMatch(/\|\s*-{3,}\s*\|/);
  });
});

describe('ReportFullView оглавление (REG-16)', () => {
  // Chunked AI narrative: the same subheading repeats across chunks — the on-screen TOC
  // used to list every one of them (60+ entries in production).
  const withAiNarrative: ReportSnapshot = {
    ...snapshotWithData,
    aiNarrative:
      '## Где мы сейчас\n\nПервый чанк.\n\n## Где мы сейчас\n\nВторой чанк.\n\n## Выводы\n\nИтог.',
  };

  const tocLinks = (): string[] => {
    const nav = screen.getByRole('navigation', { name: 'Оглавление' });
    return Array.from(nav.querySelectorAll('a')).map((a) => a.textContent ?? '');
  };

  it('keeps curated sections in the TOC but drops AI-narrative subheadings', () => {
    render(<ReportFullView snapshot={withAiNarrative} />);
    const links = tocLinks();
    // Level 1–2 (curated document skeleton) stays listed…
    expect(links).toContain('Краткие итоги');
    expect(links).toContain('B2B-пайплайн');
    // …while the repeated AI subheadings are excluded from the TOC only.
    expect(links).not.toContain('Где мы сейчас');
    expect(links).not.toContain('Выводы');
  });

  it('still renders the AI subheading sections themselves («сами секции не трогать»)', () => {
    render(<ReportFullView snapshot={withAiNarrative} />);
    // Each «Где мы сейчас» section remains a collapsible block in the report body.
    expect(screen.getAllByText('Где мы сейчас').length).toBeGreaterThanOrEqual(2);
    // TOC anchors keep pointing at real sections: every link target id exists.
    for (const link of screen
      .getByRole('navigation', { name: 'Оглавление' })
      .querySelectorAll('a')) {
      const id = (link.getAttribute('href') ?? '').slice(1);
      expect(document.getElementById(id)).not.toBeNull();
    }
  });

  it('keeps the single AI section listed when the narrative has no ## subheadings', () => {
    render(
      <ReportFullView
        snapshot={{ ...snapshotWithData, aiNarrative: 'Сплошной текст без заголовков.' }}
      />,
    );
    // No subheadings → the narrative becomes one trailing-conclusion section, still level 1.
    expect(tocLinks()).toContain('Результирующий вывод');
  });
});
