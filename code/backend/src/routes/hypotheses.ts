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

/** REG-02: shape of NewHypothesis; completeness itself stays in the repo (422, not 400). */
const CreateBody = z.object({
  diamondPhase: z.enum(['define', 'develop']),
  kind: z.enum(['problem', 'solution']),
  subject: z.string().min(1),
  action: z.string().min(1),
  solution: z.string().min(1),
  condition: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  parentId: z.number().int().positive().optional(),
  hiddenAssumptions: z.array(AssumptionBody),
  validationMethods: z.array(ValidationMethodBody),
  impact: z.number().int().min(1).max(10),
  confidence: z.number().int().min(1).max(10),
  ease: z.number().int().min(1).max(10),
  impactRationale: z.string().min(1),
  confidenceRationale: z.string().min(1),
  easeRationale: z.string().min(1),
  greenCriteria: z.string().min(1),
  yellowCriteria: z.string().min(1),
  redCriteria: z.string().min(1),
  deadlineDays: z.number().int().min(1),
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
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid body', issues: parsed.error.issues });
    }
    try {
      return reply.code(201).send(opts.repo.create(parsed.data as NewHypothesis));
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
      return reply.code(201).send(opts.repo.create(generatedToNewHypothesis(parsed.data)));
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
    const updated = opts.repo.updateStatus(idOf(req.params), parsed.data.status);
    return updated ?? reply.code(404).send({ error: 'not found' });
  });
}
