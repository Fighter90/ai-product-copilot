import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SETTING_KEYS, type AppSettings, type SettingKey } from './app-settings';
import type { UsersRepo } from '../auth/users-repo';
import type { DB } from '../db/connection';
import { randomToken } from '../security/crypto';

export interface SettingsRouteOptions {
  readonly settings: AppSettings;
  readonly users: UsersRepo;
  readonly db: DB;
  /** Called after settings change so cached clients (Metrika) are rebuilt. */
  readonly onChange?: () => void;
}

const Patch = z.partialRecord(z.enum(SETTING_KEYS), z.union([z.string().max(8000), z.number()]));

/** Runtime settings (admin writes, everyone reads the masked view). */
export async function appSettingsRoutes(
  app: FastifyInstance,
  opts: SettingsRouteOptions,
): Promise<void> {
  app.get('/settings', async () => opts.settings.view());

  /**
   * REG-12 (ANA-100): the only settings non-admins may read — the KPI bar / deadline fields.
   * Same `{ value }` shape as the admin view so `readEventDate` works on both responses.
   */
  app.get('/settings/public', async () => ({
    KPI_TARGET: { value: opts.settings.get('KPI_TARGET') },
    EVENT_DATE: { value: opts.settings.get('EVENT_DATE') },
  }));

  app.post('/settings', async (req, reply) => {
    const body = Patch.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body', code: 'BAD_INPUT' });
    const changed: string[] = [];
    for (const [key, value] of Object.entries(body.data) as Array<[SettingKey, string | number]>) {
      const v = String(value).trim();
      // A masked value sent back unchanged (••••abcd) means "keep".
      if (v.startsWith('••••')) continue;
      opts.settings.set(key, v, req.user!.email);
      changed.push(key);
    }
    opts.users.audit(req.user!, 'settings.update', changed.join(','));
    opts.onChange?.();
    return { ok: true, changed, settings: opts.settings.view() };
  });

  /** Rotate the DataLens webhook token (old URL stops working). */
  app.post('/settings/datalens-token', async (req) => {
    const token = randomToken(18);
    opts.settings.set('DATALENS_WEBHOOK_TOKEN', token, req.user!.email);
    opts.users.audit(req.user!, 'datalens.token_rotated');
    return { token };
  });

  /**
   * Danger zone: clear cached Metrika data (raw responses + derived stats). Requires the
   * confirmation word in the body — the UI asks the admin to type it.
   */
  app.delete('/data/metrika', async (req, reply) => {
    const body = z.object({ confirm: z.literal('УДАЛИТЬ') }).safeParse(req.body);
    if (!body.success)
      return reply.code(400).send({ error: 'confirmation required', code: 'CONFIRM' });
    const tables = [
      'raw_responses',
      'channel_stats',
      'utm_stats',
      'geo_device_stats',
      'page_stats',
      'exit_page_stats',
    ];
    const existing = new Set(
      (
        opts.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{
          name: string;
        }>
      ).map((r) => r.name),
    );
    for (const t of tables) if (existing.has(t)) opts.db.prepare(`DELETE FROM ${t}`).run();
    opts.users.audit(req.user!, 'data.clear_metrika');
    return { ok: true };
  });
}
