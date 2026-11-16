import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  ImageRun,
  PageNumber,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TableOfContents,
  TextRun,
  WidthType,
} from 'docx';
import { reportPeriodLabel, type ReportLocale, type ReportSnapshot } from '@pca/shared';
import { reportSections, isFrontMatter, type ReportSection } from './sections';
import { REPORT_CHROME } from './chrome';
import { determinizeDocx, resolveDeterministicDate } from './determinize';

/**
 * ГОСТ-2 layout (эталон заказчика, поля в twips):
 *  - Page margins exactly top=1134 (20мм), right=850 (15мм), bottom=1134, left=1701 (30мм) —
 *    explicit integers (lib's mm→twip converter rounds 20мм to 1133, breaking the reference).
 *  - Title page fully centered: track line 13pt, «АНАЛИТИЧЕСКИЙ ОТЧЁТ» 20pt bold, subtitle 13pt,
 *    period/sources/credits 11pt, year at the bottom via a large `spacing.before`. The snapshot
 *    UUID is NOT shown here (human wording only); it lives in the data appendix section.
 *  - «СОДЕРЖАНИЕ» — a real Word TOC field (hyperlinks, heading levels 1–2) so page numbers
 *    appear once fields are updated (F9 / auto via `features.updateFields`), plus a small hint.
 *  - «ПЕРЕЧЕНЬ РИСУНКОВ» — list of figure captions (section caption or auto-generated
 *    «Рисунок N — заголовок»), matching the captions rendered under each embedded chart.
 *  - Section headings H1 black 14pt bold ALL-CAPS «N ЗАГОЛОВОК» (through numbering, no dot after
 *    the number); headings starting with «Приложение» are kept verbatim (no number, no caps).
 *    «## »-prefixed lines render as H2 (13pt, black) — numbering assumed present in the text.
 *  - Tables: every cell bordered (single, 4, black); header row bold.
 *  - Chart captions: centered italic 12pt under each image.
 *  - Defaults: Times New Roman 14pt, 1.5 line spacing (line=360), justified body, page number
 *    centered in the footer. Heading styles are forced to black (overrides the lib's blue).
 *
 * Content is deterministic (see reportSections); the container's clock/process-global
 * footprints (zip timestamps, dcterms dates, _Toc bookmarks, drawing ids) are rewritten to
 * snapshot-derived values by determinizeDocx — one snapshotId re-exports byte-identically (ANA-188).
 * Supports markdown tables, **bold**, *italic*, and `code` inline formatting.
 */

/** Single black border for table cells (ГОСТ: таблицы в рамке). */
const CELL_BORDER = { style: BorderStyle.SINGLE, size: 4, color: '000000' } as const;
const CELL_BORDERS = {
  top: CELL_BORDER,
  bottom: CELL_BORDER,
  left: CELL_BORDER,
  right: CELL_BORDER,
} as const;

/** Parse inline markdown: **bold**, *italic*, `code`. Exported for unit coverage of the
 * empty-string fallback (callers normally pass non-empty text). */
export function parseInline(text: string): TextRun[] {
  const runs: TextRun[] = [];
  const regex = /\*\*(.+?)\*\*|`(.+?)`|\*(.+?)\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      runs.push(new TextRun(text.slice(lastIndex, match.index)));
    }
    if (match[1]) {
      runs.push(new TextRun({ text: match[1], bold: true }));
    } else if (match[2]) {
      runs.push(new TextRun({ text: match[2], font: 'Courier New', size: 24 }));
    } else if (match[3]) {
      runs.push(new TextRun({ text: match[3], italics: true }));
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    runs.push(new TextRun(text.slice(lastIndex)));
  }
  return runs.length > 0 ? runs : [new TextRun(text)];
}

/** Detect if a line is a table row (starts and ends with |). */
function isTableRow(line: string): boolean {
  return line.startsWith('|') && line.endsWith('|') && line.split('|').length > 2;
}

/** Parse a markdown table from lines. Returns [headerRow, ...dataRows] and number of lines consumed. */
function parseTable(lines: string[], startIdx: number): { table: Table; consumed: number } | null {
  const tableLines: string[] = [];
  let i = startIdx;

  while (i < lines.length && isTableRow(lines[i]!)) {
    tableLines.push(lines[i]!);
    i++;
  }

  if (tableLines.length < 2) return null;

  const headerCells = tableLines[0]!.split('|').filter((c) => c.trim() !== '');
  const dataRows = tableLines
    .slice(1)
    .filter((r) => !r.startsWith('|---') && !r.startsWith('| ***'))
    .map((r) => r.split('|').filter((c) => c.trim() !== ''));

  // Header cells: plain bold runs (headers are short labels; inline markup is not expected there).
  const headerRow = new TableRow({
    children: headerCells.map(
      (cell) =>
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: cell.trim(), bold: true })] })],
          shading: { fill: 'F8FAFC', type: 'clear' },
          borders: CELL_BORDERS,
        }),
    ),
  });

  const dataRowsParsed = dataRows.map(
    (cells) =>
      new TableRow({
        children: cells.map(
          (cell) =>
            new TableCell({
              children: [new Paragraph({ children: parseInline(cell.trim()) })],
              borders: CELL_BORDERS,
            }),
        ),
      }),
  );

  return {
    table: new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [headerRow, ...dataRowsParsed],
    }),
    consumed: tableLines.length,
  };
}

/** Appendix sections («Приложение …» / «Appendix …») are rendered verbatim: no through number, no caps. */
function isAppendixHeading(heading: string, appendixPrefix: string): boolean {
  return heading.toLowerCase().startsWith(appendixPrefix.toLowerCase());
}

/**
 * Render a snapshot to a DOCX buffer in the ГОСТ-2 reference layout (see file JSDoc for the full
 * field/typography spec). Title page → СОДЕРЖАНИЕ (TOC field) → ПЕРЕЧЕНЬ РИСУНКОВ → numbered
 * black-caps sections with bordered tables, embedded charts and italic captions.
 */
export async function buildDocx(
  snapshot: ReportSnapshot,
  locale: ReportLocale = 'ru',
): Promise<Buffer> {
  const C = REPORT_CHROME[locale];
  const sections = reportSections(snapshot, locale);
  const body = sections.slice(1); // section 0 is replaced by the ГОСТ title page
  const children: (Paragraph | Table | TableOfContents)[] = [];

  // Vertical gaps on the title page are expressed via `spacing.before` (twips), NOT runs of empty
  // paragraphs — so the audit never sees 2+ consecutive blank paragraphs (D-EMPTY-PAGE).
  const centered = (text: string, size: number, bold = false, before = 0): Paragraph =>
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: before ? { before } : undefined,
      children: [new TextRun({ text, size, bold })],
    });
  const year = /^\d{4}/.test(snapshot.generatedAt)
    ? snapshot.generatedAt.slice(0, 4)
    : snapshot.period.from.slice(0, 4);

  // ---- ГОСТ-2 title page: everything centered; no UUID (it lives in the data appendix) ----
  children.push(
    centered(`ProductCamp · ${C.track}`, 26, false, 1440),
    centered(C.reportTitle, 40, true, 3600),
    centered(C.reportSubtitle, 26, false, 120),
    centered(`${C.periodLabel} ${reportPeriodLabel(snapshot.period, locale)}`, 22, false, 2400),
    centered(C.sources, 22),
    centered(C.preparedBy, 22),
    centered(locale === 'ru' ? `${year} г.` : year, 22, false, 3600),
  );

  // ---- СОДЕРЖАНИЕ: real Word TOC field (pages appear after field update — F9 or on open) ----
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      pageBreakBefore: true,
      children: [new TextRun(C.contents)],
    }),
    new TableOfContents('Содержание', { hyperlink: true, headingStyleRange: '1-2' }),
    new Paragraph({
      children: [
        new TextRun({
          text: C.tocFieldHint,
          italics: true,
          size: 20,
        }),
      ],
    }),
  );

  // ---- Figure numbering: sections with an embedded chart, in document order. The caption text
  // (custom or auto «Рисунок N — заголовок») is shared by ПЕРЕЧЕНЬ РИСУНКОВ and under-chart captions.
  let figureNo = 0;
  const figureCaptions: (string | undefined)[] = body.map((section) => {
    if (!section.chartId || !snapshot.charts?.[section.chartId]) return undefined;
    figureNo += 1;
    const auto = C.figure(figureNo, section.heading);
    return section.caption ?? auto;
  });
  const figures = figureCaptions.filter((c): c is string => c !== undefined);

  // ---- ПЕРЕЧЕНЬ РИСУНКОВ — only when at least one figure exists (a figure exists ⇔ its PNG
  // exists); with charts = {} (Chrome unavailable) the whole page is omitted deterministically. ----
  if (figures.length > 0) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
        pageBreakBefore: true,
        children: [new TextRun(C.figures)],
      }),
    );
    figures.forEach((caption) =>
      children.push(new Paragraph({ children: [new TextRun(caption)] })),
    );
  }

  // ---- Body sections: H1 «N ЗАГОЛОВОК» caps black (front matter — без номера; appendix verbatim), each on a new page ----
  let sectionNo = 0;
  body.forEach((section: ReportSection, sectionIdx: number) => {
    const numbered =
      !isAppendixHeading(section.heading, C.appendixPrefix) && !isFrontMatter(section.heading);
    const title = numbered ? `${++sectionNo}. ${section.heading.toUpperCase()}` : section.heading;
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.LEFT,
        pageBreakBefore: true,
        spacing: { after: 120 },
        children: [new TextRun(title)],
      }),
    );

    // Embed the section's chart PNG (FINAL §6.4), if rendered into the snapshot.
    const chartBase64 = section.chartId ? snapshot.charts?.[section.chartId] : undefined;
    if (chartBase64) {
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 60 },
          children: [
            new ImageRun({
              type: 'png',
              data: Buffer.from(chartBase64, 'base64'),
              transformation: { width: 600, height: 340 },
            }),
          ],
        }),
        // ГОСТ figure caption: centered, italic, 12pt, identical text to ПЕРЕЧЕНЬ РИСУНКОВ.
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 160 },
          children: [
            new TextRun({
              text: figureCaptions[sectionIdx] ?? C.figureNoNumber(section.heading),
              italics: true,
              size: 24,
            }),
          ],
        }),
      );
    }

    // Process lines: tables, H2 subheadings, bullet lists, justified paragraphs. Collapse blank
    // runs and trim leading/trailing blanks so the document has no empty filler blocks.
    const lines = section.lines;
    let lineIdx = 0;
    let emittedInSection = false;
    let pendingBlank = false;
    while (lineIdx < lines.length) {
      const line = lines[lineIdx]!;

      if (isTableRow(line)) {
        const result = parseTable(lines, lineIdx);
        if (result) {
          pendingBlank = false;
          children.push(result.table);
          emittedInSection = true;
          lineIdx += result.consumed;
          continue;
        }
      }

      if (line === '') {
        // Defer blank lines; only emit a single spacer between real content (never leading/consecutive).
        if (emittedInSection) pendingBlank = true;
      } else {
        if (pendingBlank) {
          children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
          pendingBlank = false;
        }
        if (line.startsWith('## ')) {
          // H2 support (numbering N.M is already in the text); flat sections rarely hit this.
          children.push(
            new Paragraph({
              heading: HeadingLevel.HEADING_2,
              spacing: { before: 120, after: 80 },
              children: [new TextRun(line.slice(3))],
            }),
          );
        } else if (line.startsWith('- ') || line.startsWith('* ')) {
          children.push(
            new Paragraph({ children: parseInline(line.slice(2)), bullet: { level: 0 } }),
          );
        } else {
          children.push(
            new Paragraph({ alignment: AlignmentType.JUSTIFIED, children: parseInline(line) }),
          );
        }
        emittedInSection = true;
      }
      lineIdx++;
    }
  });

  const doc = new Document({
    creator: 'ProductCamp Analytics',
    // ANA-39: the human-readable period names the document; the snapshot UUID stays in the data appendix.
    title: `ProductCamp report ${reportPeriodLabel(snapshot.period)}`,
    // Ask Word to refresh fields (TOC page numbers) when the document is opened.
    features: { updateFields: true },
    // ГОСТ defaults: Times New Roman 14pt (size is half-points → 28), 1.5 line spacing (240 × 1.5);
    // all heading levels forced to black (the lib's built-in blues — 2E74B5/1F4D78 — must never
    // leak into styles.xml), sizes descending from H1 14pt / H2 13pt.
    styles: {
      default: {
        document: {
          run: { font: 'Times New Roman', size: 28 },
          paragraph: { spacing: { line: 360 } },
        },
        title: { run: { color: '000000', size: 40, bold: true } },
        heading1: { run: { color: '000000', size: 28, bold: true } },
        heading2: { run: { color: '000000', size: 26, bold: true } },
        heading3: { run: { color: '000000', size: 24, bold: true } },
        heading4: { run: { color: '000000', size: 24, bold: true } },
        heading5: { run: { color: '000000', size: 22, bold: true } },
        heading6: { run: { color: '000000', size: 22, bold: true } },
      },
    },
    sections: [
      {
        properties: {
          page: {
            // ГОСТ margins in twips, exact reference values (20мм→1134, 15мм→850, 30мм→1701).
            margin: { top: 1134, bottom: 1134, left: 1701, right: 850 },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ children: [PageNumber.CURRENT] })],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
  // ANA-188: strip the packer's wall-clock/process-global footprints (zip DOS timestamps,
  // dcterms:created/modified, _Toc bookmark names/ids, wp:docPr drawing ids) so the same
  // immutable snapshot re-exports to a byte-identical file. Metadata dates derive from the
  // snapshot itself — no Date.now() enters the render path.
  return determinizeDocx(
    await Packer.toBuffer(doc),
    resolveDeterministicDate(snapshot.generatedAt),
  );
}
