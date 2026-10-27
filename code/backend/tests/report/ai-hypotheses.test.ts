import { describe, it, expect, vi } from 'vitest';
import { iceScore } from '@pca/shared';
import type { ReportSnapshot } from '@pca/shared';
import {
  buildHypothesesRequest,
  buildHypothesesRetryRequest,
  parseHypotheses,
  generateHypotheses,
  extractJsonObject,
  repairJson,
  flagUnverifiedNumbers,
  findUnverifiedNumbers,
  snapshotNumberFacts,
  generatedToNewHypothesis,
  ImportAiBody,
  HYPOTHESES_MAX_TOKENS,
  ANTHROPIC_URL,
  type AnthropicFetch,
} from '../../src/report/ai-hypotheses';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const snapshot: ReportSnapshot = {
  id: 'snap-hyp-1',
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

/** Build a minimal valid raw hypotheses payload (as the AI would return — no ice.score). */
function makeProblem(id: string) {
  return {
    id,
    segment: 'Мобильный пользователь из России',
    trouble: 'высокий показатель отказов',
    action: 'заполнении формы регистрации',
    barrier: 'форма не адаптирована для мобильных устройств',
    evidence: '287 заявок B2C при 60 визитах с мобильных',
  };
}

function makeSolution(id: string, problemId: string) {
  return {
    id,
    problemId,
    action: 'адаптируем форму для мобильных',
    userBenefit: 'легко заполнить форму с телефона',
    businessResult: 'рост конверсии посетителей в заявки',
    successCriteria: 'CR с мобильных вырастет на 10% за 2 недели',
    risks: [
      { kind: 'value', note: 'пользователи могут не оценить изменение' },
      { kind: 'usability', note: 'новый дизайн может быть непривычным' },
      { kind: 'feasibility', note: 'требует переработки фронтенда' },
      { kind: 'business', note: 'рост затрат на разработку' },
      { kind: 'legal', note: 'нет юридических ограничений' },
    ],
    validation: {
      whatToVerify: 'увеличение CR с мобильных',
      methods: ['клик-тест на прототипе', 'A/B-тест'],
      audience: 'новые посетители с мобильных',
      channel: 'органический трафик из VK',
      successCriteria: '≥10% прирост CR',
    },
    ice: {
      impact: 8,
      confidence: 7,
      ease: 6,
      impactRationale: 'высокая доля мобильного трафика',
      confidenceRationale: 'данные из Метрики подтверждают проблему',
      easeRationale: 'стандартная адаптация формы',
    },
    trafficLight: {
      green: 'CR с мобильных ≥ 10% за 2 недели',
      yellow: 'CR 5–10%',
      red: 'CR < 5%',
    },
    deadline: '2025-02-15',
  };
}

/** Build a full raw payload with exactly N problems and M solutions. */
function makeRawPayload(numProblems: number, numSolutions: number): unknown {
  const problems = Array.from({ length: numProblems }, (_, i) =>
    makeProblem(`P${String(i + 1).padStart(2, '0')}`),
  );
  const solutions = Array.from({ length: numSolutions }, (_, i) =>
    makeSolution(`S${String(i + 1).padStart(2, '0')}`, problems[i % problems.length]!.id),
  );
  return { problems, solutions };
}

function fakeFetch(res: { ok: boolean; status: number; body: string }): AnthropicFetch {
  return vi.fn(async () => ({ ok: res.ok, status: res.status, text: async () => res.body }));
}

/** Wrap raw hypotheses payload inside an Anthropic Messages envelope. */
function anthropicEnvelope(payload: unknown): string {
  return JSON.stringify({
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  });
}

/** Envelope around an arbitrary model text, optionally with a stop_reason. */
function textEnvelope(text: string, stopReason?: string): string {
  return JSON.stringify({
    content: [{ type: 'text', text }],
    ...(stopReason ? { stop_reason: stopReason } : {}),
  });
}

/** A fetch returning the given bodies in order (200 OK each). */
function sequenceFetch(bodies: string[]): AnthropicFetch {
  let i = 0;
  return vi.fn(async () => {
    const body = bodies[Math.min(i, bodies.length - 1)]!;
    i++;
    return { ok: true, status: 200, text: async () => body };
  });
}

// ---------------------------------------------------------------------------
// buildHypothesesRequest
// ---------------------------------------------------------------------------

describe('buildHypothesesRequest', () => {
  it('returns a request with the correct model and max_tokens', () => {
    const req = buildHypothesesRequest(snapshot, 'claude-sonnet-4-6');
    expect(req.model).toBe('claude-sonnet-4-6');
    expect(req.max_tokens).toBeGreaterThan(0);
  });

  it('includes the snapshot id in the user message', () => {
    const req = buildHypothesesRequest(snapshot, 'claude-sonnet-4-6');
    expect(req.messages[0]?.content).toContain('snap-hyp-1');
  });

  it('references key snapshot numbers in the user message', () => {
    const req = buildHypothesesRequest(snapshot, 'claude-sonnet-4-6');
    // snapshotFacts embeds the KPI numbers and UTM data
    expect(req.messages[0]?.content).toContain('287');
    expect(req.messages[0]?.content).toContain('vk/cpc/spring');
  });

  it('has an anti-hallucination system prompt with the "заявка ≠ оплата" principle', () => {
    const req = buildHypothesesRequest(snapshot, 'claude-sonnet-4-6');
    expect(req.system).toContain('заявка ≠ оплата');
    expect(req.system).toContain('ТОЛЬКО');
  });

  it('instructs the model to produce at least 10 problems and 10 solutions', () => {
    const req = buildHypothesesRequest(snapshot, 'claude-sonnet-4-6');
    expect(req.system).toContain('≥10');
    expect(req.messages[0]?.content).toContain('минимум 10');
  });

  it('requires JSON-only output (no markdown wrapper)', () => {
    const req = buildHypothesesRequest(snapshot, 'claude-sonnet-4-6');
    expect(req.system).toContain('JSON');
    expect(req.system).toContain('markdown');
  });

  it('specifies all 5 risk kinds in the system prompt', () => {
    const req = buildHypothesesRequest(snapshot, 'claude-sonnet-4-6');
    expect(req.system).toContain('"value"');
    expect(req.system).toContain('"usability"');
    expect(req.system).toContain('"feasibility"');
    expect(req.system).toContain('"business"');
    expect(req.system).toContain('"legal"');
  });

  it('role is always "user"', () => {
    const req = buildHypothesesRequest(snapshot, 'm');
    expect(req.messages[0]?.role).toBe('user');
  });

  it('uses a 16000-token output budget', () => {
    const req = buildHypothesesRequest(snapshot, 'm');
    expect(req.max_tokens).toBe(16000);
    expect(HYPOTHESES_MAX_TOKENS).toBe(16000);
  });

  it('asks for short fields and properly escaped quotes', () => {
    const req = buildHypothesesRequest(snapshot, 'm');
    expect(req.system).toContain('160 символов');
    expect(req.system).toContain('\\"');
    expect(req.system).toContain('висячих запятых');
  });
});

describe('buildHypothesesRetryRequest', () => {
  it('keeps the original request and appends an invalid-JSON note to the single user message', () => {
    const base = buildHypothesesRequest(snapshot, 'm');
    const retry = buildHypothesesRetryRequest(base, 'invalid');
    expect(retry.model).toBe(base.model);
    expect(retry.max_tokens).toBe(base.max_tokens);
    expect(retry.system).toBe(base.system);
    expect(retry.messages).toHaveLength(1);
    expect(retry.messages[0]?.content.startsWith(base.messages[0]!.content)).toBe(true);
    expect(retry.messages[0]?.content).toContain('previous answer was invalid JSON');
    expect(retry.messages[0]?.content).toContain('strictly valid compact JSON');
  });

  it('mentions truncation when the previous answer hit max_tokens', () => {
    const base = buildHypothesesRequest(snapshot, 'm');
    const retry = buildHypothesesRetryRequest(base, 'truncated');
    expect(retry.messages[0]?.content).toContain('truncated');
    expect(retry.messages[0]?.content).toContain('strictly valid compact JSON');
  });
});

// ---------------------------------------------------------------------------
// extractJsonObject
// ---------------------------------------------------------------------------

describe('extractJsonObject', () => {
  it('strips ```json fences', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('strips bare ``` fences', () => {
    expect(extractJsonObject('```\n{"a":[1,2]}\n```')).toBe('{"a":[1,2]}');
  });

  it('strips prose before and after the object', () => {
    expect(extractJsonObject('Вот ответ: {"a":{"b":2}} Надеюсь, помог!')).toBe('{"a":{"b":2}}');
  });

  it('returns null when there is no object', () => {
    expect(extractJsonObject('no json here')).toBeNull();
    expect(extractJsonObject('} {')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// repairJson
// ---------------------------------------------------------------------------

describe('repairJson', () => {
  const parse = (s: string) => JSON.parse(repairJson(s)) as unknown;

  it('leaves valid JSON semantically unchanged', () => {
    const payload = makeRawPayload(10, 10);
    expect(parse(JSON.stringify(payload))).toEqual(payload);
    expect(parse(JSON.stringify(payload, null, 2))).toEqual(payload);
  });

  it('returns an empty string when there is no object', () => {
    expect(repairJson('nothing')).toBe('');
  });

  it('removes trailing commas in objects and arrays', () => {
    expect(parse('{"a":[1,2,],"b":{"c":"x",},}')).toEqual({ a: [1, 2], b: { c: 'x' } });
    expect(parse('{"a":[1,,2]}')).toEqual({ a: [1, 2] });
  });

  it('strips fences and prose around the object', () => {
    expect(parse('Ответ:\n```json\n{"a":1}\n```\nГотово.')).toEqual({ a: 1 });
    expect(parse('{"a":1} и ещё {"b":2}')).toEqual({ a: 1 });
  });

  it('escapes unescaped double quotes inside strings', () => {
    expect(parse('{"note":"кнопка "Купить" не видна","x":1}')).toEqual({
      note: 'кнопка "Купить" не видна',
      x: 1,
    });
  });

  it('escapes raw newlines and tabs inside strings', () => {
    expect(parse('{"a":"line1\nline2\tend"}')).toEqual({ a: 'line1\nline2\tend' });
  });

  it('inserts a missing comma between pretty-printed properties', () => {
    expect(parse('{\n  "a": "x"\n  "b": "y"\n}')).toEqual({ a: 'x', b: 'y' });
    expect(parse('{"a":[{"x":1}{"x":2}]}')).toEqual({ a: [{ x: 1 }, { x: 2 }] });
  });

  it('closes a string truncated mid-value plus all open containers', () => {
    expect(parse('{"problems":[{"id":"P01","trouble":"высокий отк')).toEqual({
      problems: [{ id: 'P01', trouble: 'высокий отк' }],
    });
  });

  it('drops a dangling escape when truncated right after a backslash', () => {
    expect(parse('{"a":"x\\')).toEqual({ a: 'x' });
    expect(parse('{"a":"x\\u04')).toEqual({ a: 'x' });
  });

  it('closes an array truncated mid-array (after a comma)', () => {
    expect(parse('{"a":[1,2,')).toEqual({ a: [1, 2] });
    expect(parse('{"a":[{"x":1},{"x":2},')).toEqual({ a: [{ x: 1 }, { x: 2 }] });
  });

  it('closes an array truncated right after an opening bracket', () => {
    expect(parse('{"a":[')).toEqual({ a: [] });
    expect(parse('{"a":[{')).toEqual({ a: [{}] });
  });

  it('cuts back a dangling key, colon or partial literal', () => {
    expect(parse('{"a":1,"b":[1],"c')).toEqual({ a: 1, b: [1] });
    expect(parse('{"a":1,"b":[1],"c":')).toEqual({ a: 1, b: [1] });
    expect(parse('{"a":"x","b":tru')).toEqual({ a: 'x' });
    expect(parse('{"a":"x","b":true')).toEqual({ a: 'x', b: true });
    expect(parse('{"a":"x","b":12')).toEqual({ a: 'x', b: 12 });
  });
});

// ---------------------------------------------------------------------------
// parseHypotheses
// ---------------------------------------------------------------------------

describe('parseHypotheses', () => {
  it('parses valid JSON with ≥10 problems and ≥10 solutions and computes ice.score', () => {
    const raw = JSON.stringify(makeRawPayload(10, 10));
    const result = parseHypotheses(raw);

    expect(result.problems).toHaveLength(10);
    expect(result.solutions).toHaveLength(10);

    const s = result.solutions[0]!;
    const expectedScore = iceScore(s.ice.impact, s.ice.confidence, s.ice.ease);
    expect(s.ice.score).toBe(expectedScore);
    // Sanity-check the formula (8 * 7 * 6 = 336)
    expect(s.ice.score).toBe(336);
  });

  it('computes ice.score deterministically regardless of AI text', () => {
    const raw = JSON.stringify(makeRawPayload(10, 10));
    const result = parseHypotheses(raw);
    for (const s of result.solutions) {
      expect(s.ice.score).toBe(s.ice.impact * s.ice.confidence * s.ice.ease);
    }
  });

  it('preserves all problem fields intact', () => {
    const raw = JSON.stringify(makeRawPayload(10, 10));
    const result = parseHypotheses(raw);
    const p = result.problems[0]!;
    expect(p.id).toBe('P01');
    expect(p.segment).toContain('Мобильный');
    expect(p.evidence).toBeTruthy();
  });

  it('preserves all solution fields intact', () => {
    const raw = JSON.stringify(makeRawPayload(10, 10));
    const result = parseHypotheses(raw);
    const s = result.solutions[0]!;
    expect(s.risks).toHaveLength(5);
    expect(s.validation.methods.length).toBeGreaterThanOrEqual(2);
    expect(s.validation.successCriteria).toBeTruthy();
    // §1.3: traffic-light criteria + deadline are preserved.
    expect(s.trafficLight.green).toBeTruthy();
    expect(s.trafficLight.yellow).toBeTruthy();
    expect(s.trafficLight.red).toBeTruthy();
    expect(s.deadline).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('rejects a solution missing the traffic light or with a malformed deadline', () => {
    const payload = JSON.parse(JSON.stringify(makeRawPayload(10, 10)));
    delete payload.solutions[0].trafficLight;
    expect(() => parseHypotheses(JSON.stringify(payload))).toThrow(/schema/);
    const payload2 = JSON.parse(JSON.stringify(makeRawPayload(10, 10)));
    payload2.solutions[0].deadline = '15.02.2025';
    expect(() => parseHypotheses(JSON.stringify(payload2))).toThrow(/schema/);
  });

  it('accepts more than 10 problems and solutions', () => {
    const raw = JSON.stringify(makeRawPayload(12, 15));
    const result = parseHypotheses(raw);
    expect(result.problems).toHaveLength(12);
    expect(result.solutions).toHaveLength(15);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseHypotheses('not-json')).toThrow('AI returned invalid JSON for hypotheses');
  });

  it('throws when there are fewer than 10 problems', () => {
    const raw = JSON.stringify(makeRawPayload(9, 10));
    expect(() => parseHypotheses(raw)).toThrow(/schema/);
  });

  it('throws when there are fewer than 10 solutions', () => {
    const raw = JSON.stringify(makeRawPayload(10, 9));
    expect(() => parseHypotheses(raw)).toThrow(/schema/);
  });

  it('throws when a risk kind is missing or invalid', () => {
    const payload = makeRawPayload(10, 10) as {
      solutions: Array<{ risks: Array<{ kind: string; note: string }> }>;
    };
    // Replace risks with only 4 entries (drop "legal")
    payload.solutions[0]!.risks = payload.solutions[0]!.risks.slice(0, 4);
    expect(() => parseHypotheses(JSON.stringify(payload))).toThrow(/schema/);
  });

  it('throws when an ICE factor is out of range', () => {
    const payload = makeRawPayload(10, 10) as {
      solutions: Array<{ ice: { impact: number; confidence: number; ease: number } }>;
    };
    payload.solutions[0]!.ice.impact = 11; // out of 1–10 range
    expect(() => parseHypotheses(JSON.stringify(payload))).toThrow(/schema/);
  });

  it('throws when validation has fewer than 2 methods', () => {
    const payload = makeRawPayload(10, 10) as {
      solutions: Array<{ validation: { methods: string[] } }>;
    };
    payload.solutions[0]!.validation.methods = ['только один метод'];
    expect(() => parseHypotheses(JSON.stringify(payload))).toThrow(/schema/);
  });

  it('throws when the JSON object is completely wrong shape', () => {
    expect(() => parseHypotheses('{"unexpected":true}')).toThrow(/schema/);
  });

  it('parses a valid payload wrapped in ```json fences with prose around', () => {
    const text = `Вот гипотезы:\n\`\`\`json\n${JSON.stringify(makeRawPayload(10, 10))}\n\`\`\`\nГотово.`;
    const result = parseHypotheses(text);
    expect(result.problems).toHaveLength(10);
    expect(result.solutions).toHaveLength(10);
  });

  it('repairs trailing commas and unescaped quotes', () => {
    const json = JSON.stringify(makeRawPayload(10, 10))
      .replace(
        '"evidence":"287 заявок B2C при 60 визитах с мобильных"',
        '"evidence":"287 "заявок" B2C"',
      )
      .replace(/\]\}$/, '],}');
    const result = parseHypotheses(json);
    expect(result.problems[0]?.evidence).toBe('287 "заявок" B2C');
    expect(result.solutions).toHaveLength(10);
  });

  it('salvages a truncated payload when ≥10 complete items remain (incomplete tail dropped)', () => {
    const full = JSON.stringify(makeRawPayload(10, 11));
    // Cut inside the 11th solution's validation block.
    const cut = full.slice(0, full.lastIndexOf('"whatToVerify"') + 20);
    const result = parseHypotheses(cut, { truncated: true });
    expect(result.problems).toHaveLength(10);
    expect(result.solutions).toHaveLength(10);
  });

  it('fails the schema clearly when a truncated payload has fewer than 10 complete items', () => {
    const full = JSON.stringify(makeRawPayload(10, 10));
    const cut = full.slice(0, full.lastIndexOf('"whatToVerify"') + 20);
    expect(() => parseHypotheses(cut, { truncated: true })).toThrow(
      /schema \(ответ модели обрезан по лимиту токенов\)/,
    );
    expect(() => parseHypotheses(cut)).toThrow(/schema/);
  });

  it('does not drop invalid items from a well-formed (non-repaired) payload', () => {
    const payload = makeRawPayload(10, 11) as { solutions: Array<{ deadline: string }> };
    payload.solutions[10]!.deadline = 'скоро';
    expect(() => parseHypotheses(JSON.stringify(payload))).toThrow(/schema/);
  });
});

// ---------------------------------------------------------------------------
// generateHypotheses
// ---------------------------------------------------------------------------

describe('generateHypotheses', () => {
  it('POSTs to Anthropic with the correct auth headers and returns parsed hypotheses', async () => {
    const payload = makeRawPayload(10, 10);
    const doFetch = fakeFetch({ ok: true, status: 200, body: anthropicEnvelope(payload) });

    const result = await generateHypotheses(snapshot, {
      fetch: doFetch,
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
    });

    expect(result.problems).toHaveLength(10);
    expect(result.solutions).toHaveLength(10);

    const call = vi.mocked(doFetch).mock.calls[0];
    expect(call?.[0]).toBe(ANTHROPIC_URL);
    expect(call?.[1].headers['x-api-key']).toBe('sk-test');
    expect(call?.[1].headers['anthropic-version']).toBeTruthy();
    expect(call?.[1].headers['content-type']).toBe('application/json');
  });

  it('includes the request body with model and messages', async () => {
    const payload = makeRawPayload(10, 10);
    const doFetch = fakeFetch({ ok: true, status: 200, body: anthropicEnvelope(payload) });

    await generateHypotheses(snapshot, {
      fetch: doFetch,
      apiKey: 'sk-test',
      model: 'test-model',
    });

    const call = vi.mocked(doFetch).mock.calls[0];
    const body = JSON.parse(call?.[1].body ?? '{}') as { model: string; messages: unknown[] };
    expect(body.model).toBe('test-model');
    expect(body.messages).toHaveLength(1);
  });

  it('throws on a non-2xx Anthropic response', async () => {
    const doFetch = fakeFetch({ ok: false, status: 401, body: '{"error":"auth"}' });

    await expect(
      generateHypotheses(snapshot, { fetch: doFetch, apiKey: 'bad', model: 'm' }),
    ).rejects.toThrow(/HTTP 401/);
  });

  it('throws when the Anthropic envelope does not match the expected schema', async () => {
    const doFetch = fakeFetch({ ok: true, status: 200, body: '{"unexpected":true}' });

    await expect(
      generateHypotheses(snapshot, { fetch: doFetch, apiKey: 'sk', model: 'm' }),
    ).rejects.toThrow(/envelope/);
  });

  it('throws when the model JSON inside the envelope is invalid', async () => {
    const envelope = JSON.stringify({
      content: [{ type: 'text', text: 'not-valid-json' }],
    });
    const doFetch = fakeFetch({ ok: true, status: 200, body: envelope });

    await expect(
      generateHypotheses(snapshot, { fetch: doFetch, apiKey: 'sk', model: 'm' }),
    ).rejects.toThrow('AI returned invalid JSON for hypotheses');
  });

  it('throws when the model returns fewer than 10 problems inside the envelope', async () => {
    const envelope = anthropicEnvelope(makeRawPayload(5, 10));
    const doFetch = fakeFetch({ ok: true, status: 200, body: envelope });

    await expect(
      generateHypotheses(snapshot, { fetch: doFetch, apiKey: 'sk', model: 'm' }),
    ).rejects.toThrow(/schema/);
  });

  it('computes ice.score deterministically even when the model omits it', async () => {
    const payload = makeRawPayload(10, 10);
    const doFetch = fakeFetch({ ok: true, status: 200, body: anthropicEnvelope(payload) });

    const result = await generateHypotheses(snapshot, {
      fetch: doFetch,
      apiKey: 'sk',
      model: 'm',
    });

    for (const s of result.solutions) {
      expect(s.ice.score).toBe(s.ice.impact * s.ice.confidence * s.ice.ease);
    }
  });

  it('concatenates multiple text content blocks before parsing', async () => {
    // Some Anthropic calls produce multiple text blocks; they should be joined before parse.
    const halfA = JSON.stringify(makeRawPayload(10, 10));
    // Split into two blocks — the second block is empty, first is the full JSON.
    const envelope = JSON.stringify({
      content: [
        { type: 'text', text: halfA },
        { type: 'tool_use' }, // non-text block — should be ignored
        { type: 'text' }, // text block without text field — contributes ''
      ],
    });
    const doFetch = fakeFetch({ ok: true, status: 200, body: envelope });

    const result = await generateHypotheses(snapshot, {
      fetch: doFetch,
      apiKey: 'sk',
      model: 'm',
    });

    expect(result.problems).toHaveLength(10);
  });

  it('makes exactly one call when the first answer is valid', async () => {
    const doFetch = sequenceFetch([anthropicEnvelope(makeRawPayload(10, 10))]);
    await generateHypotheses(snapshot, { fetch: doFetch, apiKey: 'sk', model: 'm' });
    expect(vi.mocked(doFetch).mock.calls).toHaveLength(1);
  });

  it('retries once when the first answer is broken JSON and succeeds on the second', async () => {
    const doFetch = sequenceFetch([
      textEnvelope('{"problems": [ {"id": "P01" "oops": }}}'),
      anthropicEnvelope(makeRawPayload(10, 10)),
    ]);
    const result = await generateHypotheses(snapshot, {
      fetch: doFetch,
      apiKey: 'sk',
      model: 'm',
    });
    expect(result.problems).toHaveLength(10);
    expect(result.solutions).toHaveLength(10);

    const calls = vi.mocked(doFetch).mock.calls;
    expect(calls).toHaveLength(2);
    const firstBody = JSON.parse(calls[0]![1].body) as {
      messages: Array<{ content: string }>;
    };
    const secondBody = JSON.parse(calls[1]![1].body) as {
      model: string;
      max_tokens: number;
      messages: Array<{ content: string }>;
    };
    expect(secondBody.model).toBe('m');
    expect(secondBody.max_tokens).toBe(16000);
    expect(secondBody.messages).toHaveLength(1);
    expect(firstBody.messages[0]?.content).not.toContain('previous answer was invalid JSON');
    expect(secondBody.messages[0]?.content).toContain('previous answer was invalid JSON');
  });

  it('retries once on a schema failure (too few items)', async () => {
    const doFetch = sequenceFetch([
      anthropicEnvelope(makeRawPayload(3, 3)),
      anthropicEnvelope(makeRawPayload(10, 10)),
    ]);
    const result = await generateHypotheses(snapshot, { fetch: doFetch, apiKey: 'sk', model: 'm' });
    expect(result.problems).toHaveLength(10);
    expect(vi.mocked(doFetch).mock.calls).toHaveLength(2);
  });

  it('throws after the second broken answer (no third call)', async () => {
    const doFetch = sequenceFetch([textEnvelope('not json at all'), textEnvelope('still no json')]);
    await expect(
      generateHypotheses(snapshot, { fetch: doFetch, apiKey: 'sk', model: 'm' }),
    ).rejects.toThrow('AI returned invalid JSON for hypotheses');
    expect(vi.mocked(doFetch).mock.calls).toHaveLength(2);
  });

  it('does not retry on a non-2xx response', async () => {
    const doFetch = fakeFetch({ ok: false, status: 500, body: 'boom' });
    await expect(
      generateHypotheses(snapshot, { fetch: doFetch, apiKey: 'sk', model: 'm' }),
    ).rejects.toThrow(/HTTP 500/);
    expect(vi.mocked(doFetch).mock.calls).toHaveLength(1);
  });

  it('treats stop_reason=max_tokens as truncated: salvages ≥10 complete items without a retry', async () => {
    const full = JSON.stringify(makeRawPayload(10, 11));
    const cut = full.slice(0, full.lastIndexOf('"whatToVerify"') + 20);
    const doFetch = sequenceFetch([textEnvelope(cut, 'max_tokens')]);
    const result = await generateHypotheses(snapshot, { fetch: doFetch, apiKey: 'sk', model: 'm' });
    expect(result.solutions).toHaveLength(10);
    expect(vi.mocked(doFetch).mock.calls).toHaveLength(1);
  });

  it('on stop_reason=max_tokens with <10 items retries with a truncation note', async () => {
    const full = JSON.stringify(makeRawPayload(10, 10));
    const cut = full.slice(0, full.lastIndexOf('"whatToVerify"') + 20);
    const doFetch = sequenceFetch([
      textEnvelope(cut, 'max_tokens'),
      textEnvelope(JSON.stringify(makeRawPayload(10, 10)), 'end_turn'),
    ]);
    const result = await generateHypotheses(snapshot, { fetch: doFetch, apiKey: 'sk', model: 'm' });
    expect(result.solutions).toHaveLength(10);
    const calls = vi.mocked(doFetch).mock.calls;
    expect(calls).toHaveLength(2);
    const secondBody = JSON.parse(calls[1]![1].body) as { messages: Array<{ content: string }> };
    expect(secondBody.messages[0]?.content).toContain('truncated');
  });

  it('reports truncation when both answers hit max_tokens', async () => {
    const full = JSON.stringify(makeRawPayload(10, 10));
    const cut = full.slice(0, full.lastIndexOf('"whatToVerify"') + 20);
    const doFetch = sequenceFetch([
      textEnvelope(cut, 'max_tokens'),
      textEnvelope(cut, 'max_tokens'),
    ]);
    await expect(
      generateHypotheses(snapshot, { fetch: doFetch, apiKey: 'sk', model: 'm' }),
    ).rejects.toThrow(/обрезан по лимиту токенов/);
  });

  it('throws an envelope error when the response body is not JSON', async () => {
    const doFetch = fakeFetch({ ok: true, status: 200, body: '<html>gateway</html>' });
    await expect(
      generateHypotheses(snapshot, { fetch: doFetch, apiKey: 'sk', model: 'm' }),
    ).rejects.toThrow(/envelope/);
  });

  it('ANA-38: a provider answer citing a fabricated number is flagged with unverifiedNumbers', async () => {
    const payload = makeRawPayload(10, 10) as {
      problems: Array<{ evidence: string }>;
      solutions: Array<{ ice: { impactRationale: string } }>;
    };
    // The model invents «5123 заявок» — that number does not exist in the snapshot.
    payload.problems[0]!.evidence = '5123 заявок B2C';
    payload.solutions[0]!.ice.impactRationale = '5123 заявок против 60 визитов';
    const doFetch = fakeFetch({ ok: true, status: 200, body: anthropicEnvelope(payload) });

    const result = await generateHypotheses(snapshot, { fetch: doFetch, apiKey: 'sk', model: 'm' });

    // The fabricated number is recorded on the hypothesis so the UI can warn the analyst.
    expect(result.problems[0]!.unverifiedNumbers).toContain('5123');
    expect(result.solutions[0]!.unverifiedNumbers).toContain('5123');
    // Hypotheses citing only real snapshot numbers stay clean.
    expect(result.problems[1]!.unverifiedNumbers).toEqual([]);
    expect(result.solutions[1]!.unverifiedNumbers).toEqual([]);
  });

  it('ANA-38: numbers backed by the snapshot (incl. rounding tolerance) are not flagged', () => {
    const payload = makeRawPayload(10, 10);
    const flagged = flagUnverifiedNumbers(parseHypotheses(JSON.stringify(payload)), snapshot);
    // «287 заявок B2C при 60 визитах с мобильных» — both numbers exist in the slice.
    expect(flagged.problems[0]!.unverifiedNumbers).toEqual([]);
    expect(flagged.solutions[0]!.unverifiedNumbers).toEqual([]);

    const facts = snapshotNumberFacts(snapshot);
    // Rounded share of the entry-page goal reaches (5/287 ≈ 1.74%): tolerance covers «1,7%».
    expect(findUnverifiedNumbers(['около 1,7% всех заявок'], facts)).toEqual([]);
    // A number that is nowhere in the facts is reported verbatim.
    expect(findUnverifiedNumbers(['целых 9,9% всех заявок'], facts)).toContain('9,9');
  });

  it('ANA-38: import maps an AI hypothesis to the backlog with source=ai + provider/model', () => {
    const parsed = ImportAiBody.safeParse({
      problem: makeProblem('P01'),
      solution: makeSolution('S01', 'P01'),
      provider: 'openrouter',
      model: 'claude-sonnet-4-6',
      snapshotId: 'snap-1',
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const draft = generatedToNewHypothesis(parsed.data);
    expect(draft.source).toBe('ai');
    expect(draft.aiProvider).toBe('openrouter');
    expect(draft.aiModel).toBe('claude-sonnet-4-6');
    expect(draft.evidence?.[0]?.slice).toBe('snapshot:snap-1');
    // The imported hypothesis must satisfy the full backlog format.
    expect(new Set(draft.hiddenAssumptions.map((a) => a.category))).toEqual(
      new Set(['behavior', 'market', 'tech']),
    );
    expect(new Set(draft.validationMethods.map((m) => m.type)).size).toBeGreaterThanOrEqual(2);

    // Unverified numbers (from the problem and the solution) survive the import — the analyst
    // sees the warning badge on the kanban card.
    const flagged = generatedToNewHypothesis({
      ...parsed.data,
      problem: { ...parsed.data.problem!, unverifiedNumbers: ['9999'] },
      solution: { ...parsed.data.solution, unverifiedNumbers: ['5123'] },
    });
    expect(flagged.unverifiedNumbers).toEqual(expect.arrayContaining(['5123', '9999']));
  });
});
