import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * §5 guardrail (report-gost-v2): the DOCX/PDF render path is deterministic — pure functions of the
 * snapshot, no wall-clock time and no network/LLM calls. Comments and string literals mention
 * «Date.now» in prose, so the scan strips strings and comments first and then asserts the absence
 * of actual call sites. Keeps the «анти-галлюцинация» wording in the report itself honest.
 */
const RENDER_SOURCES = [
  '../../../backend/src/report/docx/builder.ts',
  '../../../backend/src/report/docx/determinize.ts',
  '../../../backend/src/report/pdf/html.ts',
  '../../../shared/src/report-sections.ts',
  '../../../shared/src/report-period-label.ts',
];

const here = dirname(fileURLToPath(import.meta.url));

function stripCommentsAndStrings(src: string): string {
  return src
    .replace(/`(?:\\.|[^`\\])*`/gs, "''") // template literals
    .replace(/'(?:\\.|[^'\\])*'/g, "''") // single-quoted strings
    .replace(/"(?:\\.|[^"\\])*"/g, "''") // double-quoted strings
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/\/\/.*$/gm, ''); // line comments
}

describe('render path hygiene — deterministic, no clock, no network/LLM', () => {
  for (const rel of RENDER_SOURCES) {
    const file = resolve(here, rel);
    const name = rel.split('/').pop();
    it(`${name}: no Date.now / new Date / fetch / LLM call sites`, () => {
      const code = stripCommentsAndStrings(readFileSync(file, 'utf8'));
      expect(code).not.toMatch(/\bDate\.now\s*\(/);
      // Only the no-arg constructor is the wall clock; `new Date(isoString)` / `new Date(ms)`
      // are deterministic parsing/construction and are allowed.
      expect(code).not.toMatch(/\bnew\s+Date\s*\(\s*\)/);
      expect(code).not.toMatch(/\bfetch\s*\(/);
      expect(code).not.toMatch(/gigachat|openai|anthropic/i);
    });
  }
});
