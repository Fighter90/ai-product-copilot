/**
 * Client-side mirror of the backend password policy (POST /api/auth/password:
 * `current` non-empty, `next` 10–200 chars). The server stays authoritative.
 */
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;

export type PasswordChangeError = 'current' | 'short' | 'long' | 'mismatch';

export function validatePasswordChange(v: {
  current: string;
  next: string;
  confirm: string;
}): PasswordChangeError | null {
  if (!v.current) return 'current';
  if (v.next.length < PASSWORD_MIN) return 'short';
  if (v.next.length > PASSWORD_MAX) return 'long';
  if (v.next !== v.confirm) return 'mismatch';
  return null;
}

/** Map an API failure of the password change to a user-facing reason. */
export function passwordApiError(err: unknown): 'wrong' | 'weak' | 'failed' {
  const msg = err instanceof Error ? err.message : '';
  if (msg.includes('BAD_CREDENTIALS')) return 'wrong';
  if (msg.includes('WEAK_PASSWORD')) return 'weak';
  return 'failed';
}
