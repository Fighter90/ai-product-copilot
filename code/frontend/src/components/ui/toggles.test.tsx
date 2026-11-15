import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LangToggle, ThemeToggle } from './index';
import { usePrefs } from '../../store/prefs';

/**
 * ANA-173 (регресс прод 15.11): на публичных страницах тумблеры выглядели «мёртвыми», когда
 * localStorage недоступен: выбор писался молча в никуда, безусловный reload возвращал старое
 * состояние (aria-pressed=false, lang=ru, data-theme без изменений). Теперь reload делается
 * только когда выбор переживает перезагрузку; иначе состояние применяется на месте.
 */

const denyStorage = (): void => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('Storage denied', 'SecurityError');
  });
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('Storage denied', 'SecurityError');
  });
};

let reload: Mock;

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.localStorage.setItem('pca.locale', 'ru');
  window.localStorage.setItem('pca.theme', 'dark');
  usePrefs.setState({ theme: 'dark', locale: 'ru', sidebarCollapsed: false });
  document.documentElement.lang = 'ru';
  document.documentElement.dataset.theme = 'dark';
  reload = vi.fn();
});

describe('ThemeToggle (ANA-173)', () => {
  it('reloads once when the theme choice persists to storage', () => {
    render(<ThemeToggle reload={reload} />);
    fireEvent.click(screen.getByRole('button'));
    expect(usePrefs.getState().theme).toBe('light');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('without storage: applies the theme in place and does NOT reload the choice away', () => {
    denyStorage();
    render(<ThemeToggle reload={reload} />);
    fireEvent.click(screen.getByRole('button'));
    // The theme IS applied for this session (data-theme flips)…
    expect(usePrefs.getState().theme).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    // …and the page is NOT reloaded — a reload would restore the old theme and make
    // the button look dead (the exact prod symptom of the 15.11 regression).
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('ThemeToggle double-fire (ANA-173)', () => {
  it('a second click while the reload is pending is ignored: one toggle, one reload', () => {
    // Регресс прод 15.11 («Ночная тема» на /help): два быстрых клика → toggleTheme дважды
    // (тема вернулась как была) + два reload — тумблер выглядит мёртвым.
    render(<ThemeToggle reload={reload} />);
    const btn = screen.getByRole('button');
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(usePrefs.getState().theme).toBe('light');
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('LangToggle (ANA-173)', () => {
  it('reloads once when the language choice persists to storage', () => {
    render(<LangToggle reload={reload} />);
    fireEvent.click(screen.getByRole('button', { name: 'en' }));
    expect(usePrefs.getState().locale).toBe('en');
    expect(window.localStorage.getItem('pca.locale')).toBe('en');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('without storage: switches the language in place, fires onChange and does NOT reload', () => {
    denyStorage();
    const onChange = vi.fn();
    render(<LangToggle onChange={onChange} reload={reload} />);
    fireEvent.click(screen.getByRole('button', { name: 'en' }));
    expect(usePrefs.getState().locale).toBe('en');
    expect(screen.getByRole('button', { name: 'en' }).getAttribute('aria-pressed')).toBe('true');
    expect(document.documentElement.lang).toBe('en');
    expect(onChange).toHaveBeenCalledWith('en');
    expect(reload).not.toHaveBeenCalled();
  });

  it('a second click while the reload is pending is ignored: locale en, one reload', () => {
    // Регресс прод 15.11 (EN на лендинге, 3 клика): каждый клик планировал свой reload,
    // и гонка перезагрузок оставляла страницу на прежнем языке.
    render(<LangToggle reload={reload} />);
    const en = screen.getByRole('button', { name: 'en' });
    fireEvent.click(en);
    fireEvent.click(en);
    expect(usePrefs.getState().locale).toBe('en');
    expect(window.localStorage.getItem('pca.locale')).toBe('en');
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
