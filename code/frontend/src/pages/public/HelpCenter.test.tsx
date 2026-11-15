import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { renderWithProviders } from '../../test/utils';
import { expectNoCyrillic, setTestLocale } from '../../test/i18n-utils';
import { usePrefs } from '../../store/prefs';

vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('../../lib/api-v3', () => ({
  v3: {
    helpArticles: vi.fn(),
    helpArticle: vi.fn(),
    helpSearch: vi.fn(),
  },
}));
import { v3 } from '../../lib/api-v3';
import { HelpCenter, renderArticle, slugify } from './HelpCenter';

type Articles = Awaited<ReturnType<typeof v3.helpArticles>>;
type Article = Awaited<ReturnType<typeof v3.helpArticle>>;
type Hits = Awaited<ReturnType<typeof v3.helpSearch>>;

describe('HelpCenter (EN locale)', () => {
  beforeEach(() => {
    setTestLocale('en');
    vi.mocked(v3.helpArticles).mockResolvedValue([
      { slug: 'start', title: 'Getting started', section: 'Basics' },
    ] as unknown as Articles);
    vi.mocked(v3.helpArticle).mockResolvedValue({
      slug: 'start',
      title: 'Getting started',
      markdown: '# Getting started\n\n## First steps\n\nSign in.',
    } as unknown as Article);
    vi.mocked(v3.helpSearch).mockResolvedValue([] as unknown as Hits);
  });
  afterEach(() => setTestLocale('ru'));

  it('renders contents, article, TOC and empty search without Cyrillic', async () => {
    const { container } = renderWithProviders(<HelpCenter />);
    expect(await screen.findByText('First steps', { selector: 'a' })).toBeInTheDocument();
    expect(v3.helpArticles).toHaveBeenCalledWith('en');
    fireEvent.change(screen.getByLabelText('Search help'), { target: { value: 'xyz' } });
    expect(await screen.findByText('Search results')).toBeInTheDocument();
    expectNoCyrillic(container);
  });
});

describe('slugify / renderArticle', () => {
  it('slugifies Latin and Cyrillic text into attribute-safe ids', () => {
    expect(slugify('First steps')).toBe('first-steps');
    expect(slugify('Как подключить Метрику?')).toBe('как-подключить-метрику');
    expect(slugify('Ёлка — «шаг 2»')).toBe('ёлка-шаг-2');
    expect(slugify('"><img src=x onerror=alert(1)>')).toMatch(/^[\p{L}\p{N}-]+$/u);
    expect(slugify('!!!')).toBe('section');
  });

  it('puts unique ids on headings and builds the TOC from ##/### with the same ids', () => {
    const md = [
      '# Title',
      '## Setup',
      'text',
      '### Details & <b>more</b>',
      '## Setup',
      '## Настройка',
    ].join('\n');
    const { html, toc } = renderArticle(md);
    expect(toc).toEqual([
      { id: 'setup', text: 'Setup', depth: 2 },
      { id: 'details-bmoreb', text: 'Details & <b>more</b>', depth: 3 },
      { id: 'setup-2', text: 'Setup', depth: 2 },
      { id: 'настройка', text: 'Настройка', depth: 2 },
    ]);
    expect(html).toContain('<h2 id="title" class="scroll-mt-24">Title</h2>');
    for (const item of toc) expect(html).toContain(`id="${item.id}"`);
    // Escaping from mdToHtml is preserved: no live <b> tag inside the heading.
    expect(html).not.toContain('<b>');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.getElementById('details-bmoreb')?.tagName).toBe('H4');
    expect(doc.getElementById('setup-2')?.tagName).toBe('H3');
  });
});

function LocationProbe(): JSX.Element {
  const loc = useLocation();
  // Fragments are percent-encoded in the URL (`#%D0%B2…`); decode for readable assertions.
  return <span data-testid="loc">{decodeURIComponent(loc.pathname + loc.search + loc.hash)}</span>;
}

function renderAt(route: string) {
  return renderWithProviders(
    <>
      <LocationProbe />
      <Routes>
        <Route path="/help" element={<HelpCenter />} />
        <Route path="/help/:slug" element={<HelpCenter />} />
        <Route path="/app/*" element={<div data-testid="app-page">app</div>} />
      </Routes>
    </>,
    route,
  );
}

/**
 * ANA-173 (регресс прод 15.11): «Ночная тема» на /help — 2 клика, data-theme оставался light.
 * Профиль QA-браузера запрещает хранилище: выбор не переживал reload и тема «не переключалась».
 * Теперь без хранилища тема применяется на месте — клик по тумблеру в хедере /help красит <html>.
 */
describe('HelpCenter header theme toggle (ANA-173)', () => {
  beforeEach(() => {
    setTestLocale('en');
    vi.mocked(v3.helpArticles).mockResolvedValue([] as unknown as Articles);
  });
  afterEach(() => {
    // Undo the Storage prototype spies AFTER the test — never inside the it body, where a
    // restore would also wipe the helpArticles mock set above (ANA-173 review).
    vi.restoreAllMocks();
  });

  it('storage denied: «Night theme» flips data-theme on <html> in place', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage denied', 'SecurityError');
    });
    usePrefs.setState({ theme: 'light', locale: 'en', sidebarCollapsed: false });
    document.documentElement.dataset.theme = 'light';
    renderWithProviders(<HelpCenter />);
    const toggle = screen.getByRole('button', { name: 'Night theme' });
    fireEvent.click(toggle);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(usePrefs.getState().theme).toBe('dark');
  });
});

describe('HelpCenter links and on-this-page navigation', () => {
  const scrollIntoView = vi.fn();
  const original = Element.prototype.scrollIntoView;

  beforeEach(() => {
    setTestLocale('en');
    Element.prototype.scrollIntoView = scrollIntoView;
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
    vi.mocked(v3.helpArticles).mockResolvedValue([
      { slug: 'start', title: 'Getting started', section: 'Basics' },
      { slug: 'other', title: 'Other', section: 'Basics' },
    ] as unknown as Articles);
    vi.mocked(v3.helpArticle).mockImplementation(
      async (slug: string) =>
        ({
          slug,
          title: slug,
          markdown:
            slug === 'start'
              ? [
                  '# Getting started',
                  '## First steps',
                  'See [other](/help/other), [cabinet](/app/overview), [jump](#второй-шаг),',
                  '[site](https://example.com) and [mail](mailto:a@b.ru).',
                  '## Второй шаг',
                  'Done.',
                ].join('\n')
              : '# Other article\n\n## Intro',
        }) as unknown as Article,
    );
    vi.mocked(v3.helpSearch).mockResolvedValue([] as unknown as Hits);
  });
  afterEach(() => {
    Element.prototype.scrollIntoView = original;
    scrollIntoView.mockReset();
    setTestLocale('ru');
  });

  it('TOC lists ## headings and links to the ids of the rendered headings', async () => {
    const { container } = renderAt('/help/start');
    const tocLink = await screen.findByText('Второй шаг', { selector: 'a' });
    expect(tocLink.getAttribute('href')).toBe('#второй-шаг');
    const heading = container.querySelector('article [id="второй-шаг"]');
    expect(heading?.tagName).toBe('H3');
    expect(heading?.textContent).toBe('Второй шаг');
    const first = screen.getByText('First steps', { selector: 'a' });
    expect(container.querySelector(`article ${first.getAttribute('href')}`)?.tagName).toBe('H3');
  });

  it('clicking a TOC entry scrolls smoothly to the heading and updates the URL hash', async () => {
    renderAt('/help/start');
    const tocLink = await screen.findByText('Второй шаг', { selector: 'a' });
    expect(fireEvent.click(tocLink)).toBe(false); // default prevented → no native jump/reload
    await waitFor(() =>
      expect(screen.getByTestId('loc').textContent).toBe('/help/start#второй-шаг'),
    );
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    const el = scrollIntoView.mock.contexts.at(-1) as Element;
    expect(el.id).toBe('второй-шаг');
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'smooth', block: 'start' });

    // Clicking the same anchor again still scrolls (the location doesn't change).
    scrollIntoView.mockClear();
    fireEvent.click(tocLink);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('in-article #anchor link scrolls to the heading without leaving the page', async () => {
    const { container } = renderAt('/help/start');
    await screen.findByText('First steps', { selector: 'a' });
    const jump = container.querySelector('article a[href="#второй-шаг"]')!;
    expect(fireEvent.click(jump)).toBe(false);
    await waitFor(() =>
      expect(screen.getByTestId('loc').textContent).toBe('/help/start#второй-шаг'),
    );
    await waitFor(() =>
      expect((scrollIntoView.mock.contexts.at(-1) as Element | undefined)?.id).toBe('второй-шаг'),
    );
  });

  it('internal /help and /app links go through the router (no full reload)', async () => {
    const { container } = renderAt('/help/start');
    await screen.findByText('First steps', { selector: 'a' });
    const other = container.querySelector('article a[href="/help/other"]')!;
    expect(fireEvent.click(other)).toBe(false);
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/help/other'));
    await waitFor(() => expect(v3.helpArticle).toHaveBeenCalledWith('other', 'en'));
    expect(await screen.findByText('Intro', { selector: 'a' })).toBeInTheDocument();
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0 });

    // Back on the first article, the /app link navigates via the router as well.
    fireEvent.click(screen.getByText('Getting started', { selector: 'a' }));
    await screen.findByText('Второй шаг', { selector: 'a' });
    fireEvent.click(container.querySelector('article a[href="/app/overview"]')!);
    expect(await screen.findByTestId('app-page')).toBeInTheDocument();
    expect(screen.getByTestId('loc').textContent).toBe('/app/overview');
  });

  it('modified/middle clicks, target=_blank and other origins keep native behaviour', async () => {
    const { container } = renderAt('/help/start');
    await screen.findByText('First steps', { selector: 'a' });
    // Record whether the page prevented the default, then stop jsdom's (unimplemented) navigation.
    const prevented: boolean[] = [];
    const record = (e: Event) => {
      prevented.push(e.defaultPrevented);
      e.preventDefault();
    };
    window.addEventListener('click', record);
    try {
      const other = container.querySelector('article a[href="/help/other"]')!;
      for (const init of [
        { ctrlKey: true },
        { metaKey: true },
        { shiftKey: true },
        { altKey: true },
        { button: 1 },
      ]) {
        fireEvent.click(other, init);
      }
      const external = container.querySelector('article a[href="https://example.com"]')!;
      expect(external.getAttribute('target')).toBe('_blank');
      fireEvent.click(external);
      fireEvent.click(container.querySelector('article a[href^="mailto:"]')!);
    } finally {
      window.removeEventListener('click', record);
    }
    expect(prevented).toEqual([false, false, false, false, false, false, false]);
    expect(screen.getByTestId('loc').textContent).toBe('/help/start');
  });
});
