/**
 * Shared insight thresholds (ANA-75 / БАГ-09): every «ключевое наблюдение» must be judged by the
 * same numbers the adjacent table shows, so Behavior, Overview and Funnel read their insight
 * thresholds from this single source instead of inlined magic numbers. A page or channel may
 * never be praised for a CR that the overall verdict calls «низкий» — relative comparisons
 * (vs average) are additionally gated on the absolute CR target below.
 */

/** CR target: below this the overall CR is «низкий, цель > 2%» — no page/channel gets a «высокий CR» badge under it. */
export const CR_GOOD_TARGET = 0.02;
/** CR below this is reported as критический (funnel recommendations). */
export const CR_CRITICAL_TARGET = 0.01;
/** Overall CR above this is «хороший» (Overview channels). */
export const CR_EXCELLENT_TARGET = 0.05;
/** Page CR below this is a «проблемная страница» (funnel problem pages). */
export const CR_LOW_PAGE_TARGET = 0.005;
/** Bounce above this is «высокий/критический» (badges, problem pages). */
export const BOUNCE_HIGH = 0.5;
/** Bounce below this is «низкий» — the page retains visitors well. */
export const BOUNCE_LOW = 0.2;
/** A page needs at least this many visits before its bounce is judged. */
export const MIN_PAGE_VISITS = 30;
/** A page needs at least this many visits before its low CR is flagged. */
export const MIN_PAGE_VISITS_CR_LOW = 50;
/** A page/channel CR counts as «выше/ниже среднего» relative to the average by these factors. */
export const CR_HIGH_VS_AVG = 1.5;
export const CR_LOW_VS_AVG = 0.5;
/** A channel needs at least this many visits before its CR is compared to the average. */
export const MIN_CHANNEL_VISITS = 50;
