import { http } from './api';
import type {
  AutonomyMatrixResponse,
  Decision,
  DecisionListItem,
  DecisionStatus,
  Hypothesis,
  HypothesisStatus,
  NewDecision,
  NewHypothesis,
  ProblemHypothesis,
  SolutionHypothesis,
} from '@pca/shared';

/**
 * Typed client for the hypotheses workspace + Decision Log (ANA-37/38). The backend re-validates
 * every write (422 with the issue list on an incomplete hypothesis).
 */

/** Body of POST /hypotheses/import-ai — an AI solution (+ its problem) with provenance. */
export interface ImportAiPayload {
  readonly problem?: ProblemHypothesis;
  readonly solution: SolutionHypothesis;
  readonly provider?: string;
  readonly model?: string;
  readonly snapshotId?: string;
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

/**
 * ANA-181 (регресс прод 15.11): счётчик колонки «Черновики» вырос 20 → 60 между заходами без
 * создания гипотез. ЗАЩИТНАЯ мера на границе queryFn (первое вхождение выигрывает): дубликаты
 * с одинаковым id не попадают в кэш react-query. Механизм прод-дублирования НЕ подтверждён —
 * в клиенте нет пути добавления в кэш (только invalidateQueries), а серверный список —
 * плоский SELECT по таблице с целочисленным PK и физически не может вернуть id дважды;
 * доступных данных/логов прода, показывающих, что дубликаты имели одинаковые id, нет.
 * Если дубликаты имели разные id, этот фильтр их не убирает — и на отчёты он не влияет
 * ни при каком исходе: ReportSnapshot строится из SQLite, а не из этого кэша.
 */
export function dedupeById<T extends { readonly id: number }>(items: readonly T[]): T[] {
  const seen = new Set<number>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

export const hypothesesApi = {
  list: async () => dedupeById(await http<Hypothesis[]>('/hypotheses')),
  create: (h: NewHypothesis) => http<Hypothesis>('/hypotheses', { method: 'POST', ...json(h) }),
  update: (id: number, h: NewHypothesis) =>
    http<Hypothesis>(`/hypotheses/${id}`, { method: 'PUT', ...json(h) }),
  /** 204 on success; 409 with `{decisions}` when Decision Log entries reference the hypothesis. */
  remove: (id: number) => http<void>(`/hypotheses/${id}`, { method: 'DELETE' }),
  setStatus: (id: number, status: HypothesisStatus) =>
    http<Hypothesis>(`/hypotheses/${id}/status`, { method: 'PATCH', ...json({ status }) }),
  /** ANA-38: import an AI-generated hypothesis into the backlog, labelled AI. */
  importAi: (body: ImportAiPayload) =>
    http<Hypothesis>('/hypotheses/import-ai', { method: 'POST', ...json(body) }),
};

export const decisionsApi = {
  /** ANA-138: AI rows carry the `autonomy` assessment, manual rows carry none. */
  list: () => http<DecisionListItem[]>('/decisions'),
  create: (d: NewDecision) => http<Decision>('/decisions', { method: 'POST', ...json(d) }),
  /** ANA-169: move a decision to another kanban lane. */
  setStatus: (id: number, status: DecisionStatus) =>
    http<Decision>(`/decisions/${id}/status`, { method: 'PATCH', ...json({ status }) }),
  /** ANA-138: the static autonomy contract behind the «Матрица автономии» block. */
  autonomyMatrix: () => http<AutonomyMatrixResponse>('/decisions/autonomy-matrix'),
};
