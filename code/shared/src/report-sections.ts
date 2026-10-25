/**
 * Deterministic report content derived purely from a {@link ReportSnapshot}. DOCX, PDF and the
 * on-screen preview all render from this single source — so the report is reproducible (no
 * Date.now, no live data, no LLM in the render path) and identical across formats.
 *
 * The output is intentionally verbose: every hypothesis is rendered in full (hypothesis statement,
 * all hidden assumptions by category, every validation method, the ICE breakdown with each
 * rationale, the traffic-light thresholds, deadline and status), plus a prioritization section and
 * an expanded Decision Log. With a populated dataset this yields a detailed multi-page document.
 */
import type { Hypothesis } from './types/hypotheses';
import type { Decision } from './types/decisions';
import type { ReportSnapshot, ReportChartId } from './types/report';
import { iceBucket } from './validation';
import { buildReportRecommendations } from './report-recommendations';
import { chartRecommendation, REPORT_CHART_TITLES } from './report-charts';
import {
  BUCKET_LABEL,
  CATEGORY_LABEL,
  DECISION_OUTCOME_LABEL,
  KIND_LABEL,
  METHOD_LABEL,
  STATUS_LABEL,
  channelTotals,
  pct,
  priorityLine,
  hypothesisStatement,
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
function chartBlock(s: ReportSnapshot, id: ReportChartId): string[] {
  const rec = chartRecommendation(s, id);
  return [
    '',
    `Интерпретация диаграммы «${REPORT_CHART_TITLES[id]}» (по порогам, прослеживается до данных):`,
    '🟢 Что хорошо:',
    ...rec.good.map((g) => `  • ${g}`),
    '🔴 Что плохо:',
    ...rec.bad.map((b) => `  • ${b}`),
  ];
}

/** Parse markdown-style chunked AI narrative into report sections.
 * Ensures NO truncation: all text including trailing lines without headings is preserved. */
function parseChunkedNarrative(narrative: string): ReportSection[] {
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
    flush('Результирующий вывод');
  }
  return sections;
}

/** A full per-hypothesis section: every hypothesis field spelled out for the report reader. */
function hypothesisDetail(h: Hypothesis): ReportSection {
  const phase = h.diamondPhase === 'define' ? 'Define (проблема)' : 'Develop (решение)';
  const lines: string[] = [
    `Формулировка: ${hypothesisStatement(h)}`,
    `Тип: ${KIND_LABEL[h.kind]} · фаза Double Diamond: ${phase} · статус: ${STATUS_LABEL[h.status]}`,
  ];
  if (h.description) lines.push(`Описание: ${h.description}`);

  lines.push(
    '',
    `Приоритет ICE = I × C × E = ${h.impact} × ${h.confidence} × ${h.ease} = ${h.iceScore} (${BUCKET_LABEL[iceBucket(h.iceScore)]})`,
    `  • Impact ${h.impact}/10 — ${h.impactRationale}`,
    `  • Confidence ${h.confidence}/10 — ${h.confidenceRationale}`,
    `  • Ease ${h.ease}/10 — ${h.easeRationale}`,
  );

  lines.push('', `Скрытые допущения (${h.hiddenAssumptions.length}):`);
  if (h.hiddenAssumptions.length === 0) {
    lines.push('  — не зафиксированы');
  } else {
    for (const a of h.hiddenAssumptions) {
      lines.push(`  • [${CATEGORY_LABEL[a.category]}] ${a.text}`);
    }
  }

  lines.push('', `Методы проверки (${h.validationMethods.length}):`);
  if (h.validationMethods.length === 0) {
    lines.push('  — не зафиксированы');
  } else {
    for (const m of h.validationMethods) {
      const cost = m.cost ? ` (стоимость: ${m.cost})` : '';
      lines.push(`  • ${METHOD_LABEL[m.type]}: ${m.plan}${cost}`);
    }
  }

  lines.push(
    '',
    'Светофор критериев (порог решения):',
    `  🟢 Зелёный — ${h.greenCriteria}`,
    `  🟡 Жёлтый — ${h.yellowCriteria}`,
    `  🔴 Красный — ${h.redCriteria}`,
    `Дедлайн проверки: ${h.deadlineDays} дн. (до ${h.deadlineAt})`,
  );

  if (h.evidence && h.evidence.length > 0) {
    lines.push('', 'Данные-основания (прослеживаемость до raw_responses):');
    for (const e of h.evidence) {
      const ref = e.rawResponseId !== undefined ? ` [raw_response_id ${e.rawResponseId}]` : '';
      const slice = e.slice ? ` · срез: ${e.slice}` : '';
      const note = e.note ? ` — ${e.note}` : '';
      lines.push(`  • ${e.type}${ref}${slice}${note}`);
    }
  }

  // No leading ordinal — the builder adds ГОСТ through-numbering (D-DOUBLE-NUM). The
  // «(гипотеза)» suffix distinguishes data-driven cards from AI narrative sections.
  return { heading: `${h.title} (гипотеза)`, lines };
}

/** An expanded Decision Log entry: findings, evidence quotes, rationale and next step. */
function decisionDetail(d: Decision): ReportSection {
  const lines: string[] = [
    `Гипотеза #${d.hypothesisId} · метод: ${d.method} · период: ${d.periodDays} дн. · решение: ${d.outcome.toUpperCase()}`,
    `Охват проверки: ${d.scope}`,
    `Обоснование вывода: ${d.outcomeRationale}`,
  ];
  lines.push('', `Находки (${d.findings.length}):`);
  if (d.findings.length === 0) {
    lines.push('  — не зафиксированы');
  } else {
    for (const f of d.findings) lines.push(`  • [уверенность: ${f.confidence}] ${f.text}`);
  }
  lines.push('', `Доказательства (${d.evidence.length}):`);
  for (const e of d.evidence) {
    const ref = e.rawResponseId !== undefined ? ` [raw_response_id ${e.rawResponseId}]` : '';
    lines.push(`  • «${e.quote}» — ${e.source}${ref}`);
  }
  lines.push('', `Следующий шаг: ${d.nextStep}`);
  if (d.responsible) lines.push(`Ответственный: ${d.responsible}`);
  if (d.nextDeadline) lines.push(`Дедлайн следующего шага: ${d.nextDeadline}`);
  lines.push(
    `Решение принял: ${d.decidedBy}${d.participants ? ` · участники: ${d.participants}` : ''}`,
  );
  return { heading: `${d.number}: итог проверки`, lines };
}

/** «ОБОЗНАЧЕНИЯ, ТЕРМИНЫ И СОКРАЩЕНИЯ» — только сокращения; принципы методологии живут в
 * «Глоссарии и принципах», здесь их намеренно не дублируем. */
function designationsSection(): ReportSection {
  return {
    heading: 'ОБОЗНАЧЕНИЯ, ТЕРМИНЫ И СОКРАЩЕНИЯ',
    lines: [
      ...tableHeader('Термин', 'Расшифровка'),
      row(
        'KPI',
        'Key Performance Indicator — ключевой показатель эффективности; здесь — цель по оплаченным билетам за период',
      ),
      row(
        'CR',
        'Conversion Rate — конверсия: доля визитов, достигших цели (заявки/визиты или оплаты/визиты), в %',
      ),
      row(
        'UTM',
        'Urchin Tracking Module — метки источника трафика в ссылке (source / medium / campaign)',
      ),
      row(
        'ICE',
        'Impact × Confidence × Ease — балл приоритета гипотезы (произведение, 1–1000); каждый параметр обосновывается',
      ),
      row(
        'DL',
        'Decision Log — журнал решений: что проверяли, что узнали, исход и следующий шаг (записи вида DL-NNN)',
      ),
      row(
        'B2B',
        'Business-to-Business — корпоративные билеты; ведутся вручную (b2b_manual), оплаты зачитываются к цели',
      ),
      row(
        'B2C',
        'Business-to-Consumer — розничные посетители; их заявки — достижения целей Метрики',
      ),
      row(
        'DOCX',
        'Формат выгрузки отчёта (Word) — строится из того же среза данных, что PDF и экран',
      ),
      row('PDF', 'Печатный формат отчёта — рендерится из ГОСТ-HTML по тому же срезу данных'),
      row(
        'Gap',
        'Разрыв до цели: сколько оплаченных билетов не хватает до KPI (цель − зачтённые оплаты)',
      ),
      row(
        'WoW',
        'Week over Week — сравнение с предыдущей неделей; на дашбордах проекта, в отчёт входит через период среза',
      ),
      row(
        'Snapshot',
        'Срез данных — неизменяемый снимок всех цифр за период с уникальным ИД; DOCX, PDF и экран строятся из него',
      ),
      row(
        'pc-goals',
        'JS-скрипт событий билетной воронки на productcamp.ru: этапы от «увидел билеты» до «оставил контакты»',
      ),
      row('ГЧ', 'Главы и части отчёта: разделы документа нумеруются сквозно по ГОСТ Р 7.32-2017'),
      row(
        'CRM (СРМ)',
        'Система управления взаимоотношениями с клиентами; B2B-сделки проекта ведутся вручную в приложении',
      ),
      row('Bounce', 'Отказ — визит с одного экрана без действий; bounce rate — доля таких визитов'),
    ],
  };
}

/** «ВВЕДЕНИЕ» — назначение, источники, период, состав, ключевые оговорки. */
function introductionSection(s: ReportSnapshot): ReportSection {
  return {
    heading: 'ВВЕДЕНИЕ',
    lines: [
      'Назначение: аналитический отчёт по конверсиям и лидгену трека ProductCamp — как трафик превращается в заявки и оплаты, какие гипотезы роста проверены и что делать дальше.',
      'Источники данных: Яндекс Метрика (Reporting API; дневные агрегаты по каналам, UTM, гео, устройствам и страницам), счётчик ProductCamp; ручной B2B-пайплайн (b2b_manual); гипотезы и Decision Log приложения.',
      `Период отчёта: ${s.period.from} — ${s.period.to} (срез данных ${s.id} от ${s.generatedAt}).`,
      'Состав: обозначения → управленческое резюме → краткие итоги → методология → воронка и каналы → приоритизация и карточки гипотез → Decision Log → разрезы (UTM, гео, страницы) → приложение с данными.',
      'Ключевая оговорка: заявка ≠ оплата. Заявка — достижение цели Метрики, оплата — фактически оплаченный билет; эти метрики нигде не суммируются.',
      'Анти-галлюцинация: каждая цифра восходит к зафиксированному срезу (raw_responses в SQLite); в рендер-пути нет LLM и текущего времени — DOCX, PDF и экран строятся из одного среза и идентичны.',
    ],
  };
}

/** «УПРАВЛЕНЧЕСКОЕ РЕЗЮМЕ» — 6–10 выводов, каждый выведен из цифр снапшота (никаких внешних чисел). */
function executiveSummarySection(s: ReportSnapshot): ReportSection {
  const problems = s.hypotheses.problems;
  const solutions = s.hypotheses.solutions;
  const visits = s.funnel.visits;
  const credited = s.kpi.target - s.kpi.gap;
  const lines: string[] = [];

  lines.push(
    `- Цель периода — ${s.kpi.target} оплаченных билетов; зачтено ${credited} (выполнение ${pctNum(credited, s.kpi.target)}%), gap — ${s.kpi.gap}.`,
  );
  lines.push(
    `- Воронка: ${visits} визитов → ${s.funnel.b2cApplications} заявок B2C (CR ${pctOrDash(s.funnel.b2cApplications, visits)}) → ${s.kpi.b2bPaidTickets} оплаченных билетов B2B.`,
  );

  // Best / worst channel by CR among channels with visits — everything derived from snapshot rows.
  const withCr = channelTotals(s.channels)
    .filter((t) => t.visits > 0)
    .map((t) => ({ ...t, cr: t.goalReaches / t.visits }))
    .sort((a, b) => b.cr - a.cr);
  const best = withCr[0];
  const worst = withCr.length > 1 ? withCr[withCr.length - 1] : undefined;

  if (best) {
    lines.push(
      `- Лучший канал по CR: ${best.channel} — ${pctNum(best.goalReaches, best.visits)}% заявок с ${best.visits} визитов.`,
    );
  }
  if (worst && worst.channel !== best?.channel) {
    lines.push(
      `- Слабейший канал по CR: ${worst.channel} — ${pctNum(worst.goalReaches, worst.visits)}% заявок с ${worst.visits} визитов.`,
    );
  }

  if (visits > 0) {
    const bounceVisits = s.channels.reduce((a, c) => a + c.bounceRate * c.visits, 0);
    lines.push(
      `- Отказы: ${pctNum(bounceVisits, visits)}% визитов — средневзвешенный bounce rate по каналам.`,
    );
  }

  if (s.b2bSummary.dealsCount > 0) {
    lines.push(
      `- B2B-вклад: оплачено ${s.b2bSummary.paidTickets} из ${s.b2bSummary.totalTickets} билетов по ${s.b2bSummary.dealsCount} сделкам; в работе ещё ${s.funnel.b2bPipelineTickets}.`,
    );
  }

  // Main risk: positive gap, amplified by a high-volume channel converting below the overall CR.
  const overallCr = visits > 0 ? s.funnel.b2cApplications / visits : 0;
  const risky = withCr.filter((t) => t.cr < overallCr).sort((a, b) => b.visits - a.visits)[0];
  if (s.kpi.gap > 0) {
    lines.push(
      risky
        ? `- Главный риск: gap ${s.kpi.gap} билетов — заявка ≠ оплата; канал «${risky.channel}» даёт ${risky.visits} визитов при CR ${pctNum(risky.goalReaches, risky.visits)}% ниже общего.`
        : `- Главный риск: gap ${s.kpi.gap} билетов — заявка ≠ оплата, заявки без оплат цель не двигают.`,
    );
  }

  lines.push(
    best
      ? `- Главный рычаг: перераспределить бюджет в «${best.channel}» (лучший CR) и поднять конверсию объёмных каналов с низким CR.`
      : '- Главный рычаг: запустить трафик и первые проверки гипотез — данных по каналам пока нет.',
  );
  lines.push(
    `- Гипотезы: ${problems.length} проблемных + ${solutions.length} решенческих в приоритизации; закрытых проверок — ${s.decisions.length} (Decision Log).`,
  );

  return { heading: 'УПРАВЛЕНЧЕСКОЕ РЕЗЮМЕ', lines };
}

/** B2B summary section. */
function b2bSection(s: ReportSnapshot): ReportSection | null {
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
    `Всего B2B билетов: ${b2b.totalTickets}`,
    `Оплачено B2B: ${b2b.paidTickets}`,
    `Активных сделок: ${b2b.dealsCount}`,
    '',
    'Детализация по этапам:',
  ];
  for (const stage of b2b.byStage) {
    lines.push(`  • ${stage.stage}: ${stage.tickets} билетов (${stage.deals} сделок)`);
  }
  if (b2b.deals.length > 0) {
    lines.push('', 'Список сделок:');
    for (const d of b2b.deals) {
      lines.push(`  • ${d.company}: ${d.tickets} билетов [${d.stage}]`);
    }
  }

  return { heading: 'B2B-пайплайн', lines };
}

/** Funnel analysis section. */
function funnelSection(s: ReportSnapshot): ReportSection | null {
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
    `Этап 1: Визиты — ${funnel.visits}`,
    `Этап 2: Заявки B2C — ${funnel.b2cApplications} (CR ${visitToAppCR}%)`,
    `Этап 3: B2B в работе — ${funnel.b2bPipelineTickets} билетов`,
    `Этап 4: Оплачено B2B — ${funnel.b2bPaidTickets} билетов`,
    '',
    `Gap до цели (${s.kpi.target}): ${s.kpi.gap} платных билетов`,
    `Конверсия визит → заявка: ${visitToAppCR}%`,
  ];

  if (funnel.visits > 0 && funnel.b2cApplications > 0) {
    lines.push('');
    lines.push('Анализ воронки:');
    const lostVisits = funnel.visits - funnel.b2cApplications;
    lines.push(
      `  • Потеряно на этапе заявки: ${lostVisits} визитов (${((lostVisits / funnel.visits) * 100).toFixed(1)}%)`,
    );
    if (funnel.b2bPipelineTickets > 0) {
      lines.push(`  • B2B-пайплайн в работе: ${funnel.b2bPipelineTickets} билетов`);
    }
  }

  return { heading: 'Воронка конверсии', lines };
}

/** Detailed channel analysis section. */
function channelAnalysisSection(s: ReportSnapshot): ReportSection {
  const totals = channelTotals(s.channels);
  const totalVisits = totals.reduce((a, t) => a + t.visits, 0);

  const lines: string[] = [
    `Всего каналов: ${totals.length}`,
    `Суммарно визитов: ${totalVisits}`,
    `Суммарно заявок: ${s.kpi.b2cApplications}`,
    '',
    'Детализация по каналам (отсортировано по визитам):',
    '',
  ];

  for (let i = 0; i < totals.length; i++) {
    const t = totals[i];
    if (!t) continue;
    const cr = t.visits > 0 ? ((t.goalReaches / t.visits) * 100).toFixed(1) : '0.0';
    const share = totalVisits > 0 ? ((t.visits / totalVisits) * 100).toFixed(1) : '0.0';
    lines.push(`${i + 1}. ${t.channel}`);
    lines.push(`   Визиты: ${t.visits} (${share}% от общего трафика)`);
    lines.push(`   Заявки: ${t.goalReaches}`);
    lines.push(`   CR: ${cr}%`);
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

    lines.push('Выводы:');
    if (bestCr.channel) {
      lines.push(
        `  • Лучший CR: ${bestCr.channel} (${(bestCr.cr * 100).toFixed(1)}%) — масштабировать`,
      );
    }
    if (worstCr.channel && worstCr.cr > 0) {
      lines.push(
        `  • Худший CR: ${worstCr.channel} (${(worstCr.cr * 100).toFixed(1)}%) — проверить качество трафика`,
      );
    }
  }

  lines.push(
    '',
    'Детально (топ-10 по визитам):',
    ...tableHeader('Канал', 'Визиты', 'Заявки', 'CR %'),
  );
  for (const t of totals.slice(0, 10)) {
    lines.push(
      row(t.channel, String(t.visits), String(t.goalReaches), pctNum(t.goalReaches, t.visits)),
    );
  }

  lines.push(...chartBlock(s, 'channelBar'));
  return {
    heading: 'Каналы: трафик и конверсия',
    lines,
    chartId: 'channelBar',
    caption: 'Рисунок 1 — Воронка конверсии',
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
export function reportSections(s: ReportSnapshot): ReportSection[] {
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
      heading: 'ProductCamp · Конверсии и лидген',
      lines: [
        `Период: ${s.period.from} — ${s.period.to}`,
        `Срез данных: ${s.id} · сформирован ${s.generatedAt}`,
        `KPI: цель ${s.kpi.target} оплаченных билетов`,
        'Отчёт детерминированный: один ИД среза → идентичный контент в DOCX, PDF и на экране.',
        'Каждая цифра прослеживается до raw_responses в SQLite (анти-галлюцинация).',
      ],
    },
    designationsSection(),
    introductionSection(s),
    executiveSummarySection(s),
    {
      heading: 'Краткие итоги',
      lines: [
        `${s.goalLabel?.title ?? 'Заявок B2C'} (достижения основной цели за период): ${s.kpi.b2cApplications}`,
        `Оплачено B2B (билетов): ${s.kpi.b2bPaidTickets}`,
        `Gap до цели (по оплатам): ${s.kpi.gap}`,
        `Суммарно визитов в выборке каналов: ${totalVisits}`,
        '',
        'Главный разрыв: заявка ≠ оплата. Формальные цели Метрики (заявки) и фактические оплаты',
        'разведены везде в отчёте и не суммируются. Цель отчёта — показать, какой трафик приносит',
        'реальные оплаты, и приоритизировать гипотезы роста по методологии проверки гипотез.',
        '',
        `Гипотез в работе: ${problems.length} проблемных + ${solutions.length} решенческих.`,
        `Закрытых проверок (Decision Log): ${s.decisions.length}.`,
        '',
        'Ключевые цифры периода:',
        ...tableHeader('Показатель', 'Значение'),
        row('Цель периода (оплаченных билетов)', String(s.kpi.target)),
        row('Заявки B2C (достижения цели Метрики)', String(s.kpi.b2cApplications)),
        row('Оплачено B2B (билетов)', String(s.kpi.b2bPaidTickets)),
        row('Зачтено к цели (оплаченные билеты)', String(s.kpi.target - s.kpi.gap)),
        row('Gap до цели (билетов)', String(s.kpi.gap)),
        row('CR общий (заявки / визиты)', pctOrDash(s.kpi.b2cApplications, s.funnel.visits)),
        row('CR оплаты (оплачено / визиты)', pctOrDash(s.kpi.b2bPaidTickets, s.funnel.visits)),
      ],
    },
    {
      heading: 'Рекомендации: что хорошо и что плохо',
      lines: (() => {
        const rec = buildReportRecommendations(s);
        return [
          'Детерминированная оценка по порогам (CR ≥5% / <2%, отказы ≥70%), прослеживается до данных:',
          '',
          '🟢 Что хорошо:',
          ...rec.good.map((g) => `  • ${g}`),
          '',
          '🔴 Что плохо:',
          ...rec.bad.map((b) => `  • ${b}`),
        ];
      })(),
    },
    {
      heading: 'Методология',
      lines: [
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
      ],
    },
  ];

  // Funnel section
  const funnelSec = funnelSection(s);
  if (funnelSec) sections.push(funnelSec);

  // B2B section
  const b2bSec = b2bSection(s);
  if (b2bSec) sections.push(b2bSec);

  // Detailed channel analysis
  sections.push(channelAnalysisSection(s));

  sections.push({
    heading: 'Воронка: визит → заявка → оплата',
    chartId: 'funnel',
    caption: 'Рисунок 2 — Воронка: визит → заявка → оплата',
    lines: [
      `1) Визиты (сумма по каналам за период): ${totalVisits}`,
      `2) Заявки B2C (достижения цели): ${s.kpi.b2cApplications} — конверсия визит→заявка ${pct(
        s.kpi.b2cApplications,
        totalVisits,
      )}`,
      `3) Оплачено B2B (билетов): ${s.kpi.b2bPaidTickets}`,
      `Gap до цели в ${s.kpi.target} оплаченных билетов: ${s.kpi.gap}`,
      '',
      'Заявка ≠ оплата: шаги воронки не суммируются — это разные метрики из разных источников',
      '(заявки — из целей Метрики, оплаты B2B — из ручного пайплайна). Цель — двигать именно',
      'оплаты, поэтому Gap считается по оплаченным билетам, а не по заявкам.',
      ...chartBlock(s, 'funnel'),
    ],
  });

  sections.push({
    heading: 'Каналы: структура трафика',
    chartId: 'channelMix',
    caption: 'Рисунок 3 — Структура трафика по каналам',
    lines:
      channelTotals(s.channels).length === 0
        ? ['Нет данных по каналам за период.']
        : [
            'Каналы за период, отсортированы по визитам. CR = заявки / визиты:',
            '',
            ...channelTotals(s.channels).map(
              (t, i) =>
                `${i + 1}. ${t.channel}: визитов ${t.visits}, заявок ${t.goalReaches} (CR ${pct(
                  t.goalReaches,
                  t.visits,
                )})`,
            ),
            '',
            'Каналы с высоким CR в заявку — кандидаты на усиление бюджета; с высоким объёмом, но',
            'низким CR — кандидаты на проверку качества трафика и пути к оплате.',
            ...chartBlock(s, 'channelMix'),
          ],
  });

  // Hypothesis sections — only when hypotheses exist
  if (hasHypotheses) {
    sections.push({
      heading: 'Приоритизация гипотез (по ICE)',
      lines: [
        'Все гипотезы, отсортированы по убыванию ICE. Сверху — то, что бьём первым:',
        '',
        ...tableHeader('Гипотеза', 'I', 'C', 'E', 'ICE'),
        ...allByPriority.map((h) =>
          row(h.title, String(h.impact), String(h.confidence), String(h.ease), String(h.iceScore)),
        ),
        '',
        'Детально (формулировки, статусы и дедлайны):',
        '',
        ...allByPriority.map((h, i) => priorityLine(h, i + 1)),
      ],
    });

    sections.push({
      heading: 'Define — проблемные гипотезы (обзор)',
      lines: [
        `Заведено ${problems.length} проблемных гипотез. Полная карточка каждой — ниже.`,
        ...problems.map((h, i) => `  ${i + 1}) ${h.title} [ICE ${h.iceScore}]`),
      ],
    });
    sections.push(...problems.map((h) => hypothesisDetail(h)));

    sections.push({
      heading: 'Develop — решенческие гипотезы (обзор)',
      lines: [
        `Заведено ${solutions.length} решенческих гипотез. Полная карточка каждой — ниже.`,
        ...solutions.map((h, i) => `  ${i + 1}) ${h.title} [ICE ${h.iceScore}]`),
      ],
    });
    sections.push(...solutions.map((h) => hypothesisDetail(h)));
  }

  // AI-generated hypotheses — only when they exist
  if (hasAiHypotheses) {
    // Ordinals are stripped from card headings — the builder adds ГОСТ through-numbering.
    sections.push(
      ...aiHypothesisSections(s.generatedHypotheses).map((sec) => ({
        ...sec,
        heading: stripOrdinalPrefix(sec.heading),
      })),
    );
  }

  // AI-proposed decisions — only when they exist (helper returns [] otherwise)
  sections.push(
    ...aiDecisionSections(s.generatedDecisions).map((sec) => ({
      ...sec,
      heading: stripOrdinalPrefix(sec.heading),
    })),
  );

  // Decision Log — always show
  const hypothesisTitleById = new Map(
    [...problems, ...solutions].map((h) => [h.id, h.title] as const),
  );
  sections.push({
    heading: 'Deliver — Decision Log (обзор)',
    lines:
      s.decisions.length === 0
        ? ['Завершённых проверок пока нет.']
        : [
            `Зафиксировано ${s.decisions.length} решений. Детали каждого — ниже.`,
            '',
            ...tableHeader('ID', 'Гипотеза', 'Статус', 'Решение'),
            ...s.decisions.map((d) => {
              const title = hypothesisTitleById.get(d.hypothesisId);
              return row(
                d.number,
                title ? `#${d.hypothesisId} ${title}` : `#${d.hypothesisId}`,
                DECISION_OUTCOME_LABEL[d.outcome],
                d.nextStep,
              );
            }),
          ],
  });
  sections.push(...s.decisions.map(decisionDetail));

  // AI analysis (chunked narrative parsed into sections)
  if (s.aiNarrative) {
    const aiSections = parseChunkedNarrative(s.aiNarrative);
    if (aiSections.length > 0) {
      // Push parsed sections directly — they already have proper headings from ## markers
      sections.push(...aiSections);
    } else {
      // Fallback: no ## headings found, use generic AI-анализ heading
      sections.push({
        heading: 'AI-анализ (интерпретация, проверяйте по данным)',
        lines: s.aiNarrative.split('\n').filter((l) => l.trim() !== ''),
      });
    }
  }

  // Breakdown sections as markdown tables (rendered as real tables in DOCX/PDF/HTML).
  const geoBreakdown = (() => {
    if (s.breakdowns.geoDevice.length === 0) {
      return { heading: 'Топ гео + устройства', lines: ['Нет данных гео/устройств за период.'] };
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
      heading: 'Топ гео + устройства',
      lines: [
        'Гео (топ-10 по визитам, суммарно по всем устройствам):',
        '',
        ...tableHeader('Гео', 'Визиты'),
        ...countries.map(([country, geoVisits]) => row(country, String(geoVisits))),
        '',
        'Устройства (доля — от визитов в гео-разрезе):',
        '',
        ...tableHeader('Устройство', 'Визиты', 'Доля %'),
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
          ...tableHeader('Страница', 'Визиты'),
          ...rows.slice(0, 10).map((p) => row(p.page, String(p.visits))),
        ];

  sections.push(
    {
      heading: 'Топ источников UTM',
      lines: s.breakdowns.utm.length
        ? [
            'Топ источников трафика по визитам (топ-15, агрегировано по source/medium):',
            '',
            ...tableHeader('Источник (source)', 'Medium', 'Визиты'),
            ...s.breakdowns.utm.slice(0, 15).map((u) => row(u.source, u.medium, String(u.visits))),
          ]
        : ['Нет данных UTM за период.'],
    },
    geoBreakdown,
    {
      heading: 'Топ страниц входа',
      lines: pagesTable(s.breakdowns.entryPages, 'Нет данных по страницам входа за период.'),
    },
    {
      heading: 'Топ страниц выхода',
      lines: pagesTable(s.breakdowns.exitPages, 'Нет данных по страницам выхода за период.'),
    },
    {
      heading: 'Дорожная карта: что делаем дальше',
      lines: !hasHypotheses
        ? ['Гипотезы не заведены — дорожной карты пока нет.']
        : [
            'Топ-приоритеты по ICE и целевой результат (порог 🟢) каждой гипотезы:',
            '',
            ...allByPriority
              .slice(0, 3)
              .map(
                (h, i) =>
                  `${i + 1}. [ICE ${h.iceScore}] ${h.title} → цель: ${h.greenCriteria} (дедлайн ${h.deadlineDays} дн.)`,
              ),
            '',
            'Порядок работы: бьём сверху вниз, после каждой проверки фиксируем исход в Decision Log',
            'и обновляем приоритеты — список пересобирается по факту, а не по интуиции.',
          ],
    },
    {
      heading: 'Глоссарий и принципы',
      lines: [
        'Заявка — достижение цели Метрики (например, отправка формы). Не равна оплате.',
        'Оплата (B2B) — фактически оплаченный билет из ручного пайплайна (b2b_manual).',
        'CR (conversion rate) — доля визитов, дошедших до цели (заявки/визиты).',
        'Bounce rate — доля визитов с отказом (один экран, без действия).',
        'ICE — Impact × Confidence × Ease (произведение, 1–1000) — балл приоритета гипотезы.',
        'Double Diamond — Define (проблемы) → Develop (решения) → Deliver (решения зафиксированы).',
        'Светофор 🟢/🟡/🔴 — пороги исхода проверки гипотезы с конкретной метрикой.',
        'raw_responses — таблица сырых ответов Метрики в SQLite; источник правды для всех цифр.',
        'ИД среза — идентификатор неизменяемого среза данных; гарантирует идентичность DOCX/PDF/экрана.',
      ],
    },
    {
      heading: 'Приложение с данными',
      lines: [
        `Каналов в выборке: ${channelTotals(s.channels).length} (агрегировано по каналу за период;`,
        `строк-срезов по дням в выборке: ${s.channels.length})`,
        '',
        'Итоги по каналам (визиты · заявки · CR):',
        ...channelTotals(s.channels).map(
          (t) =>
            `  • ${t.channel}: визитов ${t.visits}, заявок ${t.goalReaches} (CR ${pct(t.goalReaches, t.visits)})`,
        ),
        '',
        'Полная посуточная разбивка не дублируется в отчёте во избежание шума: каждая строка',
        'восстановима из raw_responses по (query_hash, date_from, date_to) — это и есть источник правды.',
      ],
    },
  );

  // Drop sections whose only content is an empty-state placeholder («Нет данных…», «Завершённых
  // проверок пока нет», «Гипотезы не заведены…») — such heading-only sections are noise in the
  // DOCX/PDF/preview. A section survives only if it has at least one meaningful (non-placeholder) line.
  return sections.filter((sec) => {
    const meaningful = sec.lines.filter((l) => l.trim() !== '' && !EMPTY_STATE_RE.test(l.trim()));
    return meaningful.length > 0;
  });
}

/** Lines that signal «no data / nothing yet» — used to drop empty heading-only sections. */
const EMPTY_STATE_RE = /^(Нет данных|Завершённых проверок пока нет|Гипотезы не заведены)/;
