import type {
  UtmStat,
  GeoDeviceStat,
  PageStat,
  UtmBreakdownRow,
  GeoDeviceBreakdownRow,
  PageBreakdownRow,
} from '@pca/shared';

/** How many rows of each breakdown the report keeps (top by visits). */
export const TOP_N = 5;

/**
 * Aggregate UTM day-rows by source/medium/campaign, top {@link TOP_N} by visits. Deterministic.
 * `rows` is readonly because the metrics repositories already return readonly day-arrays (frozen
 * stat cache) and feed them straight in here; this function never mutates its input.
 */
export function topUtm(rows: readonly UtmStat[]): UtmBreakdownRow[] {
  const map = new Map<string, UtmBreakdownRow>();
  for (const r of rows) {
    const key = `${r.utmSource}\u0000${r.utmMedium}\u0000${r.utmCampaign}`;
    const cur = map.get(key) ?? {
      source: r.utmSource,
      medium: r.utmMedium,
      campaign: r.utmCampaign,
      visits: 0,
      goalReaches: 0,
    };
    map.set(key, {
      ...cur,
      visits: cur.visits + r.visits,
      goalReaches: cur.goalReaches + r.goalReaches,
    });
  }
  return [...map.values()].sort((a, b) => b.visits - a.visits).slice(0, TOP_N);
}

/** Aggregate geo/device day-rows by country/device, top {@link TOP_N} by visits. */
export function topGeoDevice(rows: readonly GeoDeviceStat[]): GeoDeviceBreakdownRow[] {
  const map = new Map<string, GeoDeviceBreakdownRow>();
  for (const r of rows) {
    const key = `${r.country}\u0000${r.device}`;
    const cur = map.get(key) ?? {
      country: r.country,
      device: r.device,
      visits: 0,
      goalReaches: 0,
    };
    map.set(key, {
      ...cur,
      visits: cur.visits + r.visits,
      goalReaches: cur.goalReaches + r.goalReaches,
    });
  }
  return [...map.values()].sort((a, b) => b.visits - a.visits).slice(0, TOP_N);
}

/** Aggregate page day-rows by page, visit-weighting bounce rate, top {@link TOP_N} by visits. */
export function topPages(rows: readonly PageStat[]): PageBreakdownRow[] {
  const map = new Map<string, { visits: number; goalReaches: number; bounceVisits: number }>();
  for (const r of rows) {
    const cur = map.get(r.page) ?? { visits: 0, goalReaches: 0, bounceVisits: 0 };
    map.set(r.page, {
      visits: cur.visits + r.visits,
      goalReaches: cur.goalReaches + r.goalReaches,
      bounceVisits: cur.bounceVisits + r.bounceRate * r.visits,
    });
  }
  return [...map.entries()]
    .map(([page, v]) => ({
      page,
      visits: v.visits,
      goalReaches: v.goalReaches,
      bounceRate: v.visits === 0 ? 0 : v.bounceVisits / v.visits,
    }))
    .sort((a, b) => b.visits - a.visits)
    .slice(0, TOP_N);
}
