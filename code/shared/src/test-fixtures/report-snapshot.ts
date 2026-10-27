/**
 * Rich report snapshot used by locale tests (ANA-42): touches every section branch — channels with
 * best/worst CR, B2B deals, demo hypotheses with evidence, decisions, AI hypotheses/decisions, AI
 * narrative, all breakdowns and high-bounce entry pages. Test-only; not exported from the index.
 */
import type { Decision } from '../types/decisions';
import type { Hypothesis } from '../types/hypotheses';
import type { ReportSnapshot } from '../types/report';
import type { ChannelStat } from '../types/metrics';

function channel(date: string, name: string, visits: number, goalReaches: number): ChannelStat {
  return {
    date,
    channel: name,
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    visits,
    users: visits,
    bounceRate: 0.3,
    avgDuration: 60,
    goalReaches,
    conversionRate: visits > 0 ? goalReaches / visits : 0,
  };
}

function hypothesis(over: Partial<Hypothesis>): Hypothesis {
  return {
    id: 1,
    diamondPhase: 'define',
    kind: 'problem',
    subject: 'слушатель',
    action: 'не покупает',
    solution: 'билет',
    condition: 'нет лендинга',
    title: 'Гипотеза',
    description: 'описание',
    hiddenAssumptions: [
      { category: 'behavior', text: 'готов платить' },
      { category: 'market', text: 'есть спрос' },
      { category: 'tech', text: 'оплата работает' },
    ],
    validationMethods: [
      { type: 'live', plan: 'A/B', cost: 'средняя' },
      { type: 'quantitative', plan: 'воронка' },
      { type: 'synthetic', plan: 'опрос' },
      { type: 'market', plan: 'конкуренты' },
    ],
    impact: 8,
    confidence: 6,
    ease: 7,
    impactRationale: 'ri',
    confidenceRationale: 'rc',
    easeRationale: 're',
    iceScore: 336,
    greenCriteria: 'g',
    yellowCriteria: 'y',
    redCriteria: 'r',
    deadlineDays: 5,
    deadlineAt: '2999-01-01T00:00:00.000Z',
    status: 'draft',
    evidence: [
      { type: 'metrika', rawResponseId: 7, slice: 'tg', note: 'n' },
      { type: 'interview' },
    ],
    createdAt: 'c',
    updatedAt: 'u',
    ...over,
  } as Hypothesis;
}

function decision(over: Partial<Decision>): Decision {
  return {
    id: 1,
    number: 'DL-001',
    hypothesisId: 1,
    date: '2025-01-10',
    method: 'mixed',
    scope: '5 интервью',
    periodDays: 5,
    findings: [{ text: 'находка', confidence: 'high' }],
    evidence: [
      { quote: 'q', source: 's', rawResponseId: 42 },
      { quote: 'q2', source: 's2' },
    ],
    outcome: 'yellow',
    outcomeRationale: 'ro',
    nextStep: 'онлайн-оплата',
    responsible: 'Сергей',
    nextDeadline: '2025-02-01',
    decidedBy: 'team',
    participants: 'Лиза',
    createdAt: 'c',
    updatedAt: 'u',
    ...over,
  };
}

export const richSnapshot: ReportSnapshot = {
  id: 'snap-rich',
  generatedAt: '2025-01-08T10:00:00.000Z',
  period: { from: '2025-01-01', to: '2025-01-07' },
  kpi: { target: 300, b2cApplications: 75, b2bPaidTickets: 20, gap: 280 },
  goalLabel: { title: 'Заказов', isPaid: true, showApplicationsCaveat: false, showEstimate: false },
  channels: [
    channel('2025-01-01', 'tg', 600, 60),
    channel('2025-01-02', 'tg', 400, 10),
    channel('2025-01-01', 'ads', 900, 4),
    channel('2025-01-01', 'podcast', 100, 1),
    channel('2025-01-01', 'empty', 0, 0),
  ],
  hypotheses: {
    problems: [
      hypothesis({ id: 1, isDemo: true, status: 'green' }),
      hypothesis({
        id: 3,
        title: 'Пустая',
        hiddenAssumptions: [],
        validationMethods: [],
        evidence: [],
        description: undefined,
        status: 'expired',
        iceScore: 900,
      }),
    ],
    solutions: [
      hypothesis({
        id: 2,
        kind: 'solution',
        diamondPhase: 'develop',
        status: 'in_progress',
        iceScore: 120,
      }),
      hypothesis({
        id: 4,
        kind: 'solution',
        diamondPhase: 'develop',
        status: 'red',
        iceScore: 500,
      }),
      hypothesis({ id: 5, kind: 'solution', diamondPhase: 'develop', status: 'yellow' }),
    ],
  },
  decisions: [
    decision({ isDemo: true }),
    decision({
      id: 2,
      number: 'DL-002',
      hypothesisId: 99,
      findings: [],
      responsible: undefined,
      nextDeadline: undefined,
      participants: undefined,
      outcome: 'green',
    }),
  ],
  b2bSummary: {
    totalTickets: 30,
    paidTickets: 20,
    dealsCount: 2,
    deals: [
      { company: 'BigCorp', tickets: 20, stage: 'paid' },
      { company: 'Small', tickets: 10, stage: 'lead' },
    ],
    byStage: [
      { stage: 'paid', tickets: 20, deals: 1 },
      { stage: 'lead', tickets: 10, deals: 1 },
    ],
  },
  funnel: { visits: 2000, b2cApplications: 75, b2bPipelineTickets: 10, b2bPaidTickets: 20 },
  breakdowns: {
    utm: [{ source: 'tg', medium: 'social', campaign: 'c|1', visits: 500, goalReaches: 50 }],
    geoDevice: [
      { country: 'Россия', device: 'desktop', visits: 800, goalReaches: 40 },
      { country: 'Россия', device: 'mobile', visits: 400, goalReaches: 10 },
      { country: 'Казахстан', device: 'mobile', visits: 100, goalReaches: 1 },
    ],
    entryPages: [
      { page: '/', visits: 900, bounceRate: 0.8, goalReaches: 10 },
      { page: '/tickets', visits: 100, bounceRate: 0.2, goalReaches: 20 },
    ],
    exitPages: [{ page: '/pay', visits: 300, bounceRate: 0.1, goalReaches: 30 }],
  },
  aiNarrative: '## Итог\n🔴 1. Рост\n<strong>важно</strong>\n---\nхвост без заголовка',
  generatedHypotheses: {
    problems: [
      {
        id: 'P01',
        segment: 'мобильный пользователь',
        trouble: 'не находит кнопку',
        action: 'покупке',
        barrier: 'скрыта',
        evidence: '7 заявок',
      },
    ],
    solutions: [
      {
        id: 'S01',
        problemId: 'P01',
        action: 'вынесем кнопку',
        userBenefit: 'быстрее',
        businessResult: 'рост CR',
        successCriteria: 'CR +10%',
        risks: [
          { kind: 'value', note: 'v' },
          { kind: 'usability', note: 'u' },
          { kind: 'feasibility', note: 'f' },
          { kind: 'business', note: 'b' },
          { kind: 'legal', note: 'l' },
        ],
        validation: {
          whatToVerify: 'ценность',
          methods: ['A/B', 'интервью'],
          audience: 'моб',
          channel: 'tg',
          successCriteria: '≥10%',
        },
        ice: {
          impact: 8,
          confidence: 6,
          ease: 7,
          impactRationale: 'i',
          confidenceRationale: 'c',
          easeRationale: 'e',
          score: 336,
        },
        trafficLight: { green: 'g', yellow: 'y', red: 'r' },
        deadline: '2025-02-01',
      },
    ],
  },
  generatedDecisions: {
    decisions: [
      {
        id: 'DL01',
        hypothesisId: 'S01',
        method: 'A/B',
        periodDays: 7,
        scope: 'моб',
        findings: 'рост',
        confidence: 'medium',
        evidence: '7 заявок',
        source: 'snap',
        outcome: 'green',
        outcomeRationale: 'ok',
      },
    ],
  },
};
