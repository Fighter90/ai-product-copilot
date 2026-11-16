import { describe, it, expect } from 'vitest';
import {
  kpiPlanFact,
  mergePaidByDay,
  planWeekStatus,
  weekStartIso,
  type PaidDayPoint,
} from './kpi-plan';

/**
 * ANA-193: «план → факт по неделям» — окно [база → дедлайн], план = цель равномерно,
 * факт = только подтверждённые оплаты с датой в окне. Реалистичное окно: база — первый
 * live-день после сброса счётчика (2026-11-06, пятница), дедлайн — EVENT_DATE кемпа
 * (2026-11-21, суббота), 16 дней.
 */
const WINDOW = { base: '2026-11-06', deadline: '2026-11-21', target: 300 };

const paid: PaidDayPoint[] = [
  { date: '2026-11-07', tickets: 5 }, // неделя 1
  { date: '2026-11-12', tickets: 10 }, // неделя 2
  { date: '2026-11-20', tickets: 3 }, // неделя 3 — будущая при today=11-15
  { date: '2026-11-22', tickets: 50 }, // после дедлайна — вне окна
  { date: '2026-11-01', tickets: 7 }, // до базы — вне окна
  { date: '2026-11-13', tickets: -4 }, // мусор — отбрасывается
  { date: 'не дата', tickets: 9 }, // мусор — отбрасывается
];

describe('weekStartIso (ANA-193)', () => {
  it('пятница → понедельник её недели', () => {
    expect(weekStartIso('2026-11-06')).toBe('2026-11-02');
  });

  it('воскресенье → понедельник той же недели', () => {
    expect(weekStartIso('2026-11-15')).toBe('2026-11-09');
  });

  it('понедельник → сам себя', () => {
    expect(weekStartIso('2026-11-16')).toBe('2026-11-16');
  });

  it('неверная дата возвращается как есть', () => {
    expect(weekStartIso('')).toBe('');
    expect(weekStartIso('garbage')).toBe('garbage');
  });
});

describe('mergePaidByDay (ANA-193)', () => {
  it('складывает B2C-платежи и B2B-paid по датам', () => {
    const merged = mergePaidByDay(
      [
        { date: '2026-11-07', tickets: 5 },
        { date: '2026-11-07', tickets: 2 },
        { date: '2026-11-08', tickets: 1 },
      ],
      [
        { datePaid: '2026-11-07T00:00:00Z', tickets: 3 },
        { datePaid: '2026-11-09', tickets: 4 },
        { tickets: 99 }, // не оплачена / нет даты — мимо
        { datePaid: '2026-11-09', tickets: 1 },
      ],
    );
    expect(merged).toEqual([
      { date: '2026-11-07', tickets: 10 },
      { date: '2026-11-08', tickets: 1 },
      { date: '2026-11-09', tickets: 5 },
    ]);
  });

  it('отбрасывает пустые и мусорные даты', () => {
    const merged = mergePaidByDay(
      [
        { date: '', tickets: 5 },
        { date: 'nope', tickets: 5 },
        { date: '2026-11-07', tickets: 0 },
      ],
      [{ datePaid: '2026-11-07', tickets: 2 }],
    );
    expect(merged).toEqual([{ date: '2026-11-07', tickets: 2 }]);
  });
});

describe('planWeekStatus (ANA-193)', () => {
  it('будущая неделя — future', () => {
    expect(planWeekStatus(0, 100, true)).toBe('future');
  });

  it('нулевой план — none (нечего сравнивать)', () => {
    expect(planWeekStatus(0, 0, false)).toBe('none');
  });

  it('факт ≥ план — ok', () => {
    expect(planWeekStatus(60, 56.3, false)).toBe('ok');
  });

  it('факт ≥ 80% плана — warn', () => {
    expect(planWeekStatus(150, 187.5, false)).toBe('warn');
  });

  it('факт < 80% плана — behind', () => {
    expect(planWeekStatus(15, 187.5, false)).toBe('behind');
  });
});

describe('kpiPlanFact (ANA-193)', () => {
  it('строит недельные строки: план равномерно, факт — оплаты в окне, будущие недели без факта', () => {
    const r = kpiPlanFact({ ...WINDOW, paidByDay: paid, today: '2026-11-15' });

    expect(r.empty).toBe(false);
    // 16 дней окна (2026-11-06..2026-11-21), недели с понедельника 2026-11-02.
    expect(r.totalDays).toBe(16);
    expect(r.weeks.map((w) => w.weekStart)).toEqual(['2026-11-02', '2026-11-09', '2026-11-16']);
    expect(r.weeks.map((w) => w.weekEnd)).toEqual([
      '2026-11-08', // полная неделя
      '2026-11-15', // полная неделя
      '2026-11-21', // обрезана по дедлайну
    ]);

    // План: 3/16, 10/16 и 16/16 окна → 56.3, 187.5, 300.
    expect(r.weeks.map((w) => w.planCum)).toEqual([56.3, 187.5, 300]);
    // Факт: только оплаты 11-07 (5) и 11-12 (10); до базы/после дедлайна/мусор — мимо.
    expect(r.weeks.map((w) => w.factCum)).toEqual([5, 15, 0]);
    expect(r.weeks.map((w) => w.factDelta)).toEqual([5, 10, 0]);
    // Третья неделя начинается после today → future, отклонение не сравнивается.
    expect(r.weeks.map((w) => w.future)).toEqual([false, false, true]);
    expect(r.weeks.map((w) => w.deviation)).toEqual([-51.3, -172.5, null]);

    // Итоги: факт на сегодня — 15, план на сегодня — 187.5, до дедлайна 6 дней.
    expect(r.factTotal).toBe(15);
    expect(r.planToDate).toBe(187.5);
    expect(r.deviationNow).toBe(-172.5);
    expect(r.daysLeft).toBe(6);
  });

  it('середина недели: факт текущей недели не досчитывает оплаты после «сегодня»', () => {
    // today = 17.11 — середина недели 3 (16–21): платёж 20.11 ещё не случился и в факт
    // не попадает (anti-hallucination), иначе таблица разойдётся со сводкой на 3 билета.
    const r = kpiPlanFact({ ...WINDOW, paidByDay: paid, today: '2026-11-17' });

    expect(r.weeks.map((w) => w.future)).toEqual([false, false, false]);
    // Накопленный факт: недели 1–2 полные (5, 15); неделя 3 — только по 17.11 → те же 15.
    expect(r.weeks.map((w) => w.factCum)).toEqual([5, 15, 15]);
    expect(r.weeks.map((w) => w.factDelta)).toEqual([5, 10, 0]);
    expect(r.weeks.map((w) => w.deviation)).toEqual([-51.3, -172.5, -285]);
    // Сводка на сегодня и последняя строка таблицы согласованы: факт 15, план 12/16 × 300.
    expect(r.factTotal).toBe(15);
    expect(r.planToDate).toBe(225);
    expect(r.deviationNow).toBe(-210);
    expect(r.daysLeft).toBe(4);
  });

  it('после дедлайна: все недели в факте, daysLeft = 0, план цели = target', () => {
    const r = kpiPlanFact({ ...WINDOW, paidByDay: paid, today: '2026-12-01' });
    expect(r.weeks.every((w) => !w.future)).toBe(true);
    expect(r.factTotal).toBe(18); // 5 + 10 + 3 (11-22 и 11-01 вне окна)
    expect(r.planToDate).toBe(300);
    expect(r.daysLeft).toBe(0);
    expect(r.deviationNow).toBe(18 - 300);
  });

  it('today раньше базы: все недели будущие, план на сегодня — 0', () => {
    const r = kpiPlanFact({ ...WINDOW, paidByDay: paid, today: '2026-11-01' });
    expect(r.weeks.every((w) => w.future)).toBe(true);
    expect(r.factTotal).toBe(0);
    expect(r.planToDate).toBe(0);
    expect(r.daysLeft).toBe(20);
  });

  it('пустые оплаты — факт 0 по всем неделям', () => {
    const r = kpiPlanFact({ ...WINDOW, paidByDay: [], today: '2026-11-15' });
    expect(r.weeks.map((w) => w.factCum)).toEqual([0, 0, 0]);
    expect(r.factTotal).toBe(0);
  });

  it('target ≤ 0 — план 0 и статус none', () => {
    const r = kpiPlanFact({ ...WINDOW, target: 0, paidByDay: [], today: '2026-11-15' });
    expect(r.weeks.map((w) => w.planCum)).toEqual([0, 0, 0]);
    expect(r.weeks.map((w) => planWeekStatus(w.factCum, w.planCum, w.future))).toEqual([
      'none',
      'none',
      'future',
    ]);
  });

  it('неверное окно (база после дедлайна / мусорные даты) → empty', () => {
    expect(
      kpiPlanFact({ ...WINDOW, base: '2026-11-22', paidByDay: [], today: '2026-11-15' }).empty,
    ).toBe(true);
    expect(kpiPlanFact({ ...WINDOW, deadline: '', paidByDay: [], today: '2026-11-15' }).empty).toBe(
      true,
    );
    expect(
      kpiPlanFact({ ...WINDOW, base: 'garbage', paidByDay: [], today: '2026-11-15' }).empty,
    ).toBe(true);
    const e = kpiPlanFact({ ...WINDOW, base: '', deadline: 'garbage', paidByDay: [], today: '' });
    expect(e.empty).toBe(true);
    expect(e.weeks).toEqual([]);
    expect(e.factTotal).toBe(0);
    expect(e.planToDate).toBe(0);
    expect(e.deviationNow).toBe(null);
    expect(e.daysLeft).toBe(0);
  });
});
