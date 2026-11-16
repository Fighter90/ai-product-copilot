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

  it('ANA-167: the Metrika goal line shows the period dates and the «Заказ» explanation', () => {
    view({
      from: '2025-01-01',
      goalLabel: {
        title: 'Заявок',
        isPaid: true,
        showApplicationsCaveat: false,
        showEstimate: false,
      },
    });
    // The count line carries the period dates (fmtDate → «1 янв. 2025 г.»).
    const from = fmtDate('2025-01-01', 'ru');
    const to = fmtDate('2025-01-02', 'ru');
    expect(screen.getByText(`Заявок (Метрика, с ${from} по ${to}): 40`)).toBeInTheDocument();
    // The InfoHint explains «Заказ»: goal_reaches + period + not-a-paid-ticket.
    const hint = screen.getByText(/goal_reaches/);
    expect(hint.textContent).toContain('Заказ ≠ платный билет');
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

  // ANA-171 (заявка ≠ оплата): the what-if model extrapolates goal reaches — the amber caption
  // sits right at the forecast date, so «Дата достижения цели» never reads as a payments date.
  it('ANA-171: captions the forecast date «прогноз по заявкам, не по оплатам»', () => {
    view();
    const flag = screen.getByTestId('forecast-apps-not-paid');
    expect(flag).toHaveTextContent('прогноз по заявкам, не по оплатам');
    // …right at the date («Дата достижения цели»).
    expect(flag.parentElement).toHaveTextContent('Дата достижения цели');
  });

  it('ANA-171: the applications-forecast caption has no Cyrillic in en', () => {
    setTestLocale('en');
    const { container } = view();
    expect(screen.getByTestId('forecast-apps-not-paid')).toHaveTextContent(
      'forecast by applications, not payments',
    );
    expectNoCyrillic(container);
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

  it('ANA-166: the main goal carries the SMART statement (S+M+T + daily rate)', () => {
    // paid = b2cPaid(0) + b2bPaid(20) → remaining 280; 2026-03-01 → 2026-04-15 = 45 days
    // → ceil(280 / 45) = 7 в день.
    view({ eventDate: '2026-04-15', today: '2026-03-01' });
    const smart = screen.getByTestId('kpi-smart');
    expect(smart).toHaveTextContent('≥300 платных билетов');
    expect(smart).toHaveTextContent('к 15.04.2026');
    expect(smart).toHaveTextContent('сейчас 20');
    expect(smart).toHaveTextContent('осталось 280');
    expect(smart).toHaveTextContent('~7 в день');
    // The goal is still active — no expired block.
    expect(screen.queryByTestId('kpi-expired')).toBeNull();
  });

  it('ANA-166: after EVENT_DATE the KPI page shows the auto «дедлайн прошёл» итог', () => {
    view({ eventDate: '2025-01-01', today: '2025-01-10' });
    const block = screen.getByTestId('kpi-expired');
    expect(block).toHaveTextContent(fmtDate('2025-01-01', 'ru'));
    // «Итог по цели: {paid} из {target}» — те же подтверждённые деньги, что в кольце.
    expect(block).toHaveTextContent('20 из 300');
    expect(block).toHaveTextContent('«Сбросить цель»');
    // The SMART sentence switches to the expired variant with the final count.
    expect(screen.getByTestId('kpi-smart')).toHaveTextContent(
      'Дедлайн 01.01.2025 прошёл: 20 из 300 платных билетов',
    );
  });

  it('ANA-166: expired wording keeps English (no Cyrillic)', () => {
    setTestLocale('en');
    const { container } = view({ eventDate: '2025-01-01', today: '2025-01-10' });
    expect(screen.getByTestId('kpi-expired')).toHaveTextContent('deadline has passed');
    expect(screen.getByTestId('kpi-smart')).toHaveTextContent(
      'Deadline 1 Jan 2025 has passed: 20 of 300 paid tickets',
    );
    expectNoCyrillic(container);
  });

  // ANA-166 (правка ревью): без EVENT_DATE расчётный дедлайн (конец периода + 2×окно) — не
  // обязательство: оказавшись в прошлом (старый период), он не объявляет цель завершённой.
  it('ANA-166: a past computed deadline without EVENT_DATE never flips the SMART line to «прошёл»', () => {
    // to=2025-01-02 + 2×2 дня → расчётный дедлайн 2025-01-06; сегодня позже него.
    const first = view({ today: '2025-02-01' });
    const smart = screen.getByTestId('kpi-smart');
    expect(smart).toHaveTextContent('≥300 платных билетов');
    expect(smart.textContent).not.toContain('прошёл');
    // The expired итог block stays hidden — isGoalExpired reads the configured EVENT_DATE only.
    expect(screen.queryByTestId('kpi-expired')).toBeNull();
    first.unmount();

    // While the computed deadline is still ahead, SMART keeps the «к ДАТА» term.
    view({ today: '2025-01-03' });
    expect(screen.getByTestId('kpi-smart')).toHaveTextContent(
      'Достичь ≥300 платных билетов к 06.01.2025',
    );
  });
});

// ANA-193 (фидбек старшей команды 16.11): плановые 300 билетов не имеют исторической базы —
// на /app/kpi нужен отдельный учёт «план → факт по неделям»: окно [первый live-день → дедлайн],
// план = цель равномерно, факт = подтверждённые оплаты с датой в окне.
describe('ANA-193: план → факт по неделям', () => {
  const planPaid = [
    { date: '2026-11-07', tickets: 5 },
    { date: '2026-11-12', tickets: 10 },
    { date: '2026-11-20', tickets: 3 },
  ];

  const cells = (row: HTMLElement): string[] =>
    Array.from(row.querySelectorAll('td')).map((td) => td.textContent ?? '');

  it('строит недельную таблицу от базы до дедлайна: план равномерно, факт — оплаты окна', () => {
    view({
      coverageFrom: '2026-11-06',
      coverageDays: 10,
      today: '2026-11-15',
      eventDate: '2026-11-21',
      paidByDay: planPaid,
    });
    expect(screen.getByText('План → факт по неделям')).toBeInTheDocument();
    // Окно плана: база — первый live-день (coverage), дедлайн — EVENT_DATE, цель 300.
    expect(screen.getByTestId('kpi-plan-baseline')).toHaveTextContent(
      `Окно плана: ${fmtDate('2026-11-06', 'ru')} → ${fmtDate('2026-11-21', 'ru')} · Цель: 300`,
    );
    // Недели с понедельника недели базы; последняя обрезана дедлайном (16–21).
    const rows = screen.getAllByTestId('kpi-plan-row');
    expect(rows).toHaveLength(3);
    // Неделя 1 (2–8 нояб.): план 3/16 × 300 = 56,3; факт 5 (11-07); Δ = 5 − 56,3.
    expect(cells(rows[0]!)).toEqual([
      `${fmtDate('2026-11-02', 'ru')}–${fmtDate('2026-11-08', 'ru')}`,
      '56,3',
      '5',
      '-51,3',
    ]);
    // Неделя 2 (9–15): план 10/16 × 300 = 187,5; факт 15; Δ = −172,5.
    expect(cells(rows[1]!)).toEqual([
      `${fmtDate('2026-11-09', 'ru')}–${fmtDate('2026-11-15', 'ru')}`,
      '187,5',
      '15',
      '-172,5',
    ]);
    // Неделя 3 (16–21) будущая: план 300, факта ещё нет — «—» вместо факта и Δ.
    expect(cells(rows[2]!)).toEqual([
      `${fmtDate('2026-11-16', 'ru')}–${fmtDate('2026-11-21', 'ru')}`,
      '300',
      '—',
      '—',
    ]);
    // Сводка движения к цели: факт 15 (в окне на сегодня) из плана 187,5; до дедлайна 6 дней.
    const summary = screen.getByTestId('kpi-plan-summary');
    expect(summary).toHaveTextContent('Факт на сегодня: 15 из плана 187,5');
    expect(summary).toHaveTextContent('До дедлайна: 6 дн.');
  });

  it('окрашивает Δ светофором: опережение зелёным, отставание красным', () => {
    // Цель 10: неделя 1 план 1,9 — факт 10 опережает план.
    const first = view({
      coverageFrom: '2026-11-06',
      coverageDays: 10,
      today: '2026-11-15',
      eventDate: '2026-11-21',
      target: 10,
      paidByDay: [{ date: '2026-11-07', tickets: 10 }],
    });
    const rows = screen.getAllByTestId('kpi-plan-row');
    expect(rows[0]!.querySelector('[data-testid="kpi-plan-delta"]')).toHaveClass('text-green-700');
    first.unmount();

    // Пустой факт — отставание от плана красным.
    const second = view({
      coverageFrom: '2026-11-06',
      coverageDays: 10,
      today: '2026-11-15',
      eventDate: '2026-11-21',
      target: 10,
      paidByDay: [],
    });
    const emptyRows = second.getAllByTestId('kpi-plan-row');
    expect(emptyRows[0]!.querySelector('[data-testid="kpi-plan-delta"]')).toHaveClass(
      'text-red-700',
    );
  });

  it('Δ = 0 (факт равен плану недели) — «0», а будущая неделя — «—» через тот же deltaText', () => {
    // Цель 16, окно 16 дней → 1 билет/день: план недели 1 = 3, факт = 3 → отклонение ровно 0.
    const zero = view({
      coverageFrom: '2026-11-06',
      coverageDays: 10,
      today: '2026-11-15',
      eventDate: '2026-11-21',
      target: 16,
      paidByDay: [{ date: '2026-11-07', tickets: 3 }],
    });
    const zeroRows = screen.getAllByTestId('kpi-plan-row');
    const zeroDelta = zeroRows[0]!.querySelector('[data-testid="kpi-plan-delta"]');
    expect(zeroDelta).toHaveTextContent('0');
    expect(zeroDelta).toHaveClass('text-green-700'); // факт ≥ план → ok
    zero.unmount();

    // Будущая неделя (отклонение null) рендерит «—» тем же deltaText — одна точка правды.
    const future = view({
      coverageFrom: '2026-11-06',
      coverageDays: 10,
      today: '2026-11-15',
      eventDate: '2026-11-21',
      target: 16,
      paidByDay: [],
    });
    const futureRows = screen.getAllByTestId('kpi-plan-row');
    expect(futureRows[2]!.querySelector('[data-testid="kpi-plan-delta"]')).toHaveTextContent('—');
    future.unmount();
  });

  it('не показывается без базы (coverage неизвестен) или вне окна', () => {
    view({ coverageFrom: null, coverageDays: null, paidByDay: planPaid });
    expect(screen.queryByTestId('kpi-plan-fact')).not.toBeInTheDocument();
    // Мусорная база → пустое окно → карточка скрыта.
    view({ coverageFrom: 'не дата', coverageDays: 3, paidByDay: planPaid });
    expect(screen.queryByTestId('kpi-plan-fact')).not.toBeInTheDocument();
  });

  it('держит английскую формулировку (без Cyrillic в en)', () => {
    setTestLocale('en');
    const { container } = view({
      coverageFrom: '2026-11-06',
      coverageDays: 10,
      today: '2026-11-15',
      eventDate: '2026-11-21',
      paidByDay: planPaid,
    });
    expect(screen.getByText('Plan → fact by week')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-plan-baseline')).toHaveTextContent(
      `Plan window: ${fmtDate('2026-11-06', 'en')} → ${fmtDate('2026-11-21', 'en')} · Target: 300`,
    );
    expect(screen.getByTestId('kpi-plan-summary')).toHaveTextContent(
      'Fact to date: 15 of plan 187.5',
    );
    expect(screen.getByTestId('kpi-plan-summary')).toHaveTextContent('6 days to the deadline');
    expectNoCyrillic(container);
  });
});
