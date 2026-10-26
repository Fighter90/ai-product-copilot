import { z } from 'zod';
import type { MetrikaClient } from './client';
import { MetrikaHttpError } from './client';
import { ENDPOINTS } from './endpoints';

/**
 * Goal management over the Management API (requires a token with `edit` / metrika:write access).
 *
 * Wire format notes (verified against the live API + openapi docs):
 * - Create: POST /management/v1/counter/{id}/goals with the body WRAPPED in `{"goal": {...}}` —
 *   an unwrapped body fails with 400 "must not be null, location goal".
 * - Archive / restore: POST /management/v1/counter/{id}/goal/{goalId}/archive|unarchive
 *   (SINGULAR `goal` — the plural form answers "No endpoint").
 */

/** Goal types accepted by the Management API (docs: management/openapi/goal/addGoal). */
export const GOAL_TYPES = [
  'url',
  'action',
  'step',
  'number',
  'visit_duration',
  'email',
  'file',
  'phone',
  'search',
  'social',
  'chat',
  'messenger',
  'payment_system',
] as const;
export type GoalType = (typeof GOAL_TYPES)[number];

/**
 * Goal condition: `{type, url}` in the official docs. Verified live (2026-10-26): url-matching
 * condition types are exact/contain/start/regexp with a `url` field (verified live 2026-10-26); type "js" is REJECTED by
 * the Management API («wrong value: "js"») — JS-event goals are created as type "action" with a
 * URL condition (the site fires /goal/… requests that match it).
 */
export const GOAL_CONDITION_TYPES = ['exact', 'contain', 'start', 'regexp'] as const;
export const GoalConditionSchema = z
  .object({
    type: z.enum(GOAL_CONDITION_TYPES),
    url: z.string().min(1).max(16384),
  })
  .passthrough();
export type GoalCondition = z.infer<typeof GoalConditionSchema>;

const GoalSpecShape = {
  name: z.string().min(1).max(255),
  type: z.enum(GOAL_TYPES),
  conditions: z.array(GoalConditionSchema).max(100).optional(),
  steps: z.array(z.record(z.unknown())).max(50).optional(),
  /** View-depth for `number` goals, seconds threshold for `visit_duration`. */
  depth: z.number().int().min(1).max(86_400).optional(),
  default_price: z.number().min(0).optional(),
  is_favorite: z.boolean().optional(),
  /** JS-event flag alias (e.g. `reg_step1`) used by some goal kinds. */
  flag: z.string().max(64).optional(),
} as const;

/** Validated create-goal spec: per-type required fields are enforced in {@link GoalSpecSchema}. */
export const GoalSpecSchema = z
  .object(GoalSpecShape)
  .passthrough()
  .superRefine((spec, ctx) => {
    if ((spec.type === 'url' || spec.type === 'action') && !spec.conditions?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['conditions'],
        message: `goal type "${spec.type}" requires at least one condition`,
      });
    }
    if (spec.type === 'step' && !spec.steps?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['steps'],
        message: 'goal type "step" requires at least one step',
      });
    }
  });
export type GoalSpec = z.infer<typeof GoalSpecSchema>;

/** A created/returned goal as the Management API responds it (id assigned by Metrika). */
export const ManagedGoalSchema = z
  .object({ id: z.number(), name: z.string(), type: z.string() })
  .passthrough();
export type ManagedGoal = z.infer<typeof ManagedGoalSchema>;

const GoalResponseSchema = z.object({ goal: ManagedGoalSchema }).passthrough();
const SuccessSchema = z.object({ success: z.boolean().optional() }).passthrough();

export class GoalInputError extends Error {
  constructor(public readonly issues: z.ZodIssue[]) {
    super(
      `invalid goal spec: ${issues.map((i) => `${i.path.join('.') || 'goal'} ${i.message}`).join('; ')}`,
    );
    this.name = 'GoalInputError';
  }
}

/** Validate a caller-supplied spec; throws {@link GoalInputError} BEFORE any HTTP request. */
export function parseGoalSpec(input: unknown): GoalSpec {
  const parsed = GoalSpecSchema.safeParse(input);
  if (!parsed.success) throw new GoalInputError(parsed.error.issues);
  return parsed.data;
}

/**
 * Create a goal on the counter. The spec is validated locally first (fail fast without burning an
 * API call), then posted wrapped in the documented `{"goal": ...}` envelope.
 */
export async function createGoal(
  client: MetrikaClient,
  counterId: number,
  spec: GoalSpec,
): Promise<ManagedGoal> {
  const res = await client.post(ENDPOINTS.goals(counterId), {}, { goal: spec }, GoalResponseSchema);
  return res.goal;
}

/**
 * Archive a goal (it stays in the interface under "Архив" and keeps its history).
 * `folderId` is forwarded as the optional `folderid` query parameter (target archive folder).
 *
 * Deviation from ANA-36: the spec suggested renaming goals with an `[archive]` prefix because
 * DELETE is irreversible. Metrika's archive endpoint is better on both counts — it is reversible
 * ({@link unarchiveGoal}) and keeps the goal's history — so we archive instead of renaming and
 * never call DELETE.
 */
export async function archiveGoal(
  client: MetrikaClient,
  counterId: number,
  goalId: number,
  folderId?: number,
): Promise<void> {
  const params = folderId === undefined ? {} : { folderid: folderId };
  await client.post(ENDPOINTS.goalArchive(counterId, goalId), params, {}, SuccessSchema);
}

/** Restore an archived goal (POST .../goal/{id}/unarchive). */
export async function unarchiveGoal(
  client: MetrikaClient,
  counterId: number,
  goalId: number,
): Promise<void> {
  await client.post(ENDPOINTS.goalUnarchive(counterId, goalId), {}, {}, SuccessSchema);
}

/** A goal as GET /management/v1/counter/{id}/goals lists it (only the fields we use). */
export const CounterGoalSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    type: z.string(),
    status: z.string().optional(),
    goal_source: z.string().optional(),
    conditions: z
      .array(z.object({ type: z.string().optional(), url: z.string().optional() }).passthrough())
      .optional(),
  })
  .passthrough();
export type CounterGoal = z.infer<typeof CounterGoalSchema>;
const CounterGoalsSchema = z.object({ goals: z.array(CounterGoalSchema) }).passthrough();

/** List the counter's goals (read-only Management API call). */
export async function listGoals(client: MetrikaClient, counterId: number): Promise<CounterGoal[]> {
  return (await client.get(ENDPOINTS.goals(counterId), {}, CounterGoalsSchema)).goals;
}

/** The Management API reports the archived state in the free-form `status` field. */
export const isArchivedGoal = (g: { status?: string }): boolean => /archiv/i.test(g.status ?? '');

const CounterSchema = z
  .object({ counter: z.object({ permission: z.string().optional() }).passthrough() })
  .passthrough();

/** Thrown before any write when the token/counter grant is read-only. */
export class WritePermissionError extends Error {
  constructor(public readonly permission: string) {
    super(`counter permission is "${permission}"`);
    this.name = 'WritePermissionError';
  }
}

export const WRITE_PERMISSION_MESSAGE =
  'Метрика запрещает запись: токену нужен доступ metrika:write и право edit на счётчик (403).';

/**
 * Read the token's permission on the counter (`own` | `edit` | `view`) via
 * GET /management/v1/counter/{id}. A 403 here means the token cannot even see the counter.
 */
export async function counterPermission(
  client: MetrikaClient,
  counterId: number,
): Promise<string | undefined> {
  const res = await client.get(`/management/v1/counter/${counterId}`, {}, CounterSchema);
  return res.counter.permission;
}

/**
 * Up-front write check, run once before any Management API write: a `view` grant is refused
 * locally (no write attempted). OAuth scopes are not introspectable, so a token lacking
 * metrika:write still surfaces as a 403 from the write itself — mapped to the same message.
 */
export async function assertWritePermission(
  client: MetrikaClient,
  counterId: number,
): Promise<void> {
  const permission = await counterPermission(client, counterId);
  if (permission === 'view') throw new WritePermissionError(permission);
}

export interface MappedGoalError {
  readonly status: number;
  readonly code: string;
  readonly message: string;
}

/**
 * Translate a Metrika HTTP failure into an actionable message for the admin UI:
 * the raw "must not be null, location goal"-style bodies and auth problems are confusing on
 * their own, so each known status gets a concrete explanation (the API text stays appended).
 */
export function describeGoalError(err: unknown): MappedGoalError | undefined {
  if (err instanceof WritePermissionError) {
    return { status: 403, code: 'METRIKA_WRITE_FORBIDDEN', message: WRITE_PERMISSION_MESSAGE };
  }
  if (!(err instanceof MetrikaHttpError)) return undefined;
  const body = err.message.replace(/^Metrika \d+:\s*/, '');
  if (err.status === 400 && /No object with specified ID/i.test(body)) {
    return {
      status: 404,
      code: 'GOAL_NOT_FOUND',
      message: 'Цель не найдена в счётчике (возможно, уже удалена или архивирована).',
    };
  }
  switch (err.status) {
    case 400:
      return {
        status: 400,
        code: 'METRIKA_REJECTED',
        message: `Метрика отклонила цель — проверьте параметры (400): ${body}`,
      };
    case 401:
      return {
        status: 401,
        code: 'METRIKA_UNAUTHORIZED',
        message: 'OAuth-токен недействителен или истёк — обновите его в настройках (401).',
      };
    case 403:
      return {
        status: 403,
        code: 'METRIKA_FORBIDDEN',
        message:
          'Метрика ответила 403: токену нужен доступ metrika:write (и право edit на счётчик) для управления целями.',
      };
    case 404:
      return { status: 404, code: 'GOAL_NOT_FOUND', message: 'Цель или счётчик не найдены (404).' };
    case 429:
      return {
        status: 429,
        code: 'RATE_LIMITED',
        message: 'Превышен лимит запросов к API Метрики — повторите позже (429).',
      };
    default:
      return {
        status: err.status >= 500 ? 502 : err.status,
        code: 'METRIKA_ERROR',
        message: `Ошибка API Метрики (${err.status}): ${body}`,
      };
  }
}
