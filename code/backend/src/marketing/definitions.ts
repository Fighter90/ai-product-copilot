import type { MarketingMetricDef, MarketingSection, MarketingWeek } from '@pca/shared';

/** The two block rows of the sheet «стата». */
export const MARKETING_SECTIONS: MarketingSection[] = [
  { key: 'content', ru: 'Контент-маркетинг', en: 'Content marketing' },
  { key: 'influence', ru: 'Инфопартнёры', en: 'Influence partners' },
];

/**
 * The metric rows, in the sheet's order. `sync: true` rows are recomputed by the weekly sync
 * from the synced Metrika tables / manually entered DB data (b2b deals, b2c payments); the rest
 * are content-plan facts an analyst enters by hand.
 */
export const MARKETING_METRICS: MarketingMetricDef[] = [
  {
    key: 'landings_visits',
    ru: 'заходы на лендос (посетители)',
    en: 'Landing page visits',
    section: 'content',
    sync: true,
  },
  {
    key: 'email_clicks',
    ru: 'переходы по ссылкам имейл',
    en: 'Email link clicks',
    section: 'content',
    sync: false,
  },
  {
    key: 'posts_total',
    ru: 'сколько вышло общих постов',
    en: 'Posts published (total)',
    section: 'content',
    sync: false,
  },
  {
    key: 'tg_clicks',
    ru: 'переходы по ссылкам тг',
    en: 'Telegram link clicks',
    section: 'content',
    sync: false,
  },
  {
    key: 'site_goals',
    ru: 'цели на сайте',
    en: 'Site goal reaches',
    section: 'content',
    sync: true,
  },
  { key: 'leads_total', ru: 'заявок всего', en: 'Total leads', section: 'content', sync: false },
  { key: 'payments', ru: 'оплат', en: 'Payments', section: 'content', sync: true },
  { key: 'b2b_leads', ru: 'Заявки b2b', en: 'B2B leads', section: 'content', sync: true },
  {
    key: 'b2b_planned_tickets',
    ru: 'Плановое кол-во билетов от b2b',
    en: 'Planned B2B tickets',
    section: 'content',
    sync: false,
  },
  {
    key: 'partner_posts',
    ru: 'сколько вышло партнерских постов',
    en: 'Partner posts published',
    section: 'influence',
    sync: false,
  },
  {
    key: 'speaker_posts',
    ru: 'сколько вышло постов от спикеров',
    en: 'Speaker posts published',
    section: 'influence',
    sync: false,
  },
  { key: 'ambassadors', ru: 'амбассадоры', en: 'Ambassadors', section: 'influence', sync: false },
  {
    key: 'referrals_clicks',
    ru: 'рефералы переходы',
    en: 'Referral clicks',
    section: 'influence',
    sync: false,
  },
];

/**
 * The campaign week grid, copied 1-to-1 from the sheet «стата» (the authors split months into
 * irregular ~4 parts — kept exactly as in the source so dashboard numbers match the sheet).
 */
export const MARKETING_MONTHS: Array<{ key: string; ru: string; en: string }> = [
  { key: '2026-08', ru: 'Август', en: 'August' },
  { key: '2026-09', ru: 'Сентябрь', en: 'September' },
  { key: '2026-10', ru: 'Октябрь', en: 'October' },
  { key: '2026-11', ru: 'Ноябрь', en: 'November' },
];

export const MARKETING_WEEKS: MarketingWeek[] = [
  {
    key: '2026-08-01',
    start: '2026-08-01',
    end: '2026-08-07',
    month: '2026-08',
    labelRu: '1 неделя (1-7)',
    labelEn: 'Week 1 (Aug 1-7)',
  },
  {
    key: '2026-08-08',
    start: '2026-08-08',
    end: '2026-08-14',
    month: '2026-08',
    labelRu: '2 неделя (8-14)',
    labelEn: 'Week 2 (Aug 8-14)',
  },
  {
    key: '2026-08-15',
    start: '2026-08-15',
    end: '2026-08-23',
    month: '2026-08',
    labelRu: '3 неделя (15-23)',
    labelEn: 'Week 3 (Aug 15-23)',
  },
  {
    key: '2026-08-24',
    start: '2026-08-24',
    end: '2026-08-30',
    month: '2026-08',
    labelRu: '4 неделя (24-30)',
    labelEn: 'Week 4 (Aug 24-30)',
  },
  {
    key: '2026-08-31',
    start: '2026-08-31',
    end: '2026-09-06',
    month: '2026-09',
    labelRu: '1 неделя (31-6)',
    labelEn: 'Week 1 (Aug 31-Sep 6)',
  },
  {
    key: '2026-09-07',
    start: '2026-09-07',
    end: '2026-09-13',
    month: '2026-09',
    labelRu: '2 неделя (7-13)',
    labelEn: 'Week 2 (Sep 7-13)',
  },
  {
    key: '2026-09-14',
    start: '2026-09-14',
    end: '2026-09-20',
    month: '2026-09',
    labelRu: '3 неделя (14-20)',
    labelEn: 'Week 3 (Sep 14-20)',
  },
  {
    key: '2026-09-21',
    start: '2026-09-21',
    end: '2026-09-27',
    month: '2026-09',
    labelRu: '4 неделя (21-27)',
    labelEn: 'Week 4 (Sep 21-27)',
  },
  {
    key: '2026-09-28',
    start: '2026-09-28',
    end: '2026-10-04',
    month: '2026-10',
    labelRu: '1 неделя (28-4)',
    labelEn: 'Week 1 (Sep 28-Oct 4)',
  },
  {
    key: '2026-10-05',
    start: '2026-10-05',
    end: '2026-10-11',
    month: '2026-10',
    labelRu: '2 неделя (5-11)',
    labelEn: 'Week 2 (Oct 5-11)',
  },
  {
    key: '2026-10-12',
    start: '2026-10-12',
    end: '2026-10-18',
    month: '2026-10',
    labelRu: '3 неделя (12-18)',
    labelEn: 'Week 3 (Oct 12-18)',
  },
  {
    key: '2026-10-19',
    start: '2026-10-19',
    end: '2026-10-25',
    month: '2026-10',
    labelRu: '4 неделя (19-25)',
    labelEn: 'Week 4 (Oct 19-25)',
  },
  {
    key: '2026-10-26',
    start: '2026-10-26',
    end: '2026-11-01',
    month: '2026-11',
    labelRu: '5 неделя (26-01)',
    labelEn: 'Week 5 (Oct 26-Nov 1)',
  },
];
