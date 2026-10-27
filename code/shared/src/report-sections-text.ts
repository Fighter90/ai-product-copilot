/**
 * Template text of the report sections, per report locale (ANA-42). The RU table is the historical
 * wording verbatim — {@link reportSections} with locale 'ru' must stay byte-identical (ГОСТ verifier,
 * RU tests). Only the report's own wording lives here; data values are printed as stored.
 */
import type { ReportLocale } from './report-locale';

/** One row of the «Обозначения» table: [term, explanation]. */
type TermRow = readonly [string, string];

const RU = {
  chartInterpretation: (title: string) =>
    `Интерпретация диаграммы «${title}» (по порогам, прослеживается до данных):`,
  good: '🟢 Что хорошо:',
  bad: '🔴 Что плохо:',
  aiTrailingHeading: 'Результирующий вывод',
  aiFallbackHeading: 'AI-анализ (интерпретация, проверяйте по данным)',
  // ANA-33: attribution line printed under the AI block («Сгенерировано: YandexGPT · …»).
  generatedByPrefix: 'Сгенерировано:',
  emptyState: /^(Нет данных|Завершённых проверок пока нет|Гипотезы не заведены)/,

  // Hypothesis card
  phaseDefine: 'Define (проблема)',
  phaseDevelop: 'Develop (решение)',
  statement: (stmt: string) => `Формулировка: ${stmt}`,
  typeLine: (kind: string, phase: string, status: string) =>
    `Тип: ${kind} · фаза Double Diamond: ${phase} · статус: ${status}`,
  hypothesisDemo: 'Демо-данные: гипотеза добавлена сидом (npm run seed), а не заведена командой.',
  description: (d: string) => `Описание: ${d}`,
  icePriority: (i: number, c: number, e: number, score: number, bucket: string) =>
    `Приоритет ICE = I × C × E = ${i} × ${c} × ${e} = ${score} (${bucket})`,
  hiddenAssumptions: (n: number) => `Скрытые допущения (${n}):`,
  noneRecorded: '  — не зафиксированы',
  validationMethods: (n: number) => `Методы проверки (${n}):`,
  cost: (c: string) => ` (стоимость: ${c})`,
  trafficLight: 'Светофор критериев (порог решения):',
  green: (t: string) => `  🟢 Зелёный — ${t}`,
  yellow: (t: string) => `  🟡 Жёлтый — ${t}`,
  red: (t: string) => `  🔴 Красный — ${t}`,
  deadline: (days: number, at: string) => `Дедлайн проверки: ${days} дн. (до ${at})`,
  evidenceIntro: 'Данные-основания (прослеживаемость до raw_responses):',
  slice: (sl: string) => ` · срез: ${sl}`,
  hypothesisHeading: (title: string) => `${title} (гипотеза)`,

  // Decision card
  decisionLine: (id: number, method: string, days: number, outcome: string) =>
    `Гипотеза #${id} · метод: ${method} · период: ${days} дн. · решение: ${outcome}`,
  scope: (s: string) => `Охват проверки: ${s}`,
  outcomeRationale: (s: string) => `Обоснование вывода: ${s}`,
  decisionDemo: 'Демо-данные: решение добавлено сидом (npm run seed), а не зафиксировано командой.',
  findings: (n: number) => `Находки (${n}):`,
  finding: (conf: string, text: string) => `  • [уверенность: ${conf}] ${text}`,
  evidence: (n: number) => `Доказательства (${n}):`,
  nextStep: (s: string) => `Следующий шаг: ${s}`,
  responsible: (s: string) => `Ответственный: ${s}`,
  nextDeadline: (s: string) => `Дедлайн следующего шага: ${s}`,
  decidedBy: (by: string, participants?: string) =>
    `Решение принял: ${by}${participants ? ` · участники: ${participants}` : ''}`,
  decisionHeading: (num: string) => `${num}: итог проверки`,

  // Designations
  designationsHeading: 'ОБОЗНАЧЕНИЯ, ТЕРМИНЫ И СОКРАЩЕНИЯ',
  termHeader: ['Термин', 'Расшифровка'] as readonly string[],
  terms: [
    [
      'KPI',
      'Key Performance Indicator — ключевой показатель эффективности; здесь — цель по оплаченным билетам за период',
    ],
    [
      'CR',
      'Conversion Rate — конверсия: доля визитов, достигших цели (заявки/визиты или оплаты/визиты), в %',
    ],
    [
      'UTM',
      'Urchin Tracking Module — метки источника трафика в ссылке (source / medium / campaign)',
    ],
    [
      'ICE',
      'Impact × Confidence × Ease — балл приоритета гипотезы (произведение, 1–1000); каждый параметр обосновывается',
    ],
    [
      'DL',
      'Decision Log — журнал решений: что проверяли, что узнали, исход и следующий шаг (записи вида DL-NNN)',
    ],
    [
      'B2B',
      'Business-to-Business — корпоративные билеты; ведутся вручную (b2b_manual), оплаты зачитываются к цели',
    ],
    ['B2C', 'Business-to-Consumer — розничные посетители; их заявки — достижения целей Метрики'],
    ['DOCX', 'Формат выгрузки отчёта (Word) — строится из того же среза данных, что PDF и экран'],
    ['PDF', 'Печатный формат отчёта — рендерится из ГОСТ-HTML по тому же срезу данных'],
    [
      'Gap',
      'Разрыв до цели: сколько оплаченных билетов не хватает до KPI (цель − зачтённые оплаты)',
    ],
    [
      'WoW',
      'Week over Week — сравнение с предыдущей неделей; на дашбордах проекта, в отчёт входит через период среза',
    ],
    [
      'Snapshot',
      'Срез данных — неизменяемый снимок всех цифр за период с уникальным ИД; DOCX, PDF и экран строятся из него',
    ],
    [
      'pc-goals',
      'JS-скрипт событий билетной воронки на productcamp.ru: этапы от «увидел билеты» до «оставил контакты»',
    ],
    ['Дедлайн', 'Срок проверки гипотезы; после него фиксируется исход в Decision Log'],
    [
      'CRM (СРМ)',
      'Система управления взаимоотношениями с клиентами; B2B-сделки проекта ведутся вручную в приложении',
    ],
    ['Bounce', 'Отказ — визит с одного экрана без действий; bounce rate — доля таких визитов'],
  ] as readonly TermRow[],

  // Introduction
  introductionHeading: 'ВВЕДЕНИЕ',
  introPurpose:
    'Назначение: аналитический отчёт по конверсиям и лидгену трека ProductCamp — как трафик превращается в заявки и оплаты, какие гипотезы роста проверены и что делать дальше.',
  introSources:
    'Источники данных: Яндекс Метрика (Reporting API; дневные агрегаты по каналам, UTM, гео, устройствам и страницам), счётчик ProductCamp; ручной B2B-пайплайн (b2b_manual); гипотезы и Decision Log приложения.',
  introPeriod: (from: string, to: string, id: string, at: string) =>
    `Период отчёта: ${from} — ${to} (срез данных ${id} от ${at}).`,
  introContents:
    'Состав: обозначения → управленческое резюме → краткие итоги → методология → воронка и каналы → приоритизация и карточки гипотез → Decision Log → разрезы (UTM, гео, страницы) → приложение с данными.',
  introCaveat:
    'Ключевая оговорка: заявка ≠ оплата. Заявка — достижение цели Метрики, оплата — фактически оплаченный билет; эти метрики нигде не суммируются.',
  introAntiHallucination:
    'Анти-галлюцинация: каждая цифра восходит к зафиксированному срезу (raw_responses в SQLite); в рендер-пути нет LLM и текущего времени — DOCX, PDF и экран строятся из одного среза и идентичны.',

  // Executive summary
  executiveHeading: 'УПРАВЛЕНЧЕСКОЕ РЕЗЮМЕ',
  exTarget: (target: number, credited: number, pctDone: string, gap: number) =>
    `- Цель периода — ${target} оплаченных билетов; зачтено ${credited} (выполнение ${pctDone}%), gap — ${gap}.`,
  exFunnel: (visits: number, apps: number, cr: string, paid: number) =>
    `- Воронка: ${visits} визитов → ${apps} заявок B2C (CR ${cr}) → ${paid} оплаченных билетов B2B.`,
  exBest: (ch: string, cr: string, visits: number) =>
    `- Лучший канал по CR: ${ch} — ${cr}% заявок с ${visits} визитов.`,
  exWorst: (ch: string, cr: string, visits: number) =>
    `- Слабейший канал по CR: ${ch} — ${cr}% заявок с ${visits} визитов.`,
  exBounce: (b: string) => `- Отказы: ${b}% визитов — средневзвешенный bounce rate по каналам.`,
  exB2b: (paid: number, total: number, deals: number, pipeline: number) =>
    `- B2B-вклад: оплачено ${paid} из ${total} билетов по ${deals} сделкам; в работе ещё ${pipeline}.`,
  exRiskChannel: (gap: number, ch: string, visits: number, cr: string) =>
    `- Главный риск: gap ${gap} билетов — заявка ≠ оплата; канал «${ch}» даёт ${visits} визитов при CR ${cr}% ниже общего.`,
  exRisk: (gap: number) =>
    `- Главный риск: gap ${gap} билетов — заявка ≠ оплата, заявки без оплат цель не двигают.`,
  exLever: (ch: string) =>
    `- Главный рычаг: перераспределить бюджет в «${ch}» (лучший CR) и поднять конверсию объёмных каналов с низким CR.`,
  exLeverNoData:
    '- Главный рычаг: запустить трафик и первые проверки гипотез — данных по каналам пока нет.',
  exHypotheses: (p: number, s: number, d: number) =>
    `- Гипотезы: ${p} проблемных + ${s} решенческих в приоритизации; закрытых проверок — ${d} (Decision Log).`,

  // B2B
  b2bHeading: 'B2B-пайплайн',
  b2bTotal: (n: number) => `Всего B2B билетов: ${n}`,
  b2bPaid: (n: number) => `Оплачено B2B: ${n}`,
  b2bDeals: (n: number) => `Активных сделок: ${n}`,
  b2bByStage: 'Детализация по этапам:',
  b2bStage: (stage: string, tickets: number, deals: number) =>
    `  • ${stage}: ${tickets} билетов (${deals} сделок)`,
  b2bDealList: 'Список сделок:',
  b2bDeal: (company: string, tickets: number, stage: string) =>
    `  • ${company}: ${tickets} билетов [${stage}]`,

  // Funnel (conversion)
  funnelHeading: 'Воронка конверсии',
  funnelStage1: (n: number) => `Этап 1: Визиты — ${n}`,
  funnelStage2: (n: number, cr: string) => `Этап 2: Заявки B2C — ${n} (CR ${cr}%)`,
  funnelStage3: (n: number) => `Этап 3: B2B в работе — ${n} билетов`,
  funnelStage4: (n: number) => `Этап 4: Оплачено B2B — ${n} билетов`,
  funnelGap: (target: number, gap: number) => `Gap до цели (${target}): ${gap} платных билетов`,
  funnelCr: (cr: string) => `Конверсия визит → заявка: ${cr}%`,
  funnelAnalysis: 'Анализ воронки:',
  funnelLost: (lost: number, share: string) =>
    `  • Потеряно на этапе заявки: ${lost} визитов (${share}%)`,
  funnelPipeline: (n: number) => `  • B2B-пайплайн в работе: ${n} билетов`,

  // Channel analysis
  channelsHeading: 'Каналы: трафик и конверсия',
  channelsCaption: 'Рисунок 1 — Воронка конверсии',
  chTotal: (n: number) => `Всего каналов: ${n}`,
  chVisits: (n: number) => `Суммарно визитов: ${n}`,
  chApps: (n: number) => `Суммарно заявок: ${n}`,
  chDetail: 'Детализация по каналам (отсортировано по визитам):',
  chItemVisits: (v: number, share: string) => `   Визиты: ${v} (${share}% от общего трафика)`,
  chItemApps: (n: number) => `   Заявки: ${n}`,
  chItemCr: (cr: string) => `   CR: ${cr}%`,
  chConclusions: 'Выводы:',
  chBest: (ch: string, cr: string) => `  • Лучший CR: ${ch} (${cr}%) — масштабировать`,
  chWorst: (ch: string, cr: string) => `  • Худший CR: ${ch} (${cr}%) — проверить качество трафика`,
  chTop10: 'Детально (топ-10 по визитам):',
  chTableHeader: ['Канал', 'Визиты', 'Заявки', 'CR %'] as readonly string[],

  // Title
  titleHeading: 'ProductCamp · Конверсии и лидген',
  titlePeriod: (from: string, to: string) => `Период: ${from} — ${to}`,
  titleSnapshot: (id: string, at: string) => `Срез данных: ${id} · сформирован ${at}`,
  titleKpi: (target: number) => `KPI: цель ${target} оплаченных билетов`,
  titleDeterministic:
    'Отчёт детерминированный: один ИД среза → идентичный контент в DOCX, PDF и на экране.',
  titleTraceable: 'Каждая цифра прослеживается до raw_responses в SQLite (анти-галлюцинация).',

  // Quick summary
  summaryHeading: 'Краткие итоги',
  goalTitle: (label: { title: string; isPaid: boolean } | undefined) =>
    label?.title ?? 'Заявок B2C',
  summaryGoal: (title: string, n: number) => `${title} (достижения основной цели за период): ${n}`,
  summaryPaid: (n: number) => `Оплачено B2B (билетов): ${n}`,
  summaryGap: (n: number) => `Gap до цели (по оплатам): ${n}`,
  summaryVisits: (n: number) => `Суммарно визитов в выборке каналов: ${n}`,
  summaryGapText: [
    'Главный разрыв: заявка ≠ оплата. Формальные цели Метрики (заявки) и фактические оплаты',
    'разведены везде в отчёте и не суммируются. Цель отчёта — показать, какой трафик приносит',
    'реальные оплаты, и приоритизировать гипотезы роста по методологии проверки гипотез.',
  ] as readonly string[],
  summaryHypotheses: (p: number, s: number) =>
    `Гипотез в работе: ${p} проблемных + ${s} решенческих.`,
  summaryDecisions: (n: number) => `Закрытых проверок (Decision Log): ${n}.`,
  summaryKeyFigures: 'Ключевые цифры периода:',
  kfHeader: ['Показатель', 'Значение'] as readonly string[],
  kfTarget: 'Цель периода (оплаченных билетов)',
  kfApps: 'Заявки B2C (достижения цели Метрики)',
  kfPaid: 'Оплачено B2B (билетов)',
  kfCredited: 'Зачтено к цели (оплаченные билеты)',
  kfGap: 'Gap до цели (билетов)',
  kfCr: 'CR общий (заявки / визиты)',
  kfCrPaid: 'CR оплаты (оплачено / визиты)',

  // Recommendations
  recHeading: 'Рекомендации: что хорошо и что плохо',
  recIntro:
    'Детерминированная оценка по порогам (CR ≥5% / <2%, отказы ≥70%), прослеживается до данных:',

  // Methodology
  methodologyHeading: 'Методология',
  methodology: [
    'Цикл Double Diamond: Define (проблемные гипотезы) → Develop (решенческие гипотезы) →',
    'Deliver (Decision Log с проверяемым исходом).',
    '',
    'Формат гипотезы: «{ЦА} {действие} {решение}, если {условие}». Каждая гипотеза',
    'обязана иметь ≥3 скрытых допущения (поведение/рынок/технологии), ≥2 метода проверки,',
    'светофор-критерии 🟢/🟡/🔴 с порогами и дедлайн.',
    '',
    'Приоритизация ICE = Impact × Confidence × Ease (произведение, не среднее), шкала 1–1000.',
    'Произведение наказывает однобокие гипотезы (см. ADR-005). Каждый параметр требует',
    'обоснования. Бакеты: ≤125 низкий, ≤342 средний, ≤729 высокий, выше — топ-приоритет.',
    '',
    'Анти-галлюцинация: ни одной цифры без следа в raw_responses; в render-пути нет LLM и',
    'Date.now(); AI-нарратив (если есть) сгенерирован один раз и сохранён в срезе данных.',
  ] as readonly string[],

  // Funnel (visit → application → payment)
  funnel2Heading: 'Воронка: визит → заявка → оплата',
  funnel2Caption: 'Рисунок 2 — Воронка: визит → заявка → оплата',
  f2Visits: (n: number) => `1) Визиты (сумма по каналам за период): ${n}`,
  f2Apps: (n: number, cr: string) =>
    `2) Заявки B2C (достижения цели): ${n} — конверсия визит→заявка ${cr}`,
  f2Paid: (n: number) => `3) Оплачено B2B (билетов): ${n}`,
  f2Gap: (target: number, gap: number) => `Gap до цели в ${target} оплаченных билетов: ${gap}`,
  f2Text: [
    'Заявка ≠ оплата: шаги воронки не суммируются — это разные метрики из разных источников',
    '(заявки — из целей Метрики, оплаты B2B — из ручного пайплайна). Цель — двигать именно',
    'оплаты, поэтому Gap считается по оплаченным билетам, а не по заявкам.',
  ] as readonly string[],

  // Channel mix
  mixHeading: 'Каналы: структура трафика',
  mixCaption: 'Рисунок 3 — Структура трафика по каналам',
  mixEmpty: 'Нет данных по каналам за период.',
  mixIntro: 'Каналы за период, отсортированы по визитам. CR = заявки / визиты:',
  mixLine: (i: number, ch: string, v: number, g: number, cr: string) =>
    `${i}. ${ch}: визитов ${v}, заявок ${g} (CR ${cr})`,
  mixText: [
    'Каналы с высоким CR в заявку — кандидаты на усиление бюджета; с высоким объёмом, но',
    'низким CR — кандидаты на проверку качества трафика и пути к оплате.',
  ] as readonly string[],

  // Prioritization
  prioHeading: 'Приоритизация гипотез (по ICE)',
  prioIntro: 'Все гипотезы, отсортированы по убыванию ICE. Сверху — то, что бьём первым:',
  prioHeader: ['Гипотеза', 'I', 'C', 'E', 'ICE'] as readonly string[],
  prioDetail: 'Детально (формулировки, статусы и дедлайны):',
  defineHeading: 'Define — проблемные гипотезы (обзор)',
  defineIntro: (n: number) => `Заведено ${n} проблемных гипотез. Полная карточка каждой — ниже.`,
  developHeading: 'Develop — решенческие гипотезы (обзор)',
  developIntro: (n: number) => `Заведено ${n} решенческих гипотез. Полная карточка каждой — ниже.`,

  // Decision log overview
  dlHeading: 'Deliver — Decision Log (обзор)',
  dlEmpty: 'Завершённых проверок пока нет.',
  dlIntro: (n: number) => `Зафиксировано ${n} решений. Детали каждого — ниже.`,
  dlHeader: ['ID', 'Гипотеза', 'Статус', 'Решение'] as readonly string[],

  // Breakdowns
  geoHeading: 'Топ гео + устройства',
  geoEmpty: 'Нет данных гео/устройств за период.',
  geoIntro: 'Гео (топ-10 по визитам, суммарно по всем устройствам):',
  geoHeader: ['Гео', 'Визиты'] as readonly string[],
  deviceIntro: 'Устройства (доля — от визитов в гео-разрезе):',
  deviceHeader: ['Устройство', 'Визиты', 'Доля %'] as readonly string[],
  pageHeader: ['Страница', 'Визиты'] as readonly string[],
  utmHeading: 'Топ источников UTM',
  utmIntro: 'Топ источников трафика по визитам (топ-15, агрегировано по source/medium):',
  utmHeader: ['Источник (source)', 'Medium', 'Визиты'] as readonly string[],
  utmEmpty: 'Нет данных UTM за период.',
  entryHeading: 'Топ страниц входа',
  entryEmpty: 'Нет данных по страницам входа за период.',
  exitHeading: 'Топ страниц выхода',
  exitEmpty: 'Нет данных по страницам выхода за период.',

  // Roadmap
  roadmapHeading: 'Дорожная карта: что делаем дальше',
  roadmapEmpty: 'Гипотезы не заведены — дорожной карты пока нет.',
  roadmapIntro: 'Топ-приоритеты по ICE и целевой результат (порог 🟢) каждой гипотезы:',
  roadmapLine: (i: number, ice: number, title: string, green: string, days: number) =>
    `${i}. [ICE ${ice}] ${title} → цель: ${green} (дедлайн ${days} дн.)`,
  roadmapText: [
    'Порядок работы: бьём сверху вниз, после каждой проверки фиксируем исход в Decision Log',
    'и обновляем приоритеты — список пересобирается по факту, а не по интуиции.',
  ] as readonly string[],

  // Glossary
  glossaryHeading: 'Глоссарий и принципы',
  glossary: [
    'Заявка — достижение цели Метрики (например, отправка формы). Не равна оплате.',
    'Оплата (B2B) — фактически оплаченный билет из ручного пайплайна (b2b_manual).',
    'CR (conversion rate) — доля визитов, дошедших до цели (заявки/визиты).',
    'Bounce rate — доля визитов с отказом (один экран, без действия).',
    'ICE — Impact × Confidence × Ease (произведение, 1–1000) — балл приоритета гипотезы.',
    'Double Diamond — Define (проблемы) → Develop (решения) → Deliver (решения зафиксированы).',
    'Светофор 🟢/🟡/🔴 — пороги исхода проверки гипотезы с конкретной метрикой.',
    'raw_responses — таблица сырых ответов Метрики в SQLite; источник правды для всех цифр.',
    'ИД среза — идентификатор неизменяемого среза данных; гарантирует идентичность DOCX/PDF/экрана.',
  ] as readonly string[],

  // Appendix
  appendixHeading: 'Приложение с данными',
  appendixChannels: (n: number) => `Каналов в выборке: ${n} (агрегировано по каналу за период;`,
  appendixRows: (n: number) => `строк-срезов по дням в выборке: ${n})`,
  appendixTotals: 'Итоги по каналам (визиты · заявки · CR):',
  appendixLine: (ch: string, v: number, g: number, cr: string) =>
    `  • ${ch}: визитов ${v}, заявок ${g} (CR ${cr})`,
  appendixText: [
    'Полная посуточная разбивка не дублируется в отчёте во избежание шума: каждая строка',
    'восстановима из raw_responses по (query_hash, date_from, date_to) — это и есть источник правды.',
  ] as readonly string[],
};

export type ReportText = typeof RU;

const EN: ReportText = {
  chartInterpretation: (title: string) =>
    `Chart interpretation “${title}” (threshold-based, traceable to data):`,
  good: '🟢 What works:',
  bad: '🔴 What does not:',
  aiTrailingHeading: 'Final conclusion',
  aiFallbackHeading: 'AI analysis (interpretation, verify against the data)',
  // ANA-33: attribution line printed under the AI block (provider · model label follows).
  generatedByPrefix: 'Generated by:',
  emptyState: /^(No data|No completed checks yet|No hypotheses yet)/,

  phaseDefine: 'Define (problem)',
  phaseDevelop: 'Develop (solution)',
  statement: (stmt) => `Statement: ${stmt}`,
  typeLine: (kind, phase, status) =>
    `Type: ${kind} · Double Diamond phase: ${phase} · status: ${status}`,
  hypothesisDemo:
    'Demo data: this hypothesis was added by the seed script (npm run seed), not by the team.',
  description: (d) => `Description: ${d}`,
  icePriority: (i, c, e, score, bucket) =>
    `ICE priority = I × C × E = ${i} × ${c} × ${e} = ${score} (${bucket})`,
  hiddenAssumptions: (n) => `Hidden assumptions (${n}):`,
  noneRecorded: '  — none recorded',
  validationMethods: (n) => `Validation methods (${n}):`,
  cost: (c) => ` (cost: ${c})`,
  trafficLight: 'Traffic-light criteria (decision thresholds):',
  green: (t) => `  🟢 Green — ${t}`,
  yellow: (t) => `  🟡 Yellow — ${t}`,
  red: (t) => `  🔴 Red — ${t}`,
  deadline: (days, at) => `Validation deadline: ${days} d (by ${at})`,
  evidenceIntro: 'Supporting data (traceable to raw_responses):',
  slice: (sl) => ` · slice: ${sl}`,
  hypothesisHeading: (title) => `${title} (hypothesis)`,

  decisionLine: (id, method, days, outcome) =>
    `Hypothesis #${id} · method: ${method} · period: ${days} d · decision: ${outcome}`,
  scope: (s) => `Scope: ${s}`,
  outcomeRationale: (s) => `Rationale: ${s}`,
  decisionDemo:
    'Demo data: this decision was added by the seed script (npm run seed), not recorded by the team.',
  findings: (n) => `Findings (${n}):`,
  finding: (conf, text) => `  • [confidence: ${conf}] ${text}`,
  evidence: (n) => `Evidence (${n}):`,
  nextStep: (s) => `Next step: ${s}`,
  responsible: (s) => `Owner: ${s}`,
  nextDeadline: (s) => `Next-step deadline: ${s}`,
  decidedBy: (by, participants) =>
    `Decided by: ${by}${participants ? ` · participants: ${participants}` : ''}`,
  decisionHeading: (num) => `${num}: validation outcome`,

  designationsHeading: 'TERMS AND ABBREVIATIONS',
  termHeader: ['Term', 'Meaning'],
  terms: [
    ['KPI', 'Key Performance Indicator; here — the target number of paid tickets for the period'],
    [
      'CR',
      'Conversion Rate — share of visits reaching the goal (applications/visits or paid/visits), %',
    ],
    ['UTM', 'Urchin Tracking Module — traffic-source tags in a link (source / medium / campaign)'],
    [
      'ICE',
      'Impact × Confidence × Ease — hypothesis priority score (product, 1–1000); each factor is justified',
    ],
    [
      'DL',
      'Decision Log — what was tested, what was learned, the outcome and the next step (entries DL-NNN)',
    ],
    [
      'B2B',
      'Business-to-Business — corporate tickets; tracked manually (b2b_manual), payments count towards the target',
    ],
    ['B2C', 'Business-to-Consumer — retail visitors; their applications are Metrika goal reaches'],
    [
      'DOCX',
      'Report export format (Word) — built from the same data snapshot as the PDF and the screen',
    ],
    ['PDF', 'Print format of the report — rendered from the GOST HTML of the same data snapshot'],
    [
      'Gap',
      'Distance to the target: paid tickets still missing to the KPI (target − credited payments)',
    ],
    [
      'WoW',
      'Week over Week — comparison with the previous week; on dashboards, in the report via the snapshot period',
    ],
    [
      'Snapshot',
      'Immutable capture of all figures for the period with a unique ID; DOCX, PDF and screen render from it',
    ],
    [
      'pc-goals',
      'JS script for ticket-funnel events on productcamp.ru: from “saw tickets” to “left contacts”',
    ],
    [
      'Deadline',
      'Validation due date of a hypothesis; the outcome is recorded in the Decision Log after it',
    ],
    [
      'CRM',
      'Customer Relationship Management system; the project’s B2B deals are tracked manually in the app',
    ],
    ['Bounce', 'A single-screen visit with no action; bounce rate — the share of such visits'],
  ],

  introductionHeading: 'INTRODUCTION',
  introPurpose:
    'Purpose: an analytical report on conversions and lead generation of the ProductCamp track — how traffic turns into applications and payments, which growth hypotheses were tested and what to do next.',
  introSources:
    'Data sources: Yandex Metrika (Reporting API; daily aggregates by channel, UTM, geo, device and page), the ProductCamp counter; manual B2B pipeline (b2b_manual); the app’s hypotheses and Decision Log.',
  introPeriod: (from, to, id, at) =>
    `Report period: ${from} — ${to} (data snapshot ${id} of ${at}).`,
  introContents:
    'Contents: terms → executive summary → key results → methodology → funnel and channels → prioritisation and hypothesis cards → Decision Log → breakdowns (UTM, geo, pages) → data appendix.',
  introCaveat:
    'Key caveat: application ≠ payment. An application is a Metrika goal reach, a payment is an actually paid ticket; these metrics are never added up.',
  introAntiHallucination:
    'Anti-hallucination: every figure traces back to a recorded snapshot (raw_responses in SQLite); the render path has no LLM and no current time — DOCX, PDF and screen are built from one snapshot and are identical.',

  executiveHeading: 'EXECUTIVE SUMMARY',
  exTarget: (target, credited, pctDone, gap) =>
    `- Period target — ${target} paid tickets; credited ${credited} (${pctDone}% done), gap — ${gap}.`,
  exFunnel: (visits, apps, cr, paid) =>
    `- Funnel: ${visits} visits → ${apps} B2C applications (CR ${cr}) → ${paid} paid B2B tickets.`,
  exBest: (ch, cr, visits) =>
    `- Best channel by CR: ${ch} — ${cr}% applications from ${visits} visits.`,
  exWorst: (ch, cr, visits) =>
    `- Weakest channel by CR: ${ch} — ${cr}% applications from ${visits} visits.`,
  exBounce: (b) => `- Bounces: ${b}% of visits — visit-weighted bounce rate across channels.`,
  exB2b: (paid, total, deals, pipeline) =>
    `- B2B contribution: ${paid} of ${total} tickets paid across ${deals} deals; ${pipeline} more in progress.`,
  exRiskChannel: (gap, ch, visits, cr) =>
    `- Main risk: gap of ${gap} tickets — application ≠ payment; channel “${ch}” brings ${visits} visits with CR ${cr}% below average.`,
  exRisk: (gap) =>
    `- Main risk: gap of ${gap} tickets — application ≠ payment, applications without payments do not move the target.`,
  exLever: (ch) =>
    `- Main lever: shift budget to “${ch}” (best CR) and lift conversion of high-volume low-CR channels.`,
  exLeverNoData: '- Main lever: launch traffic and first hypothesis tests — no channel data yet.',
  exHypotheses: (p, s, d) =>
    `- Hypotheses: ${p} problem + ${s} solution in prioritisation; completed checks — ${d} (Decision Log).`,

  b2bHeading: 'B2B pipeline',
  b2bTotal: (n) => `Total B2B tickets: ${n}`,
  b2bPaid: (n) => `B2B paid: ${n}`,
  b2bDeals: (n) => `Active deals: ${n}`,
  b2bByStage: 'By stage:',
  b2bStage: (stage, tickets, deals) => `  • ${stage}: ${tickets} tickets (${deals} deals)`,
  b2bDealList: 'Deals:',
  b2bDeal: (company, tickets, stage) => `  • ${company}: ${tickets} tickets [${stage}]`,

  funnelHeading: 'Conversion funnel',
  funnelStage1: (n) => `Stage 1: Visits — ${n}`,
  funnelStage2: (n, cr) => `Stage 2: B2C applications — ${n} (CR ${cr}%)`,
  funnelStage3: (n) => `Stage 3: B2B in progress — ${n} tickets`,
  funnelStage4: (n) => `Stage 4: B2B paid — ${n} tickets`,
  funnelGap: (target, gap) => `Gap to target (${target}): ${gap} paid tickets`,
  funnelCr: (cr) => `Visit → application conversion: ${cr}%`,
  funnelAnalysis: 'Funnel analysis:',
  funnelLost: (lost, share) => `  • Lost at the application step: ${lost} visits (${share}%)`,
  funnelPipeline: (n) => `  • B2B pipeline in progress: ${n} tickets`,

  channelsHeading: 'Channels: traffic and conversion',
  channelsCaption: 'Figure 1 — Traffic and conversion by channel',
  chTotal: (n) => `Channels: ${n}`,
  chVisits: (n) => `Total visits: ${n}`,
  chApps: (n) => `Total applications: ${n}`,
  chDetail: 'Channel breakdown (sorted by visits):',
  chItemVisits: (v, share) => `   Visits: ${v} (${share}% of all traffic)`,
  chItemApps: (n) => `   Applications: ${n}`,
  chItemCr: (cr) => `   CR: ${cr}%`,
  chConclusions: 'Conclusions:',
  chBest: (ch, cr) => `  • Best CR: ${ch} (${cr}%) — scale it`,
  chWorst: (ch, cr) => `  • Worst CR: ${ch} (${cr}%) — check traffic quality`,
  chTop10: 'In detail (top 10 by visits):',
  chTableHeader: ['Channel', 'Visits', 'Applications', 'CR %'],

  titleHeading: 'ProductCamp · Conversions and lead generation',
  titlePeriod: (from, to) => `Period: ${from} — ${to}`,
  titleSnapshot: (id, at) => `Data snapshot: ${id} · generated ${at}`,
  titleKpi: (target) => `KPI: target of ${target} paid tickets`,
  titleDeterministic:
    'The report is deterministic: one snapshot ID → identical content in DOCX, PDF and on screen.',
  titleTraceable: 'Every figure traces back to raw_responses in SQLite (anti-hallucination).',

  summaryHeading: 'Key results',
  goalTitle: (label) => (label?.isPaid ? 'Orders' : 'B2C applications'),
  summaryGoal: (title, n) => `${title} (primary goal reaches for the period): ${n}`,
  summaryPaid: (n) => `B2B paid (tickets): ${n}`,
  summaryGap: (n) => `Gap to target (by payments): ${n}`,
  summaryVisits: (n) => `Total visits in the channel sample: ${n}`,
  summaryGapText: [
    'The main gap: application ≠ payment. Formal Metrika goals (applications) and actual payments',
    'are kept apart throughout the report and never added up. The report shows which traffic brings',
    'real payments and prioritises growth hypotheses using the hypothesis-testing methodology.',
  ],
  summaryHypotheses: (p, s) => `Hypotheses in progress: ${p} problem + ${s} solution.`,
  summaryDecisions: (n) => `Completed checks (Decision Log): ${n}.`,
  summaryKeyFigures: 'Key figures for the period:',
  kfHeader: ['Metric', 'Value'],
  kfTarget: 'Period target (paid tickets)',
  kfApps: 'B2C applications (Metrika goal reaches)',
  kfPaid: 'B2B paid (tickets)',
  kfCredited: 'Credited to target (paid tickets)',
  kfGap: 'Gap to target (tickets)',
  kfCr: 'Overall CR (applications / visits)',
  kfCrPaid: 'Payment CR (paid / visits)',

  recHeading: 'Recommendations: what works and what does not',
  recIntro:
    'Deterministic threshold-based assessment (CR ≥5% / <2%, bounce ≥70%), traceable to data:',

  methodologyHeading: 'Methodology',
  methodology: [
    'Double Diamond cycle: Define (problem hypotheses) → Develop (solution hypotheses) →',
    'Deliver (Decision Log with a verifiable outcome).',
    '',
    'Hypothesis format: “{audience} {action} {solution}, if {condition}”. Every hypothesis',
    'must have ≥3 hidden assumptions (behaviour/market/technology), ≥2 validation methods,',
    'traffic-light criteria 🟢/🟡/🔴 with thresholds, and a deadline.',
    '',
    'Prioritisation ICE = Impact × Confidence × Ease (product, not average), scale 1–1000.',
    'The product penalises one-sided hypotheses (see ADR-005). Each factor requires',
    'a rationale. Buckets: ≤125 low, ≤342 medium, ≤729 high, above — top priority.',
    '',
    'Anti-hallucination: no figure without a trace in raw_responses; the render path has no LLM and',
    'no Date.now(); the AI narrative (if any) is generated once and stored in the data snapshot.',
  ],

  funnel2Heading: 'Funnel: visit → application → payment',
  funnel2Caption: 'Figure 2 — Funnel: visit → application → payment',
  f2Visits: (n) => `1) Visits (sum over channels for the period): ${n}`,
  f2Apps: (n, cr) =>
    `2) B2C applications (goal reaches): ${n} — visit→application conversion ${cr}`,
  f2Paid: (n) => `3) B2B paid (tickets): ${n}`,
  f2Gap: (target, gap) => `Gap to the target of ${target} paid tickets: ${gap}`,
  f2Text: [
    'Application ≠ payment: funnel steps are not added up — they are different metrics from different',
    'sources (applications — Metrika goals, B2B payments — the manual pipeline). The goal is to move',
    'payments, so the Gap is counted in paid tickets, not applications.',
  ],

  mixHeading: 'Channels: traffic mix',
  mixCaption: 'Figure 3 — Traffic mix by channel',
  mixEmpty: 'No data by channel for the period.',
  mixIntro: 'Channels for the period, sorted by visits. CR = applications / visits:',
  mixLine: (i, ch, v, g, cr) => `${i}. ${ch}: visits ${v}, applications ${g} (CR ${cr})`,
  mixText: [
    'Channels with a high application CR are candidates for more budget; high-volume channels with',
    'a low CR are candidates for a traffic-quality and path-to-payment review.',
  ],

  prioHeading: 'Hypothesis prioritisation (by ICE)',
  prioIntro: 'All hypotheses, sorted by ICE descending. Top — what we tackle first:',
  prioHeader: ['Hypothesis', 'I', 'C', 'E', 'ICE'],
  prioDetail: 'In detail (statements, statuses and deadlines):',
  defineHeading: 'Define — problem hypotheses (overview)',
  defineIntro: (n) => `${n} problem hypotheses recorded. Full card for each below.`,
  developHeading: 'Develop — solution hypotheses (overview)',
  developIntro: (n) => `${n} solution hypotheses recorded. Full card for each below.`,

  dlHeading: 'Deliver — Decision Log (overview)',
  dlEmpty: 'No completed checks yet.',
  dlIntro: (n) => `${n} decisions recorded. Details of each below.`,
  dlHeader: ['ID', 'Hypothesis', 'Status', 'Decision'],

  geoHeading: 'Top geo + devices',
  geoEmpty: 'No data on geo/devices for the period.',
  geoIntro: 'Geo (top 10 by visits, summed over all devices):',
  geoHeader: ['Geo', 'Visits'],
  deviceIntro: 'Devices (share of visits in the geo breakdown):',
  deviceHeader: ['Device', 'Visits', 'Share %'],
  pageHeader: ['Page', 'Visits'],
  utmHeading: 'Top UTM sources',
  utmIntro: 'Top traffic sources by visits (top 15, aggregated by source/medium):',
  utmHeader: ['Source', 'Medium', 'Visits'],
  utmEmpty: 'No data on UTM for the period.',
  entryHeading: 'Top entry pages',
  entryEmpty: 'No data on entry pages for the period.',
  exitHeading: 'Top exit pages',
  exitEmpty: 'No data on exit pages for the period.',

  roadmapHeading: 'Roadmap: what we do next',
  roadmapEmpty: 'No hypotheses yet — no roadmap yet.',
  roadmapIntro: 'Top priorities by ICE and the target result (🟢 threshold) of each hypothesis:',
  roadmapLine: (i, ice, title, green, days) =>
    `${i}. [ICE ${ice}] ${title} → target: ${green} (deadline ${days} d)`,
  roadmapText: [
    'Way of working: top to bottom; after each check record the outcome in the Decision Log',
    'and update priorities — the list is rebuilt from facts, not intuition.',
  ],

  glossaryHeading: 'Glossary and principles',
  glossary: [
    'Application — a Metrika goal reach (e.g. a form submission). Not equal to a payment.',
    'Payment (B2B) — an actually paid ticket from the manual pipeline (b2b_manual).',
    'CR (conversion rate) — share of visits that reached the goal (applications/visits).',
    'Bounce rate — share of bounced visits (one screen, no action).',
    'ICE — Impact × Confidence × Ease (product, 1–1000) — hypothesis priority score.',
    'Double Diamond — Define (problems) → Develop (solutions) → Deliver (decisions recorded).',
    'Traffic light 🟢/🟡/🔴 — outcome thresholds of a hypothesis check with a concrete metric.',
    'raw_responses — SQLite table of raw Metrika responses; the source of truth for every figure.',
    'Snapshot ID — identifier of an immutable data snapshot; guarantees identical DOCX/PDF/screen.',
  ],

  appendixHeading: 'Appendix: data',
  appendixChannels: (n) => `Channels in the sample: ${n} (aggregated per channel for the period;`,
  appendixRows: (n) => `daily slice rows in the sample: ${n})`,
  appendixTotals: 'Channel totals (visits · applications · CR):',
  appendixLine: (ch, v, g, cr) => `  • ${ch}: visits ${v}, applications ${g} (CR ${cr})`,
  appendixText: [
    'The full daily breakdown is not duplicated in the report to avoid noise: every row can be',
    'restored from raw_responses by (query_hash, date_from, date_to) — that is the source of truth.',
  ],
};

export const REPORT_TEXT: Record<ReportLocale, ReportText> = { ru: RU, en: EN };
