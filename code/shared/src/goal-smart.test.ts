import { describe, it, expect } from 'vitest';
import { isGoalExpired, smartGoal } from './goal-smart';

describe('isGoalExpired (ANA-166)', () => {
  it('true when the deadline day is over (deadline < today)', () => {
    expect(isGoalExpired('2026-11-01', '2026-11-15')).toBe(true);
  });

  it('false on the deadline day itself — the whole deadline day still counts', () => {
    expect(isGoalExpired('2026-11-15', '2026-11-15')).toBe(false);
  });

  it("false without a deadline ('' → heuristic) or with a non-calendar date", () => {
    expect(isGoalExpired('', '2026-11-15')).toBe(false);
    expect(isGoalExpired('2026-13-99', '2026-11-15')).toBe(false);
  });

  it('false without a usable today (nothing to compare against)', () => {
    expect(isGoalExpired('2026-11-01', '')).toBe(false);
    expect(isGoalExpired('2026-11-01', 'garbage')).toBe(false);
  });
});

describe('smartGoal (ANA-166: SMART-формулировка главной цели)', () => {
  it('active goal: Specific+Measurable+Time-bound plus the Achievable daily rate (ru)', () => {
    // 2026-11-01 → 2026-11-15: 14 days left, remaining 150 → ceil(150 / 14) = 11.
    const s = smartGoal({
      target: 300,
      paid: 150,
      deadline: '2026-11-15',
      today: '2026-11-01',
      locale: 'ru',
    });
    expect(s).toContain('≥300 платных билетов');
    expect(s).toContain('к 15.11.2026');
    expect(s).toContain('сейчас 150');
    expect(s).toContain('осталось 150');
    expect(s).toContain('~11 в день');
  });

  it('english wording mirrors the russian semantics (no Cyrillic)', () => {
    const s = smartGoal({
      target: 300,
      paid: 150,
      deadline: '2026-11-15',
      today: '2026-11-01',
      locale: 'en',
    });
    expect(s).toContain('≥300 paid tickets');
    expect(s).toContain('by 15 Nov 2026');
    expect(s).toContain('150 so far');
    expect(s).toContain('~11 per day');
    expect(s).not.toMatch(/[А-Яа-яЁё]/);
  });

  it('achieved goal beats expiry — no «дедлайн прошёл» when the target is met', () => {
    const s = smartGoal({
      target: 300,
      paid: 310,
      deadline: '2026-11-01',
      today: '2026-11-15',
      locale: 'ru',
    });
    expect(s).toContain('Цель достигнута');
    expect(s).toContain('к 01.11.2026');
    expect(s).not.toContain('прошёл');
  });

  it('expired goal states the final count (auto-state after the deadline)', () => {
    const s = smartGoal({
      target: 300,
      paid: 150,
      deadline: '2026-11-01',
      today: '2026-11-15',
      locale: 'ru',
    });
    expect(s).toContain('Дедлайн 01.11.2026 прошёл');
    expect(s).toContain('150 из 300 платных билетов');
    expect(s).not.toContain('в день');
  });

  it('expired goal in english', () => {
    const s = smartGoal({
      target: 300,
      paid: 150,
      deadline: '2026-11-01',
      today: '2026-11-15',
      locale: 'en',
    });
    expect(s).toContain('Deadline 1 Nov 2026 has passed');
    expect(s).toContain('150 of 300 paid tickets');
  });

  it('expired goal WITHOUT paid data: names the goal, invents no «0 из N» (anti-hallucination)', () => {
    // Превью админки не знает оплаченных билетов — выставлять за них ноль нельзя.
    const ru = smartGoal({
      target: 300,
      deadline: '2026-11-01',
      today: '2026-11-15',
      locale: 'ru',
    });
    expect(ru).toBe('Дедлайн 01.11.2026 прошёл: цель — 300 платных билетов.');
    const en = smartGoal({
      target: 300,
      deadline: '2026-11-01',
      today: '2026-11-15',
      locale: 'en',
    });
    expect(en).toBe('Deadline 1 Nov 2026 has passed: goal — 300 paid tickets.');
  });

  it('admin preview without paid: S+M+T without progress or rate', () => {
    const s = smartGoal({
      target: 300,
      deadline: '2026-11-15',
      today: '2026-11-01',
      locale: 'ru',
    });
    expect(s).toBe('Достичь ≥300 платных билетов к 15.11.2026.');
    expect(s).not.toContain('осталось');
  });

  it('no deadline: the statement says the goal has no deadline (admin preview)', () => {
    const ru = smartGoal({ target: 300, deadline: '', today: '2026-11-01', locale: 'ru' });
    expect(ru).toBe('Достичь ≥300 платных билетов (без дедлайна).');
    const en = smartGoal({ target: 300, deadline: '', today: '2026-11-01', locale: 'en' });
    expect(en).toBe('Reach ≥300 paid tickets (no deadline).');
  });

  it('deadline is today: progress without a rate part (0 days left)', () => {
    const s = smartGoal({
      target: 300,
      paid: 150,
      deadline: '2026-11-15',
      today: '2026-11-15',
      locale: 'ru',
    });
    expect(s).toContain('осталось 150');
    expect(s).not.toContain('в день');
  });

  it('goal fully paid exactly at target — achieved, no rate', () => {
    const s = smartGoal({
      target: 300,
      paid: 300,
      deadline: '2026-11-15',
      today: '2026-11-01',
      locale: 'ru',
    });
    expect(s).toContain('Цель достигнута');
    expect(s).not.toContain('в день');
  });

  it('no sensible target — empty string (nothing to formulate)', () => {
    expect(
      smartGoal({ target: 0, deadline: '2026-11-15', today: '2026-11-01', locale: 'ru' }),
    ).toBe('');
    expect(
      smartGoal({ target: -5, deadline: '2026-11-15', today: '2026-11-01', locale: 'en' }),
    ).toBe('');
  });
});
