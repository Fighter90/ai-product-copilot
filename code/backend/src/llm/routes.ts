import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { LlmService } from './service';
import { PROVIDER_IDS, type ProviderId } from './providers';
import type { UsersRepo } from '../auth/users-repo';

export interface LlmRouteOptions {
  readonly llm: LlmService;
  readonly users: UsersRepo;
}

const ProviderPatch = z.object({
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  model: z.string().max(200).optional(),
  secret: z.string().max(4000).optional(),
  extra: z.record(z.string().max(200)).optional(),
});

/** AI provider routes: analysts see available providers; admins configure and test them. */
export async function llmRoutes(app: FastifyInstance, opts: LlmRouteOptions): Promise<void> {
  app.get('/ai/available', async () => opts.llm.available());

  app.get('/admin/ai/providers', async () => opts.llm.list());

  app.put('/admin/ai/providers/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id as ProviderId;
    if (!PROVIDER_IDS.includes(id)) return reply.code(404).send({ error: 'unknown provider' });
    const body = ProviderPatch.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body', code: 'BAD_INPUT' });
    const view = opts.llm.update(id, body.data, req.user!.email);
    // Audit without the secret value.
    opts.users.audit(req.user!, 'ai.provider_update', id, {
      ...body.data,
      secret: body.data.secret === undefined ? undefined : body.data.secret ? 'changed' : 'cleared',
    });
    return view;
  });

  app.post('/admin/ai/providers/:id/test', async (req, reply) => {
    const id = (req.params as { id: string }).id as ProviderId;
    if (!PROVIDER_IDS.includes(id)) return reply.code(404).send({ error: 'unknown provider' });
    const res = await opts.llm.test(id, req.user!.email);
    opts.users.audit(req.user!, 'ai.provider_test', id, { ok: res.ok });
    return res;
  });

  app.get('/admin/ai/usage', async () => opts.llm.usage(30));
}
