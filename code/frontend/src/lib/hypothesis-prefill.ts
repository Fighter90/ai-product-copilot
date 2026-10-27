/**
 * Seed for prefilling a hypothesis from a weak spot / under-performing item. Every field is
 * optional — deep-links from Overview/Traffic carry whatever context is available (segment +
 * evidence at minimum).
 *
 * ANA-24: the deep link opens the hypotheses workspace editor (/app/hypotheses) with the seed in
 * the query string. The workspace parses it, prefills the editor and the saved hypothesis lands in
 * the kanban — no detour through the report page, nothing lost on redirects.
 */
export interface HypothesisSeed {
  /** ЦА / сегмент канала (e.g. «Подкаст»). */
  readonly segment?: string;
  /** Проблема / симптом (e.g. «низкая конверсия»). */
  readonly trouble?: string;
  /** Действие пользователя, на котором возникает проблема. */
  readonly action?: string;
  /** Барьер, мешающий действию. */
  readonly barrier?: string;
  /** Обоснование данными (e.g. «CR 0.7% при 1300 визитах»). */
  readonly evidence?: string;
}

const SEED_KEYS = ['segment', 'trouble', 'action', 'barrier', 'evidence'] as const;

/** sessionStorage key for the hypothesis draft captured from a deep link. */
const STORAGE_KEY = 'pca.hypothesis-prefill';

/**
 * Build a deep-link to the hypotheses workspace editor, prefilled with seed context. Empty/
 * undefined fields are omitted; values are URL-encoded. Pure and deterministic.
 */
export function buildHypothesisUrl(seed: HypothesisSeed): string {
  const params = new URLSearchParams();
  for (const key of SEED_KEYS) {
    const value = seed[key];
    if (value !== undefined && value !== '') params.set(key, value);
  }
  const qs = params.toString();
  return qs === '' ? '/app/hypotheses' : `/app/hypotheses?${qs}`;
}

/**
 * Parse a hypothesis seed from a query string or URLSearchParams. Inverse of
 * {@link buildHypothesisUrl} for the non-empty fields. Missing keys are left undefined.
 */
export function parseHypothesisSeed(search: string | URLSearchParams): HypothesisSeed {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const seed: { -readonly [K in keyof HypothesisSeed]: HypothesisSeed[K] } = {};
  for (const key of SEED_KEYS) {
    const value = params.get(key);
    if (value !== null && value !== '') seed[key] = value;
  }
  return seed;
}

/**
 * Remove the seed params from a query string while keeping every other param (e.g. ?snapshot=…).
 * Returns the cleaned search (with a leading «?» or empty). Pure. Inverse complement of
 * {@link parseHypothesisSeed} for URL cleanup after the seed is captured.
 */
export function dropHypothesisSeedParams(search: string): string {
  const params = new URLSearchParams(search);
  for (const key of SEED_KEYS) params.delete(key);
  const qs = params.toString();
  return qs === '' ? '' : `?${qs}`;
}

/** True when a seed carries at least one non-empty field — used to decide whether to show context. */
export function hasSeed(seed: HypothesisSeed): boolean {
  return SEED_KEYS.some((key) => seed[key] !== undefined && seed[key] !== '');
}

/** Persist the hypothesis draft for this browser session (survives reloads, not tab closes). */
export function storeHypothesisSeed(seed: HypothesisSeed): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
  } catch {
    // Storage unavailable (private mode / quota) — the draft just lives in memory.
  }
}

/** Load the stored hypothesis draft; empty seed when absent or malformed. */
export function loadHypothesisSeed(): HypothesisSeed {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return parseHypothesisSeed(new URLSearchParams(JSON.parse(raw) as Record<string, string>));
  } catch {
    return {};
  }
}

/** Drop the stored hypothesis draft (used by the «Убрать черновик» button). */
export function clearHypothesisSeed(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clean up.
  }
}
