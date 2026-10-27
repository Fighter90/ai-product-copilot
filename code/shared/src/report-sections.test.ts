import { describe, it, expect } from 'vitest';
import type {
  Decision,
  Hypothesis,
  HypothesisStatus,
  ProblemHypothesis,
  ReportSnapshot,
  SolutionHypothesis,
} from './index';
import { reportSections } from './index';
import { aiHypothesisSections, aiDecisionSections } from './report-section-helpers';

const genProblem = (over: Partial<ProblemHypothesis> = {}): ProblemHypothesis => ({
  id: 'P01',
  segment: 'мобильный пользователь',
  trouble: 'не находит кнопку оплаты',
  action: 'покупке билета',
  barrier: 'кнопка скрыта под футером',
  evidence: '7 заявок B2C при 100 визитах',
  ...over,
});

const genSolution = (over: Partial<SolutionHypothesis> = {}): SolutionHypothesis => ({
  id: 'S01',
  problemId: 'P01',
  action: 'вынесем кнопку оплаты в первый экран',
  userBenefit: 'быстрее находить оплату',
  businessResult: 'рост конверсии B2C',
  successCriteria: 'CR +10%',
  risks: [
    { kind: 'value', note: 'может не повлиять' },
    { kind: 'usability', note: 'перегрузим экран' },
    { kind: 'feasibility', note: 'правка вёрстки' },
    { kind: 'business', note: 'низкий риск' },
    { kind: 'legal', note: 'нет' },
  ],
  validation: {
    whatToVerify: 'ценность',
    methods: ['A/B-тест', 'интервью'],
    audience: 'мобильные посетители',
    channel: 'tg',
    successCriteria: '≥10% рост CR',
  },
  ice: {
    impact: 8,
    confidence: 6,
    ease: 7,
    impactRationale: 'высокий трафик',
    confidenceRationale: 'есть данные',
    easeRationale: 'простая правка',
    score: 336,
  },
  trafficLight: { green: 'CR +10%', yellow: 'CR +3–10%', red: 'CR <3%' },
  deadline: '2025-02-01',
  ...over,
});

const hyp = (over: Partial<Hypothesis>): Hypothesis => ({
  id: 1,
  diamondPhase: 'define',
  kind: 'problem',
  subject: 'слушатель',
  action: 'не покупает',
  solution: 'билет',
  condition: 'нет лендинга',
  title: 'Гипотеза',
  hiddenAssumptions: [
    { category: 'behavior', text: 'готов платить' },
    { category: 'market', text: 'есть спрос' },
    { category: 'tech', text: 'оплата работает' },
  ],
  validationMethods: [
    { type: 'live', plan: 'A/B', cost: 'средняя' },
    { type: 'quantitative', plan: 'воронка' },
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
  createdAt: 'c',
  updatedAt: 'u',
  ...over,
});

const decision = (over: Partial<Decision> = {}): Decision => ({
  id: 1,
  number: 'DL-001',
  hypothesisId: 1,
  date: '2025-01-10',
  method: 'mixed',
  scope: '5 интервью',
  periodDays: 5,
  findings: [{ text: 'находка', confidence: 'high' }],
  evidence: [{ quote: 'q', source: 's', rawResponseId: 42 }],
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
});

const baseSnapshot: ReportSnapshot = {
  id: 'snap-1',
  generatedAt: 'T',
  period: { from: '2025-01-01', to: '2025-01-07' },
  kpi: { target: 300, b2cApplications: 7, b2bPaidTickets: 20, gap: 280 },
  channels: [
    {
      date: '2025-01-02',
      channel: 'podcast',
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      visits: 100,
      users: 90,
      bounceRate: 0.2,
      avgDuration: 60,
      goalReaches: 7,
      conversionRate: 0.07,
    },
  ],
  hypotheses: {
    problems: [hyp({ kind: 'problem' })],
    solutions: [hyp({ id: 2, kind: 'solution' })],
  },
  decisions: [decision()],
  b2bSummary: {
    totalTickets: 20,
    paidTickets: 20,
    dealsCount: 1,
    deals: [{ company: 'BigCorp', tickets: 20, stage: 'paid' }],
    byStage: [{ stage: 'paid', tickets: 20, deals: 1 }],
  },
  funnel: { visits: 100, b2cApplications: 7, b2bPipelineTickets: 0, b2bPaidTickets: 20 },
  breakdowns: { utm: [], geoDevice: [], entryPages: [], exitPages: [] },
};

function findSection(s: ReportSnapshot, predicate: (h: string) => boolean): string[] {
  return reportSections(s).find((sec) => predicate(sec.heading))?.lines ?? [];
}

describe('reportSections — structure', () => {
  it('produces cover, designations, introduction, summary, methodology, prioritization, overviews and appendix', () => {
    const headings = reportSections(baseSnapshot).map((s) => s.heading);
    expect(headings).toContain('ProductCamp · Конверсии и лидген');
    expect(headings).toContain('ОБОЗНАЧЕНИЯ, ТЕРМИНЫ И СОКРАЩЕНИЯ');
    expect(headings).toContain('ВВЕДЕНИЕ');
    expect(headings).toContain('УПРАВЛЕНЧЕСКОЕ РЕЗЮМЕ');
    // New sections sit right after the cover and before «Краткие итоги».
    const order = reportSections(baseSnapshot).map((s) => s.heading);
    expect(order.indexOf('ОБОЗНАЧЕНИЯ, ТЕРМИНЫ И СОКРАЩЕНИЯ')).toBe(1);
    expect(order.indexOf('ВВЕДЕНИЕ')).toBe(2);
    expect(order.indexOf('УПРАВЛЕНЧЕСКОЕ РЕЗЮМЕ')).toBe(3);
    expect(order.indexOf('Краткие итоги')).toBe(4);
    expect(headings).toContain('Методология');
    expect(headings).toContain('Приоритизация гипотез (по ICE)');
    expect(headings).toContain('Define — проблемные гипотезы (обзор)');
    expect(headings).toContain('Develop — решенческие гипотезы (обзор)');
    expect(headings).toContain('Deliver — Decision Log (обзор)');
    expect(headings).toContain('Приложение с данными');
  });

  it('renders the designations table (term → expansion, no methodology duplication)', () => {
    const text = findSection(baseSnapshot, (h) => h === 'ОБОЗНАЧЕНИЯ, ТЕРМИНЫ И СОКРАЩЕНИЯ').join(
      '\n',
    );
    expect(text).toContain('| Термин | Расшифровка |');
    for (const term of [
      'KPI',
      'CR',
      'UTM',
      'ICE',
      'DL',
      'B2B',
      'B2C',
      'DOCX',
      'PDF',
      'Gap',
      'WoW',
      'Snapshot',
      'pc-goals',
      'CRM (СРМ)',
    ]) {
      expect(text).toContain(`| ${term} | `);
    }
  });

  it('renders the introduction (purpose, sources, period, sections, заявка ≠ оплата, анти-галлюцинация)', () => {
    const text = findSection(baseSnapshot, (h) => h === 'ВВЕДЕНИЕ').join('\n');
    expect(text).toContain('Назначение:');
    expect(text).toContain('Reporting API');
    expect(text).toContain('счётчик ProductCamp');
    expect(text).toContain('Период отчёта: 2025-01-01 — 2025-01-07');
    expect(text).toContain('заявка ≠ оплата');
    expect(text).toContain('Анти-галлюцинация');
  });

  it('renders the executive summary strictly from snapshot facts', () => {
    const text = findSection(baseSnapshot, (h) => h === 'УПРАВЛЕНЧЕСКОЕ РЕЗЮМЕ').join('\n');
    expect(text).toContain(
      '- Цель периода — 300 оплаченных билетов; зачтено 20 (выполнение 6.7%), gap — 280.',
    );
    expect(text).toContain(
      '- Воронка: 100 визитов → 7 заявок B2C (CR 7.0%) → 20 оплаченных билетов B2B.',
    );
    expect(text).toContain('- Лучший канал по CR: podcast — 7.0% заявок с 100 визитов.');
    expect(text).toContain('- Отказы: 20.0% визитов');
    expect(text).toContain('- B2B-вклад: оплачено 20 из 20 билетов по 1 сделкам');
    expect(text).toContain('- Главный риск: gap 280');
    expect(text).toContain('- Главный рычаг: перераспределить бюджет в «podcast»');
    expect(text).toContain('- Гипотезы: 1 проблемных + 1 решенческих');
  });

  it('renders the KPI table in Краткие итоги (CR from funnel.visits)', () => {
    const text = findSection(baseSnapshot, (h) => h === 'Краткие итоги').join('\n');
    expect(text).toContain('| Показатель | Значение |');
    expect(text).toContain('| Цель периода (оплаченных билетов) | 300 |');
    expect(text).toContain('| Заявки B2C (достижения цели Метрики) | 7 |');
    expect(text).toContain('| Оплачено B2B (билетов) | 20 |');
    expect(text).toContain('| Зачтено к цели (оплаченные билеты) | 20 |');
    expect(text).toContain('| Gap до цели (билетов) | 280 |');
    expect(text).toContain('| CR общий (заявки / визиты) | 7.0% |'); // 7 / 100 funnel.visits
    expect(text).toContain('| CR оплаты (оплачено / визиты) | 20.0% |');
  });

  it('renders dashes (never fake 0.0%) when the funnel has no visits', () => {
    const s: ReportSnapshot = {
      ...baseSnapshot,
      funnel: { visits: 0, b2cApplications: 0, b2bPipelineTickets: 0, b2bPaidTickets: 0 },
    };
    const text = findSection(s, (h) => h === 'Краткие итоги').join('\n');
    expect(text).toContain('| CR общий (заявки / визиты) | — |');
    expect(text).toContain('| CR оплаты (оплачено / визиты) | — |');
  });

  it('appends the top-10 channel table to Каналы: трафик и конверсия', () => {
    const ch = baseSnapshot.channels[0]!;
    const s: ReportSnapshot = {
      ...baseSnapshot,
      channels: [
        { ...ch, channel: 'podcast', visits: 100, goalReaches: 5 },
        { ...ch, date: '2025-01-03', channel: 'podcast', visits: 100, goalReaches: 5 },
        { ...ch, channel: 'zeta', visits: 50, goalReaches: 1 },
      ],
    };
    const text = findSection(s, (h) => h === 'Каналы: трафик и конверсия').join('\n');
    expect(text).toContain('Детально (топ-10 по визитам):');
    expect(text).toContain('| Канал | Визиты | Заявки | CR % |');
    expect(text).toContain('| podcast | 200 | 10 | 5.0 |'); // aggregated across days
    expect(text).toContain('| zeta | 50 | 1 | 2.0 |');
  });

  it('adds GOST figure captions to the three chart sections, numbered in section order', () => {
    const withCharts = reportSections(baseSnapshot).filter((s) => s.chartId);
    expect(withCharts.map((s) => s.chartId)).toEqual(['channelBar', 'funnel', 'channelMix']);
    expect(withCharts.map((s) => s.caption)).toEqual([
      'Рисунок 1 — Воронка конверсии',
      'Рисунок 2 — Воронка: визит → заявка → оплата',
      'Рисунок 3 — Структура трафика по каналам',
    ]);
  });

  it('renders the Decision Log overview table (ID, hypothesis, outcome, next step)', () => {
    const text = findSection(baseSnapshot, (h) => h === 'Deliver — Decision Log (обзор)').join(
      '\n',
    );
    expect(text).toContain('| ID | Гипотеза | Статус | Решение |');
    expect(text).toContain('| DL-001 | #1 Гипотеза | 🟡 доработать | онлайн-оплата |');
  });

  it('escapes raw pipes in table cells so markdown tables stay parseable', () => {
    const s: ReportSnapshot = {
      ...baseSnapshot,
      hypotheses: { problems: [hyp({ title: 'a | b' })], solutions: [] },
      decisions: [decision({ number: 'DL-002', nextStep: 'шаг | два' })],
    };
    const prio = findSection(s, (h) => h.startsWith('Приоритизация')).join('\n');
    expect(prio).toContain('| a / b |'); // pipe replaced with a slash, row stays 5 cells
    const dl = findSection(s, (h) => h === 'Deliver — Decision Log (обзор)').join('\n');
    expect(dl).toContain('шаг / два');
  });

  it('is deterministic — same snapshot yields identical content', () => {
    expect(reportSections(baseSnapshot)).toEqual(reportSections(baseSnapshot));
  });

  it('renders methodology and ICE explanation', () => {
    const lines = findSection(baseSnapshot, (h) => h === 'Методология').join(' ');
    expect(lines).toContain('Double Diamond');
    expect(lines).toContain('Impact × Confidence × Ease');
  });

  it('orders prioritization by descending ICE (table rows sorted, top first)', () => {
    const s: ReportSnapshot = {
      ...baseSnapshot,
      hypotheses: {
        problems: [hyp({ id: 1, iceScore: 100, title: 'low' })],
        solutions: [hyp({ id: 2, kind: 'solution', iceScore: 800, title: 'top' })],
      },
    };
    const table = findSection(s, (h) => h.startsWith('Приоритизация')).filter((l) =>
      l.startsWith('| '),
    );
    expect(table).toHaveLength(3); // header + 2 data rows (separator row starts with |---)
    expect(table[1]).toContain('top');
    expect(table[1]).toContain('| 800 |');
    expect(table[2]).toContain('low');
    expect(table[2]).toContain('| 100 |');
  });

  it('renders the funnel with visit→application conversion (заявка ≠ оплата)', () => {
    const lines = findSection(baseSnapshot, (h) => h.startsWith('Воронка')).join('\n');
    expect(lines).toContain('Этап 1: Визиты — 100');
    expect(lines).toContain('Этап 2: Заявки B2C — 7');
    expect(lines).toContain('CR 7.0%');
    expect(lines).toContain('Оплачено B2B — 20 билетов');
    expect(lines).toContain('Gap до цели');
  });

  it('aggregates channels per name with CR in the channel-analysis section', () => {
    const ch = baseSnapshot.channels[0]!;
    const s: ReportSnapshot = {
      ...baseSnapshot,
      channels: [
        { ...ch, channel: 'podcast', visits: 100, goalReaches: 5 },
        { ...ch, date: '2025-01-03', channel: 'podcast', visits: 100, goalReaches: 5 },
        { ...ch, channel: 'zeta', visits: 50, goalReaches: 1 },
        { ...ch, channel: 'direct', visits: 50, goalReaches: 10 },
      ],
    };
    const lines = findSection(s, (h) => h === 'Каналы: структура трафика');
    expect(lines[2]).toContain('podcast: визитов 200, заявок 10 (CR 5.0%)'); // summed across days
    // direct and zeta tie on visits (50) → alphabetical tie-break puts direct before zeta
    expect(lines[3]).toContain('direct: визитов 50, заявок 10 (CR 20.0%)');
    expect(lines[4]).toContain('zeta: визитов 50');
  });

  it('lists the top-3 ICE roadmap and a glossary', () => {
    const roadmap = findSection(baseSnapshot, (h) => h.startsWith('Дорожная карта')).join('\n');
    expect(roadmap).toContain('цель:');
    expect(roadmap).toContain('дедлайн');
    const glossary = findSection(baseSnapshot, (h) => h.startsWith('Глоссарий')).join('\n');
    expect(glossary).toContain('Заявка');
    expect(glossary).toContain('ICE');
  });

  it('uses Russian terms: Срез данных, ИД среза, Краткие итоги, Приложение с данными', () => {
    const headings = reportSections(baseSnapshot).map((s) => s.heading);
    expect(headings).toContain('Краткие итоги');
    expect(headings).toContain('Приложение с данными');
    const cover = findSection(baseSnapshot, (h) => h === 'ProductCamp · Конверсии и лидген').join(
      '\n',
    );
    expect(cover).toContain('Срез данных:');
    expect(cover).toContain('ИД среза');
  });

  it('skips empty hypothesis sections entirely when no hypotheses exist', () => {
    const empty: ReportSnapshot = {
      ...baseSnapshot,
      hypotheses: { problems: [], solutions: [] },
      decisions: [],
      b2bSummary: { totalTickets: 0, paidTickets: 0, dealsCount: 0, deals: [], byStage: [] },
      funnel: { visits: 0, b2cApplications: 0, b2bPipelineTickets: 0, b2bPaidTickets: 0 },
    };
    const headings = reportSections(empty).map((s) => s.heading);
    // Empty hypothesis sections are SKIPPED (not rendered with placeholder)
    expect(headings).not.toContain('Приоритизация гипотез (по ICE)');
    expect(headings).not.toContain('Define — проблемные гипотезы (обзор)');
    expect(headings).not.toContain('Develop — решенческие гипотезы (обзор)');
    expect(headings).not.toContain('Проблемные гипотезы (AI)');
    expect(headings).not.toContain('Решенческие гипотезы (AI)');
  });
});

describe('reportSections — full hypothesis detail', () => {
  it('spells out hypothesis fields, ICE breakdown, assumptions, methods and traffic-light', () => {
    const lines = findSection(baseSnapshot, (h) => h === 'Гипотеза (гипотеза)').join('\n');
    expect(lines).toContain('«слушатель не покупает билет, если нет лендинга»');
    expect(lines).toContain('I × C × E = 8 × 6 × 7 = 336');
    expect(lines).toContain('[Поведение] готов платить');
    expect(lines).toContain('[Рынок] есть спрос');
    expect(lines).toContain('[Технологии] оплата работает');
    expect(lines).toContain('Живой тест: A/B (стоимость: средняя)');
    expect(lines).toContain('Количественный анализ: воронка');
    expect(lines).toContain('🟢 Зелёный — g');
    expect(lines).toContain('🔴 Красный — r');
  });

  it('renders description, evidence variants and develop phase label', () => {
    const h = hyp({
      diamondPhase: 'develop',
      kind: 'solution',
      description: 'описание',
      evidence: [
        { type: 'channel_stats', rawResponseId: 7, slice: 'podcast', note: 'низкий CR' },
        { type: 'manual' },
      ],
    });
    const lines = findSection(
      { ...baseSnapshot, hypotheses: { problems: [], solutions: [h] } },
      (x) => x.startsWith('Гипотеза'),
    ).join('\n');
    expect(lines).toContain('Описание: описание');
    expect(lines).toContain('Develop (решение)');
    expect(lines).toContain('[raw_response_id 7]');
    expect(lines).toContain('срез: podcast');
    expect(lines).toContain('— низкий CR');
    expect(lines).toContain('• manual'); // no ref/slice/note
  });

  it('shows fallbacks when assumptions / methods are empty', () => {
    const h = hyp({ hiddenAssumptions: [], validationMethods: [] });
    const lines = findSection(
      { ...baseSnapshot, hypotheses: { problems: [h], solutions: [] } },
      (x) => x.startsWith('Гипотеза'),
    ).join('\n');
    expect(lines).toContain('Скрытые допущения (0):');
    expect(lines).toContain('Методы проверки (0):');
    expect((lines.match(/— не зафиксированы/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('covers all status labels and ICE buckets', () => {
    const statuses: HypothesisStatus[] = [
      'draft',
      'in_progress',
      'green',
      'yellow',
      'red',
      'expired',
    ];
    const problems = statuses.map((status, i) => hyp({ id: i + 1, status, iceScore: 100 + i }));
    const buckets = [100, 294, 648, 800].map((iceScore, i) =>
      hyp({ id: 100 + i, kind: 'solution', iceScore }),
    );
    const prio = findSection(
      { ...baseSnapshot, hypotheses: { problems, solutions: buckets } },
      (h) => h.startsWith('Приоритизация'),
    ).join('\n');
    expect(prio).toContain('черновик');
    expect(prio).toContain('в работе');
    expect(prio).toContain('🟢 подтверждена');
    expect(prio).toContain('🟡 частично подтверждена');
    expect(prio).toContain('🔴 опровергнута');
    expect(prio).toContain('⏳ просрочена');
    expect(prio).toContain('низкий');
    expect(prio).toContain('средний');
    expect(prio).toContain('высокий');
    expect(prio).toContain('топ-приоритет');
  });
});

describe('reportSections — decision detail', () => {
  it('renders findings, evidence with raw id, rationale, next step and optional fields', () => {
    const lines = findSection(baseSnapshot, (h) => h.startsWith('DL-001')).join('\n');
    expect(lines).toContain('решение: YELLOW');
    expect(lines).toContain('[уверенность: high] находка');
    expect(lines).toContain('«q» — s [raw_response_id 42]');
    expect(lines).toContain('Следующий шаг: онлайн-оплата');
    expect(lines).toContain('Ответственный: Сергей');
    expect(lines).toContain('Дедлайн следующего шага: 2025-02-01');
    expect(lines).toContain('участники: Лиза');
  });

  it('handles empty findings, missing optionals and evidence without raw id', () => {
    const d = decision({
      findings: [],
      evidence: [{ quote: 'q2', source: 's2' }],
      responsible: undefined,
      nextDeadline: undefined,
      participants: undefined,
    });
    const lines = findSection({ ...baseSnapshot, decisions: [d] }, (h) =>
      h.startsWith('DL-001'),
    ).join('\n');
    expect(lines).toContain('Находки (0):');
    expect(lines).toContain('— не зафиксированы');
    expect(lines).toContain('«q2» — s2');
    expect(lines).not.toContain('[raw_response_id');
    expect(lines).not.toContain('Ответственный:');
    expect(lines).not.toContain('участники:');
  });
});

describe('reportSections — breakdowns, AI and empty states', () => {
  it('renders breakdown tables with visits when present', () => {
    const s: ReportSnapshot = {
      ...baseSnapshot,
      breakdowns: {
        utm: [{ source: 'vk', medium: 'cpc', campaign: 'spring', visits: 80, goalReaches: 4 }],
        geoDevice: [{ country: 'Россия', device: 'mobile', visits: 60, goalReaches: 3 }],
        entryPages: [{ page: '/lp', visits: 70, bounceRate: 0.25, goalReaches: 4 }],
        exitPages: [{ page: '/checkout', visits: 40, bounceRate: 0.6, goalReaches: 2 }],
      },
    };
    const utm = findSection(s, (h) => h === 'Топ источников UTM').join('\n');
    expect(utm).toContain('| Источник (source) | Medium | Визиты |');
    expect(utm).toContain('| vk | cpc | 80 |');
    const geo = findSection(s, (h) => h === 'Топ гео + устройства').join('\n');
    expect(geo).toContain('| Гео | Визиты |');
    expect(geo).toContain('| Россия | 60 |');
    expect(geo).toContain('| mobile | 60 | 100.0 |'); // share of the geo-slice total (unit in header)
    expect(findSection(s, (h) => h === 'Топ страниц входа').join('\n')).toContain('| /lp | 70 |');
    expect(findSection(s, (h) => h === 'Топ страниц выхода').join('\n')).toContain(
      '| /checkout | 40 |',
    );
  });

  it('renders zero-visit breakdown rows without dividing by zero (dash share)', () => {
    const s: ReportSnapshot = {
      ...baseSnapshot,
      channels: [{ ...baseSnapshot.channels[0]!, visits: 0, goalReaches: 0 }],
      breakdowns: {
        utm: [{ source: 'x', medium: 'y', campaign: 'z', visits: 0, goalReaches: 0 }],
        geoDevice: [{ country: 'RU', device: 'mobile', visits: 0, goalReaches: 0 }],
        entryPages: [],
        exitPages: [],
      },
    };
    expect(findSection(s, (h) => h === 'Топ источников UTM').join('\n')).toContain('| x | y | 0 |');
    expect(findSection(s, (h) => h === 'Топ гео + устройства').join('\n')).toContain('| RU | 0 |');
    expect(findSection(s, (h) => h === 'Топ гео + устройства').join('\n')).toContain(
      '| mobile | 0 | — |',
    );
    expect(findSection(s, (h) => h === 'Приложение с данными').join(' ')).toContain('CR 0.0%');
  });

  it('drops empty-state sections (no data / nothing yet) — they are NOT in the report (v2.9.3)', () => {
    const empty: ReportSnapshot = {
      ...baseSnapshot,
      channels: [],
      hypotheses: { problems: [], solutions: [] },
      decisions: [],
      b2bSummary: { totalTickets: 0, paidTickets: 0, dealsCount: 0, deals: [], byStage: [] },
      funnel: { visits: 0, b2cApplications: 0, b2bPipelineTickets: 0, b2bPaidTickets: 0 },
      breakdowns: { utm: [], geoDevice: [], entryPages: [], exitPages: [] },
    };
    const headings = reportSections(empty).map((s) => s.heading);
    // Heading-only «no data / nothing yet» sections must be absent.
    expect(headings).not.toContain('Каналы: структура трафика');
    expect(headings).not.toContain('Топ источников UTM');
    expect(headings).not.toContain('Топ гео + устройства');
    expect(headings).not.toContain('Топ страниц входа');
    expect(headings).not.toContain('Топ страниц выхода');
    expect(headings.some((h) => h.startsWith('Deliver'))).toBe(false);
    expect(headings.some((h) => h.startsWith('Дорожная карта'))).toBe(false);
    // Sections with real content survive.
    expect(headings).toContain('Краткие итоги');
    expect(headings).toContain('Приложение с данными');
  });

  it('includes the AI-анализ section only when aiNarrative is present', () => {
    expect(reportSections(baseSnapshot).some((s) => s.heading.startsWith('AI-анализ'))).toBe(false);
    // Without ## headings, parseChunkedNarrative creates "Результирующий вывод"
    const withAi = reportSections({ ...baseSnapshot, aiNarrative: 'Итог: рост.\n\nРиски: отвал.' });
    const итог = withAi.find((s) => s.heading === 'Результирующий вывод');
    expect(итог?.lines).toEqual(['Итог: рост.', 'Риски: отвал.']);
  });

  it('prints «Сгенерировано: provider · model · dd.mm.yyyy» at the end of the AI block (ANA-33)', () => {
    const snap: ReportSnapshot = {
      ...baseSnapshot,
      aiNarrative: '## Вывод\n\nИтог: рост.',
      aiGeneratedBy: {
        insights: {
          provider: 'yandexgpt',
          providerName: 'YandexGPT (AI Studio)',
          model: 'yandexgpt/latest',
          at: '2026-10-27T10:00:00.000Z',
        },
      },
    };
    const sections = reportSections(snap);
    const ai = sections.find((s) => s.heading === 'Вывод');
    expect(ai?.lines.at(-1)).toBe(
      '_Сгенерировано: YandexGPT (AI Studio) · yandexgpt/latest · 27.10.2026_',
    );
    // No attribution without aiGeneratedBy (old snapshots keep rendering unchanged).
    const plain = reportSections({ ...baseSnapshot, aiNarrative: '## Вывод\n\nИтог: рост.' });
    expect(plain.find((s) => s.heading === 'Вывод')?.lines.at(-1)).toBe('Итог: рост.');
  });
});

describe('reportSections — AI-generated hypotheses', () => {
  it('adds no AI-hypothesis sections when generatedHypotheses is absent', () => {
    const headings = reportSections(baseSnapshot).map((s) => s.heading);
    expect(headings).not.toContain('Приоритизация AI-гипотез (по ICE)');
    expect(headings).not.toContain('Проблемные гипотезы (AI)');
  });

  it('adds no AI-hypothesis sections when generatedHypotheses is empty', () => {
    const snap = { ...baseSnapshot, generatedHypotheses: { problems: [], solutions: [] } };
    const headings = reportSections(snap).map((s) => s.heading);
    expect(headings).not.toContain('Решенческие гипотезы (AI)');
  });

  it('renders problem + solution cards (risks, validation, ICE) sorted by ICE desc', () => {
    const snap: ReportSnapshot = {
      ...baseSnapshot,
      generatedHypotheses: {
        problems: [genProblem(), genProblem({ id: 'P02' })],
        solutions: [
          genSolution({ id: 'S01', ice: { ...genSolution().ice, score: 100 } }),
          genSolution({ id: 'S02', ice: { ...genSolution().ice, score: 500 } }),
        ],
      },
    };
    const sections = reportSections(snap);
    const headings = sections.map((s) => s.heading);
    expect(headings).toContain('Приоритизация AI-гипотез (по ICE)');
    expect(headings).toContain('Проблемные гипотезы (AI)');
    expect(headings).toContain('Решенческие гипотезы (AI)');
    expect(headings).toContain('P01'); // no leading ordinal — builder adds ГОСТ numbering

    const prio = sections
      .find((s) => s.heading === 'Приоритизация AI-гипотез (по ICE)')!
      .lines.join('\n');
    expect(prio.indexOf('S02')).toBeLessThan(prio.indexOf('S01')); // higher ICE first

    const sol = sections.find((s) => s.heading === 'S02')!.lines.join('\n');
    expect(sol).toContain('Если');
    expect(sol).toContain('Ценность:');
    expect(sol).toContain('Юридический-репутационный:');
    expect(sol).toContain('План проверки:');
    expect(sol).toContain('= 500');

    const prob = sections.find((s) => s.heading === 'P01')!.lines.join('\n');
    expect(prob).toContain('испытывает');
    expect(prob).toContain('Обоснование (данные):');
  });

  it('shows empty-side messages (problems only / solutions only)', () => {
    const solOnly = {
      ...baseSnapshot,
      generatedHypotheses: { problems: [], solutions: [genSolution()] },
    };
    expect(findSection(solOnly, (h) => h === 'Проблемные гипотезы (AI)').join(' ')).toContain(
      'не сгенерированы',
    );

    const probOnly = {
      ...baseSnapshot,
      generatedHypotheses: { problems: [genProblem()], solutions: [] },
    };
    expect(findSection(probOnly, (h) => h === 'Решенческие гипотезы (AI)').join(' ')).toContain(
      'не сгенерированы',
    );
    expect(
      findSection(probOnly, (h) => h === 'Приоритизация AI-гипотез (по ICE)').join(' '),
    ).toContain('ещё не сгенерированы');
  });
});

describe('reportSections — new sections', () => {
  it('renders B2B section when b2bSummary is present', () => {
    const s = {
      ...baseSnapshot,
      b2bSummary: {
        totalTickets: 35,
        paidTickets: 20,
        dealsCount: 2,
        deals: [
          { company: 'BigCorp', tickets: 20, stage: 'paid' },
          { company: 'SmallCo', tickets: 15, stage: 'lead' },
        ],
        byStage: [
          { stage: 'paid', tickets: 20, deals: 1 },
          { stage: 'lead', tickets: 15, deals: 1 },
        ],
      },
    } as ReportSnapshot & { b2bSummary: unknown };
    const b2bSec = reportSections(s).find((sec) => sec.heading === 'B2B-пайплайн');
    expect(b2bSec).toBeDefined();
    expect(b2bSec?.lines.join('\n')).toContain('BigCorp');
    expect(b2bSec?.lines.join('\n')).toContain('SmallCo');
  });

  it('renders detailed channel analysis section', () => {
    const lines =
      reportSections(baseSnapshot)
        .find((sec) => sec.heading === 'Каналы: трафик и конверсия')
        ?.lines.join('\n') ?? '';
    expect(lines).toContain('podcast');
    expect(lines).toContain('Визиты: 100');
  });

  it('parses chunked AI narrative into sections', () => {
    // The parseChunkedNarrative function is tested indirectly through reportSections
    // when aiNarrative is present. Here we test the fallback case.
    const s: ReportSnapshot = {
      ...baseSnapshot,
      aiNarrative: '## Test Section\n\nSome content\n\n---\n\n## Another Section\n\nMore content',
    };
    const sections = reportSections(s);
    const testSec = sections.find((sec) => sec.heading === 'Test Section');
    const anotherSec = sections.find((sec) => sec.heading === 'Another Section');
    expect(testSec).toBeDefined();
    expect(testSec?.lines.join(' ')).toContain('Some content');
    expect(anotherSec).toBeDefined();
    expect(anotherSec?.lines.join(' ')).toContain('More content');
  });

  it('sanitizes markdown leaks (###, blockquote, -bullet) in AI narrative lines (v2.9.0)', () => {
    const s: ReportSnapshot = {
      ...baseSnapshot,
      aiNarrative:
        '## Каналы\n\n#### Где мы сейчас\n> Цитата\n- Первый пункт\nОбычный абзац с **жирным**',
    };
    const sec = reportSections(s).find((x) => x.heading === 'Каналы');
    const text = sec?.lines.join('\n') ?? '';
    expect(text).not.toMatch(/####/); // markdown heading marker stripped
    expect(text).toContain('Где мы сейчас'); // text preserved
    expect(text).not.toMatch(/^>/m); // blockquote marker stripped
    expect(text).toContain('- Первый пункт'); // bullet kept — renderers convert it to a list
    expect(text).toContain('**жирным**'); // bold marker kept for the renderer
  });

  it('strips leading emoji and self-numbering from AI headings (v2.9.1 D-EMOJI/D-DOUBLE-NUM)', () => {
    const s: ReportSnapshot = {
      ...baseSnapshot,
      aiNarrative:
        '## 🔴 1. Где мы сейчас\n\nТекст с акцентом 🔴 внутри абзаца.\n\n---\n\n## Шаг 2. Анализ\n\nещё',
    };
    const secs = reportSections(s);
    const first = secs.find((x) => x.heading === 'Где мы сейчас');
    expect(first).toBeTruthy(); // emoji + «1.» stripped from heading
    expect(first?.lines.join(' ')).toContain('🔴'); // emoji inside paragraph preserved
    expect(secs.find((x) => x.heading === 'Анализ')).toBeTruthy(); // «Шаг 2.» prefix stripped
  });

  it('caps an AI section body at the line limit, silently — no truncation note (v2.9.3 D-VERBOSE)', () => {
    const manyLines = Array.from({ length: 60 }, (_, i) => `Абзац номер ${i + 1}.`).join('\n');
    const s: ReportSnapshot = { ...baseSnapshot, aiNarrative: `## Длинный раздел\n\n${manyLines}` };
    const sec = reportSections(s).find((x) => x.heading === 'Длинный раздел');
    expect(sec).toBeTruthy();
    expect(sec!.lines.length).toBe(35); // hard cap, no extra note line
    expect(sec!.lines.join('\n')).not.toContain('сокращён'); // note removed (v2.9.3)
  });

  it('converts/strips HTML tags so none leak into DOCX/PDF (v2.9.3)', () => {
    const s: ReportSnapshot = {
      ...baseSnapshot,
      aiNarrative:
        '## Каналы\n\n<strong>~180–200 новых заявок</strong> и <em>рост</em>.<br><p>Хвост</p>',
    };
    const text = reportSections(s)
      .find((x) => x.heading === 'Каналы')!
      .lines.join('\n');
    expect(text).not.toMatch(/<[^>]+>/); // никаких HTML-тегов
    expect(text).toContain('**~180–200 новых заявок**'); // <strong> → markdown bold
    expect(text).toContain('*рост*'); // <em> → markdown italic
    expect(text).toContain('Хвост'); // текст из <p> сохранён
  });
});

describe('aiHypothesisSections — direct unit tests', () => {
  // reportSections guards the call with hasAiHypotheses, which prevents calling
  // aiHypothesisSections with { problems: [], solutions: [] }. We test that path directly
  // to cover the right-hand branch of the `&&` compound condition at line 198.
  it('returns [] when called directly with both arrays empty', () => {
    expect(aiHypothesisSections({ problems: [], solutions: [] })).toEqual([]);
  });

  it('returns [] when called with undefined', () => {
    expect(aiHypothesisSections(undefined)).toEqual([]);
  });
});

describe('aiDecisionSections + generatedDecisions in reportSections', () => {
  const genDecision = (id: string) => ({
    id,
    hypothesisId: 'S01',
    method: 'количественный анализ',
    periodDays: 14,
    scope: 'мобильный сегмент',
    findings: 'CR с мобильных ниже среднего',
    confidence: 'medium' as const,
    evidence: '287 заявок B2C',
    source: 'snap-1',
    outcome: 'yellow' as const,
    outcomeRationale: 'нужна доработка формы',
  });

  it('returns [] for undefined or empty decisions', () => {
    expect(aiDecisionSections(undefined)).toEqual([]);
    expect(aiDecisionSections({ decisions: [] })).toEqual([]);
  });

  it('renders an intro + one section per decision with the outcome label', () => {
    const out = aiDecisionSections({ decisions: [genDecision('DL01'), genDecision('DL02')] });
    expect(out[0]?.heading).toMatch(/Decision Log/);
    expect(out).toHaveLength(3); // intro + 2 decisions
    expect(out[1]?.lines.join('\n')).toContain('🟡 доработать');
    expect(out[1]?.heading).toContain('DL01');
  });

  it('reportSections includes the AI decisions block when present', () => {
    const snap = { ...baseSnapshot, generatedDecisions: { decisions: [genDecision('DL01')] } };
    const headings = reportSections(snap).map((s) => s.heading);
    expect(headings.some((h) => /Decision Log \(предполагаемые/.test(h))).toBe(true);
  });
});

describe('reportSections — demo marks (ANA-18)', () => {
  it('badges seeded demo hypotheses and decisions with «[ДЕМО]» and an explanatory line', () => {
    const s: ReportSnapshot = {
      ...baseSnapshot,
      hypotheses: { problems: [hyp({ isDemo: true })], solutions: [] },
      decisions: [decision({ isDemo: true })],
    };
    const sections = reportSections(s);

    const hypCard = sections.find((sec) => sec.heading === '[ДЕМО] Гипотеза (гипотеза)');
    expect(hypCard).toBeTruthy();
    expect(hypCard!.lines.join('\n')).toContain(
      'Демо-данные: гипотеза добавлена сидом (npm run seed)',
    );

    const decCard = sections.find((sec) => sec.heading === '[ДЕМО] DL-001: итог проверки');
    expect(decCard).toBeTruthy();
    expect(decCard!.lines.join('\n')).toContain('Демо-данные');

    // Overview list and the prioritization table carry the badge too.
    const overview = sections.find((sec) => sec.heading === 'Define — проблемные гипотезы (обзор)');
    expect(overview!.lines.join('\n')).toContain('1) [ДЕМО] Гипотеза [ICE 336]');
    const priority = sections.find((sec) => sec.heading === 'Приоритизация гипотез (по ICE)');
    expect(priority!.lines.join('\n')).toMatch(/\[ICE 336 · [^\]]+\] \[ДЕМО\]/);
  });

  it('leaves real (non-seed) rows unbadged', () => {
    const text = reportSections(baseSnapshot)
      .map((sec) => `${sec.heading}\n${sec.lines.join('\n')}`)
      .join('\n');
    expect(text).not.toContain('[ДЕМО]');
  });
});

describe('reportSections — locale en (ANA-42)', () => {
  it('ru stays byte-identical to the default call', () => {
    expect(reportSections(baseSnapshot, 'ru')).toEqual(reportSections(baseSnapshot));
  });

  it('renders localized headings and template text; data values stay as stored', () => {
    const sections = reportSections(baseSnapshot, 'en');
    const headings = sections.map((sec) => sec.heading);
    expect(headings).toContain('TERMS AND ABBREVIATIONS');
    expect(headings).toContain('INTRODUCTION');
    expect(headings).toContain('EXECUTIVE SUMMARY');
    expect(headings).toContain('Methodology');
    expect(headings).toContain('Hypothesis prioritisation (by ICE)');
    expect(headings).toContain('Deliver — Decision Log (overview)');
    expect(headings).toContain('Appendix: data');
    // The hypothesis title (a data value) is never translated; the card suffix is.
    expect(headings).toContain('Гипотеза (hypothesis)');
    expect(headings).toContain('DL-001: validation outcome');

    const intro = sections.find((sec) => sec.heading === 'INTRODUCTION')!;
    expect(intro.lines.join('\n')).toContain('Purpose: an analytical report');
    expect(intro.lines.join('\n')).toContain('application ≠ payment');

    const summary = sections.find((sec) => sec.heading === 'Key results')!;
    const text = summary.lines.join('\n');
    expect(text).toContain('Period target (paid tickets)');
    expect(text).toContain('B2C applications (Metrika goal reaches)');
    // Exec summary: the KPI sentence is localized, the numbers are the same.
    const exec = sections.find((sec) => sec.heading === 'EXECUTIVE SUMMARY')!;
    expect(exec.lines.join('\n')).toContain('Period target — 300 paid tickets; credited 20');
    // Funnel sentence keeps the data values.
    expect(exec.lines.join('\n')).toContain(
      'Funnel: 100 visits → 7 B2C applications (CR 7.0%) → 20 paid B2B tickets',
    );
  });

  it('localizes hypothesis cards (labels, assumptions, methods, traffic light) and priority lines', () => {
    const sections = reportSections(baseSnapshot, 'en');
    const card = sections.find((sec) => sec.heading === 'Гипотеза (hypothesis)')!;
    const text = card.lines.join('\n');
    expect(text).toContain(
      'Type: problem · Double Diamond phase: Define (problem) · status: draft',
    );
    expect(text).toContain('ICE priority = I × C × E = 8 × 6 × 7 = 336 (medium)');
    expect(text).toContain('Hidden assumptions (3):');
    expect(text).toContain('[Behaviour]');
    expect(text).toContain('Validation methods (2):');
    expect(text).toContain('Live test: A/B (cost: средняя)');
    expect(text).toContain('Traffic-light criteria (decision thresholds):');
    expect(text).toContain('Validation deadline: 5 d');

    const prio = sections.find((sec) => sec.heading === 'Hypothesis prioritisation (by ICE)')!;
    expect(prio.lines.join('\n')).toContain('| Hypothesis | I | C | E | ICE |');
    expect(prio.lines.join('\n')).toMatch(
      /1\. \[ICE 336 · medium\] problem: .* — status: draft, deadline/,
    );
  });

  it('localizes the decision card, chart captions and empty states', () => {
    const snapshot: ReportSnapshot = {
      ...baseSnapshot,
      channels: [],
      breakdowns: { utm: [], geoDevice: [], entryPages: [], exitPages: [] },
      hypotheses: { problems: [], solutions: [] },
      decisions: [],
    };
    const sections = reportSections(snapshot, 'en');
    // Decision cards survive with data; empty-state-only sections are dropped in both locales.
    const headings = sections.map((sec) => sec.heading);
    expect(headings).not.toContain('Roadmap: what we do next');

    const dl = sections.find((sec) => sec.heading === 'Deliver — Decision Log (overview)');
    // A section whose only line is the empty-state placeholder is dropped in both locales.
    expect(dl).toBeUndefined();

    // Captions are localized on the charted sections.
    const captions = sections
      .map((sec) => sec.caption)
      .filter((c): c is string => typeof c === 'string');
    expect(captions).toContain('Figure 1 — Traffic and conversion by channel');
    expect(captions).toContain('Figure 2 — Funnel: visit → application → payment');

    // Recommendations carry EN sentences from the shared tables.
    const rec = sections.find(
      (sec) => sec.heading === 'Recommendations: what works and what does not',
    )!;
    expect(rec.lines.join('\n')).toContain(
      'No channel data for the period — sync data from Metrika.',
    );
  });
});
