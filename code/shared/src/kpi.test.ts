import { describe, it, expect, vi, afterEach } from 'vitest';
import { paidAndGap, resolveKpiDeadline, snapshotKpiMeta } from './kpi';

/**
 * REG-03 (ANA-92), инвариант «заявка ≠ оплата»: paidAndGap считает ТОЛЬКО подтверждённые
 * деньги (B2C-платежи + B2B-paid). Заказы/заявки Метрики в оплату не входят — для этого
 * во входе просто нет соответствующего поля.
 */
describe('paidAndGap (REG-03 — только подтверждённые деньги)', () => {
  it('paid = B2C paid + B2B paid; gap = target − paid', () => {
    expect(paidAndGap({ target: 300, b2cPaidTickets: 12, b2bPaidTickets: 20 })).toEqual({
      paid: 32,
      gap: 268,
    });
  });

  it('no money → paid 0, gap = target', () => {
    expect(paidAndGap({ target: 300, b2cPaidTickets: 0, b2bPaidTickets: 0 })).toEqual({
      paid: 0,
      gap: 300,
    });
  });

  it('clamps gap at 0 when paid exceeds the target', () => {
    expect(paidAndGap({ target: 300, b2cPaidTickets: 40, b2bPaidTickets: 280 })).toEqual({
      paid: 320,
      gap: 0,
    });
  });

  it('guards against negative inputs (clamped to 0, not subtracted)', () => {
    expect(paidAndGap({ target: 300, b2cPaidTickets: -5, b2bPaidTickets: 20 })).toEqual({
      paid: 20,
      gap: 280,
    });
  });
});

/**
 * ANA-119 (регресс 28.10, БАГ-01): прямые кейсы resolveKpiDeadline — EVENT_DATE приоритетна,
 * без неё эвристика «конец периода + 2×длина окна», флаг fromEventDate в обеих ветках.
 */
describe('resolveKpiDeadline (БАГ-01 — единый дедлайн KPI)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('EVENT_DATE wins over the heuristic: deadline = event date, fromEventDate = true', () => {
    expect(
      resolveKpiDeadline({ to: '2025-10-01', windowDays: 14, eventDate: '2025-11-20' }),
    ).toEqual({ deadline: '2025-11-20', horizonDays: 50, fromEventDate: true });
  });

  it('EVENT_DATE before the period end clamps the horizon at 0 (never negative)', () => {
    expect(
      resolveKpiDeadline({ to: '2025-10-01', windowDays: 14, eventDate: '2025-09-01' }),
    ).toEqual({ deadline: '2025-09-01', horizonDays: 0, fromEventDate: true });
  });

  it('without EVENT_DATE: heuristic «period end + 2×window», fromEventDate = false', () => {
    expect(resolveKpiDeadline({ to: '2025-10-01', windowDays: 14 })).toEqual({
      deadline: '2025-10-29',
      horizonDays: 28,
      fromEventDate: false,
    });
  });

  it('blank or invalid EVENT_DATE (incl. calendar roll-over) falls back to the heuristic', () => {
    // «2026-02-31» JS-парсится как 2026-03-03 — normalizeEventDate отвергает, эвристика.
    expect(
      resolveKpiDeadline({ to: '2025-10-01', windowDays: 14, eventDate: '2026-02-31' }),
    ).toEqual({ deadline: '2025-10-29', horizonDays: 28, fromEventDate: false });
    expect(resolveKpiDeadline({ to: '2025-10-01', windowDays: 14, eventDate: '' })).toEqual({
      deadline: '2025-10-29',
      horizonDays: 28,
      fromEventDate: false,
    });
  });

  it('windowDays guard: fractional rounds, 0/negative/NaN clamp to one window (horizon 2)', () => {
    expect(resolveKpiDeadline({ to: '2025-10-01', windowDays: 7.6 })).toEqual({
      deadline: '2025-10-17', // round(7.6) = 8 → horizon 16
      horizonDays: 16,
      fromEventDate: false,
    });
    for (const windowDays of [0, -10, Number.NaN]) {
      expect(resolveKpiDeadline({ to: '2025-10-01', windowDays })).toEqual({
        deadline: '2025-10-03', // clamp to 1 → horizon 2
        horizonDays: 2,
        fromEventDate: false,
      });
    }
  });

  it('invalid period end falls back to «today» (frozen clock, no flaky date)', () => {
    vi.useFakeTimers({ now: new Date('2025-06-15T12:00:00Z') });
    expect(resolveKpiDeadline({ to: 'not-a-date', windowDays: 7 })).toEqual({
      deadline: '2025-06-29', // today 2025-06-15 + horizon 14
      horizonDays: 14,
      fromEventDate: false,
    });
  });
});

/**
 * ANA-193 (фидбек старшей команды 16.11): «История»/бэкфилл не показывают зафиксированный
 * план (300 билетов) и факт по каждому снапшоту — отслеживать план-факт можно только
 * открывая отчёты по одному. snapshotKpiMeta — единое правило извлечения «цель → оплачено»
 * из зафиксированного KPI-блока payload'а: бэкенд кладёт его в скалярные колонки
 * report_snapshots (список Истории остаётся без парсинга payload'ов — ANA-154), миграция
 * 025 бэкфилл-ит старые строки той же логикой в SQL.
 */
describe('snapshotKpiMeta (ANA-193 — план→факт из снапшота)', () => {
  it('new snapshots: paid = B2C paid + B2B paid точно (b2cPaidTickets в payload)', () => {
    expect(
      snapshotKpiMeta({
        kpi: {
          target: 300,
          b2cApplications: 400,
          b2cPaidTickets: 75,
          b2bPaidTickets: 20,
          gap: 205,
        },
      }),
    ).toEqual({ kpiTarget: 300, kpiPaid: 95 });
  });

  it('legacy payload (без b2cPaidTickets): зачтено = target − gap', () => {
    expect(
      snapshotKpiMeta({ kpi: { target: 300, b2cApplications: 7, b2bPaidTickets: 20, gap: 280 } }),
    ).toEqual({ kpiTarget: 300, kpiPaid: 20 });
  });

  it('legacy перебор B2B: факт B2B (320) важнее зачтённой шапки (target − gap = 300)', () => {
    expect(
      snapshotKpiMeta({ kpi: { target: 300, b2cApplications: 0, b2bPaidTickets: 320, gap: 0 } }),
    ).toEqual({ kpiTarget: 300, kpiPaid: 320 });
  });

  it('guards: отрицательные входы клампятся к 0, не вычитаются', () => {
    expect(
      snapshotKpiMeta({ kpi: { target: 300, b2cPaidTickets: -10, b2bPaidTickets: -5, gap: 0 } }),
    ).toEqual({ kpiTarget: 300, kpiPaid: 0 });
    expect(
      snapshotKpiMeta({ kpi: { target: 300, b2cApplications: 1, b2bPaidTickets: -5, gap: -50 } }),
    ).toEqual({ kpiTarget: 300, kpiPaid: 300 });
  });

  it('мусор в kpi или без kpi вовсе → null без выдуманных чисел (анти-галлюцинация)', () => {
    expect(snapshotKpiMeta({ kpi: { total: 160 } })).toEqual({ kpiTarget: null, kpiPaid: null });
    expect(snapshotKpiMeta({ ok: true })).toEqual({ kpiTarget: null, kpiPaid: null });
    expect(snapshotKpiMeta(null)).toEqual({ kpiTarget: null, kpiPaid: null });
    // target есть, но оплату вывести нельзя → null ОБЕ колонки: ровно то, что делает WHERE
    // миграции 025 (строка не обновляется вовсе). Полуправда {target, null} расходилась бы с
    // бэкфиллом — до-025 и после-025 строки показывали бы разное план→факт (ANA-139 review).
    expect(
      snapshotKpiMeta({ kpi: { target: 300, b2cApplications: 5, b2bPaidTickets: 'x', gap: 'y' } }),
    ).toEqual({ kpiTarget: null, kpiPaid: null });
    // b2c без b2b — названный ревьюером случай расхождения: SQL пропускает строку целиком.
    expect(snapshotKpiMeta({ kpi: { target: 300, b2cPaidTickets: 95 } })).toEqual({
      kpiTarget: null,
      kpiPaid: null,
    });
  });

  it('не-объекты в полях (строка/массив) не ломают извлечение', () => {
    expect(snapshotKpiMeta('junk')).toEqual({ kpiTarget: null, kpiPaid: null });
    expect(snapshotKpiMeta({ kpi: 'junk' })).toEqual({ kpiTarget: null, kpiPaid: null });
  });
});
