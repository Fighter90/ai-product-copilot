import { describe, expect, it } from 'vitest';
import { dedupeById } from './hypotheses-api';

/**
 * ANA-181 (регресс прод 15.11): счётчик «Черновики» вырос 20 → 60 без создания гипотез.
 * ЗАЩИТНАЯ дедупликация по id на границе queryFn: дубликаты с одинаковым id не достигают
 * кэша react-query. Механизм прод-дублирования не подтверждён (см. комментарий в
 * hypotheses-api.ts) — тесты фиксируют только гаранта функции, а не источник инцидента.
 */
describe('dedupeById (ANA-181)', () => {
  it('keeps the first occurrence of each id and preserves the order', () => {
    const rows = [
      { id: 2, title: 'b' },
      { id: 1, title: 'a' },
      { id: 2, title: 'b (duplicate)' },
      { id: 1, title: 'a (duplicate)' },
      { id: 3, title: 'c' },
    ];
    expect(dedupeById(rows)).toEqual([
      { id: 2, title: 'b' },
      { id: 1, title: 'a' },
      { id: 3, title: 'c' },
    ]);
  });

  it('passes a duplicate-free list through unchanged', () => {
    const rows = [
      { id: 1, title: 'a' },
      { id: 2, title: 'b' },
    ];
    expect(dedupeById(rows)).toEqual(rows);
  });

  it('returns an empty list for an empty payload', () => {
    expect(dedupeById([])).toEqual([]);
  });
});
