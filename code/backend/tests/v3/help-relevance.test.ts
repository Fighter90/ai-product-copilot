// ANA-46 acceptance: the help retriever (BM25 in src/help/help.ts) must be relevant on a
// fixed question set — 20 questions (RU + EN) against the REAL docs/help articles, the
// expected article slug within the top-3 hits, ≥ 18/20 passing. Failure output lists the
// misses with their top hits so scoring regressions are diagnosable from the log.
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { Bm25Index, chunkArticle, loadArticles, type HelpLang } from '../../src/help/help';

const HELP_DIR = fileURLToPath(new URL('../../../../docs/help', import.meta.url));

/** Question sets against the real help center (slug = file name without the numeric prefix). */
const QUESTIONS: Array<{ lang: HelpLang; q: string; expect: string[] }> = [
  // --- RU ---
  { lang: 'ru', q: 'Как войти в кабинет?', expect: ['start'] },
  { lang: 'ru', q: 'Как сменить пароль?', expect: ['start', 'admin-guide', 'admin'] },
  {
    lang: 'ru',
    q: 'Как запустить синхронизацию данных Метрики?',
    expect: ['history-b2b', 'admin-guide', 'reports-how'],
  },
  { lang: 'ru', q: 'Как подключить DataLens по CSV?', expect: ['datalens'] },
  { lang: 'ru', q: 'Где добавить ключ AI-провайдера?', expect: ['llm-keys', 'admin'] },
  {
    lang: 'ru',
    q: 'Кто может приглашать пользователей?',
    expect: ['admin', 'roles', 'admin-guide'],
  },
  { lang: 'ru', q: 'Как включить светлую тему?', expect: ['prefs'] },
  { lang: 'ru', q: 'Как сформировать отчёт DOCX по ГОСТ?', expect: ['report', 'reports-how'] },
  { lang: 'ru', q: 'Как читать воронку и её этапы?', expect: ['funnel'] },
  { lang: 'ru', q: 'Как считается конверсия и отказы?', expect: ['metrics'] },
  // --- EN ---
  { lang: 'en', q: 'How do I sign in to the cabinet?', expect: ['start'] },
  { lang: 'en', q: 'How do I change my password?', expect: ['start', 'admin-guide', 'admin'] },
  { lang: 'en', q: 'How do I connect DataLens CSV data?', expect: ['datalens'] },
  { lang: 'en', q: 'Where do I put the YandexGPT API key?', expect: ['llm-keys', 'admin'] },
  {
    lang: 'en',
    q: 'How do I export the report to DOCX or PDF?',
    expect: ['report', 'reports-how'],
  },
  { lang: 'en', q: 'How do I switch the interface language?', expect: ['prefs'] },
  { lang: 'en', q: 'Who can manage users and roles?', expect: ['roles', 'admin', 'admin-guide'] },
  { lang: 'en', q: 'What does the Live page show?', expect: ['live'] },
  { lang: 'en', q: 'How is the conversion rate calculated?', expect: ['metrics'] },
  {
    lang: 'en',
    q: 'How does the provider chain fallback work?',
    expect: ['llm-keys', 'assistant'],
  },
];

const PASS_THRESHOLD = 18; // ANA-46: ≥ 18 из 20

describe('help retriever relevance (ANA-46, real docs/help)', () => {
  const indexes = new Map<HelpLang, Bm25Index>();
  for (const lang of ['ru', 'en'] as const) {
    const articles = loadArticles(HELP_DIR, lang);
    expect(articles.length, `docs/help/${lang} must exist`).toBeGreaterThan(10);
    indexes.set(lang, new Bm25Index(articles.flatMap(chunkArticle)));
  }

  it(`expected slug in top-3 for ≥ ${PASS_THRESHOLD}/20 questions`, () => {
    const misses: string[] = [];
    let passed = 0;

    for (const { lang, q, expect: slugs } of QUESTIONS) {
      const top = indexes
        .get(lang)!
        .search(q, 3)
        .map((h) => h.slug);
      if (slugs.some((s) => top.includes(s))) {
        passed++;
      } else {
        misses.push(`${lang}: "${q}" → [${top.join(', ')}] (expected one of: ${slugs.join(', ')})`);
      }
    }

    if (misses.length > 0)
      console.log(`relevance misses (${misses.length}):\n${misses.join('\n')}`);
    expect(passed).toBeGreaterThanOrEqual(PASS_THRESHOLD);
    expect(passed).toBe(QUESTIONS.length - misses.length);
  });

  it('off-help questions return no hits (assistant must not invent)', () => {
    expect(indexes.get('ru')!.search('как приготовить борщ', 3)).toEqual([]);
    expect(indexes.get('en')!.search('bake a chocolate cake', 3)).toEqual([]);
  });
});
