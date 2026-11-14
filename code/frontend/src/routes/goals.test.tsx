import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { B2bDeal } from '@pca/shared';
import { forecastGoal } from '../lib/forecast';
import { fmtDate } from '../i18n';
import { expectNoCyrillic, setTestLocale } from '../test/i18n-utils';
import { GoalsView } from './goals';

const deals: B2bDeal[] = [
  {
    id: 1,
    company: 'Acme',
    tickets: 20,
    stage: 'paid',
    dateAdded: '2025-01-01',
    amountRub: 100000,
  },
  { id: 2, company: 'Beta', tickets: 10, stage: 'invoiced', dateAdded: '2025-01-02' },
  { id: 3, company: 'Gamma', tickets: 5, stage: 'negotiation', dateAdded: '2025-01-03' },
  { id: 4, company: 'Delta', tickets: 5, stage: 'lead', dateAdded: '2025-01-04' },
];

const points = [
  { date: '2025-01-01', visits: 100, reaches: 2 },
  { date: '2025-01-02', visits: 120, reaches: 3 },
];

function view(over: Partial<Parameters<typeof GoalsView>[0]> = {}) {
  return render(
    <GoalsView
      status="success"
      target={300}
      b2cApplications={40}
      b2bPaid={20}
      b2bPipeline={20}
      totalVisits={2000}
      overallCR={0.015}
      deals={deals}
      points={points}
      to="2025-01-02"
      {...over}
    />,
  );
}

describe('KPI & forecast (GoalsView)', () => {
  afterEach(() => setTestLocale('ru'));

  it('keeps the Russian wording in ru', () => {
    view();
    expect(screen.getByText('Цели ProductCamp')).toBeInTheDocument();
    expect(screen.getByText('Главная цель: 300 платных билетов')).toBeInTheDocument();
    expect(screen.getByText('Выставлен счёт')).toBeInTheDocument();
  });

  it('renders without Cyrillic in English (application goal, B2B paid)', () => {
    setTestLocale('en');
    const { container } = view();
    expect(screen.getByText('ProductCamp goals')).toBeInTheDocument();
    expect(screen.getByText('B2C applications (Metrika): 40')).toBeInTheDocument();
    expect(screen.getByText('Invoiced')).toBeInTheDocument();
    expect(screen.getByText(/below the 2% target/)).toBeInTheDocument();
    expectNoCyrillic(container);
  });

  it('renders without Cyrillic in English (purchase goal, no B2B, low CR)', () => {
    setTestLocale('en');
    const { container } = view({
      b2bPaid: 0,
      deals: [],
      overallCR: 0.005,
      goalLabel: {
        title: 'Заявок',
        isPaid: true,
        showApplicationsCaveat: true,
        showEstimate: false,
      },
    });
    // БАГ-02: Metrika reaches are labelled «Applications», not «Orders».
    expect(screen.getByText('Applications (Metrika): 40')).toBeInTheDocument();
    expect(screen.getByText(/critically low/)).toBeInTheDocument();
    expectNoCyrillic(container);
  });

  it('REG-03 (заявка ≠ оплата): ring/remaining count money only — Metrika orders are separate', () => {
    view({
      goalLabel: {
        title: 'Заявок',
        isPaid: true,
        showApplicationsCaveat: true,
        showEstimate: false,
      },
    });
    // paid = B2C 0 + B2B paid 20 → remaining 280; the 40 Metrika orders are NOT payments.
    expect(screen.getAllByText('280').length).toBeGreaterThan(0);
    // БАГ-02: purchase-goal reaches are «заявки» with the caveat on — «это заявки, не оплаты».
    expect(screen.getByText(/Это заявки, не оплаты/)).toBeInTheDocument();
  });

  it('keeps loading and error states in English', () => {
    setTestLocale('en');
    const { container, rerender } = view({ status: 'pending' });
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    rerender(
      <GoalsView
        status="error"
        target={300}
        b2cApplications={0}
        b2bPaid={0}
        b2bPipeline={0}
        totalVisits={0}
        overallCR={0}
        deals={[]}
        points={[]}
        to="2025-01-02"
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to load goal data.');
    expectNoCyrillic(container);
  });

  it('REG-04 (ANA-93): captions the forecast «прогноз по неполным данным» by the deadline', () => {
    view({ from: '2024-12-25', coverageFrom: '2025-01-01' });
    // The cache starts 2025-01-01 but the period starts 2024-12-25 → partial coverage.
    const flag = screen.getByTestId('forecast-partial');
    expect(flag).toHaveTextContent('прогноз по неполным данным');
    // …right by the deadline («К дедлайну …»).
    const cell = flag.parentElement;
    expect(cell).toHaveTextContent('К дедлайну');
  });

  it('REG-04 (ANA-93): no partial-data caption when coverage starts before the period', () => {
    view({ from: '2024-12-25', coverageFrom: '2024-12-01' });
    expect(screen.queryByTestId('forecast-partial')).not.toBeInTheDocument();
  });

  it('REG-04 (ANA-93): no partial-data caption while coverage is unknown', () => {
    view({ from: '2024-12-25', coverageFrom: null });
    expect(screen.queryByTestId('forecast-partial')).not.toBeInTheDocument();
  });

  it('REG-04 (ANA-93): captions the partial forecast without Cyrillic in en', () => {
    setTestLocale('en');
    const { container } = view({ from: '2024-12-25', coverageFrom: '2025-01-01' });
    expect(screen.getByTestId('forecast-partial')).toHaveTextContent(
      'forecast based on partial data',
    );
    expectNoCyrillic(container);
  });

  it('ANA-142: shows the honest data window on the KPI page («данных N дней (с …)»)', () => {
    // Live counter data starts 2026-11-06 — the seeded 2025 «history» must not stretch it.
    view({ coverageFrom: '2026-11-06', coverageDays: 7 });
    expect(screen.getByTestId('kpi-data-window')).toHaveTextContent(/Данных 7 дн\. \(с /);
  });

  it('ANA-142: no data-window line while coverage is unknown', () => {
    view({ coverageFrom: null, coverageDays: null });
    expect(screen.queryByTestId('kpi-data-window')).not.toBeInTheDocument();
  });

  it('ANA-142: the data-window line renders without Cyrillic in en', () => {
    setTestLocale('en');
    const { container } = view({ coverageFrom: '2026-11-06', coverageDays: 7 });
    expect(screen.getByTestId('kpi-data-window')).toHaveTextContent(/Data for 7 days \(since /);
    expectNoCyrillic(container);
  });

  it('REG-17 (ANA-105): the forecast note equals the расчёт — deadline, window and base from the same inputs', () => {
    view();
    // Same расчёт the panel runs (forecastGoal on the same points/to/target, zero scenario).
    const fc = forecastGoal({
      points,
      to: '2025-01-02',
      target: 300,
      trafficPct: 0,
      crUpliftPp: 0,
    });
    const note = screen.getByTestId('deadline-note');
    // The deadline shown is exactly the расчёт's (coverage-based), not the idealized «2 длины периода».
    expect(note).toHaveTextContent(fmtDate(fc.horizonDate, 'ru'));
    expect(note).toHaveTextContent(`2 × ${fc.windowDays}`);
    // The base label matches the last ≤7 fact days the расчёт's recent pace reads.
    expect(note).toHaveTextContent(`${fmtDate('2025-01-01', 'ru')}–${fmtDate('2025-01-02', 'ru')}`);
    expect(note).not.toHaveTextContent('2 длины периода');
  });

  it('REG-17 (ANA-105): with EVENT_DATE the note shows the event date the расчёт used', () => {
    view({ eventDate: '2026-04-15' });
    const fc = forecastGoal({
      points,
      to: '2025-01-02',
      target: 300,
      trafficPct: 0,
      crUpliftPp: 0,
      deadlineDate: '2026-04-15',
    });
    const note = screen.getByTestId('deadline-note');
    expect(note).toHaveTextContent(fmtDate(fc.horizonDate, 'ru'));
    expect(note).not.toHaveTextContent('2 ×');
  });

  it('REG-17 (ANA-105): the note keeps English wording (no Cyrillic)', () => {
    setTestLocale('en');
    const { container } = view({ eventDate: '2026-04-15' });
    const note = screen.getByTestId('deadline-note');
    expect(note).toHaveTextContent('event date');
    expect(note).toHaveTextContent(`${fmtDate('2025-01-01', 'en')}–${fmtDate('2025-01-02', 'en')}`);
    expectNoCyrillic(container);
  });

  it('ANA-168: the main goal shows the deadline date (period end + 2× fact window)', () => {
    view();
    // The same resolveKpiDeadline расчёт as the Overview hero and «Что если»: 2 fact days →
    // horizon 4 → deadline = 2025-01-02 + 4 = 2025-01-06.
    expect(screen.getByTestId('kpi-deadline')).toHaveTextContent(fmtDate('2025-01-06', 'ru'));
  });

  it('ANA-168: with EVENT_DATE the main goal shows the event date as the deadline', () => {
    view({ eventDate: '2026-04-15' });
    expect(screen.getByTestId('kpi-deadline')).toHaveTextContent(fmtDate('2026-04-15', 'ru'));
  });

  it('ANA-168: the main-goal deadline keeps English wording (no Cyrillic)', () => {
    setTestLocale('en');
    const { container } = view({ eventDate: '2026-04-15' });
    const line = screen.getByTestId('kpi-deadline');
    expect(line).toHaveTextContent('Deadline:');
    expect(line).toHaveTextContent(fmtDate('2026-04-15', 'en'));
    expectNoCyrillic(container);
  });
});
