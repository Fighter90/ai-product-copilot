import { create } from 'zustand';

export type Theme = 'dark' | 'light';
export type Locale = 'ru' | 'en';

/**
 * In-process fallback for denied/unavailable storage (ANA-173): a browser profile (QA-контейнер,
 * приватный режим с жёсткими настройками) может запретить и localStorage, и sessionStorage.
 * Выбор всё равно применяется на месте — просто не переживёт перезагрузку страницы.
 */
const memory = new Map<string, string>();

/** localStorage/sessionStorage may be denied entirely (mere access throws) — degrade to null. */
const tryStorage = (get: () => Storage): Storage | null => {
  try {
    return get();
  } catch {
    return null;
  }
};

const readItem = (storage: Storage | null, key: string): string | null => {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
};

/** localStorage → sessionStorage → memory. Denied backends just fall through. */
const readPref = (key: string): string | null =>
  readItem(
    tryStorage(() => localStorage),
    key,
  ) ??
  readItem(
    tryStorage(() => sessionStorage),
    key,
  ) ??
  memory.get(key) ??
  null;

/**
 * Write through localStorage → sessionStorage → memory. Returns `true` when a REAL backend
 * accepted the write — only then does the value survive `window.location.reload()` (ANA-173:
 * тумблеры перезагружают страницу, и выбор без хранилища «испарился», выглядя мёртвой кнопкой).
 */
const writePref = (key: string, value: string): boolean => {
  const ls = tryStorage(() => localStorage);
  if (ls) {
    try {
      ls.setItem(key, value);
      return true;
    } catch {
      // Readable but unwritable (quota/lock): drop the stale key, otherwise the next reload
      // reads the OLD value back from localStorage and resurrects the dead toggle (ANA-173).
      try {
        ls.removeItem(key);
      } catch {
        /* storage locked entirely — the sessionStorage/memory chain below still applies */
      }
    }
  }
  const ss = tryStorage(() => sessionStorage);
  if (ss) {
    try {
      ss.setItem(key, value);
      return true;
    } catch {
      /* denied — fall through */
    }
  }
  memory.set(key, value);
  return false;
};

function initialTheme(): Theme {
  const t = readPref('pca.theme');
  if (t === 'dark' || t === 'light') return t;
  const attr = typeof document !== 'undefined' ? document.documentElement.dataset.theme : null;
  return attr === 'light' ? 'light' : 'dark';
}

function initialLocale(): Locale {
  const l = readPref('pca.locale');
  if (l === 'ru' || l === 'en') return l;
  if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('en'))
    return 'en';
  return 'ru';
}

export interface PrefsState {
  theme: Theme;
  locale: Locale;
  sidebarCollapsed: boolean;
  /** `true` when the value reached real storage — it survives a page reload (ANA-173). */
  setTheme: (t: Theme) => boolean;
  toggleTheme: () => boolean;
  setLocale: (l: Locale) => boolean;
  toggleSidebar: () => void;
}

/** Apply theme/lang to <html> (also done pre-paint in index.html). */
export function applyPrefs(theme: Theme, locale: Locale): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.lang = locale;
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', theme === 'dark' ? '#000000' : '#ffffff');
}

/** Per-viewer UI preferences: day/night theme, interface language, sidebar state. */
export const usePrefs = create<PrefsState>((set, get) => ({
  theme: initialTheme(),
  locale: initialLocale(),
  sidebarCollapsed: readPref('pca.sidebar') === '1',
  setTheme: (theme) => {
    const persisted = writePref('pca.theme', theme);
    applyPrefs(theme, get().locale);
    set({ theme });
    return persisted;
  },
  toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
  setLocale: (locale) => {
    const persisted = writePref('pca.locale', locale);
    applyPrefs(get().theme, locale);
    set({ locale });
    return persisted;
  },
  toggleSidebar: () => {
    const v = !get().sidebarCollapsed;
    writePref('pca.sidebar', v ? '1' : '0');
    set({ sidebarCollapsed: v });
  },
}));
