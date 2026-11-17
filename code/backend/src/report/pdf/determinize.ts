/**
 * ANA-195: deterministic PDF re-export — один snapshotId → байт-идентичный файл.
 *
 * Headless Chrome (puppeteer `page.pdf`) stamps `/CreationDate` and `/ModDate` in the
 * trailer Info dictionary from the render wall-clock, so exporting the same immutable
 * snapshot twice produced two files differing in exactly those bytes. This module rewrites
 * both dates to the snapshot's own `generatedAt` (UTC, `D:YYYYMMDDHHmmSS+00'00'`) — the
 * document «was created» when the snapshot was built, not when someone clicked export
 * (same reasoning as the DOCX determinize, ANA-188).
 *
 * The rewrite is byte-length-preserving: the replacement value is truncated (or
 * space-padded) to the exact length of the matched date value, so every xref offset in the
 * file stays valid without reparsing the PDF structure. PDF date strings allow truncated
 * forms and literal-string spaces, so both directions stay valid PDF. Pure with respect to
 * the wall clock: the same (buffer, date) always yields the same bytes.
 */

/** Match `/CreationDate (D:…)` / `/ModDate (D:…)` Info-dictionary entries (value in group 3). */
const INFO_DATE = /\/(CreationDate|ModDate)(\s*)\((D:[^)]*)\)/g;

/** Format a Date as a full PDF date string in UTC, e.g. `D:20260528100000+00'00'`. */
function pdfDateUtc(seed: Date): string {
  const pad2 = (n: number) => String(n).padStart(2, '0');
  return (
    `D:${seed.getUTCFullYear()}` +
    `${pad2(seed.getUTCMonth() + 1)}${pad2(seed.getUTCDate())}` +
    `${pad2(seed.getUTCHours())}${pad2(seed.getUTCMinutes())}${pad2(seed.getUTCSeconds())}` +
    `+00'00'`
  );
}

/**
 * Rewrite a Chrome-produced PDF buffer so both Info-dictionary dates derive from `seed`
 * (the snapshot's generatedAt — see the file JSDoc). All other bytes pass through
 * untouched: latin1 is a lossless 1:1 byte↔char mapping, so binary streams survive, and
 * the replacement never changes the entry length.
 */
export function determinizePdf(buffer: Buffer, seed: Date): Buffer {
  const canonical = pdfDateUtc(seed);
  const text = buffer
    .toString('latin1')
    .replace(INFO_DATE, (_entry: string, key: string, space: string, value: string) => {
      // Same key + whitespace + parens, and a value of exactly the original length —
      // so the total byte length (and thus every xref offset) is preserved.
      const rewritten =
        canonical.length >= value.length
          ? canonical.slice(0, value.length)
          : canonical + ' '.repeat(value.length - canonical.length);
      return `/${key}${space}(${rewritten})`;
    });
  return Buffer.from(text, 'latin1');
}
