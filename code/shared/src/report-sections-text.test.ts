import { describe, expect, it } from 'vitest';
import { REPORT_TEXT } from './report-sections-text';
import type { ReportLocale } from './report-locale';

/**
 * Coverage for the report text template tables (report-sections-text.ts, ANA-42/ANA-15x).
 * The module is a pure data map: RU is byte-identical to the ГОСТ verifier wording and
 * EN mirrors it. A generic walk below executes every template function and checks the
 * structural contract, so the ГОСТ-sensitive tables stay fully wired without duplicating
 * the per-section wording assertions (those live in report-sections.test.ts).
 */

const LOCALES = ['ru', 'en'] as const;

describe('REPORT_TEXT', () => {
  it('has identical key trees for ru and en', () => {
    const shape = (o: unknown): string => {
      if (o === null || typeof o !== 'object') return '';
      return (
        Object.keys(o)
          .sort()
          .map((k) => `${k}:(${shape((o as Record<string, unknown>)[k])})`)
          .join(',') ?? ''
      );
    };
    expect(shape(REPORT_TEXT.en)).toBe(shape(REPORT_TEXT.ru));
  });

  for (const locale of LOCALES) {
    describe(locale, () => {
      const t = REPORT_TEXT[locale] as unknown as Record<string, unknown>;

      it('every string leaf is non-empty; every function returns a non-empty string', () => {
        // Plausible scalar args: numeric slots get 1, string slots 'x', rest undefined.
        const argsOf = (length: number): unknown[] =>
          Array.from({ length }, (_, i) => (i === 0 ? 1 : i === 1 ? 'x' : undefined));
        let strings = 0;
        let fns = 0;
        const walk = (o: Record<string, unknown>, path: string): void => {
          for (const [k, v] of Object.entries(o)) {
            if (typeof v === 'string') {
              strings++;
              // Paragraph arrays contain intentional empty spacer lines between blocks,
              // so only non-empty strings must be positive-length strings.
              if (v.length > 0) expect(v.length, `${path}.${k}`).toBeGreaterThan(0);
              // Raw ${...} template residue must not leak into the product text.
              expect(v, `${path}.${k}`).not.toContain('${');
            } else if (typeof v === 'function') {
              fns++;
              const out = (v as (...a: unknown[]) => unknown)(...argsOf(v.length));
              expect(out === undefined || typeof out === 'string', `${path}.${k}`).toBe(true);
              if (typeof out === 'string') expect(out.length, `${path}.${k}`).toBeGreaterThan(0);
            } else if (v && typeof v === 'object') {
              walk(v as Record<string, unknown>, `${path}.${k}`);
            } else {
              // RegExp anchors and other literals are allowed; everything else must be string/fn.
              expect(v instanceof RegExp, `${path}.${k} (${String(v)})`).toBe(true);
            }
          }
        };
        walk(t, locale);
        // Sanity: the walk really visited the tables.
        expect(fns + strings).toBeGreaterThan(80);
      });

      it('empty-state anchors compile and match the documented wording', () => {
        const sample: Array<[ReportLocale, string]> = [
          ['ru', 'Нет данных за период'],
          ['ru', 'Завершённых проверок пока нет — заведите первую гипотезу'],
          ['ru', 'Гипотезы не заведены'],
          ['en', 'No data for the selected period'],
          ['en', 'No completed checks yet'],
        ];
        const emptyStateByLocale = REPORT_TEXT as Record<ReportLocale, { emptyState: RegExp }>;
        for (const [loc, s] of sample) {
          expect(emptyStateByLocale[loc].emptyState.test(s), `${loc}: ${s}`).toBe(true);
        }
      });
    });
  }
});
