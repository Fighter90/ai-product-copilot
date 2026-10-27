/**
 * Deterministic report content derived purely from a {@link ReportSnapshot}. DOCX, PDF and the
 * on-screen preview all render from this single source — so the report is reproducible (no
 * Date.now, no live data, no LLM in the render path) and identical across formats.
 *
 * The output is intentionally verbose: every hypothesis is rendered in full (hypothesis statement,
 * all hidden assumptions by category, every validation method, the ICE breakdown with each
 * rationale, the traffic-light thresholds, deadline and status), plus a prioritization section and
 * an expanded Decision Log. With a populated dataset this yields a detailed multi-page document.
 *
 * Locale (ANA-42): every template sentence comes from {@link REPORT_TEXT}; `locale: 'ru'` (the
 * default) is byte-identical to the pre-i18n report — the ГОСТ verifier and the RU tests depend
 * on it. Data values (channel names, hypothesis texts, AI narrative) are printed as stored.
 */
import type { Hypothesis } from './types/hypotheses';
import type { Decision } from './types/decisions';
import type { ReportSnapshot, ReportChartId } from './types/report';
import { aiGenerationLabel } from './types/report';
import { iceBucket } from './validation';
import type { ReportLocale } from './report-locale';
import { REPORT_TEXT } from './report-sections-text';
import { buildReportRecommendations } from './report-recommendations';
import { chartRecommendation, reportChartTitles } from './report-charts';
import {
  channelTotals,
  demoTag,
  pct,
  priorityLine,
  hypothesisStatement,
  reportLabels,
  aiHypothesisSections,
  aiDecisionSections,
} from './report-section-helpers';

export interface ReportSection {
  readonly heading: string;
  readonly lines: string[];
  /** When set and snapshot.charts has this id, renderers embed the chart PNG at the top of the section. */
  readonly chartId?: ReportChartId;
  /** ГОСТ-style figure caption rendered under the embedded chart («Рисунок N — …»). */
  readonly caption?: string;
}

// ---------------------------------------------------------------------------
// Markdown-table helpers. The DOCX/PDF builders parse `| a | b |` lines: a table
// needs a header row + a separator row, and the separator MUST start with `|---`
// (no space) so the renderers filter it out instead of printing a row of dashes.
// Cell text must never contain a raw `|` — everything goes through {@link cell}.
// ---------------------------------------------------------------------------

/** Make a string safe for a table cell: no raw pipes (they would split the row). */
function cell(value: string): string {
  return value.replace(/\|/g, '/');
}

/** One markdown-table data row: `| a | b |`. */
function row(...cells: string[]): string {
  return `| ${cells.map((c) => cell(c)).join(' | ')} |`;
}

/** Table header row + separator row (exactly two lines). */
function tableHeader(...headers: string[]): string[] {
  return [row(...headers), `|${headers.map(() => '---').join('|')}|`];
}

/** Percentage with one decimal, «—» when there is no denominator (never a fake 0.0%). */
function pctOrDash(numerator: number, denominator: number): string {
  return denominator > 0 ? `${((numerator / denominator) * 100).toFixed(1)}%` : '—';
}

/** Percentage number without the «%» sign (the unit lives in the column header), one decimal. */
function pctNum(numerator: number, denominator: number): string {
  return denominator > 0 ? ((numerator / denominator) * 100).toFixed(1) : '—';
}

/** Strip a leading self-number («1. », «2) ») — the builder adds ГОСТ through-numbering itself. */
function stripOrdinalPrefix(heading: string): string {
  return heading.replace(/^\d+[.)]\s+/, '');
}

/** Per-chart 🟢/🔴 interpretation block (FINAL §6.3), appended below each chart's section. */
function chartBlock(s: ReportSnapshot, id: ReportChartId, locale: ReportLocale): string[] {
  const T = REPORT_TEXT[locale];
  const rec = chartRecommendation(s, id, locale);
  return [
    '',
    T.chartInterpretation(reportChartTitles(locale)[id]),
    T.good,
    ...rec.good.map((g) => `  • ${g}`),
    T.bad,
    ...rec.bad.map((b) => `  • ${b}`),
  ];
}

/** Parse markdown-style chunked AI narrative into report sections.
 * Ensures NO truncation: all text including trailing lines without headings is preserved. */
function parseChunkedNarrative(narrative: string, locale: ReportLocale): ReportSection[] {
  const T = REPORT_TEXT[locale];
  const sections: ReportSection[] = [];
  const lines = narrative.split('\n');
  let currentHeading = '';
  const currentLines: string[] = [];

  const flush = (fallbackHeading?: string): void => {
    const heading = currentHeading ? sanitizeAiLine(currentHeading) : fallbackHeading;
    if (!heading) return;
    const body = applyAiLineLimit(currentLines.map(sanitizeAiLine).filter((l) => l.trim() !== ''));
    sections.push({ heading, lines: body });
    currentLines.length = 0;
  };

  for (const line of lines) {
    const headingMatch = line.match(/^## (.+)$/);
    if (headingMatch && headingMatch[1]) {
      flush();
      currentHeading = headingMatch[1];
    } else if (line.startsWith('---')) {
      flush();
      currentHeading = '';
    } else {
      currentLines.push(line);
    }
  }
  // Push any remaining content; trailing text without a heading gets a generic heading.
  if (currentHeading) {
    flush();
  } else if (currentLines.length > 0) {
    flush(T.aiTrailingHeading);
  }
  return sections;
}

/** A full per-hypothesis section: every hypothesis field spelled out for the report reader. */
function hypothesisDetail(h: Hypothesis, locale: ReportLocale): ReportSection {
  const T = REPORT_TEXT[locale];
  const L = reportLabels(locale);
  const phase = h.diamondPhase === 'define' ? T.phaseDefine : T.phaseDevelop;
  const lines: string[] = [
    T.statement(hypothesisStatement(h, locale)),
    T.typeLine(L.kind[h.kind], phase, L.status[h.status]),
  ];
  if (h.isDemo) {
    lines.push(T.hypothesisDemo);
  }
  if (h.description) lines.push(T.description(h.description));

  lines.push(
    '',
    T.icePriority(h.impact, h.confidence, h.ease, h.iceScore, L.bucket[iceBucket(h.iceScore)]),
    `  • Impact ${h.impact}/10 — ${h.impactRationale}`,
    `  • Confidence ${h.confidence}/10 — ${h.confidenceRationale}`,
    `  • Ease ${h.ease}/10 — ${h.easeRationale}`,
  );

  lines.push('', T.hiddenAssumptions(h.hiddenAssumptions.length));
  if (h.hiddenAssumptions.length === 0) {
    lines.push(T.noneRecorded);
  } else {
    for (const a of h.hiddenAssumptions) {
      lines.push(`  • [${L.category[a.category]}] ${a.text}`);
    }
  }

  lines.push('', T.validationMethods(h.validationMethods.length));
  if (h.validationMethods.length === 0) {
    lines.push(T.noneRecorded);
  } else {
    for (const m of h.validationMethods) {
      const cost = m.cost ? T.cost(m.cost) : '';
      lines.push(`  • ${L.method[m.type]}: ${m.plan}${cost}`);
    }
  }

  lines.push(
    '',
    T.trafficLight,
    T.green(h.greenCriteria),
    T.yellow(h.yellowCriteria),
    T.red(h.redCriteria),
    T.deadline(h.deadlineDays, h.deadlineAt),
  );

  if (h.evidence && h.evidence.length > 0) {
    lines.push('', T.evidenceIntro);
    for (const e of h.evidence) {
      const ref = e.rawResponseId !== undefined ? ` [raw_response_id ${e.rawResponseId}]` : '';
      const slice = e.slice ? T.slice(e.slice) : '';
      const note = e.note ? ` — ${e.note}` : '';
      lines.push(`  • ${e.type}${ref}${slice}${note}`);
    }
  }

  // No leading ordinal — the builder adds ГОСТ through-numbering (D-DOUBLE-NUM). The
  // «(гипотеза)» suffix distinguishes data-driven cards from AI narrative sections.
  return { heading: `${demoTag(h, locale)}${T.hypothesisHeading(h.title)}`, lines };
}

/** An expanded Decision Log entry: findings, evidence quotes, rationale and next step. */
function decisionDetail(d: Decision, locale: ReportLocale): ReportSection {
  const T = REPORT_TEXT[locale];
  const lines: string[] = [
    T.decisionLine(d.hypothesisId, d.method, d.periodDays, d.outcome.toUpperCase()),
    T.scope(d.scope),
    T.outcomeRationale(d.outcomeRationale),
  ];
  if (d.isDemo) {
    lines.push(T.decisionDemo);
  }
  lines.push('', T.findings(d.findings.length));
  if (d.findings.length === 0) {
    lines.push(T.noneRecorded);
  } else {
    for (const f of d.findings) lines.push(T.finding(f.confidence, f.text));
  }
  lines.push('', T.evidence(d.evidence.length));
  for (const e of d.evidence) {
    const ref = e.rawResponseId !== undefined ? ` [raw_response_id ${e.rawResponseId}]` : '';
    lines.push(`  • «${e.quote}» — ${e.source}${ref}`);
  }
  lines.push('', T.nextStep(d.nextStep));
  if (d.responsible) lines.push(T.responsible(d.responsible));
  if (d.nextDeadline) lines.push(T.nextDeadline(d.nextDeadline));
  lines.push(T.decidedBy(d.decidedBy, d.participants));
  return { heading: `${demoTag(d, locale)}${T.decisionHeading(d.number)}`, lines };
}

/** «ОБОЗНАЧЕНИЯ, ТЕРМИНЫ И СОКРАЩЕНИЯ» — только сокращения; принципы методологии живут в
 * «Глоссарии и принципах», здесь их намеренно не дублируем. */
function designationsSection(locale: ReportLocale): ReportSection {
  const T = REPORT_TEXT[locale];
  return {
    heading: T.designationsHeading,
    lines: [
      ...tableHeader(...T.termHeader),
      ...T.terms.map(([term, meaning]) => row(term, meaning)),
    ],
  };
}

/** «ВВЕДЕНИЕ» — назначение, источники, период, состав, ключевые оговорки. */
function introductionSection(s: ReportSnapshot, locale: ReportLocale): ReportSection {
  const T = REPORT_TEXT[locale];
  return {
    heading: T.introductionHeading,
    lines: [
      T.introPurpose,
      T.introSources,
      T.introPeriod(s.period.from, s.period.to, s.id, s.generatedAt),
      T.introContents,
      T.introCaveat,
      T.introAntiHallucination,
    ],
  };
}

/** «УПРАВЛЕНЧЕСКОЕ РЕЗЮМЕ» — 6–10 выводов, каждый выведен из цифр снапшота (никаких внешних чисел). */
function executiveSummarySection(s: ReportSnapshot, locale: ReportLocale): ReportSection {
  const T = REPORT_TEXT[locale];
  const problems = s.hypotheses.problems;
  const solutions = s.hypotheses.solutions;
  const visits = s.funnel.visits;
  const credited = s.kpi.target - s.kpi.gap;
  const lines: string[] = [];

  lines.push(T.exTarget(s.kpi.target, credited, pctNum(credited, s.kpi.target), s.kpi.gap));
  lines.push(
    T.exFunnel(
      visits,
      s.funnel.b2cApplications,
      pctOrDash(s.funnel.b2cApplications, visits),
      s.kpi.b2bPaidTickets,
    ),
  );

  // Best / worst channel by CR among channels with visits — everything derived from snapshot rows.
  const withCr = channelTotals(s.channels)
    .filter((t) => t.visits > 0)
    .map((t) => ({ ...t, cr: t.goalReaches / t.visits }))
    .sort((a, b) => b.cr - a.cr);
  const best = withCr[0];
  const worst = withCr.length > 1 ? withCr[withCr.length - 1] : undefined;

  if (best) {
    lines.push(T.exBest(best.channel, pctNum(best.goalReaches, best.visits), best.visits));
  }
  if (worst && worst.channel !== best?.channel) {
    lines.push(T.exWorst(worst.channel, pctNum(worst.goalReaches, worst.visits), worst.visits));
  }

  if (visits > 0) {
    const bounceVisits = s.channels.reduce((a, c) => a + c.bounceRate * c.visits, 0);
    lines.push(T.exBounce(pctNum(bounceVisits, visits)));
  }

  if (s.b2bSummary.dealsCount > 0) {
    lines.push(
      T.exB2b(
        s.b2bSummary.paidTickets,
        s.b2bSummary.totalTickets,
        s.b2bSummary.dealsCount,
        s.funnel.b2bPipelineTickets,
      ),
    );
  }

  // Main risk: positive gap, amplified by a high-volume channel converting below the overall CR.
  const overallCr = visits > 0 ? s.funnel.b2cApplications / visits : 0;
  const risky = withCr.filter((t) => t.cr < overallCr).sort((a, b) => b.visits - a.visits)[0];
  if (s.kpi.gap > 0) {
    lines.push(
      risky
        ? T.exRiskChannel(
            s.kpi.gap,
            risky.channel,
            risky.visits,
            pctNum(risky.goalReaches, risky.visits),
          )
        : T.exRisk(s.kpi.gap),
    );
  }

  lines.push(best ? T.exLever(best.channel) : T.exLeverNoData);
  lines.push(T.exHypotheses(problems.length, solutions.length, s.decisions.length));

  return { heading: T.executiveHeading, lines };
}

/** B2B summary section. */
function b2bSection(s: ReportSnapshot, locale: ReportLocale): ReportSection | null {
  const T = REPORT_TEXT[locale];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b2b = (s as any).b2bSummary as
    | {
        totalTickets: number;
        paidTickets: number;
        dealsCount: number;
        deals: Array<{ company: string; tickets: number; stage: string }>;
        byStage: Array<{ stage: string; tickets: number; deals: number }>;
      }
    | undefined;

  if (!b2b || b2b.dealsCount === 0) return null;

  const lines: string[] = [
    T.b2bTotal(b2b.totalTickets),
    T.b2bPaid(b2b.paidTickets),
    T.b2bDeals(b2b.dealsCount),
    '',
    T.b2bByStage,
  ];
  for (const stage of b2b.byStage) {
    lines.push(T.b2bStage(stage.stage, stage.tickets, stage.deals));
  }
  if (b2b.deals.length > 0) {
    lines.push('', T.b2bDealList);
    for (const d of b2b.deals) {
      lines.push(T.b2bDeal(d.company, d.tickets, d.stage));
    }
  }

  return { heading: T.b2bHeading, lines };
}

/** Funnel analysis section. */
function funnelSection(s: ReportSnapshot, locale: ReportLocale): ReportSection | null {
  const T = REPORT_TEXT[locale];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const funnel = (s as any).funnel as
    | {
        visits: number;
        b2cApplications: number;
        b2bPipelineTickets: number;
        b2bPaidTickets: number;
      }
    | undefined;

  if (!funnel) return null;

  const visitToAppCR =
    funnel.visits > 0 ? ((funnel.b2cApplications / funnel.visits) * 100).toFixed(1) : '0.0';

  const lines: string[] = [
    T.funnelStage1(funnel.visits),
    T.funnelStage2(funnel.b2cApplications, visitToAppCR),
    T.funnelStage3(funnel.b2bPipelineTickets),
    T.funnelStage4(funnel.b2bPaidTickets),
    '',
    T.funnelGap(s.kpi.target, s.kpi.gap),
    T.funnelCr(visitToAppCR),
  ];

  if (funnel.visits > 0 && funnel.b2cApplications > 0) {
    lines.push('');
    lines.push(T.funnelAnalysis);
    const lostVisits = funnel.visits - funnel.b2cApplications;
    lines.push(T.funnelLost(lostVisits, ((lostVisits / funnel.visits) * 100).toFixed(1)));
    if (funnel.b2bPipelineTickets > 0) {
      lines.push(T.funnelPipeline(funnel.b2bPipelineTickets));
    }
  }

  return { heading: T.funnelHeading, lines };
}

/** Detailed channel analysis section. */
function channelAnalysisSection(s: ReportSnapshot, locale: ReportLocale): ReportSection {
  const T = REPORT_TEXT[locale];
  const totals = channelTotals(s.channels);
  const totalVisits = totals.reduce((a, t) => a + t.visits, 0);

  const lines: string[] = [
    T.chTotal(totals.length),
    T.chVisits(totalVisits),
    T.chApps(s.kpi.b2cApplications),
    '',
    T.chDetail,
    '',
  ];

  for (let i = 0; i < totals.length; i++) {
    const t = totals[i];
    if (!t) continue;
    const cr = t.visits > 0 ? ((t.goalReaches / t.visits) * 100).toFixed(1) : '0.0';
    const share = totalVisits > 0 ? ((t.visits / totalVisits) * 100).toFixed(1) : '0.0';
    lines.push(`${i + 1}. ${t.channel}`);
    lines.push(T.chItemVisits(t.visits, share));
    lines.push(T.chItemApps(t.goalReaches));
    lines.push(T.chItemCr(cr));
    lines.push('');
  }

  // Highlight top and bottom performers
  if (totals.length > 0) {
    const bestCr = totals.reduce(
      (best, t) => {
        if (!t) return best;
        const cr = t.visits > 0 ? t.goalReaches / t.visits : 0;
        return cr > best.cr ? { channel: t.channel, cr } : best;
      },
      { channel: '', cr: 0 },
    );

    const worstCr = totals.reduce(
      (worst, t) => {
        if (!t || t.visits === 0) return worst;
        const cr = t.goalReaches / t.visits;
        return cr < worst.cr ? { channel: t.channel, cr } : worst;
      },
      { channel: totals[0]?.channel ?? '', cr: 1 },
    );

    lines.push(T.chConclusions);
    if (bestCr.channel) {
      lines.push(T.chBest(bestCr.channel, (bestCr.cr * 100).toFixed(1)));
    }
    if (worstCr.channel && worstCr.cr > 0) {
      lines.push(T.chWorst(worstCr.channel, (worstCr.cr * 100).toFixed(1)));
    }
  }

  lines.push('', T.chTop10, ...tableHeader(...T.chTableHeader));
  for (const t of totals.slice(0, 10)) {
    lines.push(
      row(t.channel, String(t.visits), String(t.goalReaches), pctNum(t.goalReaches, t.visits)),
    );
  }

  lines.push(...chartBlock(s, 'channelBar', locale));
  return {
    heading: T.channelsHeading,
    lines,
    chartId: 'channelBar',
    caption: T.channelsCaption,
  };
}

/**
 * Strip markdown/heading noise from a single AI-narrative line so no raw `##`/`####`/`***` or a
 * leading bullet-emoji heading leaks into DOCX/PDF. `**bold**` is left intact — the DOCX/HTML
 * renderers convert it. The AI prompt also forbids these markers (defence in depth).
 */
/** Leading emoji (pictographs, dingbats) + variation selector / ZWJ at the very start of a line.
 * Alternation (not a combined character class) to satisfy no-misleading-character-class. */
const LEADING_EMOJI_RE =
  /^(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]|\u{FE0F}|\u{200D})+\s*/u;
/** Leading self-numbering the AI sometimes prefixes to headings («1.», «2)», «Шаг 1.», «Раздел 1.»). */
const LEADING_NUM_RE = /^(?:\d+[.)]|Шаг\s+\d+\.|Раздел\s+\d+\.)\s*/iu;

function sanitizeAiLine(line: string): string {
  // Strip markdown heading/blockquote markers, leading emoji, self-numbering and HTML tags so no raw
  // `##`/`####`/`>`/«🔴»/«1.»/`<strong>`/`<p>` leaks into the ГОСТ DOCX/PDF (D-EMOJI, D-DOUBLE-NUM,
  // and the HTML-tag leak). `<strong>/<b>` → `**`, `<em>/<i>` → `*` so the renderers keep emphasis;
  // any other tag (`<p>`,`<br>`,`<li>`…) is dropped. Markdown bullets («- »/«* ») are kept (renderers
  // make real lists); `**bold**` is preserved; emoji INSIDE a line (as an accent) are kept.
  return line
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/^\s*>\s?/, '')
    .replace(/<\s*\/?\s*(?:strong|b)\s*>/gi, '**')
    .replace(/<\s*\/?\s*(?:em|i)\s*>/gi, '*')
    .replace(/<[^>]*>/g, '')
    .replace(LEADING_EMOJI_RE, '')
    .replace(LEADING_NUM_RE, '')
    .trimEnd();
}

/** Cap an AI section's body so a single chunk can't dominate the report (D-VERBOSE). The cut is
 * silent — no «раздел сокращён…» note clutters the document; the full narrative stays in the snapshot. */
const AI_MAX_LINES_PER_SECTION = 35;

function applyAiLineLimit(lines: string[]): string[] {
  return lines.length <= AI_MAX_LINES_PER_SECTION
    ? lines
    : lines.slice(0, AI_MAX_LINES_PER_SECTION);
}

/**
 * Build the full ordered section list for a report snapshot. Each entry becomes an H1 + paragraphs in
 * DOCX/HTML and an accordion block on screen — so a populated snapshot renders as a long,
 * detailed report (cover → summary → methodology → prioritization → every hypothesis in full →
 * decision log → AI analysis → breakdowns → data appendix).
 *
 * Empty hypothesis sections are skipped entirely — they only appear when hypotheses exist.
 */
export function reportSections(s: ReportSnapshot, locale: ReportLocale = 'ru'): ReportSection[] {
  const T = REPORT_TEXT[locale];
  const L = reportLabels(locale);
  const problems = s.hypotheses.problems;
  const solutions = s.hypotheses.solutions;
  const allByPriority = [...problems, ...solutions].sort(
    (a, b) => b.iceScore - a.iceScore || a.id - b.id,
  );
  const hasHypotheses = allByPriority.length > 0;
  const hasAiHypotheses =
    (s.generatedHypotheses?.problems.length ?? 0) > 0 ||
    (s.generatedHypotheses?.solutions.length ?? 0) > 0;
  const totalVisits = s.channels.reduce((acc, c) => acc + c.visits, 0);

  const sections: ReportSection[] = [
    {
      heading: T.titleHeading,
      lines: [
        T.titlePeriod(s.period.from, s.period.to),
        T.titleSnapshot(s.id, s.generatedAt),
        T.titleKpi(s.kpi.target),
        T.titleDeterministic,
        T.titleTraceable,
      ],
    },
    designationsSection(locale),
    introductionSection(s, locale),
    executiveSummarySection(s, locale),
    {
      heading: T.summaryHeading,
      lines: [
        T.summaryGoal(T.goalTitle(s.goalLabel), s.kpi.b2cApplications),
        T.summaryPaid(s.kpi.b2bPaidTickets),
        T.summaryGap(s.kpi.gap),
        T.summaryVisits(totalVisits),
        '',
        ...T.summaryGapText,
        '',
        T.summaryHypotheses(problems.length, solutions.length),
        T.summaryDecisions(s.decisions.length),
        '',
        T.summaryKeyFigures,
        ...tableHeader(...T.kfHeader),
        row(T.kfTarget, String(s.kpi.target)),
        row(T.kfApps, String(s.kpi.b2cApplications)),
        row(T.kfPaid, String(s.kpi.b2bPaidTickets)),
        row(T.kfCredited, String(s.kpi.target - s.kpi.gap)),
        row(T.kfGap, String(s.kpi.gap)),
        row(T.kfCr, pctOrDash(s.kpi.b2cApplications, s.funnel.visits)),
        row(T.kfCrPaid, pctOrDash(s.kpi.b2bPaidTickets, s.funnel.visits)),
      ],
    },
    {
      heading: T.recHeading,
      lines: (() => {
        const rec = buildReportRecommendations(s, locale);
        return [
          T.recIntro,
          '',
          T.good,
          ...rec.good.map((g) => `  • ${g}`),
          '',
          T.bad,
          ...rec.bad.map((b) => `  • ${b}`),
        ];
      })(),
    },
    {
      heading: T.methodologyHeading,
      lines: [...T.methodology],
    },
  ];

  // Funnel section
  const funnelSec = funnelSection(s, locale);
  if (funnelSec) sections.push(funnelSec);

  // B2B section
  const b2bSec = b2bSection(s, locale);
  if (b2bSec) sections.push(b2bSec);

  // Detailed channel analysis
  sections.push(channelAnalysisSection(s, locale));

  sections.push({
    heading: T.funnel2Heading,
    chartId: 'funnel',
    caption: T.funnel2Caption,
    lines: [
      T.f2Visits(totalVisits),
      T.f2Apps(s.kpi.b2cApplications, pct(s.kpi.b2cApplications, totalVisits)),
      T.f2Paid(s.kpi.b2bPaidTickets),
      T.f2Gap(s.kpi.target, s.kpi.gap),
      '',
      ...T.f2Text,
      ...chartBlock(s, 'funnel', locale),
    ],
  });

  sections.push({
    heading: T.mixHeading,
    chartId: 'channelMix',
    caption: T.mixCaption,
    lines:
      channelTotals(s.channels).length === 0
        ? [T.mixEmpty]
        : [
            T.mixIntro,
            '',
            ...channelTotals(s.channels).map((t, i) =>
              T.mixLine(i + 1, t.channel, t.visits, t.goalReaches, pct(t.goalReaches, t.visits)),
            ),
            '',
            ...T.mixText,
            ...chartBlock(s, 'channelMix', locale),
          ],
  });

  // Hypothesis sections — only when hypotheses exist
  if (hasHypotheses) {
    sections.push({
      heading: T.prioHeading,
      lines: [
        T.prioIntro,
        '',
        ...tableHeader(...T.prioHeader),
        ...allByPriority.map((h) =>
          row(
            `${demoTag(h, locale)}${h.title}`,
            String(h.impact),
            String(h.confidence),
            String(h.ease),
            String(h.iceScore),
          ),
        ),
        '',
        T.prioDetail,
        '',
        ...allByPriority.map((h, i) => priorityLine(h, i + 1, locale)),
      ],
    });

    sections.push({
      heading: T.defineHeading,
      lines: [
        T.defineIntro(problems.length),
        ...problems.map(
          (h, i) => `  ${i + 1}) ${demoTag(h, locale)}${h.title} [ICE ${h.iceScore}]`,
        ),
      ],
    });
    sections.push(...problems.map((h) => hypothesisDetail(h, locale)));

    sections.push({
      heading: T.developHeading,
      lines: [
        T.developIntro(solutions.length),
        ...solutions.map(
          (h, i) => `  ${i + 1}) ${demoTag(h, locale)}${h.title} [ICE ${h.iceScore}]`,
        ),
      ],
    });
    sections.push(...solutions.map((h) => hypothesisDetail(h, locale)));
  }

  // AI-generated hypotheses — only when they exist
  if (hasAiHypotheses) {
    // Ordinals are stripped from card headings — the builder adds ГОСТ through-numbering.
    sections.push(
      ...aiHypothesisSections(s.generatedHypotheses, locale).map((sec) => ({
        ...sec,
        heading: stripOrdinalPrefix(sec.heading),
      })),
    );
  }

  // AI-proposed decisions — only when they exist (helper returns [] otherwise)
  sections.push(
    ...aiDecisionSections(s.generatedDecisions, locale).map((sec) => ({
      ...sec,
      heading: stripOrdinalPrefix(sec.heading),
    })),
  );

  // Decision Log — always show
  const hypothesisTitleById = new Map(
    [...problems, ...solutions].map((h) => [h.id, h.title] as const),
  );
  sections.push({
    heading: T.dlHeading,
    lines:
      s.decisions.length === 0
        ? [T.dlEmpty]
        : [
            T.dlIntro(s.decisions.length),
            '',
            ...tableHeader(...T.dlHeader),
            ...s.decisions.map((d) => {
              const title = hypothesisTitleById.get(d.hypothesisId);
              return row(
                d.number,
                title ? `#${d.hypothesisId} ${title}` : `#${d.hypothesisId}`,
                L.decisionOutcome[d.outcome],
                d.nextStep,
              );
            }),
          ],
  });
  sections.push(...s.decisions.map((d) => decisionDetail(d, locale)));

  // AI analysis (chunked narrative parsed into sections)
  if (s.aiNarrative) {
    const aiSections = parseChunkedNarrative(s.aiNarrative, locale);
    // ANA-33: «Сгенерировано: YandexGPT · yandexgpt/latest» + date — printed at the end of the
    // AI block in DOCX/PDF/on-screen report alike. Date is pre-formatted (dd.mm.yyyy, UTC) —
    // the shared document stays deterministic and locale-independent.
    const by = s.aiGeneratedBy?.insights;
    const attribution = by
      ? [
          '',
          `_${T.generatedByPrefix} ${aiGenerationLabel(by)} · ${by.at.slice(8, 10)}.${by.at.slice(5, 7)}.${by.at.slice(0, 4)}_`,
        ]
      : [];
    if (aiSections.length > 0) {
      // Push parsed sections directly — they already have proper headings from ## markers
      const last = aiSections[aiSections.length - 1]!;
      aiSections[aiSections.length - 1] = { ...last, lines: [...last.lines, ...attribution] };
      sections.push(...aiSections);
    } else {
      // Fallback: no ## headings found, use the generic localized AI-analysis heading
      sections.push({
        heading: T.aiFallbackHeading,
        lines: [...s.aiNarrative.split('\n').filter((l) => l.trim() !== ''), ...attribution],
      });
    }
  }

  // Breakdown sections as markdown tables (rendered as real tables in DOCX/PDF/HTML).
  const geoBreakdown = (() => {
    if (s.breakdowns.geoDevice.length === 0) {
      return { heading: T.geoHeading, lines: [T.geoEmpty] };
    }
    const totalGeo = s.breakdowns.geoDevice.reduce((a, g) => a + g.visits, 0);
    const byCountry = new Map<string, number>();
    const byDevice = new Map<string, number>();
    for (const g of s.breakdowns.geoDevice) {
      byCountry.set(g.country, (byCountry.get(g.country) ?? 0) + g.visits);
      byDevice.set(g.device, (byDevice.get(g.device) ?? 0) + g.visits);
    }
    const countries = [...byCountry.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    const devices = [...byDevice.entries()].sort((a, b) => b[1] - a[1]);
    return {
      heading: T.geoHeading,
      lines: [
        T.geoIntro,
        '',
        ...tableHeader(...T.geoHeader),
        ...countries.map(([country, geoVisits]) => row(country, String(geoVisits))),
        '',
        T.deviceIntro,
        '',
        ...tableHeader(...T.deviceHeader),
        ...devices.map(([device, deviceVisits]) =>
          row(device, String(deviceVisits), pctNum(deviceVisits, totalGeo)),
        ),
      ],
    };
  })();

  const pagesTable = (rows: ReportSnapshot['breakdowns']['entryPages'], empty: string): string[] =>
    rows.length === 0
      ? [empty]
      : [
          ...tableHeader(...T.pageHeader),
          ...rows.slice(0, 10).map((p) => row(p.page, String(p.visits))),
        ];

  sections.push(
    {
      heading: T.utmHeading,
      lines: s.breakdowns.utm.length
        ? [
            T.utmIntro,
            '',
            ...tableHeader(...T.utmHeader),
            ...s.breakdowns.utm.slice(0, 15).map((u) => row(u.source, u.medium, String(u.visits))),
          ]
        : [T.utmEmpty],
    },
    geoBreakdown,
    {
      heading: T.entryHeading,
      lines: pagesTable(s.breakdowns.entryPages, T.entryEmpty),
    },
    {
      heading: T.exitHeading,
      lines: pagesTable(s.breakdowns.exitPages, T.exitEmpty),
    },
    {
      heading: T.roadmapHeading,
      lines: !hasHypotheses
        ? [T.roadmapEmpty]
        : [
            T.roadmapIntro,
            '',
            ...allByPriority
              .slice(0, 3)
              .map((h, i) =>
                T.roadmapLine(
                  i + 1,
                  h.iceScore,
                  `${demoTag(h, locale)}${h.title}`,
                  h.greenCriteria,
                  h.deadlineDays,
                ),
              ),
            '',
            ...T.roadmapText,
          ],
    },
    {
      heading: T.glossaryHeading,
      lines: [...T.glossary],
    },
    {
      heading: T.appendixHeading,
      lines: [
        T.appendixChannels(channelTotals(s.channels).length),
        T.appendixRows(s.channels.length),
        '',
        T.appendixTotals,
        ...channelTotals(s.channels).map((t) =>
          T.appendixLine(t.channel, t.visits, t.goalReaches, pct(t.goalReaches, t.visits)),
        ),
        '',
        ...T.appendixText,
      ],
    },
  );

  // Drop sections whose only content is an empty-state placeholder («Нет данных…», «Завершённых
  // проверок пока нет», «Гипотезы не заведены…») — such heading-only sections are noise in the
  // DOCX/PDF/preview. A section survives only if it has at least one meaningful (non-placeholder) line.
  return sections.filter((sec) => {
    const meaningful = sec.lines.filter((l) => l.trim() !== '' && !T.emptyState.test(l.trim()));
    return meaningful.length > 0;
  });
}
