import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Send, Sparkles, X } from 'lucide-react';
import { v3, type AssistantAnswer } from '../lib/api-v3';
import { useT } from '../i18n';
import { mdToHtml } from '../lib/md-to-html';

interface Msg {
  role: 'user' | 'assistant';
  text: string;
  meta?: AssistantAnswer;
}

/** Floating RAG assistant (bottom-right) — answers only from the help articles. */
export function Assistant(): JSX.Element {
  const { t, locale } = useT();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => end.current?.scrollIntoView({ behavior: 'smooth' }), [msgs, busy]);

  const ask = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    setMsgs((m) => [...m, { role: 'user', text: question }]);
    setInput('');
    setBusy(true);
    try {
      const res = await v3.ask(question, locale);
      setMsgs((m) => [...m, { role: 'assistant', text: res.answer, meta: res }]);
    } catch {
      setMsgs((m) => [...m, { role: 'assistant', text: t('assistant.error') }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('assistant.title')}
        aria-expanded={open}
        className="fixed bottom-20 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-onaccent shadow-[0_8px_30px_rgba(255,77,20,.45)] transition-transform duration-200 hover:scale-105 active:scale-95 lg:bottom-6 lg:right-6"
      >
        {open ? <X className="h-6 w-6" /> : <Bot className="h-6 w-6" />}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t('assistant.title')}
          className="fixed bottom-36 right-4 z-50 flex h-[min(560px,70vh)] w-[min(400px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl animate-fade-up lg:bottom-24 lg:right-6"
        >
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <Sparkles className="h-4 w-4 text-accent" />
            <div className="text-sm font-semibold">{t('assistant.title')}</div>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
            <div className="rounded-xl bg-raised p-3">{t('assistant.hello')}</div>
            {msgs.length === 0 && (
              <div>
                <div className="mb-2 text-xs uppercase tracking-wide text-muted">
                  {t('assistant.examples')}
                </div>
                <div className="flex flex-wrap gap-2">
                  {(['assistant.ex1', 'assistant.ex2', 'assistant.ex3'] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => void ask(t(k))}
                      className="chip hover:border-accent hover:text-accent"
                    >
                      {t(k)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m, i) =>
              m.role === 'user' ? (
                <div key={i} className="ml-8 rounded-xl bg-accent px-3 py-2 text-onaccent">
                  {m.text}
                </div>
              ) : (
                <div key={i} className="mr-4 rounded-xl border border-line p-3">
                  <div
                    className="ai-narrative text-sm [&_h2]:text-base [&_p]:mb-2"
                    dangerouslySetInnerHTML={{ __html: mdToHtml(m.text) }}
                  />
                  {m.meta && m.meta.sources.length > 0 && (
                    <div className="mt-2 border-t border-line pt-2">
                      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted">
                        {t('assistant.sources')}
                        {m.meta.mode === 'search'
                          ? ` · ${t('assistant.searchMode')}`
                          : m.meta.provider
                            ? ` · ${m.meta.provider}`
                            : ''}
                      </div>
                      <ul className="space-y-0.5">
                        {m.meta.sources.slice(0, 4).map((s, j) => (
                          <li key={j}>
                            <Link
                              to={`/help/${s.slug}`}
                              onClick={() => setOpen(false)}
                              className="text-xs text-accent hover:underline"
                            >
                              [{j + 1}] {s.title} → {s.heading}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ),
            )}
            {busy && (
              <div className="flex gap-1 p-2">
                {[0, 1, 2].map((d) => (
                  <span
                    key={d}
                    className="h-2 w-2 animate-pulse-dot rounded-full bg-accent"
                    style={{ animationDelay: `${d * 0.2}s` }}
                  />
                ))}
              </div>
            )}
            <div ref={end} />
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void ask(input);
            }}
            className="flex gap-2 border-t border-line p-3"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t('assistant.placeholder')}
              aria-label={t('assistant.placeholder')}
              maxLength={1000}
              className="input"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="btn-primary px-3"
              aria-label={t('assistant.send')}
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
