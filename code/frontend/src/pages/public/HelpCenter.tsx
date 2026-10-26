import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, Search } from 'lucide-react';
import { v3 } from '../../lib/api-v3';
import { useT } from '../../i18n';
import { mdToHtml } from '../../lib/md-to-html';
import { PublicFooter, PublicHeader } from './PublicChrome';
import { Skeleton } from '../../components/ui';

/** Extract `##` headings for the "On this page" list. */
export function headings(md: string): Array<{ id: string; text: string }> {
  return Array.from(md.matchAll(/^##\s+(.+)$/gm)).map((m, i) => ({
    id: `h-${i}`,
    text: m[1]!.trim(),
  }));
}

/** Inject ids into rendered <h2> so the TOC can link to them. */
function withAnchors(html: string): string {
  let i = 0;
  return html.replace(/<h2>/g, () => `<h2 id="h-${i++}" class="scroll-mt-24">`);
}

/** Public help centre: contents (left), article (centre), on-this-page (right), full-text search. */
export function HelpCenter(): JSX.Element {
  const { t, locale } = useT();
  const { slug } = useParams();
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

  const toc = article.data ? headings(article.data.markdown) : [];

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
            {article.data && (
              <div
                className="ai-narrative max-w-3xl animate-fade-in"
                dangerouslySetInnerHTML={{ __html: withAnchors(mdToHtml(article.data.markdown)) }}
              />
            )}
            <div className="mt-12 max-w-3xl rounded-card border border-accent/30 bg-accent/5 p-4 text-sm">
              {t('help.askAssistant')}
            </div>
          </article>

          <aside className="hidden lg:sticky lg:top-24 lg:block lg:self-start">
            {toc.length > 0 && (
              <>
                <div className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted">
                  {t('help.onThisPage')}
                </div>
                <ul className="space-y-1.5 text-sm">
                  {toc.map((h) => (
                    <li key={h.id}>
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
