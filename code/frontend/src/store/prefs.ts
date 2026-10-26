import { create } from 'zustand';

export type Theme = 'dark' | 'light';
export type Locale = 'ru' | 'en';

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
};

function initialTheme(): Theme {
  const t = read('pca.theme');
  if (t === 'dark' || t === 'light') return t;
  const attr = typeof document !== 'undefined' ? document.documentElement.dataset.theme : null;
  return attr === 'light' ? 'light' : 'dark';
}

function initialLocale(): Locale {
  const l = read('pca.locale');
  if (l === 'ru' || l === 'en') return l;
  if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('en'))
    return 'en';
  return 'ru';
}

export interface PrefsState {
  theme: Theme;
  locale: Locale;
  sidebarCollapsed: boolean;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  setLocale: (l: Locale) => void;
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
  sidebarCollapsed: read('pca.sidebar') === '1',
  setTheme: (theme) => {
    write('pca.theme', theme);
    applyPrefs(theme, get().locale);
    set({ theme });
  },
  toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
  setLocale: (locale) => {
    write('pca.locale', locale);
    applyPrefs(get().theme, locale);
    set({ locale });
  },
  toggleSidebar: () => {
    const v = !get().sidebarCollapsed;
    write('pca.sidebar', v ? '1' : '0');
    set({ sidebarCollapsed: v });
  },
}));
