#!/usr/bin/env node
/**
 * build-guides.mjs — сборка пользовательского руководства (DOCX + PDF).
 *
 * Источники (по языкам):
 *   - RU: docs/user-guide.md     + docs/help/ru/*.md (приложения — статьи встроенной справки)
 *   - EN: docs/en/user-guide.md  + docs/help/en/*.md
 *
 * Выход:
 *   - docs/guides/user-guide-{ru,en}-v3.docx  (пакет docx)
 *   - docs/guides/user-guide-{ru,en}-v3.pdf   (pandoc + xelatex/lualatex, если установлены)
 *
 * Запуск из корня репозитория:
 *   pnpm guides                 — оба языка (= node scripts/build-guides.mjs)
 *   pnpm guides:ru | guides:en  — один язык (= node scripts/build-guides.mjs --lang en)
 * Пакет docx резолвится из code/backend/node_modules через createRequire — cwd не важен.
 * Подход к DOCX повторяет code/backend/src/report/docx/builder.ts (ГОСТ-оформление).
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND = path.join(ROOT, 'code', 'backend');
const OUT_DIR = path.join(ROOT, 'docs', 'guides');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = pkg.version;

const formatDate = (locale) =>
  new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(
    new Date(),
  );

/**
 * Настройки сборки по языкам. Буквы приложений — по ГОСТ 2.105: кириллица без Ё, З, Й, О, Ч, Ъ,
 * Ы, Ь; латиница без I и O.
 */
const LOCALES = {
  ru: {
    lang: 'ru',
    guideMd: path.join(ROOT, 'docs', 'user-guide.md'),
    helpDir: path.join(ROOT, 'docs', 'help', 'ru'),
    docxOut: path.join(OUT_DIR, 'user-guide-ru-v3.docx'),
    pdfOut: path.join(OUT_DIR, 'user-guide-ru-v3.pdf'),
    date: formatDate('ru-RU'),
    letters: 'АБВГДЕЖИКЛМНПРСТУФХЦШЩЭЮЯ'.split(''),
    appendix: 'Приложение',
    subtitle: 'Личный кабинет трека «Конверсии и лидген»',
    docTitle: 'Руководство пользователя',
    version: 'Версия',
    contents: 'Содержание',
    // Строка выбора языка в шапке руководства (ссылка на EN-версию) — в документ не попадает.
    langSwitch: /^>.*en\/user-guide\.md.*\n?/m,
    sources: 'docs/user-guide.md и docs/help/ru/*.md',
  },
  en: {
    lang: 'en',
    guideMd: path.join(ROOT, 'docs', 'en', 'user-guide.md'),
    helpDir: path.join(ROOT, 'docs', 'help', 'en'),
    docxOut: path.join(OUT_DIR, 'user-guide-en-v3.docx'),
    pdfOut: path.join(OUT_DIR, 'user-guide-en-v3.pdf'),
    date: formatDate('en-GB'),
    letters: 'ABCDEFGHJKLMNPQRSTUVWXYZ'.split(''),
    appendix: 'Appendix',
    subtitle: 'Web cabinet of the "Conversions & lead-gen" track',
    docTitle: 'User guide',
    version: 'Version',
    contents: 'Contents',
    langSwitch: /^>.*\.\.\/user-guide\.md.*\n?/m,
    sources: 'docs/en/user-guide.md and docs/help/en/*.md',
  },
};

/** Загрузка docx из зависимостей backend (в корневых node_modules его нет). */
function loadDocx() {
  try {
    return createRequire(path.join(BACKEND, 'package.json'))('docx');
  } catch (err) {
    throw new Error(
      `Пакет docx не найден (${err.message}). Установите зависимости backend: cd code/backend && pnpm install`,
    );
  }
}

// ---------------------------------------------------------------------------
// Мини-парсер Markdown (заголовки, абзацы, списки, таблицы, код, цитаты)
// ---------------------------------------------------------------------------

/** Отделить YAML front matter (--- ... ---) и разобрать его в объект. */
function stripFrontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line.trim());
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
  }
  return { meta, body: text.slice(m[0].length) };
}

/** Разбить строку таблицы на ячейки (пустые ячейки не выбрасываем). */
function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

/** Строка-разделитель шапки таблицы: | --- | :---: | ... */
function isTableSeparator(line) {
  if (!line.trim().startsWith('|')) return false;
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}

/**
 * Разобрать markdown-текст на блоки.
 * Возвращает { title, blocks }, блоки: heading | para | bullet | olist | table | code | quote | caption.
 * Уровни заголовков приведены к 1..6; заголовок 1 уровня — название документа.
 */
function parseMarkdown(text) {
  const { body } = stripFrontMatter(text);
  const lines = body.split(/\r?\n/);
  const blocks = [];
  let title = '';
  let i = 0;

  const appendToLast = (textPart) => {
    const last = blocks[blocks.length - 1];
    if (last && ['para', 'bullet', 'olist', 'quote'].includes(last.type)) {
      last.text += ` ${textPart}`;
    } else {
      blocks.push({ type: 'para', text: textPart });
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    // Пустая строка — просто разделитель абзацев.
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Ограждённый блок кода.
    if (/^```/.test(line.trim())) {
      const codeLines = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // закрывающий ```
      blocks.push({ type: 'code', lines: codeLines });
      continue;
    }

    // Заголовок.
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const textClean = heading[2].trim();
      if (level === 1 && !title) {
        title = textClean;
      } else {
        blocks.push({ type: 'heading', level, text: textClean });
      }
      i++;
      continue;
    }

    // Таблица: строка с |, за которой следует строка-разделитель.
    if (line.trim().startsWith('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const rows = [splitTableRow(line)];
      i += 2; // шапка + разделитель
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      blocks.push({ type: 'table', rows });
      continue;
    }

    // Картинка (в DOCX не встраиваем — пути относятся к сайту).
    if (/^!\[[^\]]*\]\([^)]+\)\s*$/.test(line.trim())) {
      i++;
      continue;
    }

    // Горизонтальная черта.
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      i++;
      continue;
    }

    // Маркированный список.
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      blocks.push({ type: 'bullet', text: bullet[1].trim() });
      i++;
      continue;
    }

    // Нумерованный список (номер сохраняем в тексте).
    const olist = /^(\d+)[.)]\s+(.*)$/.exec(line);
    if (olist) {
      blocks.push({ type: 'olist', text: `${olist[1]}. ${olist[2].trim()}` });
      i++;
      continue;
    }

    // Цитата.
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      blocks.push({ type: 'quote', text: quote[1].trim() });
      i++;
      continue;
    }

    // Цельная строка-подпись: _текст курсивом_
    const caption = /^_(.+)_\s*$/.exec(line.trim());
    if (caption) {
      blocks.push({ type: 'caption', text: caption[1].trim() });
      i++;
      continue;
    }

    // Обычный текст: строки-продолжения доклеиваются к предыдущему блоку.
    appendToLast(line.trim());
    i++;
  }

  return { title, blocks };
}

// ---------------------------------------------------------------------------
// Рендер DOCX
// ---------------------------------------------------------------------------

/** Разбор строчной разметки: [link](url), **bold**, `code`, *italic*, <https://…>. */
function inlineRuns(docx, text, base = {}) {
  const runs = [];
  const regex =
    /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+?)\*\*|`([^`]+?)`|\*([^*\n]+?)\*|<((?:https?):\/\/[^>]+)>/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      runs.push(new docx.TextRun({ ...base, text: text.slice(lastIndex, match.index) }));
    }
    if (match[1]) {
      const [, label, url] = match;
      if (/^https?:\/\//.test(url)) {
        runs.push(
          new docx.ExternalHyperlink({
            link: url,
            children: [new docx.TextRun({ text: label, style: 'Hyperlink' })],
          }),
        );
      } else {
        runs.push(new docx.TextRun({ ...base, text: label }));
      }
    } else if (match[3]) {
      runs.push(new docx.TextRun({ ...base, text: match[3], bold: true }));
    } else if (match[4]) {
      runs.push(new docx.TextRun({ ...base, text: match[4], font: 'Courier New', size: 22 }));
    } else if (match[5]) {
      runs.push(new docx.TextRun({ ...base, text: match[5], italics: true }));
    } else if (match[6]) {
      runs.push(
        new docx.ExternalHyperlink({
          link: match[6],
          children: [new docx.TextRun({ text: match[6], style: 'Hyperlink' })],
        }),
      );
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    runs.push(new docx.TextRun({ ...base, text: text.slice(lastIndex) }));
  }
  return runs.length > 0 ? runs : [new docx.TextRun({ ...base, text })];
}

/** Убрать строчную разметку из текста заголовка. */
const plainHeading = (text) => text.replace(/[`*]/g, '').replace(/\s+/g, ' ').trim();

/** Преобразовать блоки markdown в детей DOCX-документа. Собирает оглавление (уровень 2). */
function renderBlocks(docx, blocks, { headingOffset = 0 } = {}) {
  const children = [];
  const toc = [];

  const spacer = () => children.push(new docx.Paragraph({ spacing: { after: 120 }, children: [] }));

  for (const block of blocks) {
    switch (block.type) {
      case 'heading': {
        const level = Math.min(6, block.level + headingOffset);
        const text = plainHeading(block.text);
        if (level === 2) {
          toc.push(text);
          children.push(
            new docx.Paragraph({
              heading: docx.HeadingLevel.HEADING_2,
              pageBreakBefore: true,
              children: [new docx.TextRun(text)],
            }),
          );
        } else if (level === 3) {
          children.push(
            new docx.Paragraph({
              heading: docx.HeadingLevel.HEADING_3,
              children: [new docx.TextRun(text)],
            }),
          );
        } else if (level >= 4) {
          // Глубже третьего уровня — жирный абзац (в оглавление не попадает).
          children.push(
            new docx.Paragraph({
              spacing: { before: 200, after: 100 },
              children: [new docx.TextRun({ text, bold: true })],
            }),
          );
        }
        break;
      }
      case 'bullet':
        children.push(
          new docx.Paragraph({ children: inlineRuns(docx, block.text), bullet: { level: 0 } }),
        );
        break;
      case 'olist':
        children.push(
          new docx.Paragraph({
            children: inlineRuns(docx, block.text),
            indent: { left: 720, hanging: 360 },
          }),
        );
        break;
      case 'quote':
        children.push(
          new docx.Paragraph({
            children: inlineRuns(docx, block.text, { italics: true }),
            indent: { left: 480 },
            spacing: { after: 120 },
          }),
        );
        break;
      case 'caption':
        children.push(
          new docx.Paragraph({
            alignment: docx.AlignmentType.CENTER,
            children: [
              new docx.TextRun({ text: block.text, italics: true, size: 20, color: '64748B' }),
            ],
            spacing: { after: 120 },
          }),
        );
        break;
      case 'code':
        for (const codeLine of block.lines) {
          children.push(
            new docx.Paragraph({
              shading: { fill: 'F4F4F5', type: 'clear' },
              spacing: { after: 0 },
              indent: { left: 240 },
              children: [
                new docx.TextRun({
                  text: codeLine.length ? codeLine : ' ',
                  font: 'Courier New',
                  size: 20,
                }),
              ],
            }),
          );
        }
        spacer();
        break;
      case 'table': {
        const [header, ...rows] = block.rows;
        const cell = (content, isHeader) =>
          new docx.TableCell({
            children: [
              new docx.Paragraph({
                children: inlineRuns(docx, content, isHeader ? { bold: true } : {}),
                spacing: { after: 0, line: 240 },
              }),
            ],
            shading: isHeader ? { fill: 'EEF2F7', type: 'clear' } : undefined,
          });
        children.push(
          new docx.Table({
            width: { size: 100, type: docx.WidthType.PERCENTAGE },
            borders: {
              top: { style: docx.BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
              bottom: { style: docx.BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
              left: { style: docx.BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
              right: { style: docx.BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
              insideHorizontal: { style: docx.BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
              insideVertical: { style: docx.BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
            },
            rows: [
              new docx.TableRow({ tableHeader: true, children: header.map((c) => cell(c, true)) }),
              ...rows.map((r) => new docx.TableRow({ children: r.map((c) => cell(c, false)) })),
            ],
          }),
        );
        spacer();
        break;
      }
      default:
        children.push(
          new docx.Paragraph({
            alignment: docx.AlignmentType.JUSTIFIED,
            children: inlineRuns(docx, block.text),
          }),
        );
    }
  }
  return { children, toc };
}

/** Приложения из docs/help/<lang>/*.md, упорядоченные по front-matter `order`. */
function loadAppendix(loc) {
  if (!fs.existsSync(loc.helpDir)) return [];
  const { letters } = loc;
  const files = fs
    .readdirSync(loc.helpDir)
    .filter((f) => f.endsWith('.md'))
    .map((file) => {
      const raw = fs.readFileSync(path.join(loc.helpDir, file), 'utf8');
      const { meta, body } = stripFrontMatter(raw);
      const firstH1 = /^#\s+(.+)$/m.exec(body)?.[1];
      return {
        file,
        order: Number(meta.order) || 999,
        title: meta.title || firstH1 || file.replace(/\.md$/, ''),
        summary: meta.summary || '',
        raw,
      };
    })
    .sort((a, b) => a.order - b.order || a.file.localeCompare(b.file));

  return files.map((f, idx) => ({
    ...f,
    label: `${loc.appendix} ${letters[idx] ?? idx + 1}. ${f.title}`,
  }));
}

async function buildDocx(docx, loc) {
  const guide = parseMarkdown(fs.readFileSync(loc.guideMd, 'utf8'));
  const appendix = loadAppendix(loc);

  const { children: bodyChildren, toc: guideToc } = renderBlocks(docx, guide.blocks);
  const tocEntries = [...guideToc];
  const appendixChildren = [];
  for (const app of appendix) {
    const { blocks } = parseMarkdown(app.raw);
    tocEntries.push(app.label);
    appendixChildren.push(
      new docx.Paragraph({
        heading: docx.HeadingLevel.HEADING_2,
        pageBreakBefore: true,
        children: [new docx.TextRun(app.label)],
      }),
    );
    if (app.summary) {
      appendixChildren.push(
        new docx.Paragraph({
          children: [new docx.TextRun({ text: app.summary, italics: true, color: '475569' })],
          spacing: { after: 160 },
        }),
      );
    }
    // Заголовок 1 уровня статьи уже отражён в названии приложения.
    const filtered = blocks.filter((b) => !(b.type === 'heading' && b.level === 1));
    const { children: rendered } = renderBlocks(docx, filtered, { headingOffset: 1 });
    appendixChildren.push(...rendered);
  }

  // ---- Титульная страница (вертикальные отступы — через spacing.before, как в builder.ts) ----
  const centered = (text, size, bold = false, before = 0) =>
    new docx.Paragraph({
      alignment: docx.AlignmentType.CENTER,
      spacing: before ? { before } : undefined,
      children: [new docx.TextRun({ text, size, bold })],
    });

  const titlePage = [
    centered('ProductCamp Conversion Analytics', 26, true, 1440),
    centered(loc.subtitle, 24, false, 160),
    centered(loc.docTitle, 40, true, 2600),
    centered(`${loc.version} ${VERSION}`, 26, false, 400),
    centered(loc.date, 24, false, 160),
    centered('dashboardcamp.ru', 22, false, 3600),
  ];

  // ---- Оглавление: простой список разделов (уровень 2) ----
  const tocPage = [
    new docx.Paragraph({
      heading: docx.HeadingLevel.HEADING_1,
      alignment: docx.AlignmentType.CENTER,
      pageBreakBefore: true,
      children: [new docx.TextRun(loc.contents)],
    }),
    ...tocEntries.map(
      (entry) =>
        new docx.Paragraph({
          spacing: { after: 40 },
          children: [new docx.TextRun(entry)],
        }),
    ),
  ];

  const doc = new docx.Document({
    creator: 'ProductCamp Analytics',
    title: `${loc.docTitle} — ProductCamp Conversion Analytics v${VERSION}`,
    description: `Собрано скриптом scripts/build-guides.mjs из ${loc.sources}`,
    styles: {
      default: {
        document: {
          run: { font: 'Times New Roman', size: 24 },
          paragraph: { spacing: { line: 300 } },
        },
      },
      paragraphStyles: [
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 32, bold: true, color: '0F172A', font: 'Times New Roman' },
          paragraph: { spacing: { before: 240, after: 200 } },
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 28, bold: true, color: '1E3A8A', font: 'Times New Roman' },
          paragraph: { spacing: { before: 320, after: 160 }, keepNext: true },
        },
        {
          id: 'Heading3',
          name: 'Heading 3',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 26, bold: true, color: '334155', font: 'Times New Roman' },
          paragraph: { spacing: { before: 240, after: 120 }, keepNext: true },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 }, // A4
            margin: {
              top: 1134, // 2 см
              bottom: 1134,
              left: 1701, // 3 см
              right: 850, // 1.5 см
            },
          },
        },
        footers: {
          default: new docx.Footer({
            children: [
              new docx.Paragraph({
                alignment: docx.AlignmentType.CENTER,
                children: [
                  new docx.TextRun({
                    children: [docx.PageNumber.CURRENT],
                    size: 20,
                    color: '64748B',
                  }),
                ],
              }),
            ],
          }),
        },
        children: [...titlePage, ...tocPage, ...bodyChildren, ...appendixChildren],
      },
    ],
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const buffer = await docx.Packer.toBuffer(doc);
  fs.writeFileSync(loc.docxOut, buffer);
  return { tocCount: tocEntries.length };
}

// ---------------------------------------------------------------------------
// PDF через pandoc (xelatex/lualatex — для кириллицы pdflatex не годится)
// ---------------------------------------------------------------------------

function commandPath(cmd) {
  const res = spawnSync('which', [cmd], { encoding: 'utf8' });
  return res.status === 0 ? res.stdout.trim() : null;
}

/** Убрать эмодзи и иные символы вне Times New Roman — иначе xelatex оставит пустые боксы. */
function stripEmoji(text) {
  return text
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/gu, '')
    .replace(/\u{FE0E}|\u{FE0F}|\u{200D}/gu, '');
}

function buildPdf(loc) {
  const pandoc = commandPath('pandoc');
  if (!pandoc) {
    return { ok: false, reason: 'pandoc не найден (установите: brew install pandoc)' };
  }
  const engine = ['xelatex', 'lualatex'].map(commandPath).find(Boolean);
  if (!engine) {
    return {
      ok: false,
      reason: 'pandoc есть, но нет LaTeX-движка (нужен xelatex: brew install --cask mactex-no-gui)',
    };
  }

  const { body } = stripFrontMatter(fs.readFileSync(loc.guideMd, 'utf8'));
  // Титул даёт метаданные pandoc; строку выбора языка убираем; уровни секций поднимаем
  // (## → #), чтобы оглавление PDF имело ровную иерархию «раздел → подраздел».
  const guideBody = stripEmoji(
    body
      .replace(/^#[^\n]*\n/, '')
      .replace(loc.langSwitch, '')
      .replace(/^####\s/gm, '##### ')
      .replace(/^###\s/gm, '## ')
      .replace(/^##\s/gm, '# '),
  );
  // Приложения: свой заголовок секции, front matter вычищен вручную (yaml_metadata_block выключен).
  const combined = [
    guideBody,
    ...loadAppendix(loc).map((app) => {
      const { body: appBody } = stripFrontMatter(app.raw);
      return stripEmoji(`# ${app.label}\n\n${appBody.replace(/^#[^\n]*\n/, '')}`);
    }),
  ].join('\n\n');

  const tmpMd = path.join(os.tmpdir(), `user-guide-${loc.lang}-v3-${process.pid}.md`);
  fs.writeFileSync(tmpMd, combined);

  const args = [
    tmpMd,
    '-o',
    loc.pdfOut,
    // yaml_metadata_block выключен: строки-разделители «---» в исходниках не должны
    // считаться YAML-блоками; front matter приложений вычищен на предыдущем шаге.
    '--from',
    'markdown-yaml_metadata_block',
    `--pdf-engine=${engine}`,
    '--toc',
    '--toc-depth=2',
    '-V',
    'documentclass=article',
    '-V',
    'fontsize=12pt',
    '-V',
    'mainfont=Times New Roman',
    '-V',
    'geometry:a4paper',
    '-V',
    'geometry:margin=2.2cm',
    '-V',
    'colorlinks=true',
    '-V',
    `lang=${loc.lang}`,
    '--metadata',
    `title=${loc.docTitle} — ProductCamp Conversion Analytics`,
    '--metadata',
    `subtitle=${loc.version} ${VERSION} · ${loc.date}`,
  ];
  const res = spawnSync(pandoc, args, { encoding: 'utf8', timeout: 240_000 });
  fs.rmSync(tmpMd, { force: true });
  if (res.status !== 0 || !fs.existsSync(loc.pdfOut)) {
    const detail = (res.stderr || res.error?.message || 'неизвестная ошибка').slice(-800);
    return { ok: false, reason: `pandoc завершился с ошибкой: ${detail}` };
  }
  return { ok: true, engine };
}

// ---------------------------------------------------------------------------

/** Языки из аргумента `--lang ru|en|all` (по умолчанию — все). */
function parseLangs(argv) {
  const idx = argv.indexOf('--lang');
  const value =
    idx >= 0 ? argv[idx + 1] : (argv.find((a) => a.startsWith('--lang='))?.slice(7) ?? 'all');
  if (!value || value === 'all') return Object.keys(LOCALES);
  const langs = value.split(',').map((l) => l.trim());
  const unknown = langs.filter((l) => !LOCALES[l]);
  if (unknown.length)
    throw new Error(`Неизвестный язык: ${unknown.join(', ')} (доступно: ru, en, all)`);
  return langs;
}

async function buildLocale(docx, loc) {
  console.log(`\n[${loc.lang}] Сборка руководства: версия ${VERSION}, дата ${loc.date}`);
  if (!fs.existsSync(loc.guideMd))
    throw new Error(`нет исходника ${path.relative(ROOT, loc.guideMd)}`);

  const { tocCount } = await buildDocx(docx, loc);
  const docxSize = fs.statSync(loc.docxOut).size;
  console.log(
    `DOCX: ${path.relative(ROOT, loc.docxOut)} (${(docxSize / 1024).toFixed(1)} КБ, разделов в оглавлении: ${tocCount})`,
  );

  const pdf = buildPdf(loc);
  if (pdf.ok) {
    const pdfSize = fs.statSync(loc.pdfOut).size;
    console.log(
      `PDF:  ${path.relative(ROOT, loc.pdfOut)} (${(pdfSize / 1024).toFixed(1)} КБ, движок: ${pdf.engine} через pandoc)`,
    );
  } else {
    console.warn(`PDF пропущен: ${pdf.reason}`);
    console.warn('Подробности — в docs/guides/README.md');
  }
}

async function main() {
  const langs = parseLangs(process.argv.slice(2));
  const docx = loadDocx();
  for (const lang of langs) await buildLocale(docx, LOCALES[lang]);
}

main().catch((err) => {
  console.error(`Ошибка сборки: ${err.message}`);
  process.exit(1);
});
