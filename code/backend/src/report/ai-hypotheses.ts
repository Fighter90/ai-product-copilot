import { z } from 'zod';
import { ASSUMPTION_CATEGORIES, iceScore } from '@pca/shared';
import type {
  AssumptionCategory,
  GeneratedHypotheses,
  HiddenAssumption,
  NewHypothesis,
  ProblemHypothesis,
  ReportSnapshot,
  SolutionHypothesis,
  SolutionRiskKind,
  ValidationMethod,
  ValidationMethodType,
} from '@pca/shared';
import { snapshotFacts } from './ai-insights';
import type { AnthropicFetch } from './ai-insights';
import { ANTHROPIC_URL, ANTHROPIC_VERSION } from './ai-insights';

export type { AnthropicFetch };
export { ANTHROPIC_URL };

// ---------------------------------------------------------------------------
// Request builder
// ---------------------------------------------------------------------------

export interface AnthropicHypothesesRequest {
  readonly model: string;
  readonly max_tokens: number;
  readonly system: string;
  readonly messages: readonly { role: 'user'; content: string }[];
}

/** Output budget: 10 problems + 10 fully specified solutions is ~15–20 KB of JSON. */
export const HYPOTHESES_MAX_TOKENS = 16000;
/** Per-field length limit requested in the prompt (keeps the payload well under the budget). */
const MAX_FIELD_CHARS = 160;

/**
 * Build the Anthropic request that asks the model to generate structured hypotheses.
 * Pure and deterministic given the same snapshot + model.
 *
 * The system prompt enforces:
 *   • «заявка ≠ оплата» — the model must not confuse goal reaches with paid tickets.
 *   • Anti-hallucination — only numbers present in the snapshot facts may be cited.
 *   • Strict JSON output matching GeneratedHypotheses minus ice.score (we compute that).
 *   • ≥10 problem hypotheses, ≥10 solution hypotheses.
 */
export function buildHypothesesRequest(
  snapshot: ReportSnapshot,
  model: string,
): AnthropicHypothesesRequest {
  const system =
    'Ты продуктовый аналитик ProductCamp. Отвечай СТРОГО JSON — никакого текста до или после ' +
    'фигурных скобок, без markdown-обёрток. Используй ТОЛЬКО числа и факты из данных снапшота — НИЧЕГО не выдумывай. ' +
    'ПРИНЦИП «заявка ≠ оплата»: b2cApplications — это достижения цели (заявки), а не оплаты; ' +
    'b2bPaidTickets — реально оплаченные B2B-билеты. Не путай эти два числа. ' +
    'ПРАВИЛА ФОРМАТА (критично, ответ парсится машинно): ' +
    '1) компактный JSON в одну строку, без отступов и переносов строк; ' +
    `2) каждое строковое поле — одна короткая фраза не длиннее ${MAX_FIELD_CHARS} символов; ` +
    '3) внутри строк НЕ используй символ " — для цитат и названий используй «ёлочки»; ' +
    'если без " не обойтись, экранируй его как \\"; ' +
    '4) никаких переносов строк, markdown, эмодзи и комментариев внутри значений; ' +
    '5) никаких висячих запятых. ' +
    'Формат ответа: JSON объект {"problems":[...],"solutions":[...]}. ' +
    'problems — массив ровно из 10 объектов (≥10 обязательно, больше не нужно) вида ' +
    '{"id":"P01","segment":"...","trouble":"...","action":"...","barrier":"...","evidence":"..."}. ' +
    'Формула проблемы: «[segment] испытывает [trouble] при [action], потому что [barrier]». ' +
    'evidence — ссылка на конкретное число из данных снапшота (например «287 заявок B2C»). ' +
    'solutions — массив ровно из 10 объектов (≥10 обязательно, по одному на проблему) вида ' +
    '{"id":"S01","problemId":"P01","action":"...","userBenefit":"...","businessResult":"...",' +
    '"successCriteria":"...","risks":[...],"validation":{...},"ice":{...}}. ' +
    'Формула решения: «Если [action], то [userBenefit], что приведёт к [businessResult]». ' +
    'successCriteria — измеримый критерий («увеличим конверсию на X%» или «снизим отток на Y%»). ' +
    'risks — ровно 5 объектов: {"kind":"value","note":"..."},{"kind":"usability","note":"..."},' +
    '{"kind":"feasibility","note":"..."},{"kind":"business","note":"..."},{"kind":"legal","note":"..."}. ' +
    'validation — объект {"whatToVerify":"...","methods":["метод1","метод2"],"audience":"...",' +
    '"channel":"...","successCriteria":"..."}; минимум 2 метода. ' +
    'ice — объект {"impact":N,"confidence":N,"ease":N,"impactRationale":"...","confidenceRationale":"...",' +
    '"easeRationale":"..."} где N — целое 1–10; НЕ включай поле score (оно вычисляется детерминированно). ' +
    'ВАЖНО: итоговый ICE = Impact × Confidence × Ease (ПРОИЗВЕДЕНИЕ трёх оценок, шкала 1–1000), ' +
    'НЕ среднее арифметическое. Выбирай impact/confidence/ease с учётом того, что они перемножаются. ' +
    'trafficLight — объект {"green":"...","yellow":"...","red":"..."}: критерии исхода проверки ' +
    '(зелёный / жёлтый / красный) с конкретными порогами. ' +
    'deadline — дата проверки в формате YYYY-MM-DD. ' +
    'Все строки — на русском языке. Ответ должен быть валидным JSON без markdown-обёртки.';

  const user =
    `Снапшот ${snapshot.id}. Данные:\n${snapshotFacts(snapshot)}\n\n` +
    'Сгенерируй ровно 10 (минимум 10) гипотез проблем и минимум 10 гипотез решений для команды трека ' +
    '«Конверсии и лидген». Каждая гипотеза должна опираться на конкретные числа из данных выше. ' +
    'Каждое решение должно ссылаться на id соответствующей проблемы. ' +
    'Строго соблюдай принцип «заявка ≠ оплата». Пиши кратко. Верни только компактный валидный JSON.';

  return {
    model,
    max_tokens: HYPOTHESES_MAX_TOKENS,
    system,
    messages: [{ role: 'user', content: user }],
  };
}

/** Build the single retry request: same prompt plus a note about why the first answer was rejected. */
export function buildHypothesesRetryRequest(
  base: AnthropicHypothesesRequest,
  reason: 'invalid' | 'truncated',
): AnthropicHypothesesRequest {
  const note =
    reason === 'truncated'
      ? 'ВНИМАНИЕ: предыдущий ответ был обрезан по лимиту токенов (previous answer was truncated). ' +
        'Пиши короче: ровно 10 проблем и 10 решений, каждое поле — короткая фраза. ' +
        'Return strictly valid compact JSON.'
      : 'ВНИМАНИЕ: предыдущий ответ был невалидным JSON (previous answer was invalid JSON). ' +
        'Return strictly valid compact JSON: без markdown, без висячих запятых, ' +
        'без неэкранированных " внутри строк, ровно 10 проблем и 10 решений.';
  const [first] = base.messages;
  return {
    ...base,
    messages: [{ role: 'user', content: `${first?.content ?? ''}\n\n${note}` }],
  };
}

// ---------------------------------------------------------------------------
// Zod schema for the raw AI response (without ice.score — we compute it)
// ---------------------------------------------------------------------------

const SolutionRiskKindSchema = z.enum(['value', 'usability', 'feasibility', 'business', 'legal']);

const SolutionRiskSchema = z.object({
  kind: SolutionRiskKindSchema,
  note: z.string().min(1),
});

const ValidationPlanSchema = z.object({
  whatToVerify: z.string().min(1),
  methods: z.array(z.string().min(1)).min(2),
  audience: z.string().min(1),
  channel: z.string().min(1),
  successCriteria: z.string().min(1),
});

const IceInputSchema = z.object({
  impact: z.number().int().min(1).max(10),
  confidence: z.number().int().min(1).max(10),
  ease: z.number().int().min(1).max(10),
  impactRationale: z.string().min(1),
  confidenceRationale: z.string().min(1),
  easeRationale: z.string().min(1),
});

const ProblemHypothesisSchema = z.object({
  id: z.string().min(1),
  segment: z.string().min(1),
  trouble: z.string().min(1),
  action: z.string().min(1),
  barrier: z.string().min(1),
  evidence: z.string().min(1),
});

const TrafficLightSchema = z.object({
  green: z.string().min(1),
  yellow: z.string().min(1),
  red: z.string().min(1),
});

const SolutionHypothesisSchema = z.object({
  id: z.string().min(1),
  problemId: z.string().min(1),
  action: z.string().min(1),
  userBenefit: z.string().min(1),
  businessResult: z.string().min(1),
  successCriteria: z.string().min(1),
  risks: z.array(SolutionRiskSchema).length(5),
  validation: ValidationPlanSchema,
  ice: IceInputSchema,
  trafficLight: TrafficLightSchema,
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const RawHypothesesSchema = z.object({
  problems: z.array(ProblemHypothesisSchema).min(10),
  solutions: z.array(SolutionHypothesisSchema).min(10),
});

// ---------------------------------------------------------------------------
// JSON extraction + repair
// ---------------------------------------------------------------------------

/**
 * Extract the outermost JSON object from an AI reply: strips ```json fences and any prose
 * before/after the braces. Models routinely wrap strict-JSON answers in fences or add a
 * closing sentence — the raw JSON.parse would reject a perfectly valid payload.
 */
export function extractJsonObject(text: string): string | null {
  const fence = /```(?:json)?\s*([\s\S]*?)```/m.exec(text);
  const candidate = fence ? fence[1]! : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  return start >= 0 && end > start ? candidate.slice(start, end + 1) : null;
}

type Sig = 'none' | 'open' | 'comma' | 'colon' | 'key' | 'value' | 'literal';

const LITERAL_RE = /^(?:true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)$/;
const CLOSER: Record<string, string> = { '{': '}', '[': ']' };

/**
 * Best-effort repair of a malformed / truncated JSON object produced by an LLM. Self-contained,
 * single pass, no dependencies. Handles:
 *   • ```json fences and prose before the first `{` / after the root object closes;
 *   • trailing commas (`[1,2,]`, `{"a":1,}`) and doubled commas;
 *   • missing commas between values (`"a":"x"\n "b":"y"`, `}{`);
 *   • unescaped `"` inside strings (a quote is treated as closing only when followed by
 *     `, } ] :` / end of text, or by a newline and the next key);
 *   • raw control characters (newlines, tabs) inside strings;
 *   • truncation: an open value string is closed, a dangling key / colon / partial literal is cut
 *     back to the last complete value, and all open arrays/objects are closed.
 * Returns the repaired text (which may still be invalid JSON if the input is hopeless — the caller
 * re-parses it). Returns '' when no `{` is present.
 */
export function repairJson(text: string): string {
  let src = text;
  const start = src.indexOf('{');
  if (start < 0) return '';
  src = src.slice(start);
  const fenceEnd = src.indexOf('```');
  if (fenceEnd >= 0) src = src.slice(0, fenceEnd);

  const out: string[] = [];
  const stack: string[] = [];
  let inString = false;
  let stringIsKey = false;
  let escape = false;
  let prev: Sig = 'none';
  let literal = '';
  let safe: { len: number; stack: string[] } = { len: 0, stack: [] };
  const markSafe = (len = out.length) => {
    safe = { len, stack: [...stack] };
  };
  const insertCommaIfNeeded = () => {
    if (prev === 'value' || prev === 'literal') {
      out.push(',');
      prev = 'comma';
    }
  };
  const endLiteral = () => {
    if (prev === 'literal') {
      prev = 'value';
      literal = '';
    }
  };

  let rootClosed = false;
  for (let i = 0; i < src.length && !rootClosed; i++) {
    const c = src[i]!;

    if (inString) {
      if (escape) {
        out.push(c);
        escape = false;
      } else if (c === '\\') {
        out.push(c);
        escape = true;
      } else if (c === '"') {
        let j = i + 1;
        while (j < src.length && /\s/.test(src[j]!)) j++;
        const next = src[j];
        const closing =
          next === undefined ||
          ',}]:'.includes(next) ||
          (next === '"' && src.slice(i + 1, j).includes('\n'));
        if (closing) {
          out.push('"');
          inString = false;
          prev = stringIsKey ? 'key' : 'value';
          if (!stringIsKey) markSafe();
        } else {
          out.push('\\"');
        }
      } else {
        const code = c.charCodeAt(0);
        if (c === '\n') out.push('\\n');
        else if (c === '\r') out.push('\\r');
        else if (c === '\t') out.push('\\t');
        else if (code < 0x20) out.push(' ');
        else out.push(c);
      }
      continue;
    }

    if (/\s/.test(c)) {
      endLiteral();
      out.push(c);
      continue;
    }

    switch (c) {
      case '"': {
        endLiteral();
        insertCommaIfNeeded();
        stringIsKey = stack[stack.length - 1] === '{' && (prev === 'open' || prev === 'comma');
        inString = true;
        out.push(c);
        break;
      }
      case '{':
      case '[': {
        endLiteral();
        insertCommaIfNeeded();
        stack.push(c);
        out.push(c);
        prev = 'open';
        markSafe();
        break;
      }
      case '}':
      case ']': {
        endLiteral();
        if (prev === 'comma') {
          // Trailing comma: drop it (and any whitespace after it).
          let k = out.length - 1;
          while (k >= 0 && /^\s*$/.test(out[k]!)) k--;
          if (out[k] === ',') out.splice(k, 1);
        }
        stack.pop();
        out.push(c);
        prev = 'value';
        markSafe();
        if (stack.length === 0) rootClosed = true;
        break;
      }
      case ',': {
        endLiteral();
        if (prev === 'value') {
          markSafe();
          out.push(c);
          prev = 'comma';
        }
        // Doubled / leading commas are dropped.
        break;
      }
      case ':': {
        endLiteral();
        out.push(c);
        prev = 'colon';
        break;
      }
      default: {
        if (prev !== 'literal') {
          insertCommaIfNeeded();
          literal = '';
        }
        literal += c;
        out.push(c);
        prev = 'literal';
      }
    }
  }

  if (rootClosed) return out.join('');

  const closeWith = (parts: string[], openStack: string[]): string =>
    parts.join('') +
    [...openStack]
      .reverse()
      .map((o) => CLOSER[o])
      .join('');

  if (inString) {
    if (stringIsKey) return closeWith(out.slice(0, safe.len), safe.stack);
    if (escape) out.pop();
    let body = out.join('');
    body = body.replace(/\\u[0-9a-fA-F]{0,3}$/, '');
    return closeWith([body, '"'], stack);
  }

  if (prev === 'literal' && LITERAL_RE.test(literal)) prev = 'value';
  switch (prev) {
    case 'value':
    case 'open':
      return closeWith(out, stack);
    case 'comma': {
      let k = out.length - 1;
      while (k >= 0 && /^\s*$/.test(out[k]!)) k--;
      return closeWith(out.slice(0, k), stack);
    }
    default:
      // Dangling key, colon or partial literal — cut back to the last complete value.
      return closeWith(out.slice(0, safe.len), safe.stack);
  }
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

function invalidJsonError(detail: string): Error {
  return new Error(`AI returned invalid JSON for hypotheses: ${detail}. Повторите генерацию.`);
}

/** Try strict parse → fenced/prose extraction → repair. Reports whether repair was needed. */
function parseLenientJson(text: string, truncated: boolean): { json: unknown; repaired: boolean } {
  let firstError = '';
  if (!truncated) {
    try {
      return { json: JSON.parse(text), repaired: false };
    } catch (err) {
      firstError = (err as Error).message;
    }
    const extracted = extractJsonObject(text);
    if (extracted) {
      try {
        return { json: JSON.parse(extracted), repaired: false };
      } catch (err) {
        firstError = (err as Error).message;
      }
    }
  }
  const repaired = repairJson(text);
  if (!repaired) {
    throw new Error('AI returned invalid JSON for hypotheses (no JSON object found)');
  }
  try {
    return { json: JSON.parse(repaired), repaired: true };
  } catch (err) {
    throw invalidJsonError((firstError || (err as Error).message).slice(0, 200));
  }
}

/**
 * After a repair (truncated / malformed output) the last array element is usually incomplete.
 * Drop elements that fail their own schema so the remaining complete ones can still pass;
 * the ≥10 requirement is enforced afterwards by RawHypothesesSchema.
 */
function dropInvalidItems(json: unknown): unknown {
  if (!json || typeof json !== 'object') return json;
  const obj = json as Record<string, unknown>;
  const keep = (arr: unknown, schema: z.ZodTypeAny) =>
    Array.isArray(arr) ? arr.filter((item) => schema.safeParse(item).success) : arr;
  return {
    ...obj,
    problems: keep(obj.problems, ProblemHypothesisSchema),
    solutions: keep(obj.solutions, SolutionHypothesisSchema),
  };
}

/**
 * Parse and validate the AI's JSON output.
 * Throws a descriptive error if:
 *   • The text is not valid JSON, even after extraction and repairJson().
 *   • The shape does not match RawHypothesesSchema (includes <10 problems or <10 solutions).
 * `opts.truncated` (stop_reason = max_tokens) skips the strict parse and goes straight to repair;
 * repaired payloads have incomplete items dropped before the ≥10 check.
 * For each solution, ice.score is computed deterministically via iceScore() — the AI value
 * is never trusted.
 */
export function parseHypotheses(
  text: string,
  opts: { truncated?: boolean } = {},
): GeneratedHypotheses {
  const truncated = opts.truncated ?? false;
  const { json, repaired } = parseLenientJson(text, truncated);

  const parsed = RawHypothesesSchema.safeParse(repaired ? dropInvalidItems(json) : json);
  if (!parsed.success) {
    const suffix = truncated ? ' (ответ модели обрезан по лимиту токенов)' : '';
    throw new Error(
      `Hypotheses response did not match the expected schema${suffix}: ${parsed.error.message}`,
    );
  }

  const { problems, solutions } = parsed.data;

  return {
    problems,
    solutions: solutions.map((s) => ({
      ...s,
      ice: {
        ...s.ice,
        score: iceScore(s.ice.impact, s.ice.confidence, s.ice.ease),
      },
    })),
  };
}

// ---------------------------------------------------------------------------
// Generator (injectable fetch — same pattern as generateInsights)
// ---------------------------------------------------------------------------

const ResponseSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  stop_reason: z.string().nullish(),
  /** Model that answered (Anthropic / provider-chain adapter). */
  model: z.string().nullish(),
  /** Provider id — set by the provider-chain adapter (chainAsAnthropicFetch). */
  provider: z.string().nullish(),
});

interface HypothesesReply {
  readonly text: string;
  readonly truncated: boolean;
  readonly model?: string;
  readonly provider?: string;
}

async function requestHypotheses(
  request: AnthropicHypothesesRequest,
  deps: { fetch: AnthropicFetch; apiKey: string },
): Promise<HypothesesReply> {
  const res = await deps.fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': deps.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Anthropic hypotheses request failed (HTTP ${res.status}): ${raw}`);
  }

  // The Anthropic Messages response wraps the model's reply in content[].text blocks.
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    body = undefined;
  }
  const envelope = ResponseSchema.safeParse(body);
  if (!envelope.success) {
    throw new Error('Anthropic response envelope did not match the expected schema');
  }
  const text = envelope.data.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
    .trim();
  return {
    text,
    truncated: envelope.data.stop_reason === 'max_tokens',
    model: envelope.data.model ?? undefined,
    provider: envelope.data.provider ?? undefined,
  };
}

/** Parse a reply, flag numbers absent from the snapshot (ANA-38) and record provider/model. */
function finishHypotheses(
  reply: HypothesesReply,
  snapshot: ReportSnapshot,
  fallbackModel: string,
): GeneratedHypotheses {
  const parsed = parseHypotheses(reply.text, { truncated: reply.truncated });
  return {
    ...flagUnverifiedNumbers(parsed, snapshot),
    meta: {
      ...(reply.provider ? { provider: reply.provider } : {}),
      model: reply.model ?? fallbackModel,
    },
  };
}

/**
 * Call Anthropic to generate structured hypotheses from the snapshot.
 * If the reply cannot be parsed/validated (invalid JSON even after repair, schema mismatch,
 * or truncation at max_tokens), makes exactly ONE more call with a corrective note.
 * Throws when the Anthropic key is absent, the HTTP response is non-2xx,
 * or both attempts are rejected by parseHypotheses().
 * Every hypothesis is then checked against the snapshot numbers (flagUnverifiedNumbers) and the
 * result carries `meta.provider` / `meta.model` for the «AI» label on import.
 * Never logs the API key.
 */
export async function generateHypotheses(
  snapshot: ReportSnapshot,
  deps: { fetch: AnthropicFetch; apiKey: string; model: string },
): Promise<GeneratedHypotheses> {
  const request = buildHypothesesRequest(snapshot, deps.model);

  const first = await requestHypotheses(request, deps);
  try {
    return finishHypotheses(first, snapshot, deps.model);
  } catch {
    // Fall through to the single retry below.
  }

  const retry = buildHypothesesRetryRequest(request, first.truncated ? 'truncated' : 'invalid');
  const second = await requestHypotheses(retry, deps);
  return finishHypotheses(second, snapshot, deps.model);
}

// ---------------------------------------------------------------------------
// Anti-hallucination: every number cited by the AI must exist in the snapshot (ANA-38)
// ---------------------------------------------------------------------------

/** A number found in free text. `raw` is the text as written (used in the warning badge). */
export interface NumberToken {
  readonly raw: string;
  readonly value: number;
  readonly integer: boolean;
  /** «1,3 тыс» / «2k» — compared with a wider tolerance. */
  readonly scaled: boolean;
}

// Digits not glued to a letter/digit on the left (skips ids like P01/S01), optional thousands
// groups («1 300»), optional decimal part («2,9» / «2.9»).
const NUMBER_RE =
  /(?<![\p{L}\d.,])(\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?![\d.,]\d)|\d+)(?:[.,](\d+))?/gu;
const DATE_RE = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\.\d{1,2}\.\d{2,4}\b/g;
const THOUSANDS_RE = /^\s*(?:тыс\.?|k\b|K\b)/u;
const LAW_RE = /^\s*-?\s*ФЗ/u;
const DURATION_RE =
  /^\s*(?:дн|день|дня|дней|сут|недел|нед\b|мес|час|ч\b|мин|сек|day|week|month|hour|min|sec)/iu;

/** Extract the numbers of a text. With `checkable`, numbers that are never facts are skipped. */
export function extractNumbers(text: string, checkable = false): NumberToken[] {
  const src = checkable ? text.replace(DATE_RE, ' ') : text;
  const out: NumberToken[] = [];
  for (const m of src.matchAll(NUMBER_RE)) {
    const intPart = m[1]!.replace(/[ \u00a0\u202f]/g, '');
    const frac = m[2];
    const after = src.slice((m.index ?? 0) + m[0].length);
    const scaled = THOUSANDS_RE.test(after);
    let value = Number(frac ? `${intPart}.${frac}` : intPart);
    if (scaled) value *= 1000;
    const integer = !frac && !scaled;
    if (checkable) {
      // ICE scores, ordinal counts («в 2 клика», «3 шага») — never data claims.
      if (integer && value <= 10) continue;
      // Calendar years («в 2025 году»).
      if (integer && value >= 1990 && value <= 2100 && m[1]!.length === 4) continue;
      // Law references («152-ФЗ») and time frames («за 14 дней», «2 недели»).
      if (LAW_RE.test(after)) continue;
      if (value <= 365 && DURATION_RE.test(after)) continue;
    }
    out.push({ raw: m[0].trim() + (scaled ? ' тыс' : ''), value, integer, scaled });
  }
  return out;
}

const pct = (part: number, whole: number): number => (whole > 0 ? (part / whole) * 100 : 0);

/**
 * Every number a hypothesis may legitimately cite: the facts text the model was given plus the raw
 * snapshot values and simple derived shares (segment visits / total visits, segment applications /
 * total applications) — the model is allowed to say «68% мобильного трафика».
 */
export function snapshotNumberFacts(s: ReportSnapshot): number[] {
  const facts: number[] = extractNumbers(snapshotFacts(s)).map((n) => n.value);
  const add = (...xs: Array<number | undefined>) => {
    for (const x of xs) if (typeof x === 'number' && Number.isFinite(x)) facts.push(x);
  };

  add(s.kpi.target, s.kpi.b2cApplications, s.kpi.b2bPaidTickets, s.kpi.gap);
  add(
    s.funnel.visits,
    s.funnel.b2cApplications,
    s.funnel.b2bPipelineTickets,
    s.funnel.b2bPaidTickets,
  );
  add(s.b2bSummary.totalTickets, s.b2bSummary.paidTickets, s.b2bSummary.dealsCount);
  for (const d of s.b2bSummary.deals) add(d.tickets);

  const totalVisits = s.channels.reduce((a, c) => a + c.visits, 0) || s.funnel.visits;
  const totalApps = s.kpi.b2cApplications;
  add(totalVisits, pct(totalApps, totalVisits));

  const segment = (visits: number, reaches: number, users?: number) => {
    add(
      visits,
      reaches,
      users,
      pct(reaches, visits),
      pct(visits, totalVisits),
      pct(reaches, totalApps),
    );
  };
  const byChannel = new Map<string, { v: number; r: number; u: number }>();
  for (const c of s.channels) {
    const cur = byChannel.get(c.channel) ?? { v: 0, r: 0, u: 0 };
    byChannel.set(c.channel, { v: cur.v + c.visits, r: cur.r + c.goalReaches, u: cur.u + c.users });
  }
  for (const { v, r, u } of byChannel.values()) segment(v, r, u);
  for (const u of s.breakdowns.utm) segment(u.visits, u.goalReaches);
  for (const g of s.breakdowns.geoDevice) segment(g.visits, g.goalReaches);
  for (const p of [...s.breakdowns.entryPages, ...s.breakdowns.exitPages]) {
    segment(p.visits, p.goalReaches);
    add(p.bounceRate * 100, 100 - p.bounceRate * 100);
  }
  return facts;
}

/** True when `n` matches a fact within rounding tolerance (integer → ±0.5, decimals → ±0.05, ≥1%). */
function isKnownNumber(n: NumberToken, facts: readonly number[]): boolean {
  const abs = n.scaled ? 0.05 : n.integer ? 0.5 : 0.05;
  const rel = n.scaled ? 0.05 : 0.01;
  return facts.some((f) => Math.abs(n.value - f) <= Math.max(abs, Math.abs(f) * rel));
}

/** Numbers in `texts` that are not backed by `facts` (unique, in order of appearance). */
export function findUnverifiedNumbers(
  texts: ReadonlyArray<string | undefined>,
  facts: readonly number[],
): string[] {
  const out: string[] = [];
  for (const text of texts) {
    if (!text) continue;
    for (const n of extractNumbers(text, true)) {
      if (!isKnownNumber(n, facts) && !out.includes(n.raw)) out.push(n.raw);
    }
  }
  return out;
}

/**
 * Fields that state facts. Forward-looking fields (successCriteria, businessResult, traffic-light
 * thresholds, validation methods/sample sizes, deadline) legitimately carry target numbers that are
 * not in the snapshot, so they are not checked.
 */
function problemFactTexts(p: ProblemHypothesis): string[] {
  return [p.segment, p.trouble, p.action, p.barrier, p.evidence];
}
function solutionFactTexts(s: SolutionHypothesis): string[] {
  return [
    s.action,
    s.userBenefit,
    ...s.risks.map((r) => r.note),
    s.validation.whatToVerify,
    s.validation.audience,
    s.validation.channel,
    s.ice.impactRationale,
    s.ice.confidenceRationale,
    s.ice.easeRationale,
  ];
}

/**
 * ANA-38: scan every fact-stating text field of the generated hypotheses; numbers that are not
 * in the snapshot facts are recorded on the hypothesis as `unverifiedNumbers` (empty = verified).
 * The hypothesis is flagged, not dropped — the analyst sees a warning badge and decides.
 */
export function flagUnverifiedNumbers(
  h: GeneratedHypotheses,
  snapshot: ReportSnapshot,
): GeneratedHypotheses {
  const facts = snapshotNumberFacts(snapshot);
  return {
    ...h,
    problems: h.problems.map((p) => ({
      ...p,
      unverifiedNumbers: findUnverifiedNumbers(problemFactTexts(p), facts),
    })),
    solutions: h.solutions.map((s) => ({
      ...s,
      unverifiedNumbers: findUnverifiedNumbers(solutionFactTexts(s), facts),
    })),
  };
}

// ---------------------------------------------------------------------------
// Import into the hypotheses backlog (ANA-38: «AI» label + provider/model)
// ---------------------------------------------------------------------------

const Unverified = z.array(z.string().max(60)).max(50).optional();

/** Body of POST /hypotheses/import-ai: one generated solution (+ its problem) and provenance. */
export const ImportAiBody = z.object({
  problem: ProblemHypothesisSchema.extend({ unverifiedNumbers: Unverified }).optional(),
  solution: SolutionHypothesisSchema.extend({
    risks: z.array(SolutionRiskSchema).max(10),
    ice: IceInputSchema.extend({ score: z.number().optional() }),
    trafficLight: TrafficLightSchema.optional(),
    deadline: z.string().optional(),
    unverifiedNumbers: Unverified,
  }),
  provider: z.string().max(100).optional(),
  model: z.string().max(200).optional(),
  snapshotId: z.string().max(100).optional(),
});
export type ImportAiInput = z.infer<typeof ImportAiBody>;

const RISK_CATEGORY: Record<SolutionRiskKind, AssumptionCategory> = {
  value: 'behavior',
  usability: 'behavior',
  feasibility: 'tech',
  business: 'market',
  legal: 'market',
};

const METHOD_RULES: ReadonlyArray<readonly [RegExp, ValidationMethodType]> = [
  [/a\/b|аб[- ]?тест|сплит|метрик|аналитик|когорт|конверси|дашборд|воронк|данн/iu, 'quantitative'],
  [/fake|фейк|лендинг|предзаказ|smoke|конкурент|рын|цен/iu, 'market'],
  [/интервью|кастдев|custdev|опрос|юзабилити|usability|клик|прототип|коридор|фокус/iu, 'synthetic'],
  [/пилот|запуск|live|прод|эксперимент|mvp/iu, 'live'],
];
const METHOD_FALLBACK: readonly ValidationMethodType[] = [
  'quantitative',
  'synthetic',
  'live',
  'market',
];

/** Classify free-text AI methods into typed methods; the first two get distinct types. */
function typedMethods(methods: readonly string[], plan: string): ValidationMethod[] {
  const used = new Set<ValidationMethodType>();
  return methods.map((m, i) => {
    let type = METHOD_RULES.find(([re]) => re.test(m))?.[1] ?? METHOD_FALLBACK[0]!;
    if (i < 2 && used.has(type)) type = METHOD_FALLBACK.find((t) => !used.has(t)) ?? type;
    used.add(type);
    return { type, plan: `${m}: ${plan}` };
  });
}

const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

function deadlineDays(deadline: string | undefined, now: Date): number {
  if (!deadline || !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return 14;
  const days = Math.ceil(
    (new Date(`${deadline}T23:59:59Z`).getTime() - now.getTime()) / 86_400_000,
  );
  return Math.min(365, Math.max(1, days));
}

/**
 * Map an AI solution hypothesis (+ its problem) to the structured backlog format. Risks become
 * hidden assumptions (value/usability → behaviour, feasibility → tech, business/legal → market;
 * gaps are filled from the problem), free-text methods become typed validation methods.
 */
export function generatedToNewHypothesis(input: ImportAiInput, now = new Date()): NewHypothesis {
  const { problem, solution: s } = input;
  const assumptions: HiddenAssumption[] = s.risks.map((r) => ({
    category: RISK_CATEGORY[r.kind],
    text: r.note,
  }));
  const fill: Record<AssumptionCategory, string> = {
    behavior: problem ? `${problem.segment}: ${problem.trouble}` : s.userBenefit,
    market: s.businessResult,
    tech: `Реализуемо: ${s.action}`,
  };
  for (const category of ASSUMPTION_CATEGORIES) {
    if (!assumptions.some((a) => a.category === category)) {
      assumptions.push({ category, text: fill[category] });
    }
  }
  const audience = `ЦА: ${s.validation.audience}; канал: ${s.validation.channel}`;
  const unverified = [
    ...new Set([...(problem?.unverifiedNumbers ?? []), ...(s.unverifiedNumbers ?? [])]),
  ];
  const description = [
    `Если ${s.action}, то ${s.userBenefit}, что приведёт к ${s.businessResult}.`,
    problem
      ? `Проблема ${problem.id}: ${problem.segment} испытывает ${problem.trouble} при ${problem.action}, потому что ${problem.barrier}.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    diamondPhase: 'develop',
    kind: 'solution',
    subject: problem?.segment ?? s.validation.audience,
    action: s.userBenefit,
    solution: s.action,
    condition: s.successCriteria,
    title: clip(s.action, 120),
    description,
    hiddenAssumptions: assumptions,
    validationMethods: typedMethods(
      s.validation.methods,
      `${s.validation.whatToVerify} (${audience})`,
    ),
    impact: s.ice.impact,
    confidence: s.ice.confidence,
    ease: s.ice.ease,
    impactRationale: s.ice.impactRationale,
    confidenceRationale: s.ice.confidenceRationale,
    easeRationale: s.ice.easeRationale,
    greenCriteria: s.trafficLight?.green ?? s.successCriteria,
    yellowCriteria: s.trafficLight?.yellow ?? `Частично: ${s.validation.successCriteria}`,
    redCriteria: s.trafficLight?.red ?? `Не достигнуто: ${s.validation.successCriteria}`,
    deadlineDays: deadlineDays(s.deadline, now),
    evidence: [
      {
        type: 'ai',
        note: problem?.evidence ?? s.successCriteria,
        ...(input.snapshotId ? { slice: `snapshot:${input.snapshotId}` } : {}),
      },
    ],
    source: 'ai',
    ...(input.provider ? { aiProvider: input.provider } : {}),
    ...(input.model ? { aiModel: input.model } : {}),
    unverifiedNumbers: unverified,
  };
}
