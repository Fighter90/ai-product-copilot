/**
 * Pure formatting helpers and label maps used by {@link reportSections}.
 *
 * Extracted here to keep `report-sections.ts` under the 400-line file-size contract.
 * These are module-private utilities — they are NOT re-exported from `@pca/shared/index`.
 */
import type {
  AssumptionCategory,
  Hypothesis,
  HypothesisStatus,
  ValidationMethodType,
} from './types/hypotheses';
import type {
  GeoDeviceBreakdownRow,
  PageBreakdownRow,
  ReportSnapshot,
  UtmBreakdownRow,
} from './types/report';
import type {
  GeneratedHypotheses,
  ProblemHypothesis,
  SolutionHypothesis,
  SolutionRiskKind,
} from './types/generated-hypotheses';
import type { GeneratedDecisions, GeneratedDecisionOutcome } from './types/generated-decisions';
import { iceBucket, type IceBucket } from './validation';
import type { ReportLocale } from './report-locale';

export const CATEGORY_LABEL: Record<AssumptionCategory, string> = {
  behavior: 'Поведение',
  market: 'Рынок',
  tech: 'Технологии',
};

export const METHOD_LABEL: Record<ValidationMethodType, string> = {
  synthetic: 'Синтетический CustDev',
  live: 'Живой тест',
  quantitative: 'Количественный анализ',
  market: 'Рыночное исследование',
};

export const STATUS_LABEL: Record<HypothesisStatus, string> = {
  draft: 'черновик',
  in_progress: 'в работе',
  green: '🟢 подтверждена',
  yellow: '🟡 частично подтверждена',
  red: '🔴 опровергнута',
  expired: '⏳ просрочена',
};

export const BUCKET_LABEL: Record<IceBucket, string> = {
  low: 'низкий',
  medium: 'средний',
  high: 'высокий',
  top: 'топ-приоритет',
};

export const KIND_LABEL = { problem: 'проблема', solution: 'решение' } as const;

/** Label maps for one report locale (ANA-42). RU maps are the historical exports above. */
export interface ReportLabels {
  readonly category: Record<AssumptionCategory, string>;
  readonly method: Record<ValidationMethodType, string>;
  readonly status: Record<HypothesisStatus, string>;
  readonly bucket: Record<IceBucket, string>;
  readonly kind: Record<'problem' | 'solution', string>;
  readonly riskKind: Record<SolutionRiskKind, string>;
  readonly decisionOutcome: Record<GeneratedDecisionOutcome, string>;
}

const EN_LABELS: ReportLabels = {
  category: { behavior: 'Behaviour', market: 'Market', tech: 'Technology' },
  method: {
    synthetic: 'Synthetic CustDev',
    live: 'Live test',
    quantitative: 'Quantitative analysis',
    market: 'Market research',
  },
  status: {
    draft: 'draft',
    in_progress: 'in progress',
    green: '🟢 confirmed',
    yellow: '🟡 partially confirmed',
    red: '🔴 rejected',
    expired: '⏳ expired',
  },
  bucket: { low: 'low', medium: 'medium', high: 'high', top: 'top priority' },
  kind: { problem: 'problem', solution: 'solution' },
  riskKind: {
    value: 'Value',
    usability: 'Usability',
    feasibility: 'Feasibility',
    business: 'Business',
    legal: 'Legal / reputational',
  },
  decisionOutcome: { green: '🟢 continue', yellow: '🟡 iterate', red: '🔴 drop' },
};

/** Label maps for the requested report locale. */
export function reportLabels(locale: ReportLocale = 'ru'): ReportLabels {
  if (locale === 'en') return EN_LABELS;
  return {
    category: CATEGORY_LABEL,
    method: METHOD_LABEL,
    status: STATUS_LABEL,
    bucket: BUCKET_LABEL,
    kind: KIND_LABEL,
    riskKind: RISK_KIND_LABEL,
    decisionOutcome: DECISION_OUTCOME_LABEL,
  };
}

/**
 * ANA-187: true when the stored condition text already opens with its own joiner («если»/«if»).
 * Composing the statement with a template joiner on top produced «…, if если конверсия…» —
 * the EN joiner duplicating the Russian word inside the data (and vice versa in the RU report).
 * Case-insensitive, first word only.
 */
export function conditionStartsWithJoiner(condition: string): boolean {
  // NB: \b is Latin-only in JS regex (Cyrillic letters are not \w), so the boundary after the
  // joiner word is a Unicode-aware negative lookahead instead — otherwise «если» never matches.
  return /^\s*(?:если|if)(?![\p{L}\p{N}_])/iu.test(condition);
}

/** Full hypothesis statement: «{subject} {action} {solution}, если {condition}». */
export function hypothesisStatement(h: Hypothesis, locale: ReportLocale = 'ru'): string {
  if (locale === 'en') {
    // The joiner follows the template language — but never stacks onto a condition that
    // already opens with one (ANA-187): «…, if если …» → «…, если …».
    const joiner = conditionStartsWithJoiner(h.condition) ? ', ' : ', if ';
    return `“${h.subject} ${h.action} ${h.solution}${joiner}${h.condition}”`;
  }
  const joiner = conditionStartsWithJoiner(h.condition) ? ', ' : ', если ';
  return `«${h.subject} ${h.action} ${h.solution}${joiner}${h.condition}»`;
}

export function utmLine(u: UtmBreakdownRow): string {
  const cr = u.visits > 0 ? ((u.goalReaches / u.visits) * 100).toFixed(1) : '0.0';
  return `${u.source} / ${u.medium} / ${u.campaign}: визитов ${u.visits}, заявок ${u.goalReaches} (CR ${cr}%)`;
}

export function geoLine(g: GeoDeviceBreakdownRow): string {
  const cr = g.visits > 0 ? ((g.goalReaches / g.visits) * 100).toFixed(1) : '0.0';
  return `${g.country} · ${g.device}: визитов ${g.visits}, заявок ${g.goalReaches} (CR ${cr}%)`;
}

export function pageLine(p: PageBreakdownRow): string {
  return `${p.page}: визитов ${p.visits}, отказы ${(p.bounceRate * 100).toFixed(1)}%, заявок ${p.goalReaches}`;
}

export function pct(numerator: number, denominator: number): string {
  return denominator > 0 ? `${((numerator / denominator) * 100).toFixed(1)}%` : '0.0%';
}

export interface ChannelTotal {
  channel: string;
  visits: number;
  goalReaches: number;
}

/** Aggregate the per-date channel rows into per-channel totals, busiest first. */
export function channelTotals(channels: ReportSnapshot['channels']): ChannelTotal[] {
  const map = new Map<string, ChannelTotal>();
  for (const c of channels) {
    const cur = map.get(c.channel) ?? { channel: c.channel, visits: 0, goalReaches: 0 };
    cur.visits += c.visits;
    cur.goalReaches += c.goalReaches;
    map.set(c.channel, cur);
  }
  return [...map.values()].sort(
    (a, b) => b.visits - a.visits || a.channel.localeCompare(b.channel),
  );
}

/** «[ДЕМО] » badge for seeded demo rows (ANA-18) — empty for real data. */
export function demoTag(x: { isDemo?: boolean }, locale: ReportLocale = 'ru'): string {
  if (!x.isDemo) return '';
  return locale === 'en' ? '[DEMO] ' : '[ДЕМО] ';
}

/** One-line ICE summary used in the prioritization table. */
export function priorityLine(h: Hypothesis, rank: number, locale: ReportLocale = 'ru'): string {
  const L = reportLabels(locale);
  const bucket = L.bucket[iceBucket(h.iceScore)];
  const stmt = hypothesisStatement(h, locale);
  if (locale === 'en') {
    return `${rank}. [ICE ${h.iceScore} · ${bucket}]${h.isDemo ? ' [DEMO]' : ''} ${L.kind[h.kind]}: ${stmt} — status: ${L.status[h.status]}, deadline ${h.deadlineAt}`;
  }
  return `${rank}. [ICE ${h.iceScore} · ${bucket}]${h.isDemo ? ' [ДЕМО]' : ''} ${L.kind[h.kind]}: ${stmt} — статус: ${L.status[h.status]}, дедлайн ${h.deadlineAt}`;
}

// ---------------------------------------------------------------------------
// AI-generated hypotheses (generatedHypotheses in ReportSnapshot)
// ---------------------------------------------------------------------------

/** Shared section type — mirrors ReportSection from report-sections.ts (no circular import). */
export interface AiReportSection {
  readonly heading: string;
  readonly lines: string[];
}

/** Russian labels for the five mandatory solution risk dimensions. */
export const RISK_KIND_LABEL: Record<SolutionRiskKind, string> = {
  value: 'Ценность',
  usability: 'Удобство',
  feasibility: 'Технический',
  business: 'Бизнес',
  legal: 'Юридический-репутационный',
};

/** Template text of the AI-hypothesis / AI-decision blocks, per report locale. */
const AI_TEXT = {
  ru: {
    ifThen: (s: SolutionHypothesis) =>
      `Если ${s.action}, то ${s.userBenefit}, что приведёт к ${s.businessResult}`,
    priorityHeading: 'Приоритизация AI-гипотез (по ICE)',
    priorityEmpty: 'AI-гипотезы ещё не сгенерированы.',
    priorityIntro: 'AI-решенческие гипотезы, отсортированы по убыванию ICE:',
    problemLine: (p: ProblemHypothesis) =>
      `${p.segment} испытывает ${p.trouble} при ${p.action}, потому что ${p.barrier}`,
    evidence: 'Обоснование (данные)',
    successCriteria: 'Критерий успеха',
    linkedProblem: 'Связана с проблемой',
    risks: 'Риски:',
    plan: 'План проверки:',
    whatToVerify: 'Что проверяем',
    methods: 'Методы',
    audience: 'Аудитория',
    channel: 'Канал',
    trafficLight: 'Светофор:',
    deadline: 'Дедлайн проверки',
    problemsHeading: 'Проблемные гипотезы (AI)',
    problemsEmpty: 'Проблемные AI-гипотезы не сгенерированы.',
    problemsIntro: (n: number) =>
      `Сгенерировано ${n} проблемных гипотез. Полная карточка каждой — ниже.`,
    solutionsHeading: 'Решенческие гипотезы (AI)',
    solutionsEmpty: 'Решенческие AI-гипотезы не сгенерированы.',
    solutionsIntro: (n: number) =>
      `Сгенерировано ${n} решенческих гипотез. Полная карточка каждой — ниже.`,
    solutionOverview: (s: SolutionHypothesis) => `Если ${s.action}, то ${s.userBenefit}`,
    decisionsHeading: 'Decision Log (предполагаемые решения, AI)',
    decisionsIntro: (n: number) => `AI предложил ${n} решений на основе данных среза и гипотез.`,
    decisionsNote: 'Это черновики для обсуждения командой, а не зафиксированные решения.',
    decisionHeading: (i: number, id: string, h: string) => `${i}. ${id} → гипотеза ${h}`,
    outcome: 'Исход',
    method: (m: string, days: number, scope: string) =>
      `Метод: ${m} · период: ${days} дн. · объём: ${scope}`,
    finding: (c: string, f: string) => `Вывод (уверенность: ${c}): ${f}`,
    source: 'Источник',
  },
  en: {
    ifThen: (s: SolutionHypothesis) =>
      `If ${s.action}, then ${s.userBenefit}, which leads to ${s.businessResult}`,
    priorityHeading: 'AI hypotheses prioritisation (by ICE)',
    priorityEmpty: 'AI hypotheses have not been generated yet.',
    priorityIntro: 'AI solution hypotheses, sorted by ICE descending:',
    problemLine: (p: ProblemHypothesis) =>
      `${p.segment} experiences ${p.trouble} when ${p.action}, because ${p.barrier}`,
    evidence: 'Rationale (data)',
    successCriteria: 'Success criterion',
    linkedProblem: 'Linked problem',
    risks: 'Risks:',
    plan: 'Validation plan:',
    whatToVerify: 'What we verify',
    methods: 'Methods',
    audience: 'Audience',
    channel: 'Channel',
    trafficLight: 'Traffic light:',
    deadline: 'Validation deadline',
    problemsHeading: 'Problem hypotheses (AI)',
    problemsEmpty: 'No AI problem hypotheses generated.',
    problemsIntro: (n: number) => `${n} problem hypotheses generated. Full card for each below.`,
    solutionsHeading: 'Solution hypotheses (AI)',
    solutionsEmpty: 'No AI solution hypotheses generated.',
    solutionsIntro: (n: number) => `${n} solution hypotheses generated. Full card for each below.`,
    solutionOverview: (s: SolutionHypothesis) => `If ${s.action}, then ${s.userBenefit}`,
    decisionsHeading: 'Decision Log (proposed decisions, AI)',
    decisionsIntro: (n: number) =>
      `AI proposed ${n} decisions based on the data snapshot and hypotheses.`,
    decisionsNote: 'These are drafts for team discussion, not recorded decisions.',
    decisionHeading: (i: number, id: string, h: string) => `${i}. ${id} → hypothesis ${h}`,
    outcome: 'Outcome',
    method: (m: string, days: number, scope: string) =>
      `Method: ${m} · period: ${days} d · scope: ${scope}`,
    finding: (c: string, f: string) => `Finding (confidence: ${c}): ${f}`,
    source: 'Source',
  },
} as const satisfies Record<ReportLocale, unknown>;

/**
 * Prioritisation overview section for AI-generated solutions, sorted by ICE score descending.
 * One line per solution: «[ICE {score}] {id}: Если {action}, то {userBenefit}, что приведёт к {businessResult}».
 */
export function aiSolutionPrioritySection(
  solutions: readonly SolutionHypothesis[],
  locale: ReportLocale = 'ru',
): AiReportSection {
  const T = AI_TEXT[locale];
  const sorted = [...solutions].sort((a, b) => b.ice.score - a.ice.score);
  return {
    heading: T.priorityHeading,
    lines:
      sorted.length === 0
        ? [T.priorityEmpty]
        : [
            T.priorityIntro,
            '',
            ...sorted.map((s) => `[ICE ${s.ice.score}] ${s.id}: ${T.ifThen(s)}`),
          ],
  };
}

/** Full per-problem section for an AI-generated problem hypothesis. */
export function aiProblemSection(
  p: ProblemHypothesis,
  ordinal: number,
  locale: ReportLocale = 'ru',
): AiReportSection {
  const T = AI_TEXT[locale];
  return {
    heading: `${ordinal}. ${p.id}`,
    lines: [T.problemLine(p), `${T.evidence}: ${p.evidence}`],
  };
}

/** Full per-solution section for an AI-generated solution hypothesis. */
export function aiSolutionSection(
  s: SolutionHypothesis,
  ordinal: number,
  locale: ReportLocale = 'ru',
): AiReportSection {
  const T = AI_TEXT[locale];
  const risk = reportLabels(locale).riskKind;
  const lines: string[] = [
    T.ifThen(s),
    `${T.successCriteria}: ${s.successCriteria}`,
    `${T.linkedProblem}: ${s.problemId}`,
    '',
    T.risks,
    ...s.risks.map((r) => `  • ${risk[r.kind]}: ${r.note}`),
    '',
    T.plan,
    `  ${T.whatToVerify}: ${s.validation.whatToVerify}`,
    `  ${T.methods}: ${s.validation.methods.join(', ')}`,
    `  ${T.audience}: ${s.validation.audience}`,
    `  ${T.channel}: ${s.validation.channel}`,
    `  ${T.successCriteria}: ${s.validation.successCriteria}`,
    '',
    'ICE:',
    `  Impact ${s.ice.impact}/10 — ${s.ice.impactRationale}`,
    `  Confidence ${s.ice.confidence}/10 — ${s.ice.confidenceRationale}`,
    `  Ease ${s.ice.ease}/10 — ${s.ice.easeRationale}`,
    `  Score: ${s.ice.impact} × ${s.ice.confidence} × ${s.ice.ease} = ${s.ice.score}`,
    '',
    T.trafficLight,
    `  🟢 ${s.trafficLight.green}`,
    `  🟡 ${s.trafficLight.yellow}`,
    `  🔴 ${s.trafficLight.red}`,
    `${T.deadline}: ${s.deadline}`,
  ];
  return { heading: `${ordinal}. ${s.id}`, lines };
}

/**
 * Build all AI-hypothesis sections from a GeneratedHypotheses value.
 * Returns an empty array when the value is absent or has no entries.
 * Insertion order: priority overview → problem sections → solution sections (sorted by ICE desc).
 */
export function aiHypothesisSections(
  gh: GeneratedHypotheses | undefined,
  locale: ReportLocale = 'ru',
): AiReportSection[] {
  if (!gh || (gh.problems.length === 0 && gh.solutions.length === 0)) return [];
  const T = AI_TEXT[locale];

  const sortedSolutions = [...gh.solutions].sort((a, b) => b.ice.score - a.ice.score);

  return [
    aiSolutionPrioritySection(gh.solutions, locale),
    {
      heading: T.problemsHeading,
      lines:
        gh.problems.length === 0
          ? [T.problemsEmpty]
          : [
              T.problemsIntro(gh.problems.length),
              ...gh.problems.map((p, i) => `  ${i + 1}) ${p.id}: ${p.segment} — ${p.trouble}`),
            ],
    },
    ...gh.problems.map((p, i) => aiProblemSection(p, i + 1, locale)),
    {
      heading: T.solutionsHeading,
      lines:
        sortedSolutions.length === 0
          ? [T.solutionsEmpty]
          : [
              T.solutionsIntro(sortedSolutions.length),
              ...sortedSolutions.map(
                (s, i) => `  ${i + 1}) ${s.id} [ICE ${s.ice.score}]: ${T.solutionOverview(s)}`,
              ),
            ],
    },
    ...sortedSolutions.map((s, i) => aiSolutionSection(s, i + 1, locale)),
  ];
}

/** Russian traffic-light label for a proposed decision outcome. */
export const DECISION_OUTCOME_LABEL: Record<GeneratedDecisionOutcome, string> = {
  green: '🟢 продолжать',
  yellow: '🟡 доработать',
  red: '🔴 отказаться',
};

/**
 * AI-proposed Decision Log section (generatedDecisions). Empty array when none were generated, so
 * the report simply omits the block. Each decision spells out method, period, finding and outcome.
 */
export function aiDecisionSections(
  gd: GeneratedDecisions | undefined,
  locale: ReportLocale = 'ru',
): AiReportSection[] {
  if (!gd || gd.decisions.length === 0) return [];
  const T = AI_TEXT[locale];
  const outcome = reportLabels(locale).decisionOutcome;
  return [
    {
      heading: T.decisionsHeading,
      lines: [T.decisionsIntro(gd.decisions.length), T.decisionsNote],
    },
    ...gd.decisions.map((d, i) => ({
      heading: T.decisionHeading(i + 1, d.id, d.hypothesisId),
      lines: [
        `${T.outcome}: ${outcome[d.outcome]} — ${d.outcomeRationale}`,
        T.method(d.method, d.periodDays, d.scope),
        T.finding(d.confidence, d.findings),
        `${T.evidence}: ${d.evidence}`,
        `${T.source}: ${d.source}`,
      ],
    })),
  ];
}
