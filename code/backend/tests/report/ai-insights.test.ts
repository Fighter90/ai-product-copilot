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
