import { describe, it, expect } from 'vitest';
import {
  HYPOTHESIS_AUTONOMY_MAX_STATUS,
  HYPOTHESIS_STATUSES,
  HYPOTHESIS_STATUS_RANK,
  HYPOTHESIS_VERDICT_STATUSES,
  assessHypothesisAutonomy,
  hypothesisStatusEscalation,
  hypothesisStatusesAllowedAt,
  hypothesisTransitionEscalation,
} from './hypothesis-autonomy';

/**
 * ANA-157: the hypothesis-autonomy model is a static contract — the same «level × allowed
 * statuses» model as the decision matrix (ANA-137): AI hypotheses run at the constant level
 * A1 and may reach «В проверке» (in_progress); the verification verdicts (green/yellow/red)
 * and «Просрочена» belong to the PM. Manual hypotheses are not assessed at all.
 */
describe('hypothesis autonomy model (ANA-157)', () => {
  it('lists every status in display order (the option list the UI renders)', () => {
    expect(HYPOTHESIS_STATUSES).toEqual([
      'draft',
      'in_progress',
      'green',
      'yellow',
      'red',
      'expired',
    ]);
  });

  it('ranks statuses: draft < «В проверке» < the PM verdicts', () => {
    expect(HYPOTHESIS_STATUS_RANK.draft).toBeLessThan(HYPOTHESIS_STATUS_RANK.in_progress);
    for (const s of ['green', 'yellow', 'red', 'expired'] as const) {
      expect(HYPOTHESIS_STATUS_RANK[s]).toBeGreaterThan(HYPOTHESIS_STATUS_RANK.in_progress);
    }
  });

  it('maps each autonomy level to its maximum status (A0 draft, A1 in_progress, A2 all)', () => {
    expect(HYPOTHESIS_AUTONOMY_MAX_STATUS.A0).toBe('draft');
    expect(HYPOTHESIS_AUTONOMY_MAX_STATUS.A1).toBe('in_progress');
    expect(HYPOTHESIS_AUTONOMY_MAX_STATUS.A2).toBe('expired');
  });

  it('allowed statuses grow with the level', () => {
    expect(hypothesisStatusesAllowedAt('A0')).toEqual(['draft']);
    expect(hypothesisStatusesAllowedAt('A1')).toEqual(['draft', 'in_progress']);
    expect(hypothesisStatusesAllowedAt('A2')).toEqual(HYPOTHESIS_STATUSES);
  });

  it('escalation: at A1 draft/«В проверке» are free; the verdicts above escalate to the PM', () => {
    expect(hypothesisStatusEscalation('draft')).toEqual({ required: false, reason: null });
    expect(hypothesisStatusEscalation('in_progress')).toEqual({ required: false, reason: null });
    for (const s of ['green', 'yellow', 'red', 'expired'] as const) {
      expect(hypothesisStatusEscalation(s)).toEqual({
        required: true,
        reason: 'autonomy-exceeded',
      });
    }
    // A2 (modelled in MVP, never executed) could set every status itself.
    expect(hypothesisStatusEscalation('red', 'A2')).toEqual({ required: false, reason: null });
    expect(hypothesisStatusEscalation('expired', 'A0')).toEqual({
      required: true,
      reason: 'autonomy-exceeded',
    });
  });

  it('manual hypotheses are human-made — not assessed (null)', () => {
    expect(assessHypothesisAutonomy({ source: 'manual' })).toBeNull();
  });

  it('AI hypotheses run at A1: maxStatus «В проверке», the verdicts above are PM-only', () => {
    expect(assessHypothesisAutonomy({ source: 'ai' })).toEqual({
      level: 'A1',
      maxStatus: 'in_progress',
      allowedStatuses: ['draft', 'in_progress'],
    });
  });

  it('marks green/yellow/red as the PM verdict statuses (their clearing is a PM decision)', () => {
    expect(HYPOTHESIS_VERDICT_STATUSES).toEqual(['green', 'yellow', 'red']);
    expect(HYPOTHESIS_VERDICT_STATUSES).not.toContain('expired'); // «Просрочена» is mechanical.
  });
});

/**
 * ANA-157 (review round 3): transition-aware escalation — the verdict for a status change
 * considers not only the proposed status but also the one it leaves. Any change out of a
 * PM verdict (green/yellow/red) escalates: erasing the светофор decision is itself a PM
 * decision, even when the proposed status (e.g. draft) is below the level's cap.
 */
describe('hypothesisTransitionEscalation (ANA-157 review round 3)', () => {
  it('keeps the cap behaviour: at A1 draft/«В проверке» from a non-verdict stay free', () => {
    expect(hypothesisTransitionEscalation('draft', 'in_progress')).toEqual({
      required: false,
      reason: null,
    });
    expect(hypothesisTransitionEscalation('draft', 'draft')).toEqual({
      required: false,
      reason: null,
    });
    expect(hypothesisTransitionEscalation('expired', 'draft')).toEqual({
      required: false,
      reason: null,
    });
  });

  it('escalates the proposed status above the level cap (the round-2 behaviour, kept)', () => {
    for (const to of ['green', 'yellow', 'red', 'expired'] as const) {
      expect(hypothesisTransitionEscalation('draft', to)).toEqual({
        required: true,
        reason: 'autonomy-exceeded',
      });
    }
  });

  it('escalates ANY change out of a PM verdict — even downward to draft (verdict-clearing)', () => {
    for (const from of HYPOTHESIS_VERDICT_STATUSES) {
      for (const to of HYPOTHESIS_STATUSES) {
        expect(hypothesisTransitionEscalation(from, to)).toEqual({
          required: true,
          reason: 'autonomy-exceeded',
        });
      }
    }
  });

  it('«Просрочена» (mechanical, not a verdict) may be cleared freely below the cap', () => {
    expect(hypothesisTransitionEscalation('expired', 'draft')).toEqual({
      required: false,
      reason: null,
    });
    expect(hypothesisTransitionEscalation('expired', 'in_progress')).toEqual({
      required: false,
      reason: null,
    });
  });
});
