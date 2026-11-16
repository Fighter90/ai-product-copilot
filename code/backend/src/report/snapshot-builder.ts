import { paidAndGap, resolveKpiTarget, formatGoalLabel, type ReportSnapshot } from '@pca/shared';
import type { MetricsRepo } from '../db/repositories/metrics-repo';
import type { HypothesesRepo } from '../db/repositories/hypotheses-repo';
import type { DecisionsRepo } from '../db/repositories/decisions-repo';
import type { B2bRepo } from '../db/repositories/b2b-repo';
import type { MarketingRepo } from '../db/repositories/marketing-repo';
import { topUtm, topGeoDevice, topPages } from './breakdowns';
import { buildMarketingSummary } from './marketing-summary';
import { resolvePrimaryGoal } from '../metrika/primary-goal';

export interface SnapshotBuilderDeps {
  readonly metrics: MetricsRepo;
  readonly hypotheses: HypothesesRepo;
  readonly decisions: DecisionsRepo;
  readonly b2b: B2bRepo;
  /** ANA-165: the Marketing page's weekly grid — aggregated into snapshot.marketing. */
  readonly marketing?: Pick<MarketingRepo, 'list'>;
  /** Raw «Цель по оплатам» setting (runtime KPI_TARGET); normalised, defaults to 300. */
  readonly kpiTarget?: () => number | string;
  /** Admin-pinned KPI goal (runtime GOAL_ID; 0 = auto-detect) — same goal the sync used. */
  readonly primaryGoalId?: () => number;
  /**
   * REG-03 (ANA-92): Σ paid B2C tickets for the report period (b2c_payments). «Оплачено/Осталось»
   * counts confirmed money only; absent (legacy single-user mode) → 0.
   */
  readonly b2cPaid?: (range: { from: string; to: string }) => number;
}

export interface BuildOptions {
  readonly id: string;
  readonly generatedAt: string;
  readonly from: string;
  readonly to: string;
}

export interface B2bSummary {
  readonly totalTickets: number;
  readonly paidTickets: number;
  readonly dealsCount: number;
  readonly deals: Array<{ company: string; tickets: number; stage: string }>;
  readonly byStage: Array<{ stage: string; tickets: number; deals: number }>;
}

function computeB2bSummary(b2b: ReturnType<B2bRepo['list']>): B2bSummary {
  const totalTickets = b2b.reduce((a, d) => a + d.tickets, 0);
  const paidTickets = b2b.filter((d) => d.stage === 'paid').reduce((a, d) => a + d.tickets, 0);
  const byStageMap = new Map<string, { tickets: number; deals: number }>();
  for (const d of b2b) {
    const cur = byStageMap.get(d.stage) ?? { tickets: 0, deals: 0 };
    byStageMap.set(d.stage, { tickets: cur.tickets + d.tickets, deals: cur.deals + 1 });
  }
  const byStage = [...byStageMap.entries()].map(([stage, v]) => ({
    stage,
    tickets: v.tickets,
    deals: v.deals,
  }));
  return {
    totalTickets,
    paidTickets,
    dealsCount: b2b.length,
    deals: b2b.map((d) => ({ company: d.company, tickets: d.tickets, stage: d.stage })),
    byStage,
  };
}

/**
 * Assembles an immutable ReportSnapshot purely from the cached DB — no live API calls,
 * no Date.now() (id + generatedAt are inputs), so the same data + inputs yield the same snapshot.
 */
export class SnapshotBuilder {
  constructor(private readonly deps: SnapshotBuilderDeps) {}

  build(opts: BuildOptions): ReportSnapshot {
    const range = { from: opts.from, to: opts.to };
    const channels = this.deps.metrics.listChannelStats(range);
    const utmStats = this.deps.metrics.listUtmStats(range);
    const geoDeviceStats = this.deps.metrics.listGeoDeviceStats(range);
    const pageStats = this.deps.metrics.listPageStats(range);
    const exitPageStats = this.deps.metrics.listExitPageStats(range);
    // ANA-129: light drafts (status draft) are not full hypotheses yet — they stay out of
    // reports and ICE prioritisation until they are taken into work.
    const all = this.deps.hypotheses.list().filter((h) => h.status !== 'draft');
    const decisions = this.deps.decisions.list();
    const b2b = this.deps.b2b.list();

    const b2cApplications = channels.reduce((acc, c) => acc + c.goalReaches, 0);
    // REG-04 (ANA-93): how far back the cached data reaches (null while nothing is synced).
    const coverage = this.deps.metrics.statsCoverage();
    const b2bPaidTickets = b2b
      .filter((d) => d.stage === 'paid')
      .reduce((acc, d) => acc + d.tickets, 0);
    const b2bSummary = computeB2bSummary(b2b);

    // Compute funnel: visits → reaches → B2B pipeline → B2B paid
    const totalVisits = channels.reduce((a, c) => a + c.visits, 0);
    const b2bPipelineTickets = b2b
      .filter((d) => d.stage !== 'paid')
      .reduce((a, d) => a + d.tickets, 0);

    // Label for the primary goal's reaches — «Заказов» for a purchase goal, else «Заявок B2C».
    const goalLabel = formatGoalLabel(
      resolvePrimaryGoal(this.deps.metrics.listGoals(true), this.deps.primaryGoalId?.()),
    );
    // REG-03 (ANA-92), инвариант «заявка ≠ оплата»: единая семантика «Оплачено/Осталось» — тот же
    // helper paidAndGap, что на Обзоре и /app/kpi. В оплату входят ТОЛЬКО подтверждённые деньги:
    // B2C-платежи за период (b2c_payments) + B2B-paid. Заказы Метрики (b2cApplications) —
    // отдельная метрика «заявки/заказы» и в оплату не входят, какой бы ни был тип цели.
    const b2cPaidTickets = this.deps.b2cPaid?.(range) ?? 0;
    const target = resolveKpiTarget(this.deps.kpiTarget?.());
    const { gap } = paidAndGap({
      target,
      b2cPaidTickets,
      b2bPaidTickets,
    });

    // ANA-165: the Marketing page's weekly grid rides in the snapshot (real, non-demo cells
    // whose campaign week intersects the period) so DOCX/PDF and the AI analysis can use it.
    const marketingSummary = this.deps.marketing
      ? buildMarketingSummary(this.deps.marketing.list(), range)
      : undefined;

    return {
      id: opts.id,
      generatedAt: opts.generatedAt,
      period: { from: opts.from, to: opts.to },
      // REG-04 (ANA-93): cached-data coverage rides in the snapshot, so DOCX/PDF/screen can
      // say «Покрытие данных: …» when the period starts before the first synced day.
      ...(coverage ? { coverage } : {}),
      kpi: {
        target,
        b2cApplications,
        b2bPaidTickets,
        gap,
        // ANA-193: exact paid B2C rides in the snapshot, so History's plan→fact meta is
        // exact (not the credited target−gap header) and overshoots are not capped.
        b2cPaidTickets,
      },
      // The cache array is shared+frozen (ANA-154) — the snapshot gets its own copy so the
      // stored payload stays mutable-typed and independent of the cache's identity.
      channels: [...channels],
      hypotheses: {
        problems: all.filter((h) => h.kind === 'problem'),
        solutions: all.filter((h) => h.kind === 'solution'),
      },
      decisions,
      b2bSummary,
      funnel: {
        visits: totalVisits,
        b2cApplications,
        b2bPipelineTickets,
        b2bPaidTickets,
      },
      breakdowns: {
        utm: topUtm(utmStats),
        geoDevice: topGeoDevice(geoDeviceStats),
        entryPages: topPages(pageStats),
        exitPages: topPages(exitPageStats),
      },
      ...(marketingSummary ? { marketing: marketingSummary } : {}),
      goalLabel,
    };
  }
}
