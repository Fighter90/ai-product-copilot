import { describe, expect, it } from 'vitest';
import { windowFor } from '../../src/metrika/sync-window';

describe('windowFor (ANA-74: cron-синк последних N дней)', () => {
  it('3 дня: from = позавчера, to = сегодня', () => {
    const { from, to } = windowFor(3, new Date('2026-10-28T12:00:00Z'));
    expect(to).toBe('2026-10-28');
    expect(from).toBe('2026-10-26');
  });

  it('1 день: окно = только сегодня', () => {
    const { from, to } = windowFor(1, new Date('2026-10-28T12:00:00Z'));
    expect(from).toBe(to);
    expect(to).toBe('2026-10-28');
  });

  it('days < 1 трактуется как 1 день', () => {
    const { from, to } = windowFor(0, new Date('2026-10-28T12:00:00Z'));
    expect(from).toBe('2026-10-28');
    expect(to).toBe('2026-10-28');
  });
});
