/**
 * ANA-22 (client layer): rows synced before the test-traffic filter existed (or synced with
 * INCLUDE_TEST_TRAFFIC=1) can still carry test/service sessions. The FilterBar toggle
 * «Показать тестовый трафик» (store `includeTest`) lets the analyst show them again; by
 * default the rows below are hidden from the dashboard tables.
 *
 * Mirrors the server-side `testPatternFilter` (backend/src/metrika/traffic-filter.ts):
 * substring match on page URLs, EXACT match on UTM values (a UTM `qa` must not exclude
 * `qatar`). The known live artifacts come from ANA-22; the admin can extend the server-side
 * list via TEST_TRAFFIC_PATTERNS — this client list is the built-in baseline.
 */

/** Built-in baseline of known test-page fragments and test UTM values (ANA-22 live audit). */
export const TEST_PAGE_PATTERNS: readonly string[] = [
  '/test_1',
  '/test4',
  '/1111',
  'page312425509.html', // Tilda test pages
  'page307382109.html',
];

export const TEST_UTM_VALUES: readonly string[] = [
  'metrika_test',
  'goals_check',
  'claude_check',
  'test_claude',
  'qa',
];

/** True when the page URL matches a known test-page fragment or a file:// sandbox URL. */
export function isTestPage(page: string): boolean {
  const url = page.trim().toLowerCase();
  if (url.startsWith('file:')) return true;
  return TEST_PAGE_PATTERNS.some((p) => url.includes(p.toLowerCase()));
}

/** True when any UTM field equals (case-insensitive) a known test UTM value. */
export function isTestUtm(
  utmSource?: string | null,
  utmMedium?: string | null,
  utmCampaign?: string | null,
): boolean {
  const values = [utmSource, utmMedium, utmCampaign]
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim().toLowerCase());
  return values.some((v) => (TEST_UTM_VALUES as readonly string[]).includes(v));
}

/** True when the channel row's UTM triplet marks a test session. */
export function isTestChannelRow(row: {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
}): boolean {
  return isTestUtm(row.utmSource, row.utmMedium, row.utmCampaign);
}

/** Drop test rows unless the analyst turned «Показать тестовый трафик» on. */
export function applyTestTrafficFilter<T>(
  rows: readonly T[],
  includeTest: boolean,
  isTest: (row: T) => boolean,
): T[] {
  if (includeTest) return [...rows];
  return rows.filter((r) => !isTest(r));
}
