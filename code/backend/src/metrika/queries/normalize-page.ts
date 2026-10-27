import type { PageStat } from '@pca/shared';
import { mergeByKey, weightedRate } from './dedupe';

/**
 * ANA-22: Tilda virtual pageviews (`/tilda/popup/…`, `/tilda/click/…`, `/tilda/form…/submitted`,
 * `/tilda/cart/…`) are widget EVENTS, not pages a visitor lands on. They are grouped into the
 * single «/tilda/*» bucket so they stop inflating the entry/exit-page tables as fake pages.
 */
export const TILDA_EVENTS_GROUP = '/tilda/*';

/** True when the URL (absolute or path-only) is a Tilda virtual pageview. */
export function isTildaVirtualEvent(url: string): boolean {
  const path = /^[a-z][a-z0-9+.-]*:\/\//i.test(url)
    ? (url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?]*/i, '').split('?')[0] ?? '')
    : (url.split('?')[0] ?? '');
  return path.startsWith('/tilda/');
}

/**
 * Canonicalise a page URL so trailing-slash / host-case variants collapse to one key
 * (e.g. `https://productcamp.ru/` and `https://productcamp.ru` → same page). Query string and
 * fragment are dropped. Non-URL values (e.g. the «(none)» bucket) are returned trimmed (C-005).
 * Tilda virtual pageviews collapse into the «{@link TILDA_EVENTS_GROUP}» bucket (ANA-22).
 */
export function normalizePageUrl(url: string): string {
  const trimmed = url.trim();
  if (isTildaVirtualEvent(trimmed)) return TILDA_EVENTS_GROUP;
  try {
    const u = new URL(trimmed);
    const path = u.pathname.replace(/\/+$/, '') || '/';
    return `${u.protocol}//${u.host.toLowerCase()}${path}`;
  } catch {
    return trimmed;
  }
}

/**
 * Merge per-page rows that canonicalise to the same URL: visits/users/goalReaches are summed and
 * bounce/conversion rates are visit-weighted. Mirrors the channel aggregation (v2.6.0) and is
 * required because `page_stats` upserts with INSERT OR REPLACE — without merging, the second URL
 * variant would overwrite the first instead of adding to it.
 */
export function aggregatePages(stats: readonly PageStat[]): PageStat[] {
  interface Acc {
    base: PageStat;
    visits: number;
    users: number;
    goalReaches: number;
    bounceWeighted: number;
    crWeighted: number;
  }
  const map = new Map<string, Acc>();
  for (const s of stats) {
    const page = normalizePageUrl(s.page);
    const cur = map.get(page);
    if (cur) {
      cur.visits += s.visits;
      cur.users += s.users;
      cur.goalReaches += s.goalReaches;
      cur.bounceWeighted += s.bounceRate * s.visits;
      cur.crWeighted += s.conversionRate * s.visits;
    } else {
      map.set(page, {
        base: { ...s, page },
        visits: s.visits,
        users: s.users,
        goalReaches: s.goalReaches,
        bounceWeighted: s.bounceRate * s.visits,
        crWeighted: s.conversionRate * s.visits,
      });
    }
  }
  return [...map.values()].map((a) => ({
    ...a.base,
    visits: a.visits,
    users: a.users,
    goalReaches: a.goalReaches,
    bounceRate: a.visits > 0 ? a.bounceWeighted / a.visits : 0,
    conversionRate: a.visits > 0 ? a.crWeighted / a.visits : 0,
  }));
}

/**
 * Cross-chunk safety net (ANA-16): unlike {@link aggregatePages} this keys on (date, page), so
 * page rows accumulated over several request chunks collapse to one row per `page_stats` /
 * `exit_page_stats` primary key. Metrics are summed, rates are visit-weighted.
 */
export function mergePageStats(rows: readonly PageStat[]): PageStat[] {
  return mergeByKey(
    rows,
    (s) => `${s.date}|${s.page}`,
    (a, b) => ({
      date: a.date,
      page: a.page,
      visits: a.visits + b.visits,
      users: a.users + b.users,
      bounceRate: weightedRate(a.bounceRate, a.visits, b.bounceRate, b.visits),
      goalReaches: a.goalReaches + b.goalReaches,
      conversionRate: weightedRate(a.conversionRate, a.visits, b.conversionRate, b.visits),
    }),
  );
}
