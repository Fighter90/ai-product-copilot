import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from './api';
import { useKpiTarget } from './kpi-target';

vi.mock('./api', () => ({ api: { kpiTarget: vi.fn() } }));

function wrapper({ children }: { children: ReactNode }): JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useKpiTarget', () => {
  beforeEach(() => vi.mocked(api.kpiTarget).mockReset());

  it('returns the admin target from the API', async () => {
    vi.mocked(api.kpiTarget).mockResolvedValue({ target: 450 });
    const { result } = renderHook(() => useKpiTarget(), { wrapper });
    expect(result.current).toBe(300); // default while loading
    await waitFor(() => expect(result.current).toBe(450));
  });

  it('falls back to 300 on error or an invalid value', async () => {
    vi.mocked(api.kpiTarget).mockRejectedValue(new Error('404'));
    const { result } = renderHook(() => useKpiTarget(), { wrapper });
    await waitFor(() => expect(vi.mocked(api.kpiTarget)).toHaveBeenCalled());
    expect(result.current).toBe(300);

    vi.mocked(api.kpiTarget).mockResolvedValue({ target: 0 });
    const second = renderHook(() => useKpiTarget(), { wrapper });
    await waitFor(() => expect(vi.mocked(api.kpiTarget)).toHaveBeenCalledTimes(2));
    expect(second.result.current).toBe(300);
  });
});
