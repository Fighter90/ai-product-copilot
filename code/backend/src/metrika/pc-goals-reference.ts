import { PC_FUNNEL_GOAL_STEPS, ROLE_EVENTS, TICKET_TYPES } from '../live/live';
import type { GoalSpec } from './goals-management';

/**
 * Reference list of the goals the pc-goals script on productcamp.ru expects in the counter.
 *
 * Single source of truth: built from the same event lists the live funnel reads
 * (live.ts PC_FUNNEL goal steps / TICKET_TYPES / ROLE_EVENTS), so the audit can never drift from what
 * /api/live/funnel looks for. Order and codes follow the DataLens naming «G-01…G-18»:
 * 5 funnel stages, 3 tariffs × (pick → checkout → buy), 4 role applications.
 *
 * Every reference goal is a JS-event goal: type `action` with an `exact` condition on the event
 * name (the Management API rejects condition type "js"; live.ts `eventOf()` reads the url field).
 */
export interface PcGoalRef {
  /** Stable code, e.g. "G-01". */
  readonly code: string;
  /** JS event name sent by pc-goals (also the condition value). */
  readonly event: string;
  /**
   * Alternative counter conditions that satisfy this reference (ANA-111/REG-G17): the counter
   * names some goals differently than pc-goals sends them — e.g. the halloween purchase goal
   * is «ticket_halloween» while pc-goals emits «ticket_buy_halloween». An exact condition on
   * any alias makes the reference "present" (the read side aliases the same way, live.ts).
   */
  readonly aliasEvents?: readonly string[];
  readonly ru: string;
  readonly en: string;
  readonly group: 'funnel' | 'ticket' | 'role';
  readonly type: 'action';
  readonly condition: { readonly type: 'exact'; readonly url: string };
}

const TICKET_STEPS: ReadonlyArray<{ step: string; ru: string; en: string }> = [
  { step: 'pick', ru: 'Выбор билета', en: 'Ticket pick' },
  { step: 'checkout', ru: 'Переход к оплате', en: 'Checkout' },
  { step: 'buy', ru: 'Покупка', en: 'Purchase' },
];

const raw: Array<Omit<PcGoalRef, 'code' | 'type' | 'condition'>> = [
  ...PC_FUNNEL_GOAL_STEPS.map((s) => ({
    event: s.event,
    ru: s.ru,
    en: s.en,
    group: 'funnel' as const,
  })),
  ...TICKET_TYPES.flatMap((t) =>
    TICKET_STEPS.map((s) => ({
      event: `ticket_${s.step}_${t}`,
      // The counter's halloween purchase goal is named «ticket_halloween» (no step segment).
      ...(t === 'halloween' && s.step === 'buy' ? { aliasEvents: ['ticket_halloween'] } : {}),
      ru: `${s.ru} ${t}`,
      en: `${s.en} ${t}`,
      group: 'ticket' as const,
    })),
  ),
  ...ROLE_EVENTS.map((r) => ({ event: r.event, ru: r.ru, en: r.en, group: 'role' as const })),
];

export const PC_GOALS_REFERENCE: readonly PcGoalRef[] = raw.map((r, i) => ({
  ...r,
  code: `G-${String(i + 1).padStart(2, '0')}`,
  type: 'action',
  condition: { type: 'exact', url: r.event },
}));

/** Goal name used when creating a reference goal: "G-01 Увидел блок билетов (price_view)". */
export const refGoalName = (ref: PcGoalRef): string => `${ref.code} ${ref.ru} (${ref.event})`;

/** The exact create-goal spec for a reference entry (what preview shows and create sends). */
export function refGoalSpec(ref: PcGoalRef): GoalSpec {
  return {
    name: refGoalName(ref),
    type: ref.type,
    conditions: [{ ...ref.condition }],
  };
}

/** Look a reference up by code ("G-03") or event name ("reg_open"). */
export function findRef(key: string): PcGoalRef | undefined {
  const k = key.trim();
  return PC_GOALS_REFERENCE.find((r) => r.code === k.toUpperCase() || r.event === k);
}
