#!/usr/bin/env node
/**
 * i18n audit: (1) key parity ru/en in code/frontend/src/i18n/dict.ts, (2) hardcoded
 * Cyrillic in frontend sources outside dict.ts and tests.
 *
 * Exit code 1 when problems are found, 0 when clean. `--json` prints a JSON report.
 *
 * Lines containing an inline `// i18n: ignore` marker are skipped; the marker may also
 * stand on the line directly above (used for multi-line statements), and block ranges
 * between `// i18n: ignore-start` and `// i18n: ignore-end` are skipped entirely, as are files
 * listed in IGNORE_FILES (own data/CONTENT objects checked separately by other
 * workstreams, e.g. the public landing CONTENT in pages/public/Landing.tsx).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const FRONTEND = new URL('../code/frontend/src', import.meta.url).pathname;
const ROOT = new URL('..', import.meta.url).pathname;

// Files deliberately excluded from the hardcoded-Cyrillic scan:
// - i18n/dict.ts is the dictionary itself
// - pages/public/Landing.tsx + Landing.test.tsx own a dedicated ru/en CONTENT
//   object (issue ANA-71 extends it); tracked separately
const IGNORE_FILES = [
  'code/frontend/src/i18n/dict.ts',
  'code/frontend/src/pages/public/Landing.tsx',
  'code/frontend/src/pages/public/Landing.test.tsx',
];

const CYRILLIC = /[\u0400-\u04FF]/;
const DICT_KEY = /^[ \t]*'([^']+)':/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// ---- 1. key parity ---------------------------------------------------------
const dictPath = join(FRONTEND, 'i18n', 'dict.ts');
const dictSrc = readFileSync(dictPath, 'utf8');
const ruStart = dictSrc.indexOf('export const ru = {');
const enStart = dictSrc.indexOf('export const en');
const fileEnd = dictSrc.indexOf('export const CHANNELS');
if (ruStart < 0 || enStart < 0) throw new Error('dict.ts: cannot locate ru/en objects');
const ruKeys = new Set();
const enKeys = new Set();
const sections = [
  [ruKeys, dictSrc.slice(ruStart, enStart)],
  [enKeys, dictSrc.slice(enStart, fileEnd < 0 ? undefined : fileEnd)],
];
for (const [set, body] of sections) {
  for (const line of body.split('\n')) {
    const k = line.match(DICT_KEY);
    if (k) set.add(k[1]);
  }
}

const missingEn = [...ruKeys].filter((k) => !enKeys.has(k)).sort();
const missingRu = [...enKeys].filter((k) => !ruKeys.has(k)).sort();

// ---- 2. hardcoded Cyrillic -------------------------------------------------
const offenders = [];
const rel = (p) => p.slice(ROOT.length);
for (const file of walk(FRONTEND)) {
  if (!/\.(ts|tsx)$/.test(file)) continue;
  if (/\.(test|stories)\./.test(file)) continue;
  const r = rel(file);
  if (IGNORE_FILES.some((i) => r.endsWith(i.split('/').slice(-2).join('/')) && r === i)) continue;
  if (IGNORE_FILES.includes(r)) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  let inIgnoreBlock = false;
  lines.forEach((line, i) => {
    // Block range: everything between ignore-start and ignore-end (exclusive) is skipped.
    // The state machine runs on every line — marker lines hold no Cyrillic themselves.
    if (line.includes('i18n: ignore-start')) {
      inIgnoreBlock = true;
      return;
    }
    if (inIgnoreBlock) {
      if (line.includes('i18n: ignore-end')) inIgnoreBlock = false;
      return;
    }
    if (!CYRILLIC.test(line)) return;
    const code = line.trim();
    if (line.includes('i18n: ignore')) return;
    // A marker on the preceding line covers multi-line statements and attributes.
    if (i > 0 && lines[i - 1].includes('i18n: ignore')) return;
    if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
    // JSX comments never render — their text is not user-visible.
    if (code.startsWith('{/*')) return;
    offenders.push({ file: r, line: i + 1, text: line.trim().slice(0, 120) });
  });
}

const problems = [
  ...missingEn.map((k) => ({ type: 'missing-en', key: k })),
  ...missingRu.map((k) => ({ type: 'missing-ru', key: k })),
  ...offenders.map((o) => ({ type: 'hardcoded-cyrillic', ...o })),
];

const report = {
  ruKeys: ruKeys.size,
  enKeys: enKeys.size,
  missingEn,
  missingRu,
  hardcoded: offenders,
  ok: problems.length === 0,
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`dict.ts: ru=${ruKeys.size} keys, en=${enKeys.size} keys`);
  if (missingEn.length)
    console.log(`\nMissing EN (${missingEn.length}):\n  ${missingEn.join(', ')}`);
  if (missingRu.length)
    console.log(`\nMissing RU (${missingRu.length}):\n  ${missingRu.join(', ')}`);
  if (offenders.length) {
    console.log(`\nHardcoded Cyrillic (${offenders.length}):`);
    for (const o of offenders) console.log(`  ${o.file}:${o.line}: ${o.text}`);
  }
  console.log(problems.length ? `\nFAIL: ${problems.length} problem(s)` : '\nOK: i18n audit clean');
}

process.exitCode = problems.length ? 1 : 0;
