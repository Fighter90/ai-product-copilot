import type { B2bDeal, B2bStage } from '@pca/shared';

export const B2B_STAGES: readonly B2bStage[] = ['lead', 'negotiation', 'invoiced', 'paid'];

export interface StageSummary {
  readonly stage: B2bStage;
  readonly deals: number;
  readonly tickets: number;
  /**
   * ANA-164: Σ amount_rub over the stage's deals for the kanban column headers.
   * null when no deal in the stage carries an amount — the UI hides the counter instead of
   * showing an invented «0 ₽» (anti-hallucination: absence ≠ zero).
   */
  readonly amountRub: number | null;
}

export interface PipelineSummary {
  readonly byStage: StageSummary[];
  readonly totalTickets: number;
  readonly paidTickets: number;
}

/** Counts, ticket sums and ₽ sums per pipeline stage; paidTickets feeds the B2B part of the KPI. */
export function pipelineSummary(deals: B2bDeal[]): PipelineSummary {
  const byStage = B2B_STAGES.map((stage) => {
    const inStage = deals.filter((d) => d.stage === stage);
    // Round 2: a deal cleared via the inline editor can carry `amountRub: null` at runtime
    // (the PATCH round-trips it), so exclude everything that is not a number — null amounts
    // must not sneak `0` into the sum (anti-hallucination: absence ≠ zero).
    const amounts = inStage
      .map((d) => d.amountRub)
      .filter((a): a is number => typeof a === 'number');
    return {
      stage,
      deals: inStage.length,
      tickets: inStage.reduce((acc, d) => acc + d.tickets, 0),
      amountRub: amounts.length === 0 ? null : amounts.reduce((acc, a) => acc + a, 0),
    };
  });
  const totalTickets = deals.reduce((acc, d) => acc + d.tickets, 0);
  const paidTickets = deals
    .filter((d) => d.stage === 'paid')
    .reduce((acc, d) => acc + d.tickets, 0);
  return { byStage, totalTickets, paidTickets };
}
