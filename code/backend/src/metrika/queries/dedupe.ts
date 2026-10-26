/**
 * Row-level dedup for synced stat rows (audit bug ANA-16: duplicate rows in the UTM / entry-page /
 * problem-pages tables). Each breakdown now collapses rows that share a table's natural key
 * BEFORE the upsert, so `INSERT OR REPLACE` always sees one row per primary key per sync —
 * repeated keys sum up instead of silently overwriting (or, with legacy pre-PK tables,
 * accumulating as duplicates).
 *
 * A dedicated migration (see the ticket report) is still recommended: a UNIQUE index backfills
 * the guarantee into databases created before the wipe-and-reload sync existed.
 */

/**
 * Collapse `rows` that share `keyOf`, combining each group via `merge(first, next)`.
 * First-seen order is preserved; `merge` must treat `first` as the accumulator.
 */
export function mergeByKey<T>(
  rows: readonly T[],
  keyOf: (row: T) => string,
  merge: (first: T, next: T) => T,
): T[] {
  const map = new Map<string, T>();
  for (const row of rows) {
    const key = keyOf(row);
    const cur = map.get(key);
    map.set(key, cur ? merge(cur, row) : row);
  }
  return [...map.values()];
}

/** Visit-weighted average of a rate field (bounce rate, conversion rate) over summed visits. */
export function weightedRate(
  aRate: number,
  aVisits: number,
  bRate: number,
  bVisits: number,
): number {
  const visits = aVisits + bVisits;
  return visits > 0 ? (aRate * aVisits + bRate * bVisits) / visits : 0;
}

/** Conversion rate from summed reaches and visits (reaches/visits), 0 when there are no visits. */
export function reachRate(reaches: number, visits: number): number {
  return visits > 0 ? reaches / visits : 0;
}
