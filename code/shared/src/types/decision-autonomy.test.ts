import { describe, it, expect } from 'vitest';
import {
  DECISION_TYPES,
  AUTONOMY_LEVELS,
  AUTONOMY_LEVEL_RANK,
  AUTONOMY_MATRIX,
  AUTONOMY_LEVEL_LABELS,
  REQUIRED_AUTONOMY,
  needsEscalation,
  assessDecisionAutonomy,
  isDecisionType,
} from './decision-autonomy';

/**
 * ANA-137: the decision-autonomy model is a static contract — exactly 8 decision types,
 * 3 autonomy levels, a complete type→max-level matrix and deterministic escalation rules.
 */

describe('decision autonomy taxonomy', () => {
  it('has exactly the 8 spec decision types', () => {
    expect([...DECISION_TYPES]).toEqual([
      'data-analysis',
      'hypothesis-draft',
      'experiment-launch',
      'pricing',
      'budget',
      'public-comms',
      'strategic',
      'legal',
    ]);
  });

  it('has exactly 3 autonomy levels A0–A2 with a consistent ascending rank', () => {
    expect([...AUTONOMY_LEVELS]).toEqual(['A0', 'A1', 'A2']);
    expect(AUTONOMY_LEVEL_RANK).toEqual({ A0: 0, A1: 1, A2: 2 });
  });

  it('matrix covers every type with a valid maximum and a label', () => {
    for (const type of DECISION_TYPES) {
      const entry = AUTONOMY_MATRIX[type];
      expect(AUTONOMY_LEVELS).toContain(entry.maxAutonomy);
      expect(entry.label.length).toBeGreaterThan(0);
    }
    expect(Object.keys(AUTONOMY_MATRIX)).toHaveLength(DECISION_TYPES.length);
  });

  it('fixes the MVP maxima: data-analysis→A2, hypothesis-draft→A1, the other 6→A0', () => {
    expect(AUTONOMY_MATRIX['data-analysis'].maxAutonomy).toBe('A2');
    expect(AUTONOMY_MATRIX['hypothesis-draft'].maxAutonomy).toBe('A1');
    for (const type of [
      'experiment-launch',
      'pricing',
      'budget',
      'public-comms',
      'strategic',
      'legal',
    ] as const) {
      expect(AUTONOMY_MATRIX[type].maxAutonomy).toBe('A0');
    }
    // `legal` is never delegated to AI — it can only sit at the propose-only level.
    expect(AUTONOMY_MATRIX.legal.maxAutonomy).toBe('A0');
  });

  it('labels every autonomy level (code-level RU defaults)', () => {
    expect(Object.keys(AUTONOMY_LEVEL_LABELS)).toEqual(['A0', 'A1', 'A2']);
    for (const level of AUTONOMY_LEVELS) {
      expect(AUTONOMY_LEVEL_LABELS[level].length).toBeGreaterThan(0);
    }
  });

  it('keeps the MVP required level constant at A1', () => {
    expect(REQUIRED_AUTONOMY).toBe('A1');
  });
});

describe('needsEscalation', () => {
  it('escalates every type with an A0 maximum when the required level is A1', () => {
    for (const type of [
      'experiment-launch',
      'pricing',
      'budget',
      'public-comms',
      'strategic',
      'legal',
    ] as const) {
      expect(needsEscalation(type, REQUIRED_AUTONOMY)).toEqual({
        required: true,
        reason: 'autonomy-exceeded',
      });
    }
  });

  it('does not escalate data-analysis (A2) or hypothesis-draft (A1) at the required A1', () => {
    expect(needsEscalation('data-analysis', 'A1')).toEqual({ required: false, reason: null });
    expect(needsEscalation('hypothesis-draft', 'A1')).toEqual({ required: false, reason: null });
  });

  it('generalizes to other proposed levels (A0 never escalates a classified type, A2 always does)', () => {
    expect(needsEscalation('pricing', 'A0')).toEqual({ required: false, reason: null });
    expect(needsEscalation('hypothesis-draft', 'A0')).toEqual({ required: false, reason: null });
    expect(needsEscalation('pricing', 'A2')).toEqual({
      required: true,
      reason: 'autonomy-exceeded',
    });
    expect(needsEscalation('data-analysis', 'A2')).toEqual({ required: false, reason: null });
  });

  it('reads a missing type conservatively as strategic (max A0) with reason unclassified-type', () => {
    expect(needsEscalation(null, 'A1')).toEqual({ required: true, reason: 'unclassified-type' });
    expect(needsEscalation(null, 'A2')).toEqual({ required: true, reason: 'unclassified-type' });
    // At A0 the conservative strategic reading is within bounds — no escalation.
    expect(needsEscalation(null, 'A0')).toEqual({ required: false, reason: null });
  });
});

describe('assessDecisionAutonomy', () => {
  it('returns null for manual decisions (human-made entries are not assessed)', () => {
    expect(assessDecisionAutonomy({ source: 'manual' })).toBeNull();
    expect(assessDecisionAutonomy({ source: 'manual', decisionType: 'pricing' })).toBeNull();
  });

  it('assesses a classified AI decision with its type, maximum and the constant required level', () => {
    expect(assessDecisionAutonomy({ source: 'ai', decisionType: 'data-analysis' })).toEqual({
      type: 'data-analysis',
      unclassified: false,
      maxAutonomy: 'A2',
      required: 'A1',
      escalation: { required: false, reason: null },
    });
    expect(assessDecisionAutonomy({ source: 'ai', decisionType: 'pricing' })).toEqual({
      type: 'pricing',
      unclassified: false,
      maxAutonomy: 'A0',
      required: 'A1',
      escalation: { required: true, reason: 'autonomy-exceeded' },
    });
  });

  it('assesses a NULL-type AI decision conservatively (strategic / A0 / unclassified-type)', () => {
    expect(assessDecisionAutonomy({ source: 'ai' })).toEqual({
      type: 'strategic',
      unclassified: true,
      maxAutonomy: 'A0',
      required: 'A1',
      escalation: { required: true, reason: 'unclassified-type' },
    });
    expect(assessDecisionAutonomy({ source: 'ai', decisionType: null })).toEqual(
      assessDecisionAutonomy({ source: 'ai' }),
    );
  });
});

describe('isDecisionType', () => {
  it('accepts taxonomy values and rejects anything else', () => {
    for (const type of DECISION_TYPES) expect(isDecisionType(type)).toBe(true);
    expect(isDecisionType('bogus')).toBe(false);
    expect(isDecisionType(null)).toBe(false);
    expect(isDecisionType(undefined)).toBe(false);
  });
});
