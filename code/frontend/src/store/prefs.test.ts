import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePrefs } from './prefs';

/**
 * ANA-173 (регресс прод 15.11): тумблеры языка/темы «умирали», когда localStorage недоступен
 * (запрет хранилища в браузере/QA-контейнере). Раньше `write()` молча глотал ошибку, а тумблер
 * безусловно делал `window.location.reload()` — выбор испарялся, страница возвращалась как была.
 * Теперь: localStorage → sessionStorage → память в процессе, а экшены стора сообщают,
 * переживает ли выбор перезагрузку.
 */

const denyStorage = (): void => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('Storage denied', 'SecurityError');
  });
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('Storage denied', 'SecurityError');
  });
};

/**
 * Deny `pca.*` operations on the localStorage RECEIVER only — sessionStorage (the same
 * prototype) keeps working, so the fall-through chain is what actually gets exercised
 * (ANA-173 review: a prototype-wide mock denies sessionStorage too, and the fresh-store
 * assertions passed only via stale <html> attrs / navigator.language). Ops left `false`
 * stay real — e.g. a quota profile still allows reads and deletes.
 */
const denyLocalStorage = ({
  getItem = false,
  setItem = false,
  removeItem = false,
}: {
  getItem?: boolean;
  setItem?: boolean;
  removeItem?: boolean;
} = {}): void => {
  const deny = (): never => {
    throw new DOMException('Storage denied', 'SecurityError');
  };
  const realGet = Storage.prototype.getItem;
  const realSet = Storage.prototype.setItem;
  const realRemove = Storage.prototype.removeItem;
  if (getItem)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (
      this: Storage,
      key: string,
    ) {
      if (this === window.localStorage && key.startsWith('pca.')) deny();
      return realGet.call(this, key);
    });
  if (setItem)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (this === window.localStorage && key.startsWith('pca.')) deny();
      return realSet.call(this, key, value);
    });
  if (removeItem)
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (
      this: Storage,
      key: string,
    ) {
      if (this === window.localStorage && key.startsWith('pca.')) deny();
      return realRemove.call(this, key);
    });
};

const resetStore = (): void => {
  usePrefs.setState({ theme: 'dark', locale: 'ru', sidebarCollapsed: false });
};

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.localStorage.setItem('pca.locale', 'ru');
  window.localStorage.setItem('pca.theme', 'dark');
  // Reset the <html> markers a previous test's applyPrefs left behind — otherwise the stale
  // data-theme="light" would mask a broken storage read in the fresh-store tests below
  // (the attr fallback would return exactly the value the storage chain should deliver).
  document.documentElement.lang = 'ru';
  document.documentElement.dataset.theme = 'dark';
  resetStore();
});

describe('prefs: persistence chain (ANA-173)', () => {
  it('setLocale writes localStorage and reports persisted=true when storage works', () => {
    expect(usePrefs.getState().setLocale('en')).toBe(true);
    expect(window.localStorage.getItem('pca.locale')).toBe('en');
    expect(usePrefs.getState().locale).toBe('en');
  });

  it('setTheme writes localStorage and reports persisted=true when storage works', () => {
    expect(usePrefs.getState().setTheme('light')).toBe(true);
    expect(window.localStorage.getItem('pca.theme')).toBe('light');
    expect(usePrefs.getState().theme).toBe('light');
  });

  it('toggleTheme flips the theme and reports persistence', () => {
    expect(usePrefs.getState().toggleTheme()).toBe(true);
    expect(usePrefs.getState().theme).toBe('light');
  });

  it('falls back to sessionStorage when localStorage denies writes (still persisted=true)', () => {
    // Quota profile: reads and deletes still work, only the write fails.
    denyLocalStorage({ setItem: true });
    expect(usePrefs.getState().setLocale('en')).toBe(true);
    // The stale localStorage value is dropped on the failed write — a reload must not
    // resurrect the old preference from a key the backend can no longer overwrite.
    expect(window.localStorage.getItem('pca.locale')).toBeNull();
    expect(window.sessionStorage.getItem('pca.locale')).toBe('en');
    expect(usePrefs.getState().locale).toBe('en');
  });

  it('localStorage unwritable and undeletable: still falls through to sessionStorage', () => {
    denyLocalStorage({ setItem: true, removeItem: true });
    expect(usePrefs.getState().setLocale('en')).toBe(true);
    expect(window.localStorage.getItem('pca.locale')).toBe('ru'); // removal was denied too
    expect(window.sessionStorage.getItem('pca.locale')).toBe('en');
    expect(usePrefs.getState().locale).toBe('en');
  });

  it('keeps the choice in memory when every backend denies access (persisted=false)', () => {
    denyStorage();
    expect(usePrefs.getState().setLocale('en')).toBe(false);
    expect(usePrefs.getState().setTheme('light')).toBe(false);
    // The in-session state is still applied — the UI must not look dead.
    expect(usePrefs.getState().locale).toBe('en');
    expect(usePrefs.getState().theme).toBe('light');
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('a fresh store reads the locale back from sessionStorage when localStorage denies pca reads', async () => {
    window.sessionStorage.setItem('pca.locale', 'en');
    window.sessionStorage.setItem('pca.theme', 'light');
    denyLocalStorage({ getItem: true, setItem: true });
    vi.resetModules();
    const fresh = await import('./prefs');
    // The <html> defaults were reset to dark/ru in beforeEach: only the fresh store's
    // localStorage→sessionStorage read chain can produce en/light here.
    expect(fresh.usePrefs.getState().locale).toBe('en');
    expect(fresh.usePrefs.getState().theme).toBe('light');
  });

  it('a fresh store survives localStorage access throwing outright (locked browser profile)', async () => {
    window.sessionStorage.setItem('pca.locale', 'en');
    window.sessionStorage.setItem('pca.theme', 'light');
    // Safari/iframe sandbox: mere `window.localStorage` access throws SecurityError.
    // jsdom keeps localStorage as a configurable own window property — shadow it, then
    // restore the captured descriptor (a plain delete would drop it for good).
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Storage denied', 'SecurityError');
      },
    });
    vi.resetModules();
    try {
      const fresh = await import('./prefs');
      expect(fresh.usePrefs.getState().locale).toBe('en');
      expect(fresh.usePrefs.getState().theme).toBe('light');
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original);
    }
  });
});
