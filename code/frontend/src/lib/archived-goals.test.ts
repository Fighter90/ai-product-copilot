import { describe, it, expect } from 'vitest';
import { isArchived, visibleGoals } from './archived-goals';

describe('archived goals filter', () => {
  const goals = [
    { id: 1, archived: false },
    { id: 2, archived: true },
    { id: 3 },
    { id: 4, isArchived: true },
  ];

  it('detects both API shapes of the archive flag', () => {
    expect(isArchived({ archived: true })).toBe(true);
    expect(isArchived({ isArchived: true })).toBe(true);
    expect(isArchived({ archived: false })).toBe(false);
    expect(isArchived({})).toBe(false);
  });

  it('hides archived goals unless showArchived is on', () => {
    expect(visibleGoals(goals, false).map((g) => g.id)).toEqual([1, 3]);
    expect(visibleGoals(goals, true).map((g) => g.id)).toEqual([1, 2, 3, 4]);
  });
});
