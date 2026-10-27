import type { NewMarketingCell } from '@pca/shared';

/**
 * The real campaign data from the Google Sheet «Инфопартнеры ProductCamp | лето 2026»,
 * лист «стата» (https://docs.google.com/spreadsheets/d/1GoHbMiU0GsyLI1RZIOMLdO32Gdxrj8X27KlEJ6voInE).
 * Imported with source='import' so the weekly sync never overwrites it; an analyst can still
 * correct any cell by hand (manual wins over everything).
 */

/** Sheet columns → week grid keys. */
const C = '2026-08-01';
const D = '2026-08-08';
const E = '2026-08-15';
const F = '2026-08-24';
const G = '2026-08-31';
const H = '2026-09-07';
const I = '2026-09-14';
const J = '2026-09-21';
const K = '2026-09-28';
const L = '2026-10-05';
const M = '2026-10-12';
const N = '2026-10-19';

/** [metricKey, weekKey, value] triples transcribed from the sheet rows. */
const DATA: Array<[string, string, number]> = [
  // заходы на лендос (посетители)
  ...zip(
    'landings_visits',
    [C, D, E, F, G, H, I, J, K, L, M, N],
    [486, 531, 1290, 576, 546, 829, 1023, 723, 793, 1132, 1115, 1161],
  ),
  // переходы по ссылкам имейл
  ...zip(
    'email_clicks',
    [C, D, E, F, G, H, I, J, K, L, M, N],
    [134, 104, 136, 66, 43, 72, 149, 100, 67, 85, 48, 47],
  ),
  // сколько вышло общих постов
  ...zip('posts_total', [C, D, E, F, G, H, I, J, K, L], [1, 1, 3, 3, 2, 3, 3, 5, 5, 10]),
  // переходы по ссылкам тг
  ...zip(
    'tg_clicks',
    [C, D, E, F, G, H, I, J, K, L, M, N],
    [18, 29, 93, 66, 129, 98, 240, 87, 116, 106, 163, 120],
  ),
  // цели на сайте
  ...zip(
    'site_goals',
    [C, D, E, F, G, H, I, J, K, L, M, N],
    [1, 1, 6, 1, 2, 2, 16, 1, 1, 3, 11, 37],
  ),
  // заявок всего
  ...zip('leads_total', [C, D, E, F, G, H, I, J, K, L, M], [4, 0, 4, 3, 2, 7, 7, 4, 4, 10, 5]),
  // оплат
  ...zip('payments', [C, D, E, F, G, H, I, J, K, L, M, N], [5, 0, 5, 1, 0, 4, 7, 2, 3, 5, 6, 26]),
  // Заявки b2b (заполняется с октябрьских недель)
  ...zip('b2b_leads', [K, L, M, N], [9, 6, 0, 3]),
  // Плановое кол-во билетов от b2b
  ...zip('b2b_planned_tickets', [K, L, N], [12, 11, 13]),
  // Инфоюне: партнерские посты
  ...zip('partner_posts', [C, D, E, F, G, H, I, J, K], [0, 0, 0, 0, 1, 3, 0, 1, 4]),
  // посты от спикеров
  ...zip('speaker_posts', [C, D, E, F, G, H, I, J, K], [0, 0, 0, 0, 0, 1, 0, 0, 1]),
  // амбассадоры
  ...zip('ambassadors', [C, D, E, F, G], [0, 0, 0, 0, 0]),
  // рефералы переходы (единственное значение — неделя 19-25)
  ...zip('referrals_clicks', [N], [100]),
];

function zip(
  metricKey: string,
  weeks: string[],
  values: number[],
): Array<[string, string, number]> {
  return weeks.map((w, i) => [metricKey, w, values[i]!] as [string, string, number]);
}

/** Pure builder — the exact sheet values as import cells. */
export function buildStataSheetCells(): NewMarketingCell[] {
  return DATA.filter(([, , v]) => v !== undefined).map(([metricKey, weekStart, value]) => ({
    weekStart,
    metricKey,
    value,
    note: 'Google Sheets «стата»',
  }));
}
