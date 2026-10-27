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
    try {
      return reply.code(201).send(opts.repo.create(req.body as NewHypothesis));
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
