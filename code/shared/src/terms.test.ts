import { describe, it, expect } from 'vitest';
import { FUNNEL_TERMS, TERMS, orderGoalHint, term, termHint } from './terms';

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

describe('orderGoalHint (ANA-167)', () => {
  it('explains «Заказ»: definition + goal_reaches + period dates + not-a-paid-ticket (ru)', () => {
    const hint = orderGoalHint('ru', { from: '2025-01-01', to: '2025-01-07' });
    expect(hint).toContain('Заказ — ');
    expect(hint).toContain('Считается: сумма goal_reaches за период, с 2025-01-01 до 2025-01-07');
    expect(hint).toContain('Заказ ≠ платный билет');
  });

  it('explains the order goal in English without Cyrillic', () => {
    const hint = orderGoalHint('en', { from: '2025-01-01', to: '2025-01-07' });
    expect(hint).toContain('goal_reaches');
    expect(hint).toContain('2025-01-01');
    expect(hint).toContain('not a paid ticket');
    expect(hint).not.toMatch(/[А-Яа-яЁё]/);
  });

  it('keeps the «how it is counted» part but omits dates when the period is unknown', () => {
    expect(orderGoalHint('ru')).toContain('Считается');
    expect(orderGoalHint('ru')).not.toMatch(/с \d{4}-\d{2}-\d{2}/);
    expect(orderGoalHint('ru', { from: '2025-01-01' })).not.toMatch(/с \d{4}-\d{2}-\d{2}/);
    expect(orderGoalHint('ru', { to: '2025-01-07' })).not.toMatch(/с \d{4}-\d{2}-\d{2}/);
  });
});
