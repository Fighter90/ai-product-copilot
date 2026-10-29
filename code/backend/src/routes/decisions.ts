import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { NewDecision } from '@pca/shared';
import { DecisionsRepo, DecisionValidationError } from '../db/repositories/decisions-repo';

export interface DecisionsRouteOptions {
  readonly repo: DecisionsRepo;
}

const FindingBody = z.object({
  text: z.string().min(1),
  confidence: z.enum(['high', 'medium', 'low']),
});

const EvidenceBody = z.object({
  quote: z.string().min(1),
  source: z.string().min(1),
  rawResponseId: z.number().int().optional(),
});

/** REG-02: shape of NewDecision; evidence-required stays in the repo (422, not 400). */
const CreateBody = z.object({
  hypothesisId: z.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  method: z.enum(['synthetic', 'live', 'quantitative', 'market', 'mixed']),
  scope: z.string().min(1),
  periodDays: z.number().int().min(1),
  findings: z.array(FindingBody),
  evidence: z.array(EvidenceBody),
  outcome: z.enum(['green', 'yellow', 'red']),
  outcomeRationale: z.string().min(1),
  nextStep: z.string().min(1),
  responsible: z.string().optional(),
  nextDeadline: z.string().optional(),
  previousDecisionId: z.number().int().optional(),
  spawnedHypothesisIds: z.array(z.number().int()).optional(),
  decidedBy: z.string().min(1),
  participants: z.string().optional(),
  isDemo: z.boolean().optional(),
});

/** Decision Log endpoints. Creating a decision auto-updates the linked hypothesis status. */
export async function decisionsRoutes(
  app: FastifyInstance,
  opts: DecisionsRouteOptions,
): Promise<void> {
  app.get('/decisions', { schema: { tags: ['decisions'] } }, async () => opts.repo.list());

  app.get('/decisions/:id', { schema: { tags: ['decisions'] } }, async (req, reply) => {
    const d = opts.repo.getById(Number((req.params as { id: string }).id));
    return d ?? reply.code(404).send({ error: 'not found' });
  });

  app.post('/decisions', { schema: { tags: ['decisions'] } }, async (req, reply) => {
    // REG-02: validate before touching fields — an empty body used to 500 on undefined.
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid body', issues: parsed.error.issues });
    }
    try {
      return reply.code(201).send(opts.repo.create(parsed.data as NewDecision));
    } catch (err) {
      if (err instanceof DecisionValidationError) {
        return reply.code(422).send({ error: 'invalid decision', message: err.message });
      }
      throw err;
    }
  });
}
