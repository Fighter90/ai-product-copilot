import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AppSettings, SETTING_KEYS, SECRET_KEYS } from '../../src/settings/app-settings';
import { decryptSecret, encryptSecret } from '../../src/security/crypto';
import { freshDb } from '../db/helpers';
import type { DB } from '../../src/db/connection';

const APP_SECRET = 'test-app-secret';

/** Default env: one real value, one placeholder, one missing. */
const env = {
  YANDEX_OAUTH_TOKEN: 'env-oauth-token',
  COUNTER_ID: '12345',
  GOAL_ID: 'YOUR_GOAL_ID_HERE', // placeholder из .env.example — считается пустым
} as unknown as Partial<Record<(typeof SETTING_KEYS)[number], string>>;

let db: DB;
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  db = freshDb();
  warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  warn.mockRestore();
  db.close();
});

const make = (envDefaults = env) => new AppSettings(db, APP_SECRET, envDefaults);

describe('AppSettings.get', () => {
  it('falls back to env defaults; placeholder counts as empty', () => {
    const s = make();
    expect(s.get('YANDEX_OAUTH_TOKEN')).toBe('env-oauth-token');
    expect(s.get('COUNTER_ID')).toBe('12345');
    expect(s.get('GOAL_ID')).toBe(''); // YOUR_GOAL_ID_HERE → ''
    expect(s.get('ORDER_GOAL_ID')).toBe(''); // no env default
  });

  it('a DB override wins over env; secrets roundtrip encrypted', () => {
    const s = make();
    s.set('COUNTER_ID', '999', 'admin@x.ru');
    expect(s.get('COUNTER_ID')).toBe('999');
    s.set('YANDEX_OAUTH_TOKEN', 'db-secret-token', 'admin@x.ru');
    // Stored encrypted, not plaintext.
    const raw = (
      db.prepare("SELECT value FROM app_settings WHERE key = 'YANDEX_OAUTH_TOKEN'").get() as {
        value: string;
      }
    ).value;
    expect(raw).toMatch(/^v1:/);
    expect(raw).not.toContain('db-secret-token');
    expect(decryptSecret(raw, APP_SECRET)).toBe('db-secret-token');
    expect(s.get('YANDEX_OAUTH_TOKEN')).toBe('db-secret-token');
  });

  it('overwriting a secret key with "" stores an empty (non-encrypted) value', () => {
    const s = make();
    s.set('YANDEX_OAUTH_TOKEN', 'x', 'a@x.ru');
    s.set('YANDEX_OAUTH_TOKEN', '', 'a@x.ru');
    const row = db
      .prepare("SELECT value, is_secret FROM app_settings WHERE key = 'YANDEX_OAUTH_TOKEN'")
      .get() as { value: string; is_secret: number };
    expect(row.value).toBe('');
    expect(row.is_secret).toBe(1);
    expect(s.get('YANDEX_OAUTH_TOKEN')).toBe('');
  });

  it('a placeholder saved into the DB also reads as empty', () => {
    const s = make();
    s.set('COUNTER_ID', 'YOUR_COUNTER_ID_HERE', 'a@x.ru');
    expect(s.get('COUNTER_ID')).toBe('');
  });

  it('undecryptable secret (rotated APP_SECRET) → "" + one console.error per key', () => {
    const s = make();
    s.set('YANDEX_CLIENT_SECRET', 'sec', 'a@x.ru');
    // Re-create with a wrong key over an existing encrypted row.
    const s2 = new AppSettings(db, 'wrong-key', {});
    expect(s2.get('YANDEX_CLIENT_SECRET')).toBe('');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('YANDEX_CLIENT_SECRET');
    expect(warn.mock.calls[0]![0]).not.toContain('sec'); // значение никогда не печатается
    // Second read is silent (one warn per key).
    expect(s2.get('YANDEX_CLIENT_SECRET')).toBe('');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('getNumber parses finite numbers, garbage → 0', () => {
    const s = make();
    expect(s.getNumber('COUNTER_ID')).toBe(12345);
    s.set('KPI_TARGET', '42.5', 'a@x.ru');
    expect(s.getNumber('KPI_TARGET')).toBe(42.5);
    s.set('KPI_TARGET', 'abc', 'a@x.ru');
    expect(s.getNumber('KPI_TARGET')).toBe(0);
  });
});

describe('AppSettings.source / view', () => {
  it('source reports db / env / unset (placeholder = unset)', () => {
    const s = make();
    expect(s.source('YANDEX_OAUTH_TOKEN')).toBe('env');
    expect(s.source('GOAL_ID')).toBe('unset'); // placeholder env
    expect(s.source('ORDER_GOAL_ID')).toBe('unset');
    s.set('ORDER_GOAL_ID', '7', 'a@x.ru');
    expect(s.source('ORDER_GOAL_ID')).toBe('db');
  });

  it('view masks secrets, shows plain values for the rest, and flags isSecret', () => {
    const s = make();
    s.set('YANDEX_OAUTH_TOKEN', 'super-secret-token', 'a@x.ru');
    s.set('COUNTER_ID', '777', 'a@x.ru');
    const v = s.view();
    expect(Object.keys(v).sort()).toEqual([...SETTING_KEYS].sort());
    expect(v.YANDEX_OAUTH_TOKEN).toEqual({ value: '••••oken', isSecret: true, source: 'db' });
    expect(v.COUNTER_ID).toEqual({ value: '777', isSecret: false, source: 'db' });
    expect(v.YANDEX_CLIENT_SECRET.isSecret).toBe(true);
    expect(v.GOAL_ID).toEqual({ value: '', isSecret: false, source: 'unset' });
    // Masked secret can be echoed back into set() as "keep" (handled by the route, not here).
  });

  it('SECRET_KEYS are exactly the four documented keys', () => {
    expect([...SECRET_KEYS].sort()).toEqual([
      'DATALENS_IAM_TOKEN',
      'DATALENS_WEBHOOK_TOKEN',
      'YANDEX_CLIENT_SECRET',
      'YANDEX_OAUTH_TOKEN',
    ]);
  });

  it('DataLens connection keys: org/workbook plain, IAM token encrypted at rest and masked', () => {
    const s = make();
    s.set('DATALENS_ORG_ID', 'org-abc', 'a@x.ru');
    s.set('DATALENS_WORKBOOK_ID', 'wb-123', 'a@x.ru');
    s.set('DATALENS_IAM_TOKEN', 't1.iam-secret-value-9876', 'a@x.ru');
    const raw = db
      .prepare("SELECT value, is_secret FROM app_settings WHERE key = 'DATALENS_IAM_TOKEN'")
      .get() as { value: string; is_secret: number };
    expect(raw.is_secret).toBe(1);
    expect(raw.value).not.toContain('iam-secret-value');
    expect(s.get('DATALENS_IAM_TOKEN')).toBe('t1.iam-secret-value-9876');
    const v = s.view();
    expect(v.DATALENS_IAM_TOKEN).toEqual({ value: '••••9876', isSecret: true, source: 'db' });
    expect(v.DATALENS_ORG_ID).toEqual({ value: 'org-abc', isSecret: false, source: 'db' });
    expect(v.DATALENS_WORKBOOK_ID).toEqual({ value: 'wb-123', isSecret: false, source: 'db' });
    expect(JSON.stringify(v)).not.toContain('iam-secret-value');
  });

  it('settings survive re-instantiation (encrypted at rest)', () => {
    const s1 = make();
    s1.set('DATALENS_WEBHOOK_TOKEN', 'wh-token-123456', 'a@x.ru');
    const s2 = make();
    expect(s2.get('DATALENS_WEBHOOK_TOKEN')).toBe('wh-token-123456');
    expect(s2.view().DATALENS_WEBHOOK_TOKEN.value).toBe('••••3456');
  });

  it('encryptSecret output is stable across instances with the same key (roundtrip check)', () => {
    expect(decryptSecret(encryptSecret('v', APP_SECRET), APP_SECRET)).toBe('v');
  });
});
