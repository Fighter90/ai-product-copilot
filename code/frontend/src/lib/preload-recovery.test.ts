import { describe, expect, it, vi } from 'vitest';
import { installPreloadRecovery } from './preload-recovery';

/** Минимальный EventTarget-стаб, запоминающий обработчик `vite:preloadError`. */
function fakeTarget(): EventTarget & { fail: () => { prevented: boolean } } {
  let handler: ((e: Event) => void) | null = null;
  return {
    dispatchEvent: () => true,
    removeEventListener: () => undefined,
    addEventListener: vi.fn((_type: string, h: (e: Event) => void) => {
      handler = h;
    }),
    /** Сымитировать сбой lazy-чанка. */
    fail: () => {
      const e = new Event('vite:preloadError');
      const pd = vi.spyOn(e, 'preventDefault');
      handler?.(e);
      return { prevented: pd.mock.calls.length > 0 };
    },
  };
}

function fakeSession(initial?: string) {
  const store = new Map<string, string>();
  if (initial) store.set('pca.preload-reload', initial);
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
}

describe('installPreloadRecovery (перезагрузка после деплоя)', () => {
  it('первый сбой чанка отменяет дефолт и перезагружает страницу', () => {
    const target = fakeTarget();
    const reload = vi.fn();
    installPreloadRecovery({ target, reload, session: fakeSession() });
    const { prevented } = target.fail();
    expect(prevented).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('второй сбой в той же загрузке — тихий (без зацикливания reload)', () => {
    const target = fakeTarget();
    const reload = vi.fn();
    installPreloadRecovery({ target, reload, session: fakeSession() });
    target.fail();
    target.fail();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('страж в sessionStorage: перезагрузка уже была — reload не вызывается', () => {
    const target = fakeTarget();
    const reload = vi.fn();
    installPreloadRecovery({ target, reload, session: fakeSession('1') });
    target.fail();
    expect(reload).not.toHaveBeenCalled();
  });
});
