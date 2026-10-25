import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { z } from 'zod';

// Resolve the repo root from this file (code/backend/src) so .env and the SQLite file
// are found regardless of the working directory a script is invoked from.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
loadEnv({ path: join(REPO_ROOT, '.env') });

/**
 * Single source of truth for runtime configuration.
 * Values come from `.env` (gitignored). Never log the token or client secret.
 */
const EnvSchema = z.object({
  YANDEX_OAUTH_TOKEN: z.string().default(''),
  YANDEX_CLIENT_ID: z.string().default(''),
  YANDEX_CLIENT_SECRET: z.string().default(''),
  OAUTH_REDIRECT_URI: z.string().default('https://oauth.yandex.ru/verification_code'),
  // Yandex Metrika counter id. Not hardcoded — supply it via .env (./init.sh asks for it).
  // 0 (default) = not configured: demo/seed mode works, but a live sync requires a real id.
  COUNTER_ID: z.coerce.number().int().nonnegative().default(0),
  // The Metrika goal that counts for the KPI. 0 (default) = auto-detect the primary purchase/payment
  // goal from the goals list at sync time (selectPrimaryGoal); set a specific id only to override.
  GOAL_ID: z.coerce.number().int().default(0),
  // AI report narrative (Anthropic). Empty key → AI analysis is unavailable, dashboard still works.
  ANTHROPIC_API_KEY: z.string().default(''),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-6'),
  TIMEZONE: z.string().default('Europe/Moscow'),
  PORT: z.coerce.number().int().default(5173),
  API_PORT: z.coerce.number().int().default(4000),
  ARCHIVED_GOAL_ID_THRESHOLD: z.coerce.number().int().default(77),
  LOW_UTM_COVERAGE_RATIO: z.coerce.number().default(0.7),
  DB_PATH: z.string().default(join(REPO_ROOT, 'data', 'productcamp.sqlite')),
  // --- v3: cabinet, roles, providers -------------------------------------------------------
  // Master key for AES-256-GCM encryption of secrets stored in the DB. Required on a server.
  APP_SECRET: z.string().default(''),
  // First administrator, created on start when the users table is empty.
  ADMIN_EMAIL: z.string().default('admin@productcamp.local'),
  ADMIN_PASSWORD: z.string().default(''),
  ADMIN_NAME: z.string().default('Администратор'),
  // 1 = create demo accounts (admin + analyst) with DEMO_ADMIN_PASSWORD / DEMO_ANALYST_PASSWORD.
  DEMO_USERS: z.coerce.number().int().default(0),
  DEMO_ADMIN_PASSWORD: z.string().default(''),
  DEMO_ANALYST_PASSWORD: z.string().default(''),
  // Session cookie: Secure flag (on behind HTTPS) and lifetime in days.
  COOKIE_SECURE: z.coerce.number().int().default(1),
  SESSION_DAYS: z.coerce.number().int().default(7),
  PUBLIC_URL: z.string().default('http://localhost:5173'),
  // Optional initial values for AI providers (admin UI overrides them; never commit real keys).
  OPENROUTER_API_KEY: z.string().default(''),
  OPENROUTER_MODEL: z.string().default('anthropic/claude-sonnet-4.5'),
  YANDEX_AI_API_KEY: z.string().default(''),
  YANDEX_AI_FOLDER_ID: z.string().default(''),
  YANDEX_AI_MODEL: z.string().default('yandexgpt/latest'),
  GIGACHAT_AUTH_KEY: z.string().default(''),
  GIGACHAT_SCOPE: z.string().default('GIGACHAT_API_PERS'),
  GIGACHAT_MODEL: z.string().default('GigaChat-2-Pro'),
  HELP_DIR: z.string().default(join(REPO_ROOT, 'docs', 'help')),
});

export const config = EnvSchema.parse(process.env);
export type AppConfig = typeof config;

/** Placeholders from .env.example are treated as empty values (audit bug ANA-23). */
export const isPlaceholder = (v: string | undefined | null): boolean =>
  !v || /^YOUR_[A-Z_]+_HERE$/.test(v.trim());

/** Product version (root package.json) — shown in the UI footer and /api/health. */
export const APP_VERSION: string = (() => {
  try {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
      version?: string;
    };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

export { REPO_ROOT };

/** True once a real OAuth token (not the placeholder) is present. Pure for testability. */
export const hasMetrikaToken = (token: string = config.YANDEX_OAUTH_TOKEN): boolean =>
  token.length > 0 && token !== 'YOUR_OAUTH_TOKEN_HERE';

/** True once an Anthropic API key (not the placeholder) is present. Pure for testability. */
export const hasAnthropicKey = (key: string = config.ANTHROPIC_API_KEY): boolean =>
  key.length > 0 && key !== 'YOUR_ANTHROPIC_API_KEY_HERE';

/** True once a Metrika counter id is configured (a live sync needs it). Pure for testability. */
export const hasCounterId = (id: number = config.COUNTER_ID): boolean => id > 0;
