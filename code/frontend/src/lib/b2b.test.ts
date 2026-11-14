import { describe, it, expect } from 'vitest';
import type { B2bDeal } from '@pca/shared';
import { pipelineSummary, B2B_STAGES } from './b2b';

function deal(over: Partial<B2bDeal>): B2bDeal {
  return { id: 1, company: 'Acme', tickets: 10, stage: 'lead', dateAdded: '2025-01-01', ...over };
}

describe('pipelineSummary', () => {
  it('counts deals and tickets per stage with totals', () => {
    const s = pipelineSummary([
      deal({ id: 1, stage: 'lead', tickets: 5 }),
      deal({ id: 2, stage: 'paid', tickets: 20 }),
      deal({ id: 3, stage: 'paid', tickets: 15 }),
    ]);
    expect(s.totalTickets).toBe(40);
    expect(s.paidTickets).toBe(35);
    expect(s.byStage.find((x) => x.stage === 'paid')).toEqual({
      stage: 'paid',
      deals: 2,
      tickets: 35,
      amountRub: null,
    });
    expect(s.byStage.find((x) => x.stage === 'negotiation')).toEqual({
      stage: 'negotiation',
      deals: 0,
      tickets: 0,
      amountRub: null,
    });
  });

  it('reports zero paid tickets when there are no paid deals', () => {
    expect(pipelineSummary([deal({ stage: 'lead' })]).paidTickets).toBe(0);
    expect(B2B_STAGES).toHaveLength(4);
  });

  // ANA-164: kanban column headers show the ₽ sum per stage; a stage where no deal carries
  // an amount reports null (not 0) so the UI can hide the counter instead of inventing «0 ₽».
  it('ANA-164: sums deal amounts per stage — null when no deal carries an amount', () => {
    const s = pipelineSummary([
      deal({ id: 1, stage: 'lead', amountRub: 100000 }),
      deal({ id: 2, stage: 'lead' }),
      deal({ id: 3, stage: 'paid', amountRub: 250000 }),
      deal({ id: 4, stage: 'paid', amountRub: 50000 }),
    ]);
    expect(s.byStage.find((x) => x.stage === 'lead')?.amountRub).toBe(100000);
    expect(s.byStage.find((x) => x.stage === 'paid')?.amountRub).toBe(300000);
    expect(s.byStage.find((x) => x.stage === 'negotiation')?.amountRub).toBeNull();
  });

  // ANA-164 round 2 (review): clearing an amount PATCHes `amountRub: null` and the state
  // round-trip can hand a deal back with null — a stage of such deals must report null (the
  // UI hides the ₽ counter), never an invented 0 ₽ (anti-hallucination: absence ≠ zero).
  it('ANA-164: a stage whose deals all carry amountRub: null reports null, not 0', () => {
    const s = pipelineSummary([
      deal({ id: 1, stage: 'paid', amountRub: null as unknown as number }),
    ]);
    expect(s.byStage.find((x) => x.stage === 'paid')?.amountRub).toBeNull();
    expect(s.byStage.find((x) => x.stage === 'paid')?.tickets).toBe(10);
  });

  it('ANA-164: mixed null and defined amounts sum only the defined ones', () => {
    const s = pipelineSummary([
      deal({ id: 1, stage: 'lead', amountRub: null as unknown as number }),
      deal({ id: 2, stage: 'lead', amountRub: 70000 }),
    ]);
    expect(s.byStage.find((x) => x.stage === 'lead')?.amountRub).toBe(70000);
  });
});
