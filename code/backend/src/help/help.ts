import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

export type HelpLang = 'ru' | 'en';

export interface HelpArticle {
  readonly slug: string;
  readonly lang: HelpLang;
  readonly title: string;
  readonly section: string;
  readonly order: number;
  readonly summary: string;
  readonly markdown: string;
}

export interface HelpChunk {
  readonly slug: string;
  readonly articleTitle: string;
  readonly heading: string;
  readonly text: string;
}

/** Parse `---\nkey: value\n---` front matter. */
export function parseFrontMatter(src: string): { meta: Record<string, string>; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(src);
  if (!m) return { meta: {}, body: src };
  const meta: Record<string, string> = {};
  for (const line of m[1]!.split('\n')) {
    const i = line.indexOf(':');
    if (i > 0)
      meta[line.slice(0, i).trim()] = line
        .slice(i + 1)
        .trim()
        .replace(/^"|"$/g, '');
  }
  return { meta, body: src.slice(m[0].length) };
}

/** Load `<dir>/<lang>/*.md` articles. Missing dir → empty list. */
export function loadArticles(dir: string, lang: HelpLang): HelpArticle[] {
  const base = join(dir, lang);
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const { meta, body } = parseFrontMatter(readFileSync(join(base, f), 'utf8'));
      const slug = f.replace(/\.md$/, '').replace(/^\d+-/, '');
      const h1 = /^#\s+(.+)$/m.exec(body)?.[1];
      return {
        slug,
        lang,
        title: meta.title ?? h1 ?? slug,
        section: meta.section ?? '',
        order: Number(meta.order ?? /^(\d+)-/.exec(f)?.[1] ?? 999),
        summary: meta.summary ?? '',
        markdown: body,
      };
    })
    .sort((a, b) => a.order - b.order);
}

/** Split an article into chunks by `##` / `###` headings (small enough for a prompt). */
export function chunkArticle(a: HelpArticle): HelpChunk[] {
  const chunks: HelpChunk[] = [];
  let heading = a.title;
  let buf: string[] = [];
  const flush = () => {
    const text = buf.join('\n').trim();
    if (text)
      chunks.push({ slug: a.slug, articleTitle: a.title, heading, text: text.slice(0, 2500) });
    buf = [];
  };
  for (const line of a.markdown.split('\n')) {
    const h = /^#{2,3}\s+(.+)$/.exec(line);
    if (h) {
      flush();
      heading = h[1]!.trim();
    } else if (!/^#\s/.test(line)) {
      buf.push(line);
    }
  }
  flush();
  return chunks;
}

const STOP = new Set(
  'и в во не что он на я с со как а то все она так его но да ты к у же вы за бы по только ее мне было вот от меня еще нет о из ему теперь когда даже ну вдруг ли если уже или ни быть был него до вас нибудь опять уж вам ведь там потом себя ничего ей может они тут где есть надо ней для мы тебя их чем была сам чтоб без будто чего раз тоже себе под будет ж тогда кто этот того потому этого какой совсем ним здесь этом один почти мой тем чтобы нее сейчас были куда зачем всех никогда можно при наконец два об другой хоть после над больше тот через эти нас про всего них какая много разве три эту моя впрочем хорошо свою этой перед иногда лучше чуть том нельзя такой им более всегда конечно всю между the a an and or of to in is are for on with how what do does i can it be this that as by from at'.split(
    ' ',
  ),
);

/** Lowercase, split, drop stop-words, crude stemming (prefix of 6 chars) — good enough for RU/EN. */
export function tokenize(text: string): string[] {
  return (
    text
      .toLowerCase()
      .replace(/ё/g, 'е')
      .match(/[a-zа-я0-9_]+/g) ?? []
  )
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map((t) => (t.length > 6 ? t.slice(0, 6) : t));
}

/** Okapi BM25 over chunks. */
export class Bm25Index {
  private readonly docs: string[][];
  private readonly df = new Map<string, number>();
  private readonly avgLen: number;

  constructor(
    public readonly chunks: HelpChunk[],
    private readonly k1 = 1.4,
    private readonly b = 0.75,
  ) {
    this.docs = chunks.map((c) =>
      tokenize(`${c.articleTitle} ${c.heading} ${c.heading} ${c.text}`),
    );
    for (const d of this.docs)
      for (const t of new Set(d)) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    this.avgLen = this.docs.reduce((s, d) => s + d.length, 0) / Math.max(1, this.docs.length);
  }

  search(query: string, k = 5): Array<HelpChunk & { score: number }> {
    const q = tokenize(query);
    const n = this.docs.length;
    const scored = this.docs.map((d, i) => {
      let score = 0;
      const tf = new Map<string, number>();
      for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of q) {
        const f = tf.get(t);
        if (!f) continue;
        const df = this.df.get(t) ?? 0;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        score +=
          (idf * f * (this.k1 + 1)) /
          (f + this.k1 * (1 - this.b + (this.b * d.length) / this.avgLen));
      }
      return { ...this.chunks[i]!, score };
    });
    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
}

/** Build the grounded RAG prompt. The model must answer only from the fragments. */
export function buildAssistantPrompt(
  question: string,
  hits: HelpChunk[],
  lang: HelpLang,
): { system: string; user: string } {
  const system =
    lang === 'ru'
      ? 'Ты — ассистент справки продукта «ProductCamp Analytics Copilot». Отвечай по-русски, кратко и по шагам. ' +
        'Используй ТОЛЬКО факты из фрагментов справки ниже. Если ответа во фрагментах нет — так и скажи: ' +
        '«В справке нет ответа на этот вопрос» и предложи, к какому разделу обратиться. Не выдумывай кнопки, ' +
        'цифры и настройки. В конце перечисли использованные фрагменты как [1], [2].'
      : 'You are the help assistant of "ProductCamp Analytics Copilot". Answer in English, concisely, step by step. ' +
        'Use ONLY facts from the help fragments below. If the answer is not there, say "The help does not cover this" ' +
        'and suggest a section. Never invent buttons, numbers or settings. Cite fragments as [1], [2].';
  const ctx = hits
    .map((h, i) => `[${i + 1}] ${h.articleTitle} → ${h.heading}\n${h.text}`)
    .join('\n\n---\n\n');
  return {
    system,
    user: `${lang === 'ru' ? 'Фрагменты справки' : 'Help fragments'}:\n\n${ctx}\n\n${lang === 'ru' ? 'Вопрос' : 'Question'}: ${question}`,
  };
}

export interface HelpDeps {
  readonly dir: string;
  readonly complete?: (req: { system: string; user: string; maxTokens: number }) => Promise<{
    text: string;
    provider: string;
    model: string;
  }>;
  readonly now?: () => number;
}

/** Public help routes + RAG assistant. */
export async function helpRoutes(app: FastifyInstance, deps: HelpDeps): Promise<void> {
  const cache = new Map<HelpLang, { articles: HelpArticle[]; index: Bm25Index }>();
  const get = (lang: HelpLang) => {
    let c = cache.get(lang);
    if (!c) {
      const articles = loadArticles(deps.dir, lang);
      c = { articles, index: new Bm25Index(articles.flatMap(chunkArticle)) };
      cache.set(lang, c);
    }
    return c;
  };
  const langOf = (q: unknown): HelpLang => ((q as { lang?: string })?.lang === 'en' ? 'en' : 'ru');

  // Per-IP limiter for the assistant: дифференцированно — гость 5 / авторизованный 20 вопросов
  // за 10 минут (ревью Claude: ротация IP не должна давать анонимам тот же бюджет).
  const now = deps.now ?? Date.now;
  const hits = new Map<string, number[]>();
  const limited = (key: string, max: number): boolean => {
    const t = now();
    const list = (hits.get(key) ?? []).filter((x) => t - x < 600_000);
    if (list.length >= max) return true;
    list.push(t);
    hits.set(key, list);
    return false;
  };

  app.get('/help/articles', async (req) =>
    get(langOf(req.query)).articles.map(({ markdown: _m, ...rest }) => rest),
  );

  app.get('/help/articles/:slug', async (req, reply) => {
    const a = get(langOf(req.query)).articles.find(
      (x) => x.slug === (req.params as { slug: string }).slug,
    );
    return a ?? reply.code(404).send({ error: 'not found' });
  });

  app.get('/help/search', async (req) => {
    const q = String((req.query as { q?: string }).q ?? '').slice(0, 300);
    if (!q.trim()) return [];
    return get(langOf(req.query)).index.search(q, 8);
  });

  const Ask = z.object({
    question: z.string().min(2).max(1000),
    lang: z.enum(['ru', 'en']).default('ru'),
  });

  app.post('/help/ask', async (req, reply) => {
    const body = Ask.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body' });
    // Гость — 5 вопросов/10 мин, авторизованный — 20 (ревью: ротация IP не должна
    // давать анонимам полный бюджет LLM-токенов).
    const anonLimit = req.user ? 20 : 5;
    if (limited(req.ip, anonLimit))
      return reply.code(429).send({ error: 'too many questions', code: 'RATE_LIMITED' });
    const { question, lang } = body.data;
    const found = get(lang).index.search(question, 5);
    const sources = found.map((h) => ({ slug: h.slug, title: h.articleTitle, heading: h.heading }));
    if (found.length === 0) {
      return {
        mode: 'search',
        answer:
          lang === 'ru'
            ? 'В справке не нашлось подходящих разделов. Попробуйте переформулировать вопрос или откройте оглавление справки.'
            : 'No matching help sections. Try rephrasing or browse the help contents.',
        sources,
      };
    }
    if (deps.complete) {
      try {
        const prompt = buildAssistantPrompt(question, found, lang);
        const res = await deps.complete({ ...prompt, maxTokens: 900 });
        return { mode: 'llm', answer: res.text, provider: res.provider, model: res.model, sources };
      } catch {
        // fall through to search-only mode
      }
    }
    return {
      mode: 'search',
      answer:
        (lang === 'ru'
          ? 'AI-провайдер недоступен — вот самые подходящие разделы справки:\n\n'
          : 'AI provider unavailable — the most relevant help sections:\n\n') +
        found
          .slice(0, 3)
          .map((h, i) => `[${i + 1}] **${h.articleTitle} → ${h.heading}**\n${h.text.slice(0, 400)}`)
          .join('\n\n'),
      sources,
    };
  });
}
