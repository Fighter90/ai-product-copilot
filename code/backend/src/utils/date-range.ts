export interface DateChunk {
  readonly from: string;
  readonly to: string;
}

const MS_PER_DAY = 86_400_000;

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
