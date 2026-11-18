import { describe, it, expect, vi } from 'vitest';
import type { ReportSnapshot } from '@pca/shared';
import type { AnthropicFetch } from '../../src/report/ai-insights';
import {
  snapshotFacts,
  buildInsightsRequest,
  parseInsights,
  generateInsights,
  ANTHROPIC_URL,
  INSIGHTS_CONCURRENCY,
} from '../../src/report/ai-insights';

const snapshot: ReportSnapshot = {
  id: 'snap-1',
  generatedAt: 'T',
  period: { from: '2025-01-01', to: '2025-01-07' },
  kpi: { target: 300, b2cApplications: 287, b2bPaidTickets: 20, gap: 280 },
  channels: [],
  hypotheses: { problems: [], solutions: [] },
  decisions: [],
  b2bSummary: { totalTickets: 0, paidTickets: 0, dealsCount: 0, deals: [], byStage: [] },
  funnel: { visits: 0, b2cApplications: 287, b2bPipelineTickets: 0, b2bPaidTickets: 20 },
  breakdowns: {
    utm: [{ source: 'vk', medium: 'cpc', campaign: 'spring', visits: 80, goalReaches: 4 }],
    geoDevice: [{ country: 'Russia', device: 'mobile', visits: 60, goalReaches: 3 }],
    entryPages: [{ page: '/reg', visits: 70, bounceRate: 0.2, goalReaches: 5 }],
    exitPages: [],
  },
};

/**
 * ANA-192: real marketing-grid summary (weeks + byMetric) — shared by the prompt-assembly
 * tests below (present/absent/empty-array cases).
 */
const marketingSummary: NonNullable<ReportSnapshot['marketing']> = {
  weeks: [{ key: '2026-08-01', start: '2026-08-01', end: '2026-08-14' }],
  byMetric: [
    {
      metricKey: 'tg_clicks',
      labelRu: 'переходы по ссылкам тг',
      labelEn: 'Telegram link clicks',
      section: 'content',
      total: 120,
      weeks: 1,
    },
    {
      metricKey: 'partner_posts',
      labelRu: 'сколько вышло партнерских постов',
      labelEn: 'Partner posts published',
      section: 'influence',
      total: 6,
      weeks: 1,
    },
  ],
};

describe('snapshotFacts', () => {
  it('includes the KPI numbers and the top breakdown rows', () => {
    const facts = snapshotFacts(snapshot);
    expect(facts).toContain('287');
    expect(facts).toContain('vk/cpc/spring');
    expect(facts).toContain('Russia/mobile');
  });

  it('renders "—" for a breakdown with no rows', () => {
    const empty = snapshotFacts({
      ...snapshot,
      breakdowns: { utm: [], geoDevice: [], entryPages: [], exitPages: [] },
    });
    expect(empty).toContain('Топ UTM: —');
  });

  it('ANA-165: adds the marketing weekly-grid totals when the snapshot carries them', () => {
    const facts = snapshotFacts({ ...snapshot, marketing: marketingSummary });
    expect(facts).toContain(
      'Маркетинг (источник: weekly marketing grid; недели 2026-08-01..2026-08-14)',
    );
    expect(facts).toContain('Контент-маркетинг — переходы по ссылкам тг: 120 (1 нед.)');
    expect(facts).toContain('Инфопартнёры — сколько вышло партнерских постов: 6 (1 нед.)');
  });

  it('ANA-165: no «Маркетинг» line without marketing data in the snapshot', () => {
    expect(snapshotFacts(snapshot)).not.toContain('Маркетинг');
  });

  it('ANA-192: labels the marketing block with its source — the weekly marketing grid', () => {
    const facts = snapshotFacts({ ...snapshot, marketing: marketingSummary });
    expect(facts).toContain('источник: weekly marketing grid');
  });

  it('ANA-192: empty byMetric array — the marketing block is omitted', () => {
    const facts = snapshotFacts({
      ...snapshot,
      marketing: { weeks: marketingSummary.weeks, byMetric: [] },
    });
    expect(facts).not.toContain('Маркетинг');
  });
});

describe('buildInsightsRequest', () => {
  it('builds an Anthropic request grounded in the snapshot, with an anti-hallucination system prompt', () => {
    const req = buildInsightsRequest(snapshot, 'claude-sonnet-4-6');
    expect(req.model).toBe('claude-sonnet-4-6');
    expect(req.system).toContain('ТОЛЬКО');
    expect(req.messages[0]?.content).toContain('snap-1');
    expect(req.max_tokens).toBeGreaterThan(0);
  });

  it('uses the snapshot KPI target (admin setting), not a hardcoded 300', () => {
    const req = buildInsightsRequest(
      { ...snapshot, kpi: { ...snapshot.kpi, target: 450 } },
      'claude-sonnet-4-6',
    );
    expect(req.messages[0]?.content).toContain('цели в 450 платных билетов');
    expect(req.messages[0]?.content).not.toContain('300 платных');
  });
});

describe('parseInsights', () => {
  it('joins text content blocks and ignores non-text blocks', () => {
    const raw = JSON.stringify({
      content: [
        { type: 'text', text: 'Итог: рост.' },
        { type: 'tool_use' },
        { type: 'text' }, // text block without a text field → contributes ''
        { type: 'text', text: 'Рекомендации: …' },
      ],
    });
    expect(parseInsights(raw)).toBe('Итог: рост.\n\nРекомендации: …');
  });

  it('throws on a body that does not match the schema', () => {
    expect(() => parseInsights('{"unexpected":true}')).toThrow(/schema/);
  });
});

describe('generateInsights', () => {
  it('POSTs to Anthropic with auth headers and returns the narrative', async () => {
    // Mock 5 chunk responses (reduced from 10 for speed)
    const doFetch = vi.fn<AnthropicFetch>().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ content: [{ type: 'text', text: `## Section\n\nанализ` }] }),
    });
    const out = await generateInsights(doFetch, {
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      snapshot,
    });
    // Should contain the joined sections (6 chunks incl. the final «Итоговый вывод»)
    expect(out).toContain('## Section');
    expect(out).toContain('анализ');
    expect(doFetch).toHaveBeenCalledTimes(6);
    const firstCall = doFetch.mock.calls[0];
    if (firstCall) {
      expect(firstCall[0]).toBe(ANTHROPIC_URL);
      expect(firstCall[1].headers['x-api-key']).toBe('sk-test');
      expect(firstCall[1].headers['anthropic-version']).toBeTruthy();
      // Every chunk's system prompt instructs ICE as a PRODUCT, not a mean.
      const sys = JSON.parse(firstCall[1].body).system as string;
      expect(sys).toContain('Impact × Confidence × Ease');
      expect(sys).toMatch(/ПРОИЗВЕДЕНИЕ|произведение/);
      expect(sys).toMatch(/НЕ.*средне/i);
    }
  });

  it('Регресс №4: locale en → LANGUAGE OVERRIDE in every system prompt and EN section headings', async () => {
    const doFetch = vi.fn<AnthropicFetch>().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ content: [{ type: 'text', text: 'analysis' }] }),
    });
    const out = await generateInsights(doFetch, {
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      snapshot,
      locale: 'en',
    });
    // Every chunk's system prompt carries the EN language override…
    expect(doFetch).toHaveBeenCalledTimes(6);
    for (const call of doFetch.mock.calls) {
      const sys = JSON.parse(call[1]?.body as string).system as string;
      expect(sys).toContain('LANGUAGE OVERRIDE');
      expect(sys).toContain('in fluent English');
    }
    // …and the joined section headings are the EN ones (Итог → Summary).
    expect(out).toContain('## Summary');
    expect(out).not.toContain('## Итог');
  });

  it('Регресс №4: locale ru (default) — no LANGUAGE OVERRIDE, RU headings preserved', async () => {
    const doFetch = vi.fn<AnthropicFetch>().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ content: [{ type: 'text', text: 'анализ' }] }),
    });
    const out = await generateInsights(doFetch, {
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      snapshot,
    });
    expect(out).toContain('## Итог');
    const sys = JSON.parse(doFetch.mock.calls[0]![1].body as string).system as string;
    expect(sys).not.toContain('LANGUAGE OVERRIDE');
  });

  it('runs chunks concurrently (bounded) and keeps the section order', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    let n = 0;
    const doFetch = vi.fn<AnthropicFetch>().mockImplementation(async () => {
      const id = n++;
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      // Earlier chunks finish LATER — the output must still follow the chunk order.
      await new Promise((r) => setTimeout(r, 30 - id * 4));
      inFlight--;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ content: [{ type: 'text', text: `body-${id}` }] }),
      };
    });
    const out = await generateInsights(doFetch, { apiKey: 'k', model: 'm', snapshot });
    expect(maxInFlight).toBe(INSIGHTS_CONCURRENCY);
    const order = [...out.matchAll(/body-(\d)/g)].map((m) => Number(m[1]));
    expect(order).toEqual([0, 1, 2, 3, 4, 5]);
    expect(out.indexOf('## Итоговый вывод')).toBeGreaterThan(out.indexOf('body-4'));
  });

  it('handles partial failures (some chunks fail, others succeed)', async () => {
    let callCount = 0;
    const doFetch = vi.fn<AnthropicFetch>().mockImplementation(async () => {
      callCount++;
      if (callCount <= 2) {
        // First 2 chunks fail
        return { ok: false, status: 401, text: async () => '{"error":"auth"}' };
      }
      // Rest succeed
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ content: [{ type: 'text', text: `## Section\n\nанализ` }] }),
      };
    });
    const out = await generateInsights(doFetch, {
      apiKey: 'bad',
      model: 'm',
      snapshot,
    });
    // Should still return output with error messages for failed chunks
    expect(out).toContain('Ошибка генерации');
    expect(out).toContain('анализ');
  });
});

describe('generateInsights — marketing in the chunk prompts (ANA-192)', () => {
  interface ChunkRequestBody {
    system: string;
    messages: { role: string; content: string }[];
  }

  const mockFetch = (): ReturnType<typeof vi.fn<AnthropicFetch>> =>
    vi.fn<AnthropicFetch>().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ content: [{ type: 'text', text: 'анализ' }] }),
    });

  it('feeds marketing facts into every chunk user prompt and asks the final chunk for marketing synthesis', async () => {
    const doFetch = mockFetch();
    await generateInsights(doFetch, {
      apiKey: 'k',
      model: 'm',
      snapshot: { ...snapshot, marketing: marketingSummary },
    });
    const bodies = doFetch.mock.calls.map((c) => JSON.parse(c[1].body) as ChunkRequestBody);
    expect(bodies).toHaveLength(6);
    // Every chunk shares the facts block → every user prompt carries the marketing totals
    // with their source (the weekly marketing grid).
    for (const body of bodies) {
      expect(body.messages[0]?.content).toContain('источник: weekly marketing grid');
      expect(body.messages[0]?.content).toContain('переходы по ссылкам тг: 120');
    }
    // The final-output chunk synthesizes marketing activities explicitly.
    const final = bodies.find((b) =>
      b.system.startsWith('Ты — старший продуктовый аналитик и руководитель трека'),
    );
    expect(final?.system).toContain('«Маркетинг»');
    expect(final?.system).toContain('marketing grid');
  });

  it('keeps marketing data out of the chunk user prompts without marketing in the snapshot', async () => {
    const doFetch = mockFetch();
    await generateInsights(doFetch, { apiKey: 'k', model: 'm', snapshot });
    const bodies = doFetch.mock.calls.map((c) => JSON.parse(c[1].body) as ChunkRequestBody);
    expect(bodies).toHaveLength(6);
    for (const body of bodies) {
      expect(body.messages[0]?.content).not.toContain('Маркетинг');
      expect(body.messages[0]?.content).not.toContain('marketing grid');
    }
  });

  it('keeps marketing data out of the chunk user prompts with an empty byMetric array', async () => {
    const doFetch = mockFetch();
    await generateInsights(doFetch, {
      apiKey: 'k',
      model: 'm',
      snapshot: { ...snapshot, marketing: { weeks: marketingSummary.weeks, byMetric: [] } },
    });
    const bodies = doFetch.mock.calls.map((c) => JSON.parse(c[1].body) as ChunkRequestBody);
    for (const body of bodies) {
      expect(body.messages[0]?.content).not.toContain('Маркетинг');
      expect(body.messages[0]?.content).not.toContain('marketing grid');
    }
  });
});
