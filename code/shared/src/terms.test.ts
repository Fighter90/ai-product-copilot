import { describe, it, expect } from 'vitest';
import { FUNNEL_TERMS, TERMS, term, termHint } from './terms';

describe('TERMS (ANA-19)', () => {
  it('defines every term in both locales with a label and a definition', () => {
    for (const [key, locales] of Object.entries(TERMS)) {
      for (const [locale, entry] of Object.entries(locales)) {
        expect(entry.label.length, `${key}/${locale} label`).toBeGreaterThan(0);
        expect(entry.definition.length, `${key}/${locale} definition`).toBeGreaterThan(0);
      }
    }
  });

  it('orders the main funnel as Визит → Заявка → Заказ → Оплата', () => {
    expect(FUNNEL_TERMS).toEqual(['visit', 'application', 'order', 'payment']);
    expect(FUNNEL_TERMS.map((k) => TERMS[k].ru.label)).toEqual([
      'Визит',
      'Заявка',
      'Заказ',
      'Оплата',
    ]);
  });

  it('keeps the key rule in the definitions: Метрика видит заказы, а не оплаты', () => {
    expect(TERMS.order.ru.definition).toContain('Оплату Метрика не видит');
    expect(TERMS.payment.ru.definition).toContain('внесённые вручную');
    expect(TERMS.paid.ru.definition).toContain('B2C');
    expect(TERMS.paid.ru.definition).toContain('B2B');
  });

  it('falls back to Russian for unknown locales and composes tooltip one-liners', () => {
    expect(term('visit', 'fr').label).toBe('Визит');
    expect(termHint('gap', 'en')).toBe(`${TERMS.gap.en.label} — ${TERMS.gap.en.definition}`);
    expect(termHint('order')).toContain(' — ');
  });

  it('documents the ANA-22 test-traffic and tilda-event terms', () => {
    expect(TERMS.testTraffic.ru.definition).toContain('env=test');
    expect(TERMS.tildaEvents.ru.definition).toContain('/tilda/*');
    expect(TERMS.demoData.ru.definition).toContain('pnpm seed');
  });
});
