#!/usr/bin/env node
// merge-gates.mjs — быстрые проверки перед/после слияния веток агентов (Phase M, PLAN-RELEASE.md):
//   1. Паритет ключей ru/en в code/frontend/src/i18n/dict.ts + дубликаты ключей.
//   2. Синхронность tests/db/migrate.test.ts с фактическим списком миграций.
//   3. Файлы-конфликт-лист: остаточные маркеры слияния (<<<<<<<).
// Exit 1 — если есть блокирующие проблемы; --json для машинного вывода.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const json = process.argv.includes('--json');
const problems = [];
const warnings = [];

// --- 1. dict.ts: паритет и дубликаты ---
const dictPath = join(ROOT, 'code/frontend/src/i18n/dict.ts');
const dict = readFileSync(dictPath, 'utf8');
const keyRe = /'([a-zA-Z0-9_.-]+)':/g;
const byLocale = { ru: new Map(), en: new Map() };
// dict.ts exports two flat objects: `export const ru = { … }` and `export const en: Record<…> = { … }`.
let current = null;
for (const line of dict.split('\n')) {
  if (/^export const ru\b/.test(line)) current = 'ru';
  else if (/^export const en\b/.test(line)) current = 'en';
  else if (current) {
    let m;
    keyRe.lastIndex = 0;
    while ((m = keyRe.exec(line))) {
      const key = m[1];
      if (byLocale[current].has(key)) {
        problems.push(`dict.ts[${current}]: дубликат ключа '${key}'`);
      }
      byLocale[current].set(key, true);
    }
  }
}
const ruKeys = [...byLocale.ru.keys()];
const enKeys = [...byLocale.en.keys()];
const onlyRu = ruKeys.filter((k) => !byLocale.en.has(k));
const onlyEn = enKeys.filter((k) => !byLocale.ru.has(k));
for (const k of onlyRu) problems.push(`dict.ts: ключ '${k}' есть в ru, нет в en`);
for (const k of onlyEn) problems.push(`dict.ts: ключ '${k}' есть в en, нет в ru`);

// --- 2. Миграции vs migrate.test.ts ---
const migDir = join(ROOT, 'code/backend/src/db/migrations');
const migs = readdirSync(migDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();
const testPath = join(ROOT, 'code/backend/tests/db/migrate.test.ts');
let testSrc = '';
try {
  testSrc = readFileSync(testPath, 'utf8');
} catch {
  warnings.push('tests/db/migrate.test.ts не найден — проверка списка миграций пропущена');
}
if (testSrc) {
  for (const f of migs) {
    const num = f.slice(0, 3);
    if (!testSrc.includes(f) && !testSrc.includes(num)) {
      warnings.push(`migrate.test.ts не упоминает миграцию ${f} — сверить список`);
    }
  }
  const declared = [...testSrc.matchAll(/'(\d{3}_[a-z0-9_]+\.sql)'/g)].map((m) => m[1]);
  for (const d of declared) {
    if (!migs.includes(d)) problems.push(`migrate.test.ts ожидает ${d}, файла нет`);
  }
}

// --- 3. Маркеры незакрытых конфликтов ---
const { execSync } = await import('node:child_process');
const changed = execSync('git status --porcelain', { encoding: 'utf8', cwd: ROOT })
  .split('\n')
  .filter(Boolean)
  .map((l) => l.slice(3).trim().replace(/^"|"$/g, ''));
// Точные 7-символьные маркеры через repeat — чтобы не держать их литералом в этом же файле.
const CONFLICT = {
  open: '<'.repeat(7),
  close: '>'.repeat(7),
};
for (const f of changed) {
  if (f === 'scripts/merge-gates.mjs') continue; // сам скрипт упоминает маркеры в docstring
  if (!/\.(ts|tsx|mjs|js|json|md|yml|yaml|sql|sh)$/.test(f)) continue;
  let src = '';
  try {
    src = readFileSync(join(ROOT, f), 'utf8');
  } catch {
    continue;
  }
  if (src.includes(CONFLICT.open) || src.includes(CONFLICT.close)) {
    problems.push(`в ${f} остались маркеры конфликта`);
  }
}

const report = {
  problems,
  warnings,
  ruKeys: ruKeys.length,
  enKeys: enKeys.length,
  migrations: migs.length,
};
if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(
    `dict.ts: ru=${ruKeys.length}, en=${enKeys.length}, паритет=${onlyRu.length + onlyEn.length === 0 ? 'OK' : 'НАРУШЕН'}`,
  );
  console.log(
    `миграций: ${migs.length} (014+ ждут синхронизации migrate.test.ts при необходимости)`,
  );
  for (const w of warnings) console.log(`WARN: ${w}`);
  for (const p of problems) console.log(`FAIL: ${p}`);
  console.log(problems.length ? `ИТОГ: ${problems.length} блокирующих` : 'ИТОГ: OK');
}
process.exit(problems.length ? 1 : 0);
