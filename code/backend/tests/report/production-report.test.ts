import { describe, it, expect } from 'vitest';
import { sniffAiFetch } from '../../src/report/production-report';
import type { AnthropicFetch } from '../../src/report/ai-insights';

/** ANA-33: the sniffing wrapper learns provider/model from the reply and replays the body. */

const jsonReply =
  (body: string, ok = true, status = 200): AnthropicFetch =>
  async () => ({ ok, status, text: async () => body });

describe('sniffAiFetch', () => {
  it('captures provider + model from the JSON envelope and replays the body once more', async () => {
    const calls: Array<{ provider?: string; model?: string }> = [];
    const inner = jsonReply(
      JSON.stringify({
        content: [{ type: 'text', text: 'ok' }],
        model: 'yandexgpt/latest',
        provider: 'yandexgpt',
      }),
    );
    const res = await sniffAiFetch(inner, (i) => calls.push(i))('u', {
      method: 'POST',
      headers: {},
      body: '{}',
    });
    expect(calls).toEqual([
      { provider: 'yandexgpt', model: 'yandexgpt/latest', content: [{ type: 'text', text: 'ok' }] },
    ]);
    // The downstream parser still gets the full body — res.text() is single-use upstream.
    expect(JSON.parse(await res.text()).content[0].text).toBe('ok');
    expect(res.ok).toBe(true);
  });

  it('ignores non-JSON bodies (error paths) and envelopes without attribution', async () => {
    const calls: Array<{ provider?: string; model?: string }> = [];
    await sniffAiFetch(jsonReply('502 Bad Gateway', false, 502), (i) => calls.push(i))('u', {
      method: 'POST',
      headers: {},
      body: '{}',
    });
    await sniffAiFetch(jsonReply(JSON.stringify({ content: [] })), (i) => calls.push(i))('u', {
      method: 'POST',
      headers: {},
      body: '{}',
    });
    expect(calls).toEqual([]);
  });
});
