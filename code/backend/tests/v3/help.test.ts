import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  Bm25Index,
  buildAssistantPrompt,
  chunkArticle,
  helpRoutes,
  loadArticles,
  parseFrontMatter,
  tokenize,
  type HelpArticle,
} from '../../src/help/help';

const ARTICLE_RU = `---
title: "Начало работы"
section: "Основы"
order: 1
summary: "Как войти в кабинет"
---

# Начало работы

Вводный текст.

## Вход в кабинет

Откройте /login и введите почту и пароль.

### Забыли пароль

Обратитесь к администратору.
`;

const ARTICLE_EN = `# Getting started

## Sign in

Open /login and enter your email.
`;

describe('parseFrontMatter', () => {
  it('parses key: value pairs and strips quotes', () => {
    const { meta, body } = parseFrontMatter(ARTICLE_RU);
    expect(meta).toEqual({
      title: 'Начало работы',
      section: 'Основы',
      order: '1',
      summary: 'Как войти в кабинет',
    });
    expect(body).not.toContain('---');
    expect(body.trimStart().startsWith('# Начало работы')).toBe(true);
  });

  it('returns the source untouched without front matter', () => {
    const { meta, body } = parseFrontMatter('# Just markdown\n');
    expect(meta).toEqual({});
    expect(body).toBe('# Just markdown\n');
  });
});

describe('loadArticles / chunkArticle', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pca-help-'));
    mkdirSync(join(dir, 'ru'));
    mkdirSync(join(dir, 'en'));
    writeFileSync(join(dir, 'ru', '01-start.md'), ARTICLE_RU);
    writeFileSync(join(dir, 'en', '01-start.md'), ARTICLE_EN);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('loads ru articles with meta (slug drops the numeric prefix)', () => {
    const [a] = loadArticles(dir, 'ru');
    expect(a).toMatchObject({
      slug: 'start',
      lang: 'ru',
      title: 'Начало работы',
      section: 'Основы',
      order: 1,
      summary: 'Как войти в кабинет',
    });
    expect(a!.markdown).toContain('## Вход в кабинет');
  });

  it('en articles parse h1 as title when no front matter; missing dir → []', () => {
    const [a] = loadArticles(dir, 'en');
    // order берётся из числового префикса файла (01-start.md), не из front matter
    expect(a).toMatchObject({ slug: 'start', title: 'Getting started', order: 1 });
    expect(a!.summary).toBe('');
    expect(loadArticles(join(dir, 'nope'), 'ru')).toEqual([]);
  });

  it('chunkArticle splits by ##/### and skips the h1 line', () => {
    const a = loadArticles(dir, 'ru')[0]!;
    const chunks = chunkArticle(a);
    expect(chunks.map((c) => c.heading)).toEqual([
      'Начало работы',
      'Вход в кабинет',
      'Забыли пароль',
    ]);
    expect(chunks[1]).toMatchObject({ slug: 'start', articleTitle: 'Начало работы' });
    expect(chunks[1]!.text).toContain('/login');
    // h1 text itself is not duplicated into a chunk
    expect(chunks[0]!.heading).toBe('Начало работы');
  });

  it('chunks longer than 2500 chars are truncated', () => {
    const a: HelpArticle = {
      slug: 'big',
      lang: 'ru',
      title: 'T',
      section: '',
      order: 1,
      summary: '',
      markdown: `## Head\n${'x'.repeat(3000)}`,
    };
    expect(chunkArticle(a)[0]!.text).toHaveLength(2500);
  });
});

describe('tokenize / Bm25Index', () => {
  it('tokenize lowercases, drops stop-words, stems only words longer than 6, ё→е', () => {
    expect(tokenize('И что Регистрация?')).toEqual(['регист']);
    // 'однако' — ровно 6 символов, не стеммится
    expect(tokenize('Ёлка ёж однако')).toEqual(['елка', 'еж', 'однако']);
    expect(tokenize('ABC123 def_45')).toEqual(['abc123', 'def_45']);
  });

  const article = (
    slug: string,
    title: string,
    sections: Array<[string, string]>,
  ): HelpArticle => ({
    slug,
    lang: 'ru',
    title,
    section: '',
    order: 1,
    summary: '',
    markdown: sections.map(([h, t]) => `## ${h}\n${t}`).join('\n'),
  });

  const idx = new Bm25Index(
    [
      article('login', 'Вход', [['Пароль', 'Сменить пароль можно в настройках кабинета.']]),
      article('sync', 'Синхронизация', [
        ['Metrika', 'Данные Метрики обновляются по расписанию ночью.'],
      ]),
    ].flatMap(chunkArticle),
  );

  it('search ranks the relevant chunk first and returns score > 0', () => {
    const hits = idx.search('как сменить пароль');
    expect(hits[0]!.slug).toBe('login');
    expect(hits[0]!.score).toBeGreaterThan(0);
    expect(hits[0]!.heading).toBe('Пароль');
  });

  it('unrelated queries return nothing; limit k respected', () => {
    expect(idx.search('запрос про космос')).toEqual([]);
    const both = idx.search('пароль метрика синхронизация', 1);
    expect(both).toHaveLength(1);
  });
});

describe('buildAssistantPrompt', () => {
  it('builds a grounded prompt with numbered fragments (ru and en)', () => {
    const chunks = [
      { slug: 'a', articleTitle: 'Вход', heading: 'Пароль', text: 'Текст' },
      { slug: 'b', articleTitle: 'Синк', heading: 'Metrika', text: 'Text' },
    ];
    const ru = buildAssistantPrompt('Как войти?', chunks, 'ru');
    expect(ru.system).toContain('ProductCamp Analytics Copilot');
    expect(ru.system).toContain('ТОЛЬКО');
    expect(ru.user).toContain('[1] Вход → Пароль');
    expect(ru.user).toContain('Вопрос: Как войти?');

    const en = buildAssistantPrompt('How to sign in?', chunks, 'en');
    expect(en.system).toContain('Answer in English');
    expect(en.user).toContain('Question: How to sign in?');
  });
});

describe('helpRoutes', () => {
  let dir: string;
  let app: FastifyInstance;
  let complete: ReturnType<typeof vi.fn>;
  let now: number;

  const build = async (): Promise<void> => {
    dir = mkdtempSync(join(tmpdir(), 'pca-help-routes-'));
    mkdirSync(join(dir, 'ru'));
    writeFileSync(join(dir, 'ru', '01-start.md'), ARTICLE_RU);
    complete = vi.fn(async () => ({
      text: 'Ответ ассистента [1]',
      provider: 'openrouter',
      model: 'm',
    }));
    now = 1_000_000;
    app = Fastify({ logger: false });
    await app.register(helpRoutes, {
      prefix: '/api',
      dir,
      complete,
      now: () => now,
    });
    await app.ready();
  };
  beforeEach(build);
  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('GET /help/articles returns meta without markdown bodies', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/help/articles' });
    expect(res.statusCode).toBe(200);
    const list = res.json();
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({
      slug: 'start',
      lang: 'ru',
      title: 'Начало работы',
      section: 'Основы',
      order: 1,
      summary: 'Как войти в кабинет',
    });
    expect(res.body).not.toContain('Вводный текст');
  });

  it('GET /help/articles/:slug returns the full article; 404 unknown', async () => {
    const ok = await app.inject({ method: 'GET', url: '/api/help/articles/start' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().markdown).toContain('## Вход в кабинет');
    expect((await app.inject({ method: 'GET', url: '/api/help/articles/nope' })).statusCode).toBe(
      404,
    );
  });

  it('GET /help/search finds chunks; empty q → []', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/help/search?q=пароль' });
    expect(res.statusCode).toBe(200);
    // Заголовок в индексе считается дважды → чанк «Забыли пароль» ранжируется первым
    expect(res.json()[0]).toMatchObject({ slug: 'start', heading: 'Забыли пароль' });
    expect((await app.inject({ method: 'GET', url: '/api/help/search?q=%20%20' })).json()).toEqual(
      [],
    );
  });

  it('POST /help/ask: LLM available → mode=llm with sources', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/help/ask',
      payload: { question: 'Как сменить пароль?' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      mode: 'llm',
      answer: 'Ответ ассистента [1]',
      provider: 'openrouter',
    });
    expect(res.json().sources[0]).toMatchObject({ slug: 'start', heading: 'Забыли пароль' });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0]![0].maxTokens).toBe(900);
  });

  it('POST /help/ask: LLM failure → search-only fallback listing sections', async () => {
    complete.mockRejectedValueOnce(new Error('provider down'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/help/ask',
      payload: { question: 'Как сменить пароль?' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mode).toBe('search');
    expect(body.answer).toContain('AI-провайдер недоступен');
    expect(body.answer).toContain('Вход в кабинет');
  });

  it('POST /help/ask: no hits → mode=search with a hint, no LLM call', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/help/ask',
      payload: { question: 'квантовая запутанность?' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ mode: 'search', sources: [] });
    expect(complete).not.toHaveBeenCalled();
  });

  it('POST /help/ask: invalid body → 400; en language supported', async () => {
    expect(
      (await app.inject({ method: 'POST', url: '/api/help/ask', payload: { question: 'x' } }))
        .statusCode,
    ).toBe(400);
    const en = await app.inject({
      method: 'POST',
      url: '/api/help/ask',
      payload: { question: 'Как сменить пароль?', lang: 'en' },
    });
    // en-индекс пуст (нет en-статей) → search-режим с en-текстом
    expect(en.json().answer).toContain('No matching help sections');
  });

  it('rate limit: гость — 5 вопросов / 10 минут → 429; окно истекло — снова можно', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/help/ask',
        payload: { question: 'Как сменить пароль?' },
      });
      expect(res.statusCode).toBe(200);
    }
    const sixth = await app.inject({
      method: 'POST',
      url: '/api/help/ask',
      payload: { question: 'Как сменить пароль?' },
    });
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json().code).toBe('RATE_LIMITED');

    // Окно истекло — снова можно.
    now += 601_000;
    expect(
      (await app.inject({ method: 'POST', url: '/api/help/ask', payload: { question: 'пароль' } }))
        .statusCode,
    ).toBe(200);
  });
});
