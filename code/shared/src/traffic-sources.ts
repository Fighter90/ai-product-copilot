/**
 * Yandex Metrika traffic sources (`ym:s:lastTrafficSource`). The Reporting API answers every row
 * with both a stable `id` (`organic`, `ad`, …) and a localized `name` ("Search engine traffic" /
 * «Переходы из поисковых систем»). `channel_stats.channel` stores the name, so classification
 * (segments, colours) resolves the name back to the id here and never compares display strings
 * (ANA-17: «Social networks traffic» ≠ «Social network traffic» silently dropped rows).
 */
export type TrafficSourceId =
  | 'ad'
  | 'direct'
  | 'internal'
  | 'organic'
  | 'referral'
  | 'recommend'
  | 'saved'
  | 'social'
  | 'email'
  | 'messenger'
  | 'qrcode'
  | 'undefined';

export interface TrafficSource {
  readonly id: TrafficSourceId;
  /** Name returned by the API with `lang=en` (what the sync stores). */
  readonly name: string;
  /** Name returned with `lang=ru`, plus historical spellings seen in older code / exports. */
  readonly aliases: readonly string[];
}

export const TRAFFIC_SOURCES: readonly TrafficSource[] = [
  { id: 'ad', name: 'Ad traffic', aliases: ['Переходы по рекламе', 'Переходы из рекламы'] },
  { id: 'direct', name: 'Direct traffic', aliases: ['Прямые заходы'] },
  { id: 'internal', name: 'Internal traffic', aliases: ['Внутренние переходы'] },
  {
    id: 'organic',
    name: 'Search engine traffic',
    aliases: ['Переходы из поисковых систем', 'Search engines traffic'],
  },
  { id: 'referral', name: 'Link traffic', aliases: ['Переходы по ссылкам на сайтах'] },
  {
    id: 'recommend',
    name: 'Recommendation system traffic',
    aliases: ['Переходы из рекомендательных систем', 'Recommendation systems traffic'],
  },
  {
    id: 'saved',
    name: 'Cached page traffic',
    aliases: ['Переходы с сохранённых страниц', 'Saved page traffic'],
  },
  {
    id: 'social',
    name: 'Social network traffic',
    aliases: ['Переходы из социальных сетей', 'Social networks traffic'],
  },
  { id: 'email', name: 'Mailing traffic', aliases: ['Переходы из почтовых рассылок'] },
  { id: 'messenger', name: 'Messenger traffic', aliases: ['Переходы из мессенджеров'] },
  { id: 'qrcode', name: 'QR code traffic', aliases: ['Переходы по QR-коду'] },
  {
    id: 'undefined',
    name: 'Undefined traffic',
    aliases: ['Not determined', 'Не определено', 'Неопределённые переходы'],
  },
];

const BY_KEY: ReadonlyMap<string, TrafficSourceId> = new Map(
  TRAFFIC_SOURCES.flatMap((s) =>
    [s.id, s.name, ...s.aliases].map((k) => [k.trim().toLowerCase(), s.id] as const),
  ),
);

/**
 * Resolve a stored channel value — a Metrika id or any known (en/ru/legacy) name — to its
 * `lastTrafficSource` id. Unknown values (custom names, 'unknown') resolve to `undefined`.
 */
export function trafficSourceId(channel: string | null | undefined): TrafficSourceId | undefined {
  if (!channel) return undefined;
  return BY_KEY.get(channel.trim().toLowerCase());
}

/**
 * Sources that represent B2C traffic. ProductCamp's B2B sales are manual deals (`b2b_manual`) —
 * Metrika never tags a visit as B2B — so every Metrika source counts as B2C.
 */
export const B2C_TRAFFIC_SOURCE_IDS: ReadonlySet<TrafficSourceId> = new Set(
  TRAFFIC_SOURCES.map((s) => s.id),
);
