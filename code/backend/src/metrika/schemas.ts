import { z } from 'zod';

/** A single row of a Stat API report: parallel dimension + metric arrays. */
export const StatDataRowSchema = z.object({
  dimensions: z.array(z.object({ name: z.string().nullable() }).passthrough()),
  metrics: z.array(z.number().nullable()),
});

/** `/stat/v1/data` (and bytime/drilldown) response envelope. */
export const StatDataResponseSchema = z
  .object({
    data: z.array(StatDataRowSchema),
    total_rows: z.number().optional(),
    // /stat/v1/data returns flat per-metric totals (number[]); bytime nests them (number[][]).
    // We don't consume totals, so accept either shape rather than over-constrain the live API.
    totals: z.array(z.union([z.number().nullable(), z.array(z.number().nullable())])).optional(),
    query: z.unknown().optional(),
  })
  .passthrough();
export type StatDataResponse = z.infer<typeof StatDataResponseSchema>;

/**
 * `/stat/v1/data/bytime` response: unlike /stat/v1/data every row nests its metrics as
 * per-period series — `metrics[i]` is the value array of metric i over the grouped days.
 * Validating bytime with the flat row schema failed every sync's goal-reaches-by-day step.
 */
export const StatByTimeResponseSchema = z
  .object({
    data: z.array(
      z.object({
        dimensions: z.array(z.object({ name: z.string().nullable() }).passthrough()),
        metrics: z.array(z.array(z.number().nullable())),
      }),
    ),
    total_rows: z.number().optional(),
    totals: z.array(z.array(z.number().nullable())).optional(),
    query: z.unknown().optional(),
  })
  .passthrough();
export type StatByTimeResponse = z.infer<typeof StatByTimeResponseSchema>;

/**
 * A goal from the Management API. `archived`/`status` are Metrika's own archive state —
 * authoritative when present; the id-threshold heuristic is only a fallback for counters whose
 * responses lack both fields (audit bug ANA-23: «163 активных, 163 архивных»).
 */
export const GoalSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    type: z.string(),
    archived: z.boolean().optional(),
    status: z.string().optional(),
  })
  .passthrough();

/** `/management/v1/counter/{id}/goals` response. */
export const GoalsResponseSchema = z.object({ goals: z.array(GoalSchema) }).passthrough();
export type GoalsResponse = z.infer<typeof GoalsResponseSchema>;
