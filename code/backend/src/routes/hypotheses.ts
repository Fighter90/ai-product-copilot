import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { NewHypothesis } from '@pca/shared';
import {
  HypothesesRepo,
  HypothesisInUseError,
  HypothesisValidationError,
} from '../db/repositories/hypotheses-repo';
import { ImportAiBody, generatedToNewHypothesis } from '../report/ai-hypotheses';

export interface HypothesesRouteOptions {
  readonly repo: HypothesesRepo;
}

const StatusBody = z.object({
  status: z.enum(['draft', 'in_progress', 'green', 'yellow', 'red', 'expired']),
});

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
 * Hypotheses CRUD. Create/update enforce the structured hypothesis format (invalid → 422 with
 * the issue list); delete refuses hypotheses referenced by the Decision Log (409).
 */
export async function hypothesesRoutes(
  app: FastifyInstance,
  opts: HypothesesRouteOptions,
): Promise<void> {
  app.get('/hypotheses', { schema: { tags: ['hypotheses'] } }, async () => opts.repo.list());

  app.get('/hypotheses/:id', { schema: { tags: ['hypotheses'] } }, async (req, reply) => {
    const h = opts.repo.getById(idOf(req.params));
    return h ?? reply.code(404).send({ error: 'not found' });
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
    try {
      const updated = opts.repo.updateStatus(idOf(req.params), parsed.data.status);
      return updated ?? reply.code(404).send({ error: 'not found' });
    } catch (err) {
      // ANA-129: taking an incomplete draft into work is refused with the checklist issues.
      if (err instanceof HypothesisValidationError) {
        return reply.code(422).send({ error: 'invalid hypothesis', issues: err.errors });
      }
      throw err;
    }
  });
}
