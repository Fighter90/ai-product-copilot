import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Password hashing (scrypt, per-user salt) and secret encryption (AES-256-GCM).
 * Pure functions over node:crypto — no new dependencies (ADR-008).
 */

const SCRYPT_N = 16384;
const SCRYPT_KEYLEN = 64;

/** Hash a password: `scrypt$N$saltB64$hashB64`. */
export function hashPassword(password: string, salt: Buffer = randomBytes(16)): string {
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N });
  return `scrypt$${SCRYPT_N}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

/** Constant-time password check against a stored `hashPassword` string. */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]);
  const salt = Buffer.from(parts[2] ?? '', 'base64');
  const expected = Buffer.from(parts[3] ?? '', 'base64');
  if (!n || salt.length === 0 || expected.length === 0) return false;
  const actual = scryptSync(password, salt, expected.length, { N: n });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Random URL-safe token (session ids, webhook tokens). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Readable temporary password: 4 groups of 4 chars, no ambiguous symbols. */
export function randomPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(16);
  let out = '';
  for (let i = 0; i < 16; i++) {
    if (i > 0 && i % 4 === 0) out += '-';
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}

/** SHA-256 hex — sessions are stored by hash so a DB leak does not leak live tokens. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Derive a 32-byte AES key from the app secret. */
function keyFrom(secret: string): Buffer {
  if (!secret) throw new Error('APP_SECRET is not set — cannot encrypt secrets');
  // scrypt KDF: even a weak APP_SECRET produces a strong 256-bit AES key.
  return scryptSync(secret, 'pca:aes-kdf:v2', 32, { N: 16384, r: 8, p: 1 });
}

/** Encrypt a UTF-8 string → `v1:iv:tag:ciphertext` (base64 parts). */
export function encryptSecret(plain: string, appSecret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(appSecret), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

/** Decrypt a value produced by {@link encryptSecret}. Throws on tampering or a wrong key. */
export function decryptSecret(value: string, appSecret: string): string {
  const [ver, ivB64, tagB64, encB64] = value.split(':');
  if (ver !== 'v1' || !ivB64 || !tagB64 || encB64 === undefined) {
    throw new Error('Unsupported secret format');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    keyFrom(appSecret),
    Buffer.from(ivB64, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encB64, 'base64')), decipher.final()]).toString(
    'utf8',
  );
}

/** Mask a secret for display: `••••abcd` (never more than the last 4 chars). */
export function maskSecret(value: string | undefined | null): string {
  if (!value) return '';
  return `••••${value.slice(-4)}`;
}
