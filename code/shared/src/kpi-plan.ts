/**
 * ANA-193 (фидбек старшей команды 16.11): плановые показатели (300 билетов к дедлайну) не имеют
 * исторической базы — нужен отдельный учёт «план → факт по неделям». Окно плана фиксируется
 * явно: база — первый live-день данных Метрики в БД (GET /api/metrics/coverage, «с какой даты
 * фиксируем факт»), дедлайн — тот же resolveKpiDeadline, что везде (EVENT_DATE или эвристика).
 *
 * Anti-hallucination: план — ТОЛЬКО равномерное распределение цели по дням окна (чистая
 * математика), факт — ТОЛЬКО подтверждённые оплаты (B2C-платежи + B2B-paid) с датой внутри
 * окна; инвариант «заявка ≠ оплата» — достижения цели Метрики в факт не входят никогда.
 */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** Одна точка подтверждённых оплат за день (после mergePaidByDay — суммарно за дату). */
export interface PaidDayPoint {
  readonly date: string;
  readonly tickets: number;
}

/** Одна строка недельной таблицы «план → факт». */
export interface KpiPlanWeek {
  /** Понедельник недели (ISO). */
  readonly weekStart: string;
  /** Конец недели: воскресенье, обрезанное дедлайном окна (ISO). */
  readonly weekEnd: string;
  /** Накопленный план к концу недели (1 знак — доли билетов допустимы). */
  readonly planCum: number;
  /** Накопленный факт к концу недели (у текущей недели — по «сегодня», 0 у будущих недель). */
  readonly factCum: number;
  /** Факт этой недели (накопленный минус предыдущая неделя). */
  readonly factDelta: number;
  /** факт − план к концу недели; null у будущих недель (сравнивать рано). */
  readonly deviation: number | null;
  /** Неделя ещё не началась к `today` — факта пока нет и быть не должно. */
  readonly future: boolean;
}

/** Светофор недели: ok ≥ план, warn ≥ 80% плана, behind — ниже, future — неделя впереди. */
export type PlanWeekStatus = 'ok' | 'warn' | 'behind' | 'future' | 'none';

export interface KpiPlanFact {
  /** База окна (первый live-день) и дедлайн (ISO). */
  readonly base: string;
  readonly deadline: string;
  /** Цель (оплаченных билетов), ≤ 0 → 0. */
  readonly target: number;
  /** Длина окна в календарных днях (включительно); 0 у пустого результата. */
  readonly totalDays: number;
  /** Недельные строки от понедельника недели базы до дедлайна. */
  readonly weeks: KpiPlanWeek[];
  /** Факт в окне на сегодня ([base, min(today, deadline)]). */
  readonly factTotal: number;
  /** Накопленный план на сегодня. */
  readonly planToDate: number;
  /** factTotal − planToDate. */
  readonly deviationNow: number | null;
  /** Целых дней до дедлайна (0 — дедлайн прошёл или сегодня). */
  readonly daysLeft: number;
  /** true — окно не построить (мусорные даты или base > deadline): карточку не показывать. */
  readonly empty: boolean;
}

/** Strict YYYY-MM-DD и реальный календарный день (2026-02-31 — не день; тот же guard, что в kpi.ts). */
function isIsoDate(v: string): boolean {
  if (!ISO_DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Whole days from `a` to `b` (b − a); 0 для неверных дат (тот же guard, что в kpi.ts). */
function diffDaysIso(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Number.isNaN(ms) ? 0 : Math.round(ms / DAY_MS);
}

/** ISO-дата + n дней → ISO-дата (UTC-арифметика, без DST-ловушек). */
function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Понедельник ISO-недели (UTC-арифметика). Неверная дата возвращается как есть.
 */
export function weekStartIso(iso: string): string {
  if (!isIsoDate(iso)) return iso;
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // Вс=0 → 6 дней назад до Пн
  return d.toISOString().slice(0, 10);
}

/**
 * Слияние серий оплат в суммарный ряд по датам: B2C-платежи (уже по датам) + оплаченные
 * B2B-сделки (datePaid может быть таймстампом — берётся день). Пустые/мусорные даты и
 * неположительные билеты отбрасываются, результат сортируется по дате.
 */
export function mergePaidByDay(
  b2c: ReadonlyArray<{ date: string; tickets: number }>,
  b2bPaid: ReadonlyArray<{ datePaid?: string; tickets: number }>,
): PaidDayPoint[] {
  const byDay = new Map<string, number>();
  const add = (date: string | undefined, tickets: number): void => {
    const day = (date ?? '').slice(0, 10);
    if (!isIsoDate(day) || !(tickets > 0)) return;
    byDay.set(day, (byDay.get(day) ?? 0) + tickets);
  };
  for (const p of b2c) add(p.date, p.tickets);
  for (const d of b2bPaid) add(d.datePaid, d.tickets);
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, tickets]) => ({ date, tickets }));
}

/** Светофор недели (см. PlanWeekStatus). */
export function planWeekStatus(factCum: number, planCum: number, future: boolean): PlanWeekStatus {
  if (future) return 'future';
  if (!(planCum > 0)) return 'none';
  const ratio = factCum / planCum;
  if (ratio >= 1) return 'ok';
  if (ratio >= 0.8) return 'warn';
  return 'behind';
}

export interface KpiPlanFactInput {
  /** Первый live-день данных (ISO) — «с какой даты фиксируем факт». */
  readonly base: string;
  /** Дедлайн KPI (ISO) — resolveKpiDeadline на вызывающей стороне. */
  readonly deadline: string;
  /** Цель (оплаченных билетов). */
  readonly target: number;
  /** Суммарный ряд оплат по датам (mergePaidByDay). */
  readonly paidByDay: ReadonlyArray<PaidDayPoint>;
  /** «Сегодня» (ISO) — передаётся явно: в render-пути Date.now() нет (ANA-166). */
  readonly today: string;
}

function emptyResult(base: string, deadline: string, target: number): KpiPlanFact {
  return {
    base,
    deadline,
    target,
    totalDays: 0,
    weeks: [],
    factTotal: 0,
    planToDate: 0,
    deviationNow: null,
    daysLeft: 0,
    empty: true,
  };
}

/**
 * «План → факт по неделям»: окно [base → deadline], план = target равномерно по дням окна,
 * факт = оплаты с датой в окне, накопленные к концу каждой недели (у текущей недели — по
 * «сегодня»: платежи с датой после today в факт не попадают). Недели — с понедельника
 * недели базы; последняя обрезается дедлайном. Детерминировано: тот же вход — тот же выход.
 */
export function kpiPlanFact(input: KpiPlanFactInput): KpiPlanFact {
  const { base, deadline, today } = input;
  const target = Number.isFinite(input.target) && input.target > 0 ? input.target : 0;
  if (!isIsoDate(base) || !isIsoDate(deadline) || !isIsoDate(today) || base > deadline) {
    return emptyResult(base, deadline, target);
  }

  const totalDays = diffDaysIso(base, deadline) + 1;

  // Оплаты внутри окна, отсортированные по датам: prefix[i] = сумма билетов по date[i].
  const inWindow = mergePaidByDay(input.paidByDay, [])
    .filter((p) => p.date >= base && p.date <= deadline)
    .sort((a, b) => a.date.localeCompare(b.date));
  const prefix: number[] = [];
  let acc = 0;
  for (const p of inWindow) {
    acc += p.tickets;
    prefix.push(acc);
  }
  /** Накопленный факт к дню `to` ([base, to]); 0 когда to раньше первой оплаты. */
  const factThrough = (to: string): number => {
    if (to < base) return 0;
    let lo = 0;
    let hi = inWindow.length; // число оплат с датой ≤ to
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (inWindow[mid]!.date <= to) lo = mid + 1;
      else hi = mid;
    }
    return lo === 0 ? 0 : prefix[lo - 1]!;
  };

  const weeks: KpiPlanWeek[] = [];
  let cursor = weekStartIso(base);
  while (cursor <= deadline) {
    // Конец недели: воскресенье, но не дальше дедлайна окна.
    const sunday = addDaysIso(cursor, 6);
    const weekEnd = sunday > deadline ? deadline : sunday;
    const future = cursor > today;

    // План: дней окна, прошедших к концу недели (0..totalDays) → доля цели.
    const daysThrough = Math.min(Math.max(diffDaysIso(base, weekEnd) + 1, 0), totalDays);
    const planCum = round1((target * daysThrough) / totalDays);
    // Факт: будущей неделе факта «ещё нет и быть не должно» — 0 и без сравнения. Текущей
    // (незавершённой) неделе факт считается только по «сегодня»: платежи с датой после today
    // в факт не попадают (anti-hallucination), иначе таблица разойдётся со сводкой factTotal.
    const factCum = future ? 0 : factThrough(weekEnd < today ? weekEnd : today);
    const prevCum = weeks.length > 0 ? weeks[weeks.length - 1]!.factCum : 0;
    weeks.push({
      weekStart: cursor,
      weekEnd,
      planCum,
      factCum,
      factDelta: future ? 0 : factCum - prevCum,
      deviation: future ? null : round1(factCum - planCum),
      future,
    });
    cursor = addDaysIso(cursor, 7);
  }

  const throughToday = today < deadline ? today : deadline;
  const factTotal = factThrough(throughToday);
  const daysThroughToday = Math.min(Math.max(diffDaysIso(base, throughToday) + 1, 0), totalDays);
  const planToDate = round1((target * daysThroughToday) / totalDays);

  return {
    base,
    deadline,
    target,
    totalDays,
    weeks,
    factTotal,
    planToDate,
    deviationNow: round1(factTotal - planToDate),
    daysLeft: Math.max(diffDaysIso(today, deadline), 0),
    empty: false,
  };
}
