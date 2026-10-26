import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatInt, formatPercent, formatDate } from './format';

describe('format', () => {
  it('formatInt rounds and groups', () => {
    expect(formatInt(1234.6)).toMatch(/1.235/);
  });

  it('formatInt follows pca.locale: ru thin space, en comma grouping', () => {
    window.localStorage.setItem('pca.locale', 'en');
    expect(formatInt(1234567)).toBe('1,234,567');
    window.localStorage.setItem('pca.locale', 'ru');
    expect(formatInt(1234567)).toBe('1\u00A0234\u00A0567');
  });

  it('formatInt falls back to ru-RU when localStorage throws (private mode)', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      expect(formatInt(1234567)).toBe('1\u00A0234\u00A0567');
    } finally {
      spy.mockRestore();
    }
  });

  it('formatPercent uses default and custom digits', () => {
    expect(formatPercent(0.05)).toBe('5.0%');
    expect(formatPercent(0.0523, 2)).toBe('5.23%');
  });

  it('formatPercent clamps an implausible rate (>100%) to 100.0%', () => {
    // Metrika can return conversionRate=2.0 on multi-goal pages — never render "200.0%".
    expect(formatPercent(2.0)).toBe('100.0%');
  });

  it('formatDate trims to YYYY-MM-DD', () => {
    expect(formatDate('2025-01-02T10:00:00.000Z')).toBe('2025-01-02');
  });
});

afterEach(() => {
  window.localStorage.setItem('pca.locale', 'ru');
});
