import { describe, it, expect } from 'vitest';
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  passwordApiError,
  validatePasswordChange,
} from './password-policy';

describe('validatePasswordChange', () => {
  const ok = 'a'.repeat(PASSWORD_MIN);

  it('mirrors the backend policy: current required, next 10–200 chars, confirm matches', () => {
    expect(validatePasswordChange({ current: '', next: ok, confirm: ok })).toBe('current');
    expect(validatePasswordChange({ current: 'x', next: 'short', confirm: 'short' })).toBe('short');
    const long = 'a'.repeat(PASSWORD_MAX + 1);
    expect(validatePasswordChange({ current: 'x', next: long, confirm: long })).toBe('long');
    expect(validatePasswordChange({ current: 'x', next: ok, confirm: `${ok}!` })).toBe('mismatch');
    expect(validatePasswordChange({ current: 'x', next: ok, confirm: ok })).toBeNull();
  });
});

describe('passwordApiError', () => {
  it('maps backend error codes', () => {
    expect(passwordApiError(new Error('{"code":"BAD_CREDENTIALS"}'))).toBe('wrong');
    expect(passwordApiError(new Error('{"code":"WEAK_PASSWORD"}'))).toBe('weak');
    expect(passwordApiError(new Error('boom'))).toBe('failed');
    expect(passwordApiError('nope')).toBe('failed');
  });
});
