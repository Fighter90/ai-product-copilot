import type { ChannelStat } from '@pca/shared';
import { dailySeries, weekOverWeek } from './trends';
import { weakSpots, type WeakSpot } from './overview';

export interface ChannelVisits {
  readonly channel: string;
  readonly visits: number;
}

/**
 * A compact "what happened this week" summary for the Overview page. Headline metrics are
 * week-over-week (last 7 days vs the 7 before); the top channel and weak spot are computed over
 * the last-7-day window so the digest reads as a single coherent weekly snapshot. Pure and
 * fully unit-testable.
 */
export interface WeeklyDigestData {
  readonly hasData: boolean;
  readonly visits: number;
  /**
   * ANA-184: WoW delta vs the 7 days before the last 7 — `null` when the selected period has no
   * full previous week in data (a 7-day period). Null renders as «—», never a fake «0%».
   */
  readonly visitsDelta: number | null;
  readonly applications: number;
  /** Same nullability contract as {@link visitsDelta}. */
  readonly applicationsDelta: number | null;
  readonly topChannel: ChannelVisits | null;
  readonly topWeakSpot: WeakSpot | null;
}

export function weeklyDigest(stats: ChannelStat[]): WeeklyDigestData {
  const wow = weekOverWeek(stats);
  const series = dailySeries(stats);
  const last7Dates = new Set(series.slice(-7).map((p) => p.date));
  const last7 = stats.filter((s) => last7Dates.has(s.date));

  const byChannel = new Map<string, number>();
  for (const s of last7) byChannel.set(s.channel, (byChannel.get(s.channel) ?? 0) + s.visits);
  const top = [...byChannel.entries()].sort((a, b) => b[1] - a[1])[0];

  // ANA-184 (регресс 15.11): смешанная семантика карточки — «Визиты (7 дней)» не меняется при
  // переключении периода 7д/14д, а WoW менялся с фейковых «0%» на реальный ±. Дельта честная
  // только когда в периоде есть полная предыдущая неделя (series ≥ 14 дней); иначе null → «—».
  const hasPrevWeek = series.length >= 14;

  return {
    hasData: series.length > 0,
    visits: wow.currentVisits,
    visitsDelta: hasPrevWeek ? wow.visitsDelta : null,
    applications: wow.currentReaches,
    applicationsDelta: hasPrevWeek ? wow.reachesDelta : null,
    topChannel: top ? { channel: top[0], visits: top[1] } : null,
    topWeakSpot: weakSpots(last7)[0] ?? null,
  };
}
