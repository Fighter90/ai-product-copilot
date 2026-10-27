import { describe, it, expect } from 'vitest';
import { FRONTEND_BUILD, buildLabel, buildMismatch, formatBuildDate } from './build-info';

const front = { version: '3.1.0', sha: 'abc1234', date: '2026-10-25' };

describe('build-info', () => {
  it('falls back to dev placeholders when Vite define is absent (vitest)', () => {
    expect(FRONTEND_BUILD).toEqual({ version: 'dev', sha: 'dev', date: '' });
  });

  it('formats the build date as DD.MM.YYYY', () => {
    expect(formatBuildDate('2026-10-25')).toBe('25.10.2026');
    expect(formatBuildDate('2026-10-25T10:00:00Z')).toBe('25.10.2026');
    expect(formatBuildDate('')).toBe('');
    expect(formatBuildDate('soon')).toBe('soon');
  });

  it('builds «vX · sha · date», skipping unknown parts', () => {
    expect(buildLabel(front)).toBe('v3.1.0 · abc1234 · 25.10.2026');
    expect(buildLabel({ version: 'dev', sha: 'dev', date: '' })).toBe('vdev');
    expect(buildLabel()).toBe('vdev');
  });

  describe('buildMismatch', () => {
    it('no backend answer → no mismatch', () => {
      expect(buildMismatch(front, null)).toBeNull();
      expect(buildMismatch(front, undefined)).toBeNull();
    });

    it('matches a full backend SHA by prefix', () => {
      expect(
        buildMismatch(front, { version: '3.1.0', build: 'abc1234def5678900000000000000000000000' }),
      ).toBeNull();
    });

    it('flags a different commit', () => {
      expect(buildMismatch(front, { version: '3.1.0', build: 'fff0000aaaa' })).toEqual({
        field: 'build',
        frontend: 'abc1234',
        backend: 'fff0000',
      });
    });

    it('flags a different version first', () => {
      expect(buildMismatch(front, { version: '3.2.0', build: 'abc1234' })).toEqual({
        field: 'version',
        frontend: '3.1.0',
        backend: '3.2.0',
      });
    });

    it('unknown sides (dev build, BUILD_SHA unset) never mismatch', () => {
      expect(buildMismatch(front, { version: '3.1.0', build: null })).toBeNull();
      expect(
        buildMismatch({ ...front, sha: 'dev' }, { version: '3.1.0', build: 'fff' }),
      ).toBeNull();
      expect(buildMismatch({ ...front, version: 'dev' }, { version: '9.9.9' })).toBeNull();
      expect(buildMismatch(front, {})).toBeNull();
    });
  });
});
