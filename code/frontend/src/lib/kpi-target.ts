import { useQuery } from '@tanstack/react-query';
import { resolveKpiTarget } from '@pca/shared';
import { api } from './api';

/**
 * The admin's «Цель по оплатам» (paid tickets) from GET /api/metrics/kpi-target. While loading or
 * on error (older backend, no session) it falls back to the default 300, so the KPI never blanks.
 */
export function useKpiTarget(): number {
  const q = useQuery({
    queryKey: ['kpi-target'],
    queryFn: () => api.kpiTarget(),
    retry: false,
    staleTime: 60_000,
  });
  return resolveKpiTarget(q.data?.target);
}
