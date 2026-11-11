import { describe, it, expect } from 'vitest';
import { validateHypothesis, iceScore, iceBucket } from './validation';
import type { NewHypothesis } from './types/hypotheses';

function valid(overrides: Partial<NewHypothesis> = {}): NewHypothesis {
  return {
    diamondPhase: 'define',
    kind: 'problem',
    subject: 'Слушатель подкаста',
    action: 'не покупает',
    solution: 'билет за 14k+',
    condition: 'нет промежуточного лендинга',
    title: 'Подкаст → низкая конверсия',
    hiddenAssumptions: [
      { category: 'behavior', text: 'холодный лид' },
      { category: 'market', text: '14k дорого без ценности' },
      { category: 'tech', text: 'UTM проставлены' },
    ],
    validationMethods: [
      { type: 'quantitative', plan: 'CR podcast vs others' },
      { type: 'synthetic', plan: 'custdev слушателя' },
    ],
    impact: 7,
    confidence: 6,
    ease: 9,
    impactRationale: 'есть кого активировать',
    confidenceRationale: 'подозрение, нет данных',
    easeRationale: 'один запрос',
    greenCriteria: 'CR ниже на 30%',
    yellowCriteria: 'разница 10-30%',
    redCriteria: 'разницы нет',
    deadlineDays: 2,
    ...overrides,
  };
}

describe('validateHypothesis', () => {
  it('accepts a complete hypothesis', () => {
    const res = validateHypothesis(valid());
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
  });

  it('rejects blank format/criteria/rationale fields', () => {
    const res = validateHypothesis(
      valid({ subject: '   ', greenCriteria: '', impactRationale: '' }),
    );
    expect(res.ok).toBe(false);
    expect(res.errors).toContain('subject is required');
    expect(res.errors).toContain('greenCriteria is required');
    expect(res.errors).toContain('impactRationale is required');
  });

  it('rejects fewer than 3 hidden assumptions', () => {
    const res = validateHypothesis(
      valid({ hiddenAssumptions: [{ category: 'behavior', text: 'a' }] }),
    );
    expect(res.errors.some((e) => e.includes('>=3 hidden assumptions'))).toBe(true);
  });

  it('rejects assumptions that do not cover all categories', () => {
    const res = validateHypothesis(
      valid({
        hiddenAssumptions: [
          { category: 'behavior', text: 'a' },
          { category: 'behavior', text: 'b' },
          { category: 'behavior', text: 'c' },
        ],
      }),
    );
    expect(res.errors.some((e) => e.includes('cover categories'))).toBe(true);
  });

  it('rejects fewer than 2 validation methods', () => {
    const res = validateHypothesis(
      valid({ validationMethods: [{ type: 'synthetic', plan: 'x' }] }),
    );
    expect(res.errors.some((e) => e.includes('>=2 validation methods'))).toBe(true);
  });

  it('rejects two methods of the same type', () => {
    const res = validateHypothesis(
      valid({
        validationMethods: [
          { type: 'synthetic', plan: 'a' },
          { type: 'synthetic', plan: 'b' },
        ],
      }),
    );
    expect(res.errors.some((e) => e.includes('distinct validation method types'))).toBe(true);
  });

  it('rejects out-of-range and non-integer ICE factors', () => {
    expect(
      validateHypothesis(valid({ impact: 0 })).errors.some((e) => e.startsWith('impact')),
    ).toBe(true);
    expect(
      validateHypothesis(valid({ confidence: 11 })).errors.some((e) => e.startsWith('confidence')),
    ).toBe(true);
    expect(validateHypothesis(valid({ ease: 5.5 })).errors.some((e) => e.startsWith('ease'))).toBe(
      true,
    );
  });

  it('rejects non-positive or non-integer deadlines', () => {
    expect(validateHypothesis(valid({ deadlineDays: 0 })).ok).toBe(false);
    expect(validateHypothesis(valid({ deadlineDays: 1.5 })).ok).toBe(false);
  });
});

describe('validateHypothesis draft mode (ANA-129 two-status model)', () => {
  /** A draft with only a title: every format field blank / empty. */
  function titleOnly(): NewHypothesis {
    return valid({
      subject: '',
      action: '',
      solution: '',
      condition: '',
      hiddenAssumptions: [],
      validationMethods: [],
      impactRationale: '',
      confidenceRationale: '',
      easeRationale: '',
      greenCriteria: '',
      yellowCriteria: '',
      redCriteria: '',
    });
  }

  it('accepts a title-only draft — all format fields are optional', () => {
    const res = validateHypothesis(titleOnly(), { mode: 'draft' });
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
  });

  it('still requires a non-blank title', () => {
    const res = validateHypothesis(valid({ title: '   ' }), { mode: 'draft' });
    expect(res.ok).toBe(false);
    expect(res.errors).toContain('title is required');
  });

  it('keeps ICE factors in range and the deadline sane (data sanity, not format)', () => {
    expect(validateHypothesis(valid({ impact: 42 }), { mode: 'draft' }).ok).toBe(false);
    expect(validateHypothesis(valid({ deadlineDays: 0 }), { mode: 'draft' }).ok).toBe(false);
    expect(validateHypothesis(valid({ deadlineDays: 1.5 }), { mode: 'draft' }).ok).toBe(false);
  });

  it('defaults to work mode — the full format still applies without options', () => {
    expect(validateHypothesis(titleOnly()).ok).toBe(false);
  });

  it('work mode rejects a title-only draft that passes draft validation', () => {
    expect(validateHypothesis(titleOnly(), { mode: 'draft' }).ok).toBe(true);
    const res = validateHypothesis(titleOnly(), { mode: 'work' });
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.includes('>=3 hidden assumptions'))).toBe(true);
    expect(res.errors.some((e) => e.includes('>=2 validation methods'))).toBe(true);
  });
});

describe('iceScore', () => {
  it('multiplies the three factors (product, not mean)', () => {
    expect(iceScore(8, 5, 7)).toBe(280);
    expect(iceScore(10, 2, 10)).toBe(200);
    expect(iceScore(10, 10, 10)).toBe(1000);
  });
});

describe('iceBucket', () => {
  it('maps scores to priority buckets at the threshold boundaries', () => {
    expect(iceBucket(1)).toBe('low');
    expect(iceBucket(125)).toBe('low');
    expect(iceBucket(126)).toBe('medium');
    expect(iceBucket(342)).toBe('medium');
    expect(iceBucket(343)).toBe('high');
    expect(iceBucket(729)).toBe('high');
    expect(iceBucket(730)).toBe('top');
    expect(iceBucket(1000)).toBe('top');
  });
});
