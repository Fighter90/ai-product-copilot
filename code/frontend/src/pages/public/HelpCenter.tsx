import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, Search } from 'lucide-react';
import { v3 } from '../../lib/api-v3';
import { useT } from '../../i18n';
import { mdToHtml } from '../../lib/md-to-html';
import { PublicFooter, PublicHeader } from './PublicChrome';
import { Skeleton } from '../../components/ui';
import { RestartTourButton } from '../../components/onboarding/RestartTourButton';

export interface TocItem {
  id: string;
  text: string;
  /** 2 = markdown `##`, 3 = markdown `###`. */
  depth: 2 | 3;
}

/**
 * URL-fragment slug: lower-case letters (any script, Cyrillic included), digits and hyphens only —
 * so the value is also safe inside an HTML attribute.
 */
export function slugify(text: string): string {
  const slug = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/[\s-]+/g, '-')
    .slice(0, 80)
    .replace(/^-+|-+$/g, '');
  return slug || 'section';
}

const decodeEntities = (s: string): string =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');

/**
 * Render an article and give every heading a unique slug id. mdToHtml maps markdown `#`→h2,
 * `##`→h3, `###`→h4; the "On this page" list holds `##`/`###` (h3/h4), built from the same pass
 * so TOC links and heading ids can never drift apart.
 */
export function renderArticle(md: string): { html: string; toc: TocItem[] } {
  const used = new Set<string>();
  const toc: TocItem[] = [];
  const html = mdToHtml(md).replace(
    /<h([2-6])>([\s\S]*?)<\/h\1>/g,
    (_m, level: string, inner: string) => {
      const text = decodeEntities(inner.replace(/<[^>]*>/g, '')).trim();
      const base = slugify(text);
      let id = base;
      for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
      used.add(id);
      const depth = Number(level) - 1;
      if (depth === 2 || depth === 3) toc.push({ id, text, depth });
      return `<h${level} id="${id}" class="scroll-mt-24">${inner}</h${level}>`;
    },
  );
  return { html, toc };
}

/** `#%D0%B0` → `а`; empty string when there is no fragment. */
function hashId(hash: string): string {
  const raw = hash.replace(/^#/, '');
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function scrollToId(id: string): boolean {
  const el = id ? document.getElementById(id) : null;
  if (!el) return false;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  el.scrollIntoView?.({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  return true;
}

/** Public help centre: contents (left), article (centre), on-this-page (right), full-text search. */
export function HelpCenter(): JSX.Element {
  const { t, locale } = useT();
  const { slug } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState('');
  const list = useQuery({
    queryKey: ['help', 'list', locale],
    queryFn: () => v3.helpArticles(locale),
  });
  const current = slug ?? list.data?.[0]?.slug;
  const article = useQuery({
    queryKey: ['help', 'article', current, locale],
    queryFn: () => v3.helpArticle(current!, locale),
    enabled: !!current,
  });
  const search = useQuery({
    queryKey: ['help', 'search', query, locale],
    queryFn: () => v3.helpSearch(query, locale),
    enabled: query.trim().length > 1,
  });

  const sections = useMemo(() => {
    const m = new Map<string, typeof list.data>();
    for (const a of list.data ?? [])
      m.set(a.section || '—', [...(m.get(a.section || '—') ?? []), a]);
    return [...m.entries()];
  }, [list.data]);

  const markdown = article.data?.markdown;
  const rendered = useMemo(
    () => (markdown === undefined ? null : renderArticle(markdown)),
    [markdown],
  );
  const toc = rendered?.toc ?? [];

  // Deep links (/help/x#section), back/forward and in-page anchors: scroll once the heading exists.
  useEffect(() => {
    if (rendered) scrollToId(hashId(location.hash));
  }, [location.hash, rendered]);

  // Client-side navigation keeps the scroll position — start a new article at the top.
  const lastPath = useRef(location.pathname);
  useEffect(() => {
    if (lastPath.current === location.pathname) return;
    lastPath.current = location.pathname;
    if (!location.hash) window.scrollTo?.({ top: 0 });
  }, [location.pathname, location.hash]);

  /**
   * Event delegation for links inside rendered markdown and the TOC: same-origin links go through
   * the router (no full reload), `#anchors` scroll smoothly and update the URL hash. Modified
   * clicks, middle clicks, `target=_blank`, downloads and other origins keep native behaviour.
   */
  const onLinkClick = (e: MouseEvent<HTMLElement>): void => {
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target instanceof Element ? e.target.closest('a') : null;
    if (!a || !e.currentTarget.contains(a)) return;
    const target = a.getAttribute('target');
    if ((target && target !== '_self') || a.hasAttribute('download')) return;
    const href = a.getAttribute('href');
    if (!href) return;
    const here = `${window.location.origin}${location.pathname}${location.search}`;
    let url: URL;
    try {
      url = new URL(href, here);
    } catch {
      return;
    }
    if (url.origin !== window.location.origin) return;
    e.preventDefault();
    const samePage = url.pathname === location.pathname && url.search === location.search;
    if (samePage) {
      if (!url.hash) return;
      // Same hash again: the location won't change, so scroll here; otherwise the effect does.
      if (hashId(url.hash) === hashId(location.hash)) scrollToId(hashId(url.hash));
      else navigate({ pathname: location.pathname, search: location.search, hash: url.hash });
      return;
    }
    navigate(url.pathname + url.search + url.hash);
  };

  return (
    <div className="min-h-screen bg-canvas">
      <PublicHeader />
      <main>
        <div className="border-b border-line pb-10 pt-28">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.25em] text-accent">
              <BookOpen className="h-4 w-4" /> {t('help.title')}
            </div>
            <h1 className="h-display text-4xl sm:text-6xl">{t('help.subtitle')}</h1>
            <label className="relative mt-8 block max-w-2xl">
              <Search className="pointer-events-none absolute left-4 top-3.5 h-5 w-5 text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('help.search')}
                aria-label={t('help.search')}
                className="input h-12 pl-12 text-base"
              />
            </label>
            {query.trim().length > 1 && (
              <div className="mt-3 max-w-2xl rounded-xl border border-line bg-surface p-2 shadow-xl animate-fade-in">
                <div className="px-2 py-1 text-xs uppercase tracking-wide text-muted">
                  {t('help.results')}
                </div>
                {(search.data ?? []).length === 0 && (
                  <div className="px-2 py-3 text-sm text-muted">—</div>
                )}
                {(search.data ?? []).map((h, i) => (
                  <Link
                    key={i}
                    to={`/help/${h.slug}`}
                    onClick={() => setQuery('')}
                    className="block rounded-lg px-3 py-2 hover:bg-raised"
                  >
                    <div className="text-sm font-medium">
                      {h.articleTitle} <span className="text-muted">→ {h.heading}</span>
                    </div>
                    <div className="line-clamp-2 text-xs text-muted">
                      {h.text.replace(/[#*`>|]/g, '').slice(0, 220)}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[240px_1fr_200px]">
          <aside className="lg:sticky lg:top-24 lg:self-start" aria-label={t('help.contents')}>
            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted">
              {t('help.contents')}
            </div>
            {list.isLoading && <Skeleton className="h-64" />}
            <nav className="space-y-5">
              {sections.map(([section, items]) => (
                <div key={section}>
                  <div className="mb-1 text-xs font-semibold text-ink">{section}</div>
                  <ul className="space-y-0.5 border-l border-line">
                    {(items ?? []).map((a) => (
                      <li key={a.slug}>
                        <Link
                          to={`/help/${a.slug}`}
                          className={`-ml-px block border-l px-3 py-1 text-sm transition-colors ${
                            a.slug === current
                              ? 'border-accent font-medium text-accent'
                              : 'border-transparent text-muted hover:text-ink'
                          }`}
                        >
                          {a.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
          </aside>

          <article className="min-w-0">
            {article.isLoading && <Skeleton className="h-96" />}
            {article.isError && <div className="text-muted">{t('help.notFound')}</div>}
            {rendered && (
              <div
                className="ai-narrative max-w-3xl animate-fade-in"
                onClick={onLinkClick}
                dangerouslySetInnerHTML={{ __html: rendered.html }}
              />
            )}
            <div className="mt-12 max-w-3xl rounded-card border border-accent/30 bg-accent/5 p-4 text-sm">
              {t('help.askAssistant')}
            </div>
            <div className="mt-4 flex max-w-3xl flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface p-4 text-sm">
              <div className="min-w-0">
                <div className="font-medium">{t('hint.tour.restart')}</div>
                <div className="text-muted">{t('hint.tour.restartDesc')}</div>
              </div>
              <RestartTourButton />
            </div>
          </article>

          <aside className="hidden lg:sticky lg:top-24 lg:block lg:self-start">
            {toc.length > 0 && (
              <>
                <div className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted">
                  {t('help.onThisPage')}
                </div>
                <ul className="space-y-1.5 text-sm" onClick={onLinkClick}>
                  {toc.map((h) => (
                    <li key={h.id} className={h.depth === 3 ? 'pl-3 text-xs' : undefined}>
                      <a href={`#${h.id}`} className="text-muted hover:text-accent">
                        {h.text}
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </aside>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
