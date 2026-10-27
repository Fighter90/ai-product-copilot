import { http } from './api';
import type {
  Decision,
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

export const hypothesesApi = {
  list: () => http<Hypothesis[]>('/hypotheses'),
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
  list: () => http<Decision[]>('/decisions'),
  create: (d: NewDecision) => http<Decision>('/decisions', { method: 'POST', ...json(d) }),
};
