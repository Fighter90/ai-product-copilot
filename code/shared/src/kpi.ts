/**
 * ANA-75: единая KPI-математика, разделяемая бэкендом и фронтендом, чтобы «Оплачено/Осталось»
 * и дедлайн KPI не расходились между Обзором, /app/kpi, воронкой и снапшотом отчёта.
 */

export interface PaidAndGapInput {
  /** KPI-цель (платные билеты) — админская «Цель по оплатам». */
  readonly target: number;
  /** Подтверждённые B2C-платежи (ручной ввод / CSV, платные билеты). */
  readonly b2cPaidTickets: number;
  /** Билеты B2B-сделок в стадии «paid». */
  readonly b2bPaidTickets: number;
}

export interface PaidAndGap {
  /** Оплачено к цели (только подтверждённые деньги). */
  readonly paid: number;
  /** Осталось до цели: target − paid, не меньше 0. */
  readonly gap: number;
}

/**
 * Единая семантика «Оплачено» (REG-03 / ANA-92, инвариант «заявка ≠ оплата»): только
 * подтверждённые деньги — B2C-платежи (b2c_payments) + билеты B2B-сделок в стадии «paid».
 * Заказы/заявки Метрики оплатой НЕ считаются ни для какого типа цели — это отдельная метрика
 * «заявки/заказы». Gap = target − paid (не меньше 0). Один расчёт для Обзора, /app/kpi,
 * воронки и снапшота отчёта — цифры совпадают по определению.
 */
export function paidAndGap(input: PaidAndGapInput): PaidAndGap {
  const paid = Math.max(0, input.b2cPaidTickets) + Math.max(0, input.b2bPaidTickets);
  return { paid, gap: Math.max(0, input.target - paid) };
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Strict YYYY-MM-DD (a real calendar day) or ''. Date.parse alone is not enough: JS rolls
 * out-of-range days over («2026-02-31» parses as 2026-03-03), so the round-trip is verified.
 */
export function normalizeEventDate(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const v = raw.trim();
  if (!ISO_DATE_RE.test(v)) return '';
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? '' : v;
}

/** EVENT_DATE из view GET /api/settings ({ EVENT_DATE: { value } }); '' когда не задана. */
export function readEventDate(settings: unknown): string {
  if (typeof settings !== 'object' || settings === null) return '';
  const rec = (settings as Record<string, unknown>).EVENT_DATE;
  if (typeof rec !== 'object' || rec === null) return '';
  return normalizeEventDate((rec as { value?: unknown }).value);
}

export interface KpiDeadline {
  /** ISO-дата дедлайна KPI. */
  readonly deadline: string;
  /** Дней от конца периода (`to`) до дедлайна (≥ 0). */
  readonly horizonDays: number;
  /** true — дедлайн из EVENT_DATE; false — эвристика «конец периода + 2 длины периода». */
  readonly fromEventDate: boolean;
}

const DAY_MS = 86_400_000;

/** ISO date + n days → ISO date (UTC arithmetic, no DST pitfalls). Invalid input returns as-is. */
function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (b − a); 0 for invalid dates. */
function diffDaysIso(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Number.isNaN(ms) ? 0 : Math.round(ms / DAY_MS);
}

/**
 * ANA-75 (БАГ-01): единый дедлайн KPI для всех экранов. Задана EVENT_DATE (админ, «Дата события»)
 * — она и есть дедлайн; иначе эвристика «конец периода + 2 длины периода» (в UI показывается
 * оговорка). Same heuristic the KPI page and the Overview hero used before.
 */
export function resolveKpiDeadline(input: {
  /** Period end (ISO date). */
  readonly to: string;
  /** Fact window length in days (clamped to ≥ 1, same guard as the pace model). */
  readonly windowDays: number;
  /** Admin EVENT_DATE (YYYY-MM-DD); '' / invalid → the heuristic. */
  readonly eventDate?: string;
}): KpiDeadline {
  const event = normalizeEventDate(input.eventDate);
  const to = normalizeEventDate(input.to) || new Date().toISOString().slice(0, 10);
  if (event) {
    return {
      deadline: event,
      horizonDays: Math.max(diffDaysIso(to, event), 0),
      fromEventDate: true,
    };
  }
  const horizon = Math.max(Math.round(input.windowDays) || 0, 1) * 2;
  return { deadline: addDaysIso(to, horizon), horizonDays: horizon, fromEventDate: false };
}
