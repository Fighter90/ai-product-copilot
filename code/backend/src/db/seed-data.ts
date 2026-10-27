import type {
  ChannelStat,
  GeoDeviceStat,
  Goal,
  NewB2bDeal,
  NewB2cPayment,
  PageStat,
  UtmStat,
} from '@pca/shared';

/**
 * Deterministic demo dataset so `./run.sh` shows a populated dashboard without an OAuth token.
 * Pure (no DB, no clock) — the CLI seeder writes it via the repositories. Numbers are illustrative,
 * not real Metrika data; the «заявка ≠ оплата» split is kept realistic (few paid B2B vs many B2C).
 *
 * ANA-18: dates are RELATIVE to «now» (the last 30 days, oldest first) so the demo fits the
 * default 14-day filter window, and every row carries `isDemo: true` so a real sync can wipe the
 * dataset (and the banner can flag it) — demo rows never mix with live data unnoticed.
 */
export interface SeedData {
  readonly goals: Goal[];
  readonly channels: ChannelStat[];
  readonly utm: UtmStat[];
  readonly geoDevice: GeoDeviceStat[];
  readonly pages: PageStat[];
  readonly exitPages: PageStat[];
  readonly b2b: NewB2bDeal[];
  readonly b2c: NewB2cPayment[];
}

/** Demo window: 30 days ending today (issue criterion), oldest first. */
export const SEED_DAYS = 30;

/** ISO date (YYYY-MM-DD) `offset` days before the anchor (0 = the anchor day itself). */
export function seedDate(anchor: Date, offset: number): string {
  return new Date(anchor.getTime() - offset * 86_400_000).toISOString().slice(0, 10);
}

const CHANNELS = [
  { channel: 'podcast', visits: 420, reaches: 12 },
  { channel: 'direct', visits: 260, reaches: 18 },
  { channel: 'social', visits: 180, reaches: 4 },
  { channel: 'referral', visits: 90, reaches: 9 },
] as const;

/** Build the full demo dataset. Same output for the same anchor day (deterministic). */
export function buildSeedData(now: Date = new Date()): SeedData {
  // Anchors relative to today: day 0 = today … day 29 = 29 days ago.
  const day = (offset: number): string => seedDate(now, offset);
  // Demo rows span the whole window; the ramp is keyed off days-ago so «today» is the peak.
  const channels: ChannelStat[] = [];
  for (let ago = SEED_DAYS - 1; ago >= 0; ago--) {
    const i = SEED_DAYS - 1 - ago; // 0 = oldest … 29 = today
    const date = day(ago);
    for (const c of CHANNELS) {
      // Gentle day-over-day ramp so the Trends line and WoW deltas look alive.
      const visits = c.visits + i * 5;
      const goalReaches = c.reaches + Math.floor(i / 3);
      channels.push({
        date,
        channel: c.channel,
        utmSource: null,
        utmMedium: null,
        utmCampaign: null,
        visits,
        users: Math.round(visits * 0.9),
        bounceRate: 0.2 + i * 0.005,
        avgDuration: 60 + i,
        goalReaches,
        conversionRate: goalReaches / visits,
        isDemo: true,
      });
    }
  }

  const utm: UtmStat[] = [
    mkUtm(day(20), 'vk', 'cpc', 'spring-launch', 240, 9),
    mkUtm(day(15), 'telegram', 'social', 'channel-post', 130, 6),
    mkUtm(day(10), 'email', 'newsletter', 'digest-01', 80, 7),
    mkUtm(day(10), '(none)', '(none)', '(none)', 310, 11),
  ];

  const geoDevice: GeoDeviceStat[] = [
    mkGeo(day(20), 'Россия', 'mobile', 520, 22),
    mkGeo(day(20), 'Россия', 'desktop', 280, 16),
    mkGeo(day(15), 'Казахстан', 'mobile', 70, 3),
    mkGeo(day(15), 'Беларусь', 'desktop', 40, 2),
  ];

  const pages: PageStat[] = [
    mkPage(day(20), '/', 380, 0.18, 14),
    mkPage(day(20), '/tickets', 210, 0.12, 19),
    mkPage(day(15), '/program', 140, 0.34, 3),
  ];

  const exitPages: PageStat[] = [
    mkPage(day(20), '/checkout', 120, 0.55, 6),
    mkPage(day(20), '/tickets', 95, 0.41, 5),
    mkPage(day(15), '/', 60, 0.62, 1),
  ];

  const b2b: NewB2bDeal[] = [
    {
      company: 'BigCorp',
      tickets: 20,
      stage: 'paid',
      dateAdded: day(20),
      datePaid: day(10),
      isDemo: true,
    },
    { company: 'MidMarket', tickets: 8, stage: 'invoiced', dateAdded: day(15), isDemo: true },
    { company: 'StartupZ', tickets: 4, stage: 'negotiation', dateAdded: day(15), isDemo: true },
    { company: 'LeadCo', tickets: 2, stage: 'lead', dateAdded: day(5), isDemo: true },
  ];

  // A few paid B2C days (manual-entry shape) so «Оплачено» is non-zero out of the box (ANA-19).
  const b2c: NewB2cPayment[] = [
    { date: day(12), tickets: 6, note: 'Демо: оплаты за день' },
    { date: day(11), tickets: 9, note: 'Демо: оплаты за день' },
    { date: day(10), tickets: 5, note: 'Демо: оплаты за день' },
  ];

  // Start of the anchor UTC day — two calls on the same day yield identical output.
  const seededAt = `${day(0)}T00:00:00.000Z`;
  const goals: Goal[] = [
    {
      id: 80,
      name: 'Заявка на билет',
      type: 'form',
      isB2b: false,
      isArchived: false,
      syncedAt: seededAt,
      isDemo: true,
    },
    {
      id: 81,
      name: 'Заказ (корзина)',
      type: 'action',
      isB2b: false,
      isArchived: false,
      syncedAt: seededAt,
      isDemo: true,
    },
    {
      id: 12,
      name: 'Старая цель',
      type: 'action',
      isB2b: false,
      isArchived: true,
      syncedAt: seededAt,
      isDemo: true,
    },
  ];

  return { goals, channels, utm, geoDevice, pages, exitPages, b2b, b2c };
}

function mkUtm(
  date: string,
  utmSource: string,
  utmMedium: string,
  utmCampaign: string,
  visits: number,
  goalReaches: number,
): UtmStat {
  return {
    date,
    utmSource,
    utmMedium,
    utmCampaign,
    visits,
    users: Math.round(visits * 0.9),
    goalReaches,
    conversionRate: goalReaches / visits,
    isDemo: true,
  };
}

function mkGeo(
  date: string,
  country: string,
  device: string,
  visits: number,
  goalReaches: number,
): GeoDeviceStat {
  return {
    date,
    country,
    device,
    visits,
    users: Math.round(visits * 0.9),
    goalReaches,
    conversionRate: goalReaches / visits,
    isDemo: true,
  };
}

function mkPage(
  date: string,
  page: string,
  visits: number,
  bounceRate: number,
  goalReaches: number,
): PageStat {
  return {
    date,
    page,
    visits,
    users: Math.round(visits * 0.9),
    bounceRate,
    goalReaches,
    conversionRate: goalReaches / visits,
    isDemo: true,
  };
}
