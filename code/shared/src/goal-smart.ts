import { normalizeEventDate } from './kpi';

/**
 * ANA-166: SMART-формулировка главной KPI-цели и авто-состояние после дедлайна.
 *
 * Главная цель = «Цель по оплатам» (KPI_TARGET, платные билеты) с дедлайном (EVENT_DATE).
 * До ANA-166 цель существовала как голое число + дата; формулировка цели (Specific, Measurable,
 * Achievable, Relevant, Time-bound) нигде не собиралась, а после дедлайна дашборд продолжал
 * показывать «осталось N билетов» и прогноз темпа, как будто цель ещё активна.
 *
 * Обе функции чистые и детерминированные: «сегодня» передаётся явно (`today`), поэтому
 * render-путь отчёта остаётся без Date.now(), а тесты не зависят от часов машины.
 */

const EN_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const DAY_MS = 86_400_000;

/**
 * true — день дедлайна закончился (deadline < today, строгая дата-дата). Пустой/битый дедлайн
 * ('' → эвристика «конец периода + 2 длины») цели не истекает: эвристическая дата — не
 * обязательство. Сам день дедлайна ещё считается активным.
 */
export function isGoalExpired(deadline: string, today: string): boolean {
  const d = normalizeEventDate(deadline);
  const t = normalizeEventDate(today);
  return d !== '' && t !== '' && d < t;
}

export interface SmartGoalInput {
  /** KPI-цель в платных билетах (Measurable) — уже нормализованная resolveKpiTarget. */
  readonly target: number;
  /** Подтверждённые оплаты (B2C + B2B) на сегодня; без него — превью без прогресса и без
   * счёта-итога в истёкшей редакции (админка): ноль за неизвестные оплаты не выдаётся. */
  readonly paid?: number;
  /** Дедлайн цели (ISO YYYY-MM-DD) — Time-bound; '' → формулировка без даты. */
  readonly deadline: string;
  /** Сегодня (ISO YYYY-MM-DD) — выбирает активную/достигнутую/истёкшую редакцию. */
  readonly today: string;
  readonly locale: 'ru' | 'en';
}

/** ru: DD.MM.YYYY · en: «15 Nov 2026» — фиксированные месяцы, без расхождений рантайм-локалей. */
function formatGoalDate(iso: string, locale: 'ru' | 'en'): string {
  const [y, m, d] = iso.split('-');
  if (locale === 'ru') return `${d}.${m}.${y}`;
  return `${Number(d)} ${EN_MONTHS[Number(m) - 1] ?? m} ${y}`;
}

/**
 * SMART-формулировка главной цели одним предложением. Specific+Relevant — «платных билетов»
 * (подтверждённые оплаты, не заявки), Measurable — «≥N», Time-bound — «к ДАТА», Achievable —
 * «осталось R (~K в день)» из чистой математики remaining/daysLeft. Числа входные — функция
 * ничего не считает из данных Метрики, anti-hallucination не нарушается.
 */
export function smartGoal(input: SmartGoalInput): string {
  const target = Math.round(Number(input.target));
  if (!Number.isFinite(target) || target <= 0) return '';
  const locale = input.locale;
  const deadline = normalizeEventDate(input.deadline);
  const today = normalizeEventDate(input.today);
  const when = deadline ? formatGoalDate(deadline, locale) : '';
  const paid = typeof input.paid === 'number' && Number.isFinite(input.paid) ? input.paid : null;

  // Достигнутая цель главнее истёкшего дедлайна: результат фиксируем как успех.
  if (paid !== null && paid >= target) {
    return locale === 'ru'
      ? `Цель достигнута: ${target} платных билетов${when ? ` к ${when}` : ''}.`
      : `Goal reached: ${target} paid tickets${when ? ` by ${when}` : ''}.`;
  }
  // Дедлайн прошёл, цель не достигнута — авто-состояние «завершена без успеха» с итогом.
  // Без данных об оплатах итог не выдумывается (anti-hallucination): ноль «из N» рисовать нельзя,
  // поэтому формулировка называет цель, а счёт прогресса опускает (превью админки).
  if (deadline && today && deadline < today) {
    if (paid === null) {
      return locale === 'ru'
        ? `Дедлайн ${when} прошёл: цель — ${target} платных билетов.`
        : `Deadline ${when} has passed: goal — ${target} paid tickets.`;
    }
    return locale === 'ru'
      ? `Дедлайн ${when} прошёл: ${paid} из ${target} платных билетов.`
      : `Deadline ${when} has passed: ${paid} of ${target} paid tickets.`;
  }
  // Активная цель: S+M+T и, когда известен прогресс, достижимый темп.
  const head =
    locale === 'ru' ? `Достичь ≥${target} платных билетов` : `Reach ≥${target} paid tickets`;
  const by = when
    ? locale === 'ru'
      ? ` к ${when}`
      : ` by ${when}`
    : locale === 'ru'
      ? ' (без дедлайна)'
      : ' (no deadline)';
  let tail = '.';
  if (paid !== null) {
    const remaining = Math.max(target - paid, 0);
    tail =
      locale === 'ru'
        ? ` — сейчас ${paid}, осталось ${remaining}`
        : ` — ${paid} so far, ${remaining} to go`;
    const daysLeft =
      deadline && today
        ? Math.round(
            (Date.parse(`${deadline}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS,
          )
        : 0;
    if (remaining > 0 && daysLeft > 0) {
      const perDay = Math.ceil(remaining / daysLeft);
      tail += locale === 'ru' ? ` (~${perDay} в день)` : ` (~${perDay} per day)`;
    }
    tail += '.';
  }
  return `${head}${by}${tail}`;
}
