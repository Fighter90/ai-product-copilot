import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { NewHypothesis } from '@pca/shared';
import {
  HYPOTHESIS_AUTONOMY_MAX_STATUS,
  REQUIRED_AUTONOMY,
  assessHypothesisAutonomy,
  hypothesisTransitionEscalation,
} from '@pca/shared';
import type { UsersRepo } from '../auth/users-repo';
import {
  HypothesesRepo,
  HypothesisInUseError,
  HypothesisValidationError,
} from '../db/repositories/hypotheses-repo';
import { ImportAiBody, generatedToNewHypothesis } from '../report/ai-hypotheses';

export interface HypothesesRouteOptions {
  readonly repo: HypothesesRepo;
  /** ANA-157: cabinet users repo — writes the escalation record when a non-PM status change
   *  on an AI hypothesis is refused. Absent in legacy single-user mode, where there is no PM
   *  role: the single human user confirms every status directly (no escalation, no audit). */
  readonly users?: UsersRepo;
}

const StatusBody = z.object({
  status: z.enum(['draft', 'in_progress', 'green', 'yellow', 'red', 'expired']),
});

/**
 * ANA-157 (review round 3): a guard schema for the PUT update body — `status` must be
 * absent (`z.undefined().optional()` accepts a missing field and refuses any value).
 * Status changes go only through PATCH /hypotheses/:id/status, where the AI-autonomy
 * matrix guards the PM verdicts; the full update must not become a bypass around it.
 */
const UpdateBody = z.object({ status: z.undefined().optional() });

const AssumptionBody = z.object({
  category: z.enum(['behavior', 'market', 'tech']),
  text: z.string().min(1),
});

const ValidationMethodBody = z.object({
  type: z.enum(['synthetic', 'live', 'quantitative', 'market']),
  plan: z.string().min(1),
  cost: z.string().optional(),
});

const EvidenceBody = z.object({
  type: z.string().min(1),
  rawResponseId: z.number().int().optional(),
  slice: z.string().optional(),
  note: z.string().optional(),
});

/**
 * REG-02: shape of NewHypothesis. ANA-129: format text fields are optional at creation (defaults
 * are empty), a title-only body parses into a light draft; the completeness itself stays in the
 * repo (draft vs work mode → 422, not 400).
 */
const CreateBody = z.object({
  diamondPhase: z.enum(['define', 'develop']).default('develop'),
  kind: z.enum(['problem', 'solution']).default('solution'),
  subject: z.string().default(''),
  action: z.string().default(''),
  solution: z.string().default(''),
  condition: z.string().default(''),
  title: z.string().min(1),
  description: z.string().optional(),
  parentId: z.number().int().positive().optional(),
  hiddenAssumptions: z.array(AssumptionBody).default([]),
  validationMethods: z.array(ValidationMethodBody).default([]),
  impact: z.number().int().min(1).max(10).default(5),
  confidence: z.number().int().min(1).max(10).default(5),
  ease: z.number().int().min(1).max(10).default(5),
  impactRationale: z.string().default(''),
  confidenceRationale: z.string().default(''),
  easeRationale: z.string().default(''),
  greenCriteria: z.string().default(''),
  yellowCriteria: z.string().default(''),
  redCriteria: z.string().default(''),
  deadlineDays: z.number().int().min(1).default(14),
  evidence: z.array(EvidenceBody).optional(),
  isDemo: z.boolean().optional(),
  source: z.enum(['manual', 'ai']).optional(),
  aiProvider: z.string().optional(),
  aiModel: z.string().optional(),
  unverifiedNumbers: z.array(z.string()).optional(),
});

const idOf = (params: unknown): number => Number((params as { id: string }).id);

/**
 * ANA-157: AI hypotheses carry their autonomy assessment (level, max status, allowed
 * statuses) on every read/update response — list, detail and the status change answer
 * uniformly; manual hypotheses carry none. The report render path is unaffected (it reads
 * the repo, not the routes).
 */
const withAutonomy = <T extends { source?: string }>(h: T) =>
  h.source === 'ai' ? { ...h, autonomy: assessHypothesisAutonomy({ source: h.source }) } : h;

/**
 * Hypotheses CRUD. Create/update enforce the structured hypothesis format (invalid → 422 with
 * the issue list); delete refuses hypotheses referenced by the Decision Log (409).
 */
export async function hypothesesRoutes(
  app: FastifyInstance,
  opts: HypothesesRouteOptions,
): Promise<void> {
  // ANA-157: AI hypotheses carry their autonomy assessment; manual ones carry none.
  app.get('/hypotheses', { schema: { tags: ['hypotheses'] } }, async () =>
    opts.repo.list().map((h) => withAutonomy(h)),
  );

  app.get('/hypotheses/:id', { schema: { tags: ['hypotheses'] } }, async (req, reply) => {
    const h = opts.repo.getById(idOf(req.params));
    return h ? withAutonomy(h) : reply.code(404).send({ error: 'not found' });
  });

  app.post('/hypotheses', { schema: { tags: ['hypotheses'] } }, async (req, reply) => {
    // REG-02: validate before touching fields — a partial body used to 500 on undefined.
    // ANA-129: an incomplete body becomes a light draft; completeness is checked in the repo.
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid body', issues: parsed.error.issues });
    }
    try {
      return reply
        .code(201)
        .send(opts.repo.create(parsed.data as NewHypothesis, { mode: 'draft' }));
    } catch (err) {
      if (err instanceof HypothesisValidationError) {
        return reply.code(422).send({ error: 'invalid hypothesis', issues: err.errors });
      }
      throw err;
    }
  });

  /** ANA-38: import one AI-generated solution (+ its problem) into the backlog, labelled AI. */
  app.post('/hypotheses/import-ai', { schema: { tags: ['hypotheses'] } }, async (req, reply) => {
    const parsed = ImportAiBody.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'invalid AI hypothesis', message: parsed.error.message });
    }
    try {
      // ANA-129: AI imports must carry the complete format — no light drafts from the model.
      return reply.code(201).send(
        opts.repo.create(generatedToNewHypothesis(parsed.data), {
          mode: 'work',
        }),
      );
    } catch (err) {
      if (err instanceof HypothesisValidationError) {
        return reply.code(422).send({ error: 'invalid hypothesis', issues: err.errors });
      }
      throw err;
    }
  });

  app.put('/hypotheses/:id', { schema: { tags: ['hypotheses'] } }, async (req, reply) => {
    // ANA-157 (review round 3): the update body must not carry `status` — otherwise a
    // non-PM in cabinet mode could set a PM verdict on an AI hypothesis through PUT and
    // walk straight past the autonomy matrix. Unknown fields are stripped, so only an
    // explicitly present `status` is refused.
    if (!UpdateBody.safeParse(req.body).success) {
      return reply.code(400).send({
        error: 'status is not settable via update — use PATCH /hypotheses/:id/status',
      });
    }
    try {
      const updated = opts.repo.update(idOf(req.params), req.body as NewHypothesis);
      return updated ?? reply.code(404).send({ error: 'not found' });
    } catch (err) {
      if (err instanceof HypothesisValidationError) {
        return reply.code(422).send({ error: 'invalid hypothesis', issues: err.errors });
      }
      throw err;
    }
  });

  app.delete('/hypotheses/:id', { schema: { tags: ['hypotheses'] } }, async (req, reply) => {
    try {
      return opts.repo.delete(idOf(req.params))
        ? reply.code(204).send()
        : reply.code(404).send({ error: 'not found' });
    } catch (err) {
      if (err instanceof HypothesisInUseError) {
        return reply
          .code(409)
          .send({ error: 'hypothesis is referenced by decisions', decisions: err.decisions });
      }
      throw err;
    }
  });

  app.patch('/hypotheses/:id/status', { schema: { tags: ['hypotheses'] } }, async (req, reply) => {
    const parsed = StatusBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid status' });
    // ANA-157: the AI-autonomy matrix — an AI hypothesis (level A1) may not set a status above
    // its maximum («В проверке») *without the PM*: the verification verdicts belong to the PM.
    // In cabinet mode the requester must be the admin role (the PM) — everyone else is refused
    // with the machine-readable escalation, audited via the users repo. In legacy single-user
    // mode there is no PM role: the single human user owns the verdict, so the change goes
    // through (the cap is a confirmation gate, not a dead end).
    const current = opts.repo.getById(idOf(req.params));
    if (!current) return reply.code(404).send({ error: 'not found' });
    const level = REQUIRED_AUTONOMY;
    // ANA-157 (review round 3): the transition-aware verdict — leaving a PM verdict
    // (green/yellow/red) escalates as well, so a non-PM cannot silently erase the
    // светофор decision by moving the hypothesis back to draft/«В проверке».
    const escalation = hypothesisTransitionEscalation(current.status, parsed.data.status, level);
    const pmConfirmed = opts.users === undefined || req.user?.role === 'admin';
    if (current.source === 'ai' && escalation.required && !pmConfirmed) {
      try {
        opts.users?.audit(req.user ?? null, 'hypotheses.status_escalation', String(current.id), {
          from: current.status,
          to: parsed.data.status,
          level,
          reason: escalation.reason,
        });
      } catch {
        // ANA-157 (review round 3): an audit failure must not mask the security refusal
        // with a 500 — the 403 escalation response is always returned.
      }
      return reply.code(403).send({
        error: 'AI hypothesis status above the autonomy level — PM confirmation required',
        code: 'AUTONOMY_EXCEEDED',
        autonomy: {
          level,
          maxStatus: HYPOTHESIS_AUTONOMY_MAX_STATUS[level],
          escalation,
        },
      });
    }
    try {
      const updated = opts.repo.updateStatus(current.id, parsed.data.status);
      return updated ? withAutonomy(updated) : reply.code(404).send({ error: 'not found' });
    } catch (err) {
      // ANA-129: taking an incomplete draft into work is refused with the checklist issues.
      if (err instanceof HypothesisValidationError) {
        return reply.code(422).send({ error: 'invalid hypothesis', issues: err.errors });
      }
      throw err;
    }
  });
}
