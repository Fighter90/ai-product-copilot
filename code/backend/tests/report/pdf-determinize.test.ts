import { describe, it, expect } from 'vitest';
import { determinizePdf } from '../../src/report/pdf/determinize';
import { resolveDeterministicDate } from '../../src/report/docx/determinize';

/**
 * ANA-195: /CreationDate and /ModDate were stamped from the render wall-clock by headless
 * Chrome, so exporting the same snapshotId twice produced two files with different sha256
 * (the byte diff was exactly those two date strings). The fix stamps both from the
 * snapshot's own generatedAt — same reasoning as the DOCX determinize (ANA-188).
 *
 * These tests reproduce the regression without launching a browser: they synthesize
 * Chrome-like PDF bytes whose only difference is the wall-clock dates and assert the
 * determinizer makes them byte-identical.
 */

/** Chrome-like Info dictionary inside a minimal PDF body (binary-safe latin1 round trip). */
function chromeLikePdf(creationDate: string, modDate: string): Buffer {
  return Buffer.from(
    [
      '%PDF-1.4\n',
      '1 0 obj\n',
      `<< /Producer (Skia/PDF m126) /CreationDate (${creationDate}) /ModDate (${modDate}) >>\n`,
      'endobj\n',
      'trailer\n<< /Root 1 0 R /Size 2 >>\n',
      '%%EOF',
    ].join(''),
    'latin1',
  );
}

const SEED = resolveDeterministicDate('2026-05-28T10:00:00.000Z');

describe('determinizePdf (ANA-195)', () => {
  it('makes two wall-clock renders of the same snapshot byte-identical (the regression)', () => {
    // From the issue: D:20261117031512 → D:20261117035012 — the only 4 differing bytes
    // between two exports of the same snapshotId.
    const first = determinizePdf(
      chromeLikePdf("D:20261117031512+03'00'", "D:20261117031512+03'00'"),
      SEED,
    );
    const second = determinizePdf(
      chromeLikePdf("D:20261117035012+03'00'", "D:20261117035012+03'00'"),
      SEED,
    );
    expect(first.equals(second)).toBe(true);
    // Both dates are now the snapshot's generatedAt (UTC), not the render clock.
    const text = first.toString('latin1');
    expect(text).toContain("/CreationDate (D:20260528100000+00'00')");
    expect(text).toContain("/ModDate (D:20260528100000+00'00')");
    expect(text).not.toContain('20261117');
  });

  it('is length-preserving — every non-date byte and the total size stay the same (xref offsets stay valid)', () => {
    const input = chromeLikePdf("D:20261117031512+03'00'", "D:20261117031512+03'00'");
    const out = determinizePdf(input, SEED);
    expect(out.length).toBe(input.length);
    // Everything except the two date values survives byte-for-byte (latin1 round trip).
    const before = input.toString('latin1').replace(/D:\d{14}\+\d{2}'\d{2}'/g, '§');
    const after = out.toString('latin1').replace(/D:\d{14}\+\d{2}'\d{2}'/g, '§');
    expect(after).toBe(before);
  });

  it('stamps both /CreationDate and /ModDate independently', () => {
    const out = determinizePdf(
      chromeLikePdf("D:20261117031512+03'00'", "D:20261117031513+03'00'"),
      SEED,
    );
    const text = out.toString('latin1');
    expect(text).toContain("/CreationDate (D:20260528100000+00'00')");
    expect(text).toContain("/ModDate (D:20260528100000+00'00')");
  });

  it('truncates the canonical date when the matched value is shorter (spec allows truncated PDF dates)', () => {
    // Chrome could emit a value without the offset (still a valid PDF date); the rewrite
    // must not change the entry length, so the canonical value is cut to the same length.
    const out = determinizePdf(chromeLikePdf('D:20261117031512', 'D:2026111'), SEED);
    const text = out.toString('latin1');
    expect(text).toContain('/CreationDate (D:20260528100000)');
    expect(text).toContain('/ModDate (D:2026052)');
    expect(out.length).toBe(chromeLikePdf('D:20261117031512', 'D:2026111').length);
  });

  it('space-pads when the matched value is longer than the canonical date (appended user text)', () => {
    const input = chromeLikePdf("D:20261117031512+03'00' custom", "D:20261117031512+03'00' extra");
    const out = determinizePdf(input, SEED);
    expect(out.length).toBe(input.length);
    const text = out.toString('latin1');
    // 7 spaces for CreationDate (30 − 23), 6 for ModDate (29 − 23): length stays identical.
    expect(text).toContain("/CreationDate (D:20260528100000+00'00'       )");
    expect(text).toContain("/ModDate (D:20260528100000+00'00'      )");
  });

  it('leaves a PDF without Info-dict dates byte-identical', () => {
    const input = Buffer.from(
      '%PDF-1.4\n1 0 obj\n<< /Producer (Skia/PDF m126) >>\nendobj\n%%EOF',
      'latin1',
    );
    const out = determinizePdf(input, SEED);
    expect(out.equals(input)).toBe(true);
  });

  it('is pure: the same (buffer, seed) always yields the same bytes', () => {
    const input = chromeLikePdf("D:20261117031512+03'00'", "D:20261117031512+03'00'");
    expect(determinizePdf(input, SEED).equals(determinizePdf(input, SEED))).toBe(true);
  });

  it('falls back to the determinism epoch when the snapshot carries an unparseable generatedAt', () => {
    const out = determinizePdf(
      chromeLikePdf("D:20261117031512+03'00'", "D:20261117031512+03'00'"),
      resolveDeterministicDate('not-a-date'),
    );
    // 1980-01-01T00:00:00Z → same constant the DOCX determinizer uses.
    expect(out.toString('latin1')).toContain("/CreationDate (D:19800101000000+00'00')");
  });
});
