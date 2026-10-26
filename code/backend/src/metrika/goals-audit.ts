import { z } from 'zod';
import type { MetrikaClient } from './client';
import { ENDPOINTS } from './endpoints';
import { isArchivedGoal, type CounterGoal, type GoalSpec } from './goals-management';
import { PC_GOALS_REFERENCE, refGoalName, refGoalSpec, type PcGoalRef } from './pc-goals-reference';

/**
 * Pure audit of the counter's goals against the pc-goals reference:
 * - expected: every reference goal → present | missing | mismatch;
 * - dead: active goals with 0 reaches over the window;
 * - duplicates: groups with identical type + conditions, or the same normalized name.
 */

export type RefStatus = 'present' | 'missing' | 'mismatch';

export interface ExpectedRow {
  readonly ref: PcGoalRef & { readonly name: string };
  readonly status: RefStatus;
  /** The matching (present) or closest (mismatch) active goal. */
  readonly goalId?: number;
  readonly goalName?: string;
  /** Human-readable differences for `mismatch`. */
  readonly issues?: string[];
  /** For `missing`: an archived goal that would satisfy the reference (restore instead of create). */
  readonly archivedGoalId?: number;
  /** The exact create spec (shown in preview, sent on confirm). */
  readonly spec: GoalSpec;
}

export interface AuditGoalRef {
  readonly id: number;
  readonly name: string;
  readonly type: string;
  /** Reference code ("G-01") if this goal satisfies a pc-goals reference — archiving breaks the funnel. */
  readonly reference: string | null;
}

export interface DeadRow extends AuditGoalRef {
  readonly reaches: number;
}

export interface DuplicateGroup {
  readonly reason: 'conditions' | 'name';
  readonly key: string;
  readonly goals: AuditGoalRef[];
}

export interface AuditGoal extends AuditGoalRef {
  readonly archived: boolean;
  readonly conditions: Array<{ type?: string; url?: string }>;
}

export interface GoalsAudit {
  readonly expected: ExpectedRow[];
  readonly dead: DeadRow[];
  readonly duplicates: DuplicateGroup[];
  readonly goals: AuditGoal[];
}

/** Lowercase, ё→е, strip an `[archive]` prefix, collapse whitespace and trailing punctuation. */
export function normalizeGoalName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/^\s*\[archive\]\s*/, '')
    .replace(/[\s\u00a0]+/g, ' ')
    .replace(/[.,;:!\s]+$/, '')
    .trim();
}

const hasExactEvent = (g: CounterGoal, event: string): boolean =>
  g.type === 'action' && (g.conditions ?? []).some((c) => c.type === 'exact' && c.url === event);

const mentionsEvent = (g: CounterGoal, event: string): boolean =>
  (g.conditions ?? []).some((c) => c.url === event);

const nameMatchesRef = (g: CounterGoal, ref: PcGoalRef): boolean => {
  const n = normalizeGoalName(g.name);
  return n === normalizeGoalName(refGoalName(ref)) || n.startsWith(`${ref.code.toLowerCase()} `);
};

function mismatchIssues(g: CounterGoal, ref: PcGoalRef): string[] {
  const issues: string[] = [];
  if (g.type !== ref.type) issues.push(`type: ${g.type} (expected ${ref.type})`);
  const conds = g.conditions ?? [];
  const same = conds.find((c) => c.url === ref.event);
  if (!same) {
    const got = conds.map((c) => `${c.type ?? '?'}:${c.url ?? ''}`).join(', ') || '—';
    issues.push(`condition: ${got} (expected exact:${ref.event})`);
  } else if (same.type !== ref.condition.type) {
    issues.push(`condition type: ${same.type ?? '?'} (expected ${ref.condition.type})`);
  }
  return issues;
}

/**
 * Map goal id → reference code for the ONE active goal per reference that the audit treats as
 * "present" (the first exact match, same pick as {@link compareWithReference}); further exact
 * copies are plain duplicates and safe to archive.
 */
function referenceIndex(goals: readonly CounterGoal[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const ref of PC_GOALS_REFERENCE) {
    const g = goals.find((x) => !isArchivedGoal(x) && hasExactEvent(x, ref.event));
    if (g && !out.has(g.id)) out.set(g.id, ref.code);
  }
  return out;
}

export function compareWithReference(goals: readonly CounterGoal[]): ExpectedRow[] {
  const active = goals.filter((g) => !isArchivedGoal(g));
  const archived = goals.filter(isArchivedGoal);
  return PC_GOALS_REFERENCE.map((ref): ExpectedRow => {
    const base = { ref: { ...ref, name: refGoalName(ref) }, spec: refGoalSpec(ref) };
    const exact = active.find((g) => hasExactEvent(g, ref.event));
    if (exact) return { ...base, status: 'present', goalId: exact.id, goalName: exact.name };
    const near = active.find((g) => mentionsEvent(g, ref.event) || nameMatchesRef(g, ref));
    if (near) {
      return {
        ...base,
        status: 'mismatch',
        goalId: near.id,
        goalName: near.name,
        issues: mismatchIssues(near, ref),
      };
    }
    const restorable = archived.find((g) => hasExactEvent(g, ref.event));
    return restorable
      ? { ...base, status: 'missing', archivedGoalId: restorable.id }
      : { ...base, status: 'missing' };
  });
}

export function findDuplicates(goals: readonly CounterGoal[]): DuplicateGroup[] {
  const refs = referenceIndex(goals);
  const view = (g: CounterGoal): AuditGoalRef => ({
    id: g.id,
    name: g.name,
    type: g.type,
    reference: refs.get(g.id) ?? null,
  });
  const active = goals.filter((g) => !isArchivedGoal(g));
  const groups: DuplicateGroup[] = [];
  const seen = new Set<string>();
  const push = (reason: DuplicateGroup['reason'], key: string, members: CounterGoal[]): void => {
    if (members.length < 2) return;
    const ids = members
      .map((g) => g.id)
      .sort((a, b) => a - b)
      .join(',');
    if (seen.has(ids)) return;
    seen.add(ids);
    groups.push({ reason, key, goals: members.map(view) });
  };

  const bySig = new Map<string, CounterGoal[]>();
  for (const g of active) {
    if (!g.conditions?.length) continue;
    const conds = g.conditions.map((c) => `${c.type ?? ''}:${c.url ?? ''}`).sort();
    const key = `${g.type}|${conds.join('|')}`;
    bySig.set(key, [...(bySig.get(key) ?? []), g]);
  }
  for (const [key, members] of bySig) push('conditions', key, members);

  const byName = new Map<string, CounterGoal[]>();
  for (const g of active) {
    const key = normalizeGoalName(g.name);
    if (key) byName.set(key, [...(byName.get(key) ?? []), g]);
  }
  for (const [key, members] of byName) push('name', key, members);
  return groups;
}

export function findDead(
  goals: readonly CounterGoal[],
  reaches: ReadonlyMap<number, number>,
): DeadRow[] {
  const refs = referenceIndex(goals);
  return goals
    .filter((g) => !isArchivedGoal(g) && reaches.has(g.id) && (reaches.get(g.id) ?? 0) === 0)
    .map((g) => ({
      id: g.id,
      name: g.name,
      type: g.type,
      reference: refs.get(g.id) ?? null,
      reaches: 0,
    }));
}

export function auditGoals(
  goals: readonly CounterGoal[],
  reaches: ReadonlyMap<number, number>,
): GoalsAudit {
  const refs = referenceIndex(goals);
  return {
    expected: compareWithReference(goals),
    dead: findDead(goals, reaches),
    duplicates: findDuplicates(goals),
    goals: goals.map((g) => ({
      id: g.id,
      name: g.name,
      type: g.type,
      reference: refs.get(g.id) ?? null,
      archived: isArchivedGoal(g),
      conditions: (g.conditions ?? []).map((c) => ({ type: c.type, url: c.url })),
    })),
  };
}

const StatTotalsSchema = z
  .object({
    data: z.array(z.object({ metrics: z.array(z.number().nullable()) }).passthrough()),
    totals: z.array(z.number().nullable()).optional(),
  })
  .passthrough();

/** Same test-traffic filter as live.ts (pc-goals sandbox visits start with `file:`). */
const TEST_FILTER = "ym:s:startURL!~'^file:'";

/**
 * Reaches per goal over the last `days` days (read-only Reporting API).
 * Metrika caps a request at 20 metrics, so goals are queried in chunks of 20.
 */
export async function fetchGoalReaches(
  client: MetrikaClient,
  counterId: number,
  goalIds: readonly number[],
  days: number,
): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  for (let i = 0; i < goalIds.length; i += 20) {
    const chunk = goalIds.slice(i, i + 20);
    const res = await client.get(
      ENDPOINTS.statData,
      {
        ids: counterId,
        metrics: chunk.map((id) => `ym:s:goal${id}reaches`).join(','),
        date1: `${days}daysAgo`,
        date2: 'today',
        filters: TEST_FILTER,
        accuracy: 'full',
      },
      StatTotalsSchema,
    );
    const t = res.totals ?? res.data[0]?.metrics ?? [];
    chunk.forEach((id, j) => out.set(id, t[j] ?? 0));
  }
  return out;
}
