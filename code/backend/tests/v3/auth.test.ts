import { describe, it, expect } from 'vitest';
import {
  isPublicPath,
  LoginLimiter,
  parseCookies,
  requiresAdmin,
  SESSION_COOKIE,
  sessionCookie,
} from '../../src/auth/auth';

describe('parseCookies', () => {
  it('parses a Cookie header into a map', () => {
    expect(parseCookies('a=1; b=two%20words; pca_session=tok')).toEqual({
      a: '1',
      b: 'two words',
      pca_session: 'tok',
    });
  });

  it('tolerates garbage: empty header, parts without =, broken encoding', () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('')).toEqual({});
    expect(parseCookies('novalue; =empty; ok=1')).toEqual({ ok: '1' });
    expect(parseCookies('bad=%ZZ')).toEqual({ bad: '%ZZ' }); // decode failure keeps raw value
  });
});

describe('sessionCookie', () => {
  it('builds an HttpOnly Lax cookie; Secure only behind TLS', () => {
    expect(sessionCookie('tok en', { secure: true, maxAgeSec: 3600 })).toBe(
      `${SESSION_COOKIE}=tok%20en; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600; Secure`,
    );
    const c = sessionCookie('t', { secure: false, maxAgeSec: 60 });
    expect(c).toContain('Max-Age=60');
    expect(c).not.toContain('Secure');
    // Logout shape: empty token, Max-Age=0
    expect(sessionCookie('', { secure: false, maxAgeSec: 0 })).toContain(`${SESSION_COOKIE}=;`);
  });
});

describe('isPublicPath', () => {
  it('allows health, login/logout, help and the datalens webhook', () => {
    for (const p of [
      '/api/health',
      '/api/health/',
      '/api/auth/login',
      '/api/auth/logout',
      '/api/help/articles',
      '/api/help/search?q=x',
      '/api/integrations/datalens/webhook/some-token',
    ]) {
      expect(isPublicPath(p), p).toBe(true);
    }
  });

  it('keeps /api/help/ask behind auth (costs LLM tokens)', () => {
    expect(isPublicPath('/api/help/ask')).toBe(false);
    expect(isPublicPath('/api/help/ask/')).toBe(false);
  });

  it('query strings do not bypass the guard', () => {
    expect(isPublicPath('/api/auth/me?x=1')).toBe(false);
    expect(isPublicPath('/api/help/ask?lang=en')).toBe(false);
  });

  it('everything else under /api requires a session', () => {
    for (const p of [
      '/api/metrics/channels',
      '/api/users',
      '/api/settings',
      '/api/notifications',
      '/api/auth/me',
      '/api/auth/password',
      '/api/helpcenter-ish', // prefix must match a full segment
    ]) {
      expect(isPublicPath(p), p).toBe(false);
    }
  });

  it('non-API paths are public (swagger UI behind nginx)', () => {
    expect(isPublicPath('/docs')).toBe(true);
    expect(isPublicPath('/')).toBe(true);
  });
});

describe('requiresAdmin', () => {
  it('guards /api/admin and /api/users for every method', () => {
    expect(requiresAdmin('GET', '/api/admin/audit')).toBe(true);
    expect(requiresAdmin('POST', '/api/users')).toBe(true);
    expect(requiresAdmin('GET', '/api/users/5')).toBe(true);
    expect(requiresAdmin('PATCH', '/api/users/5?x=1')).toBe(true);
  });

  it('guards mutating settings/provider routes but leaves reads public', () => {
    expect(requiresAdmin('GET', '/api/settings')).toBe(false);
    expect(requiresAdmin('POST', '/api/settings')).toBe(true);
    expect(requiresAdmin('PUT', '/api/settings')).toBe(true);
    expect(requiresAdmin('DELETE', '/api/settings')).toBe(true);
    expect(requiresAdmin('GET', '/api/ai/available')).toBe(false);
    expect(requiresAdmin('PUT', '/api/ai/providers/anthropic')).toBe(true);
    expect(requiresAdmin('POST', '/api/ai/providers/anthropic/test')).toBe(true);
    expect(requiresAdmin('GET', '/api/admin/ai/providers')).toBe(true);
  });

  it('lowercase methods are normalised; data wipe is DELETE-only', () => {
    expect(requiresAdmin('delete', '/api/data/metrika')).toBe(true);
    expect(requiresAdmin('GET', '/api/data/metrika')).toBe(false);
    expect(requiresAdmin('POST', '/api/sync')).toBe(false);
  });
});

describe('LoginLimiter', () => {
  it('blocks after max failures per key and resets on success', () => {
    let t = 0;
    const lim = new LoginLimiter(3, 60_000, () => (t += 1000));
    expect(lim.blocked('k')).toBe(false);
    lim.fail('k');
    lim.fail('k');
    expect(lim.blocked('k')).toBe(false);
    lim.fail('k');
    expect(lim.blocked('k')).toBe(true);
    lim.reset('k');
    expect(lim.blocked('k')).toBe(false);
  });

  it('window expiry unblocks the key; independent keys', () => {
    let t = 0;
    const lim = new LoginLimiter(2, 60_000, () => t);
    lim.fail('k1');
    lim.fail('k1');
    expect(lim.blocked('k1')).toBe(true);
    expect(lim.blocked('k2')).toBe(false);
    t = 61_000;
    expect(lim.blocked('k1')).toBe(false); // all hits aged out
    // Failing again after expiry blocks only after 2 fresh failures.
    lim.fail('k1');
    expect(lim.blocked('k1')).toBe(false);
    lim.fail('k1');
    expect(lim.blocked('k1')).toBe(true);
  });

  it('sweeps dead keys when the map grows past 10k entries (no memory leak)', () => {
    let t = 0;
    const lim = new LoginLimiter(1, 1000, () => t);
    for (let i = 0; i < 10_050; i++) lim.fail(`spoofed-${i}`);
    t = 2000; // everything expires
    lim.fail('fresh'); // triggers the sweep
    // Spoofed keys with only stale hits must have been dropped.
    expect(lim.blocked('spoofed-0')).toBe(false);
    expect(lim.blocked('fresh')).toBe(true);
  });
});
