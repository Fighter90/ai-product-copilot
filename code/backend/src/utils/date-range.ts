export interface DateChunk {
  readonly from: string;
  readonly to: string;
}

/** Milliseconds in one UTC day (ANA-139: shared by dayChunks and contiguousRanges). */
export const MS_PER_DAY = 86_400_000;

/**
 * ANA-139 (round-3 review): strict YYYY-MM-DD calendar-day check. A garbage date used to make
 * the gaps endpoints iterate zero days — the hole report answered a clean-looking «всё покрыто»
 * and the refill no-opped with 200. Both routes validate the window with this BEFORE the repo.
 */
export function isIsoDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const t = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === value;
}

/**
 * Split an inclusive [from, to] range (YYYY-MM-DD) into per-day request chunks — for EVERY range
 * length. Single-dimension breakdowns have no `ym:s:date` in the response and rows are stamped
 * with the chunk's `from`, so a whole-window request would collapse N days onto day 1 (ANA-65
 * finding 7). Per-day chunks keep every day's rows on their own date; it also matches Metrika's
 * guidance to avoid >7-day windows in one request.
 */
export function dayChunks(from: string, to: string): DateChunk[] {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);

  const chunks: DateChunk[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += MS_PER_DAY) {
    const day = new Date(t).toISOString().slice(0, 10);
    chunks.push({ from: day, to: day });
  }
  return chunks;
}

/**
 * ANA-139: group (possibly unsorted, possibly repeated) ISO days into the fewest contiguous
 * inclusive [from, to] ranges. The gap refill uses it to turn scattered missing days into the
 * minimal set of Metrika windows, so already-good days are never re-fetched.
 */
export function contiguousRanges(days: readonly string[]): DateChunk[] {
  const sorted = [...new Set(days)].sort();
  const ranges: DateChunk[] = [];
  for (const day of sorted) {
    const last = ranges[ranges.length - 1];
    const adjacent =
      last !== undefined &&
      new Date(`${day}T00:00:00Z`).getTime() - new Date(`${last.to}T00:00:00Z`).getTime() ===
        MS_PER_DAY;
    if (adjacent && last) ranges[ranges.length - 1] = { from: last.from, to: day };
    else ranges.push({ from: day, to: day });
  }
  return ranges;
}
