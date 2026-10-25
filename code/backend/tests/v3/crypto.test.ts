import { describe, it, expect } from 'vitest';
import {
  decryptSecret,
  encryptSecret,
  hashPassword,
  maskSecret,
  randomPassword,
  randomToken,
  sha256,
  verifyPassword,
} from '../../src/security/crypto';

describe('password hashing (scrypt)', () => {
  it('hashPassword/verifyPassword roundtrip', () => {
    const stored = hashPassword('Секрет-123!');
    expect(stored).toMatch(/^scrypt\$16384\$/);
    expect(verifyPassword('Секрет-123!', stored)).toBe(true);
    expect(verifyPassword('секрет-123!', stored)).toBe(false);
  });

  it('two hashes of the same password differ (random salt)', () => {
    expect(hashPassword('same')).not.toBe(hashPassword('same'));
  });

  it('verifyPassword rejects malformed stored values', () => {
    expect(verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(verifyPassword('x', 'bcrypt$16384$aaa$bbb')).toBe(false);
    expect(verifyPassword('x', 'scrypt$0$aaa$bbb')).toBe(false); // invalid N
    expect(verifyPassword('x', 'scrypt$16384$$bbb')).toBe(false); // empty salt
    expect(verifyPassword('x', 'scrypt$16384$aaa$')).toBe(false); // empty hash
  });
});

describe('secret encryption (AES-256-GCM)', () => {
  const secret = 'app-secret';

  it('encrypt → decrypt roundtrip (incl. unicode and empty string)', () => {
    const enc = encryptSecret('tok_секрет-🔑', secret);
    expect(enc).toMatch(/^v1:/);
    expect(enc.split(':')).toHaveLength(4);
    expect(decryptSecret(enc, secret)).toBe('tok_секрет-🔑');
    expect(decryptSecret(encryptSecret('', secret), secret)).toBe('');
  });

  it('fresh encryption produces a new IV (no deterministic output)', () => {
    expect(encryptSecret('x', secret)).not.toBe(encryptSecret('x', secret));
  });

  it('decrypt fails on a tampered tag or ciphertext', () => {
    const enc = encryptSecret('value', secret);
    const [ver, iv, tag, body] = enc.split(':');
    const tamperedTag = [
      ver,
      iv,
      tag!.slice(0, -2) + (tag!.endsWith('AA') ? 'BB' : 'AA'),
      body,
    ].join(':');
    expect(() => decryptSecret(tamperedTag, secret)).toThrow();
    const tamperedBody = [
      ver,
      iv,
      tag,
      body!.slice(0, -2) + (body!.endsWith('AA') ? 'BB' : 'AA'),
    ].join(':');
    expect(() => decryptSecret(tamperedBody, secret)).toThrow();
  });

  it('decrypt fails with a wrong key and on unsupported formats', () => {
    const enc = encryptSecret('value', secret);
    expect(() => decryptSecret(enc, 'another-secret')).toThrow();
    expect(() => decryptSecret('v2:aa:bb:cc', secret)).toThrow('Unsupported secret format');
    expect(() => decryptSecret('garbage', secret)).toThrow('Unsupported secret format');
    expect(() => decryptSecret('v1::tag:body', secret)).toThrow('Unsupported secret format');
    expect(() => decryptSecret('v1:iv::', secret)).toThrow('Unsupported secret format');
  });

  it('encrypt rejects an empty APP_SECRET', () => {
    expect(() => encryptSecret('value', '')).toThrow('APP_SECRET is not set');
  });
});

describe('maskSecret / tokens', () => {
  it('maskSecret shows at most the last 4 chars', () => {
    expect(maskSecret('abcdefghijklmnop')).toBe('••••mnop');
    expect(maskSecret('abc')).toBe('••••abc');
    expect(maskSecret('')).toBe('');
    expect(maskSecret(undefined)).toBe('');
    expect(maskSecret(null)).toBe('');
  });

  it('randomToken is url-safe and size-parameterised', () => {
    const t = randomToken(32);
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes → 43 base64url chars
    expect(randomToken(16)).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(randomToken(32)).not.toBe(t);
  });

  it('randomPassword: 4 groups of 4 unambiguous chars', () => {
    const p = randomPassword();
    expect(p).toMatch(/^[A-HJ-NP-Za-km-z2-9]{4}(-[A-HJ-NP-Za-km-z2-9]{4}){3}$/);
    expect(randomPassword()).not.toBe(p);
  });

  it('sha256 is deterministic hex', () => {
    expect(sha256('abc')).toBe(sha256('abc'));
    expect(sha256('abc')).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256('abc')).not.toBe(sha256('abd'));
  });
});
