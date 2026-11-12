import type { UtmStat, GeoDeviceStat, PageStat } from '@pca/shared';
import { B2C_TRAFFIC_SOURCE_IDS, trafficSourceId, type TrafficSourceId } from '@pca/shared';
import type { Segment } from '../store/filters';

/**
 * Segment (ANA-17): classification goes through `ym:s:lastTrafficSource` ids via
 * `trafficSourceId`, never through display names. ProductCamp's B2B sales are manual deals
 * (`b2b_manual`) — Metrika never tags a visit as B2B — so:
 *  - «B2C» keeps only rows classified as a Metrika source (`B2C_TRAFFIC_SOURCE_IDS`);
 *  - «B2B» keeps only rows that do NOT classify into a Metrika source — i.e. the manual
 *    pipeline rows (`b2b_manual`, future artificial channels); the screens combine them with
 *    the B2B deals dataset for KPI and funnel;
 *  - «B2C+B2B» returns both sources unchanged (no double counting: deal rows are excluded
 *    from the B2C classification by construction).
 */
export function channelMatchesSegment(channel: string, segment: Segment): boolean {
  if (segment === 'b2c_b2b') return true;
  const id: TrafficSourceId | undefined = trafficSourceId(channel);
  if (segment === 'b2c') return id !== undefined && B2C_TRAFFIC_SOURCE_IDS.has(id);
  /* istanbul ignore else -- exhaustive: Segment has only 3 values */
  if (segment === 'b2b') return id === undefined;
  return true;
}

/** Filter channel stats by segment. */
export function filterBySegment<T extends { channel?: string }>(data: T[], segment: Segment): T[] {
  if (segment === 'b2c_b2b') return data;
  return data.filter((d) => d.channel && channelMatchesSegment(d.channel, segment));
}

/**
 * Filter UTM stats by segment. ANA-139: the UTM breakdown is a Metrika dataset of its own
 * (utm_stats) and does not inherit the channel segmentation. The old «active sources»
 * cross-filter derived UTM sources from `channel_stats.utmSource` — permanently null since the
 * M-004 fix (the channel query uses a single `lastsignTrafficSource` dimension), which left the
 * UTM table, Sankey and coverage empty in the B2C/B2B segments even when Metrika had the data.
 * Semantics per the segment model (ANA-17):
 *  - «B2C+B2B» → everything;
 *  - «B2C» → everything (UTM-tagged visits are Metrika-classified campaign traffic — the B2C side);
 *  - «B2B» → nothing (the B2B segment is the manual pipeline; Metrika never tags a visit as B2B).
 */
export function filterUtmBySegment(data: UtmStat[], segment: Segment): UtmStat[] {
  if (segment === 'b2b') return [];
  return data;
}

/** Filter geo/device stats by segment. */
export function filterGeoBySegment(data: GeoDeviceStat[], _segment: Segment): GeoDeviceStat[] {
  // Geo/device data applies to all segments equally
  return data;
}

/** Filter page stats by segment. */
export function filterPagesBySegment(data: PageStat[], _segment: Segment): PageStat[] {
  // Page data applies to all segments equally
  return data;
}
