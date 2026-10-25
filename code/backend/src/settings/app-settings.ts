import type { DB } from '../db/connection';
import { decryptSecret, encryptSecret, maskSecret } from '../security/crypto';
import { isPlaceholder } from '../config';

/** Settings an admin can change at runtime (override .env, applied without a restart). */
export const SETTING_KEYS = [
  'YANDEX_OAUTH_TOKEN',
  'YANDEX_CLIENT_ID',
  'YANDEX_CLIENT_SECRET',
  'COUNTER_ID',
  'GOAL_ID',
  'ORDER_GOAL_ID',
  'KPI_TARGET',
  'DATALENS_WEBHOOK_TOKEN',
  'DATALENS_LINKS',
  'TEST_TRAFFIC_PATTERNS',
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export const SECRET_KEYS: ReadonlySet<SettingKey> = new Set([
  'YANDEX_OAUTH_TOKEN',
  'YANDEX_CLIENT_SECRET',
  'DATALENS_WEBHOOK_TOKEN',
]);

interface Row {
  key: string;
  value: string;
  is_secret: number;
  updated_at: string;
  updated_by: string | null;
}

/**
 * DB-backed key/value settings. Secrets are AES-GCM encrypted with APP_SECRET.
 * `get` falls back to the provided env defaults so a fresh install keeps working from `.env`.
 */
export class AppSettings {
  /** Keys whose decryption already produced a console warning (one warn per key). */
  private readonly decryptWarned = new Set<string>();
  constructor(
    private readonly db: DB,
    private readonly appSecret: string,
    private readonly envDefaults: Partial<Record<SettingKey, string>>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private row(key: SettingKey): Row | undefined {
    return this.db.prepare('SELECT * FROM app_settings WHERE key = ?').get(key) as Row | undefined;
  }

  /** Effective value: DB override → env default → ''. Placeholders count as empty. */
  get(key: SettingKey): string {
    const r = this.row(key);
    if (r) {
      try {
        const v = r.is_secret ? decryptSecret(r.value, this.appSecret) : r.value;
        return isPlaceholder(v) ? '' : v;
      } catch {
        // Wrong/rotated APP_SECRET: fail visibly in logs (never print the value), behave as unset.
        if (!this.decryptWarned.has(key)) {
          this.decryptWarned.add(key);
          console.error(`app-settings: cannot decrypt "${key}" — check APP_SECRET`);
        }
        return '';
      }
    }
    const env = this.envDefaults[key] ?? '';
    return isPlaceholder(env) ? '' : env;
  }

  getNumber(key: SettingKey): number {
    const n = Number(this.get(key));
    return Number.isFinite(n) ? n : 0;
  }

  /** Where the effective value comes from — shown to the admin. */
  source(key: SettingKey): 'db' | 'env' | 'unset' {
    if (this.row(key)) return 'db';
    return isPlaceholder(this.envDefaults[key]) ? 'unset' : 'env';
  }

  set(key: SettingKey, value: string, by: string | null): void {
    const secret = SECRET_KEYS.has(key);
    const stored = secret && value ? encryptSecret(value, this.appSecret) : value;
    this.db
      .prepare(
        `INSERT INTO app_settings (key, value, is_secret, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, is_secret = excluded.is_secret,
         updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      )
      .run(key, stored, secret ? 1 : 0, this.now().toISOString(), by);
  }

  /** Public view for the admin UI: secrets masked, plus source. */
  view(): Record<SettingKey, { value: string; isSecret: boolean; source: string }> {
    const out = {} as Record<SettingKey, { value: string; isSecret: boolean; source: string }>;
    for (const key of SETTING_KEYS) {
      const secret = SECRET_KEYS.has(key);
      const v = this.get(key);
      out[key] = { value: secret ? maskSecret(v) : v, isSecret: secret, source: this.source(key) };
    }
    return out;
  }
}
