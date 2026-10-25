#!/usr/bin/env node
/**
 * Верификатор ГОСТ-оформления отчёта (DOCX).
 *
 * Использование:
 *   node scripts/verify-report-gost.mjs <путь-к-docx>
 *
 * Что проверяется (эталон):
 *   - поля страницы: top=1134, right=850, bottom=1134, left=1701 twips;
 *   - формат A4: 11906×16838 twips (книжная ориентация);
 *   - Times New Roman в docDefaults (word/styles.xml);
 *   - базовый кегль sz=28 (14 pt);
 *   - межстрочный интервал w:line="360" (1,5 строки);
 *   - заголовки без синего цвета 2E74B5 (дефолт Word);
 *   - PAGE-поле в нижнем колонтитуле (номер страницы);
 *   - наличие границ таблиц (w:tblBorders);
 *   - наличие подписей рисунков («Рисунок N — …»);
 *   - обязательные разделы: СОДЕРЖАНИЕ/Содержание, ПЕРЕЧЕНЬ РИСУНКОВ
 *     (только если в документе есть рисунки), УПРАВЛЕНЧЕСКОЕ РЕЗЮМЕ,
 *     ВВЕДЕНИЕ, ОБОЗНАЧЕНИЯ.
 *
 * Итог: VERDICT: PASS | PASS-WITH-WARNINGS | FAIL.
 * Коды выхода: 0 — PASS или PASS-WITH-WARNINGS, 1 — FAIL или ошибка выполнения.
 *
 * Внешние зависимости: нет (только node:fs, node:os, node:path,
 * node:child_process и системный unzip). DOCX распаковывается во
 * временную папку, разбор ведётся регэкспами по XML.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ETALON = Object.freeze({
  pageSize: Object.freeze({ w: '11906', h: '16838' }),
  margins: Object.freeze({ top: '1134', right: '850', bottom: '1134', left: '1701' }),
  sz: '28',
  line: '360',
  blue: '2E74B5',
});

const PASS = 'PASS';
const WARN = 'WARN';
const FAIL = 'FAIL';

function die(message) {
  console.error(`ОШИБКА: ${message}`);
  process.exit(1);
}

// ── Вспомогательные функции ─────────────────────────────────────────────────

/** Значение атрибута из фрагмента XML (порядок атрибутов не важен). */
function attr(fragment, name) {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`);
  const m = fragment.match(re);
  return m ? m[1] : null;
}

const show = (v) => (v === null ? '—' : v);

/** Разворачивание XML-сущностей. */
function xmlDecode(text) {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Видимый текст документа: конец абзаца → \n, теги выбрасываются. */
function extractText(xml) {
  return xmlDecode(
    xml
      .replace(/<w:tab\b[^>]*\/?>/g, '\t')
      .replace(/<w:br\b[^>]*\/?>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]+>/g, ''),
  );
}

/** Список непустых абзацев документа. */
function extractParagraphs(xml) {
  return extractText(xml)
    .split('\n')
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/**
 * Поиск заголовка без учёта регистра; устойчив к разбиению текста
 * на несколько run'ов (пробелы игнорируются при сравнении).
 */
function findHeading(paragraphs, needle) {
  const target = needle.toUpperCase();
  const flat = needle.replace(/\s+/g, '').toUpperCase();
  return paragraphs.some((p) => {
    const up = p.toUpperCase();
    return up.includes(target) || up.replace(/\s+/g, '').includes(flat);
  });
}

function countMatches(text, re) {
  return (text.match(re) || []).length;
}

/** Есть ли в колонтитуле поле PAGE (fldSimple или instrText). */
function hasPageField(footerXml) {
  const instr = [...footerXml.matchAll(/<w:instrText[^>]*>([\s\S]*?)<\/w:instrText>/g)]
    .map((m) => m[1])
    .join(' ');
  const fldSimple = [...footerXml.matchAll(/<w:fldSimple\b[^>]*>/g)]
    .map((m) => attr(m[0], 'w:instr') ?? '')
    .join(' ');
  return /\bPAGE\b/.test(`${instr} ${fldSimple}`);
}

// ── Основная логика ─────────────────────────────────────────────────────────

function main() {
  const target = process.argv[2];
  if (!target) {
    console.error('Использование: node scripts/verify-report-gost.mjs <путь-к-docx>');
    process.exit(1);
  }
  if (!existsSync(target) || !statSync(target).isFile()) {
    die(`файл не найден: ${target}`);
  }

  const tmp = mkdtempSync(join(tmpdir(), 'gost-verify-'));
  let docXml;
  let stylesXml;
  let footerFiles;
  try {
    try {
      execFileSync('unzip', ['-o', '-q', target, '-d', tmp], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
    } catch (err) {
      const detail = err.stderr ? err.stderr.toString().trim() : err.message;
      die(`не удалось распаковать DOCX (${target}): ${detail}`);
    }

    const docPath = join(tmp, 'word', 'document.xml');
    const stylesPath = join(tmp, 'word', 'styles.xml');
    if (!existsSync(docPath)) die('в DOCX нет word/document.xml — это не похоже на документ Word');
    if (!existsSync(stylesPath)) die('в DOCX нет word/styles.xml');

    docXml = readFileSync(docPath, 'utf8');
    stylesXml = readFileSync(stylesPath, 'utf8');
    footerFiles = existsSync(join(tmp, 'word'))
      ? readdirSync(join(tmp, 'word'))
          .filter((f) => /^footer\d*\.xml$/i.test(f))
          .sort()
          .map((f) => ({ name: `word/${f}`, xml: readFileSync(join(tmp, 'word', f), 'utf8') }))
      : [];
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  const paragraphs = extractParagraphs(docXml);
  const flatText = paragraphs.join('\n');
  const hasFigures = /<w:drawing\b|<w:pict\b|<v:imagedata\b/.test(docXml);
  const captionCount = countMatches(flatText, /Рисунок\s*\d+/g);

  const results = [];
  const add = (name, status, details) => results.push({ name, status, details });

  // 1. Поля страницы
  {
    const pgMars = [...docXml.matchAll(/<w:pgMar\b[^>]*>/g)].map((m) => m[0]);
    if (pgMars.length === 0) {
      add('Поля страницы (twips)', FAIL, 'элемент w:pgMar не найден в document.xml');
    } else {
      const bad = [];
      pgMars.forEach((frag, i) => {
        const got = {
          top: attr(frag, 'w:top'),
          right: attr(frag, 'w:right'),
          bottom: attr(frag, 'w:bottom'),
          left: attr(frag, 'w:left'),
        };
        const ok =
          got.top === ETALON.margins.top &&
          got.right === ETALON.margins.right &&
          got.bottom === ETALON.margins.bottom &&
          got.left === ETALON.margins.left;
        if (!ok) {
          bad.push(
            `секция ${i + 1}: top=${show(got.top)} right=${show(got.right)} bottom=${show(got.bottom)} left=${show(got.left)}`,
          );
        }
      });
      if (bad.length === 0) {
        add(
          'Поля страницы (twips)',
          PASS,
          `top=${ETALON.margins.top} right=${ETALON.margins.right} bottom=${ETALON.margins.bottom} left=${ETALON.margins.left} — совпадает с эталоном`,
        );
      } else {
        add(
          'Поля страницы (twips)',
          FAIL,
          `ожидалось top=${ETALON.margins.top} right=${ETALON.margins.right} bottom=${ETALON.margins.bottom} left=${ETALON.margins.left}; найдено: ${bad.join('; ')}`,
        );
      }
    }
  }

  // 2. Формат страницы A4
  {
    const pgSzList = [...docXml.matchAll(/<w:pgSz\b[^>]*>/g)].map((m) => m[0]);
    if (pgSzList.length === 0) {
      add('Формат страницы A4 (twips)', FAIL, 'элемент w:pgSz не найден в document.xml');
    } else {
      const bad = [];
      pgSzList.forEach((frag, i) => {
        const w = attr(frag, 'w:w');
        const h = attr(frag, 'w:h');
        if (w !== ETALON.pageSize.w || h !== ETALON.pageSize.h) {
          bad.push(`секция ${i + 1}: w=${show(w)} h=${show(h)}`);
        }
      });
      if (bad.length === 0) {
        add(
          'Формат страницы A4 (twips)',
          PASS,
          `${ETALON.pageSize.w}×${ETALON.pageSize.h} (A4, книжная ориентация)`,
        );
      } else {
        add(
          'Формат страницы A4 (twips)',
          FAIL,
          `ожидалось w=${ETALON.pageSize.w} h=${ETALON.pageSize.h}; найдено: ${bad.join('; ')}`,
        );
      }
    }
  }

  // 3–5. docDefaults: шрифт, кегль, межстрочный интервал
  const docDefaults = stylesXml.match(/<w:docDefaults[^>]*>([\s\S]*?)<\/w:docDefaults>/)?.[1] ?? '';

  {
    const tnr = /w:(?:ascii|hAnsi|cs)="Times New Roman"/;
    if (tnr.test(docDefaults)) {
      add('Шрифт Times New Roman в docDefaults', PASS, 'Times New Roman задан в docDefaults');
    } else if (tnr.test(stylesXml)) {
      add(
        'Шрифт Times New Roman в docDefaults',
        WARN,
        'Times New Roman есть в стилях, но не в docDefaults',
      );
    } else {
      add('Шрифт Times New Roman в docDefaults', FAIL, 'шрифт Times New Roman не найден');
    }
  }

  {
    const szRe = new RegExp(`<w:sz[\\s>][^>]*w:val="${ETALON.sz}"`);
    if (szRe.test(docDefaults)) {
      add('Базовый кегль sz=28 (14 pt)', PASS, `sz=${ETALON.sz} (14 pt) задан в docDefaults`);
    } else if (szRe.test(stylesXml)) {
      add(
        'Базовый кегль sz=28 (14 pt)',
        WARN,
        `sz=${ETALON.sz} есть в стилях, но не в docDefaults`,
      );
    } else {
      add('Базовый кегль sz=28 (14 pt)', FAIL, `базовый кегль sz=${ETALON.sz} (14 pt) не найден`);
    }
  }

  {
    const lineRe = new RegExp(`<w:spacing\\b[^>]*w:line="${ETALON.line}"`);
    if (lineRe.test(docDefaults)) {
      add(
        'Межстрочный интервал line=360 (1,5)',
        PASS,
        `line=${ETALON.line} (1,5 строки) задан в docDefaults`,
      );
    } else if (lineRe.test(stylesXml)) {
      add(
        'Межстрочный интервал line=360 (1,5)',
        WARN,
        `line=${ETALON.line} есть в стилях, но не в docDefaults`,
      );
    } else {
      add(
        'Межстрочный интервал line=360 (1,5)',
        FAIL,
        `интервал line=${ETALON.line} (1,5 строки) не найден`,
      );
    }
  }

  // 6. Синий цвет заголовков 2E74B5 (дефолт Word)
  {
    const blueRe = new RegExp(ETALON.blue, 'gi');
    const inStyles = countMatches(stylesXml, blueRe);
    const inDoc = countMatches(docXml, blueRe);
    if (inStyles === 0 && inDoc === 0) {
      add('Заголовки без синего цвета 2E74B5', PASS, 'цвет 2E74B5 не используется');
    } else {
      add(
        'Заголовки без синего цвета 2E74B5',
        FAIL,
        `найден синий ${ETALON.blue}: styles.xml — ${inStyles}, document.xml — ${inDoc} (перекрасить в чёрный)`,
      );
    }
  }

  // 7. PAGE-поле в нижнем колонтитуле
  {
    if (footerFiles.length === 0) {
      add(
        'PAGE-поле в нижнем колонтитуле',
        FAIL,
        'файлы нижних колонтитулов (word/footer*.xml) не найдены',
      );
    } else {
      const withPage = footerFiles.filter((f) => hasPageField(f.xml));
      if (withPage.length === 0) {
        add(
          'PAGE-поле в нижнем колонтитуле',
          FAIL,
          `PAGE-поле не найдено в: ${footerFiles.map((f) => f.name).join(', ')}`,
        );
      } else {
        add(
          'PAGE-поле в нижнем колонтитуле',
          PASS,
          `PAGE-поле найдено: ${withPage.map((f) => f.name).join(', ')}`,
        );
      }
    }
  }

  // 8. Границы таблиц
  {
    const hasTbl = /<w:tbl\b/.test(docXml);
    const inStyles = /<w:tblBorders\b/.test(stylesXml);
    const inDoc = /<w:tblBorders\b/.test(docXml);
    if (inStyles || inDoc) {
      add(
        'Границы таблиц (tblBorders)',
        PASS,
        `w:tblBorders найден (${[inStyles && 'styles.xml', inDoc && 'document.xml'].filter(Boolean).join(', ')})`,
      );
    } else if (!hasTbl) {
      add('Границы таблиц (tblBorders)', WARN, 'таблиц в документе нет — границы не проверяются');
    } else {
      add(
        'Границы таблиц (tblBorders)',
        FAIL,
        'в документе есть таблицы, но w:tblBorders не найден',
      );
    }
  }

  // 9. Подписи рисунков
  {
    if (captionCount > 0) {
      add('Подписи рисунков («Рисунок N»)', PASS, `подписей найдено: ${captionCount}`);
    } else if (hasFigures) {
      add(
        'Подписи рисунков («Рисунок N»)',
        FAIL,
        'в документе есть рисунки, но подписей «Рисунок N» не найдено',
      );
    } else {
      add('Подписи рисунков («Рисунок N»)', WARN, 'рисунков и подписей «Рисунок» в документе нет');
    }
  }

  // 10–14. Обязательные разделы
  {
    const figuresExist = hasFigures || captionCount > 0;
    const sectionChecks = [
      { label: 'Раздел «СОДЕРЖАНИЕ»', needle: 'СОДЕРЖАНИЕ', required: true, skipMsg: '' },
      {
        label: 'Раздел «ПЕРЕЧЕНЬ РИСУНКОВ»',
        needle: 'ПЕРЕЧЕНЬ РИСУНКОВ',
        required: figuresExist,
        skipMsg: 'рисунков в документе нет — раздел не обязателен',
      },
      {
        label: 'Раздел «УПРАВЛЕНЧЕСКОЕ РЕЗЮМЕ»',
        needle: 'УПРАВЛЕНЧЕСКОЕ РЕЗЮМЕ',
        required: true,
        skipMsg: '',
      },
      { label: 'Раздел «ВВЕДЕНИЕ»', needle: 'ВВЕДЕНИЕ', required: true, skipMsg: '' },
      { label: 'Раздел «ОБОЗНАЧЕНИЯ»', needle: 'ОБОЗНАЧЕНИЯ', required: true, skipMsg: '' },
    ];
    for (const s of sectionChecks) {
      if (findHeading(paragraphs, s.needle)) {
        add(s.label, PASS, 'раздел найден');
      } else if (!s.required) {
        add(s.label, WARN, s.skipMsg);
      } else {
        add(s.label, FAIL, 'раздел не найден');
      }
    }
  }

  // ── Итоговая таблица ──────────────────────────────────────────────────────
  const nameW = Math.max(...results.map((r) => r.name.length), 'Проверка'.length);
  const statusW = 6;
  const idxW = 3;
  const header = `${'№'.padStart(idxW)}  ${'Проверка'.padEnd(nameW)}  ${'Статус'.padEnd(statusW)}Комментарий`;
  const rule = '─'.repeat(header.length + 10);

  console.log(`Проверка ГОСТ-оформления: ${target}`);
  console.log('');
  console.log(header);
  console.log(rule);
  for (const [i, r] of results.entries()) {
    console.log(
      `${String(i + 1).padStart(idxW)}  ${r.name.padEnd(nameW)}  ${r.status.padEnd(statusW)}${r.details ?? ''}`,
    );
  }
  console.log(rule);

  const pass = results.filter((r) => r.status === PASS).length;
  const warn = results.filter((r) => r.status === WARN).length;
  const fail = results.filter((r) => r.status === FAIL).length;
  const verdict = fail > 0 ? FAIL : warn > 0 ? 'PASS-WITH-WARNINGS' : PASS;

  console.log(`\nИтого: PASS=${pass}, WARN=${warn}, FAIL=${fail}`);
  console.log(`VERDICT: ${verdict}`);
  process.exit(verdict === FAIL ? 1 : 0);
}

main();
