import { describe, it, expect } from 'vitest';
import { paidAndGap } from './kpi';

/**
 * REG-03 (ANA-92), инвариант «заявка ≠ оплата»: paidAndGap считает ТОЛЬКО подтверждённые
 * деньги (B2C-платежи + B2B-paid). Заказы/заявки Метрики в оплату не входят — для этого
 * во входе просто нет соответствующего поля.
 */
describe('paidAndGap (REG-03 — только подтверждённые деньги)', () => {
  it('paid = B2C paid + B2B paid; gap = target − paid', () => {
    expect(paidAndGap({ target: 300, b2cPaidTickets: 12, b2bPaidTickets: 20 })).toEqual({
      paid: 32,
      gap: 268,
    });
  });

  it('no money → paid 0, gap = target', () => {
    expect(paidAndGap({ target: 300, b2cPaidTickets: 0, b2bPaidTickets: 0 })).toEqual({
      paid: 0,
      gap: 300,
    });
  });

  it('clamps gap at 0 when paid exceeds the target', () => {
    expect(paidAndGap({ target: 300, b2cPaidTickets: 40, b2bPaidTickets: 280 })).toEqual({
      paid: 320,
      gap: 0,
    });
  });

  it('guards against negative inputs (clamped to 0, not subtracted)', () => {
    expect(paidAndGap({ target: 300, b2cPaidTickets: -5, b2bPaidTickets: 20 })).toEqual({
      paid: 20,
      gap: 280,
    });
  });
});
