import JSZip from 'jszip';

/**
 * ANA-188: deterministic DOCX re-export — один snapshotId → байт-идентичный файл.
 *
 * The `docx` library (9.x) leaves four wall-clock/process-global footprints in every
 * Packer.toBuffer() result, so exporting the same immutable snapshot twice produced two
 * different files:
 *  1. zip entry DOS timestamps — `new Date()` per added part (JSZip default);
 *  2. `docProps/core.xml` — `dcterms:created`/`dcterms:modified` = build moment
 *     (TimestampElement hardcodes `new Date()`, no public option to override);
 *  3. heading bookmarks `_TocN` + `w:id` — names/ids come from a process-global counter
 *     (bookmarkUniqueNumericId), so every export in the same process shifts them;
 *  4. drawing ids `wp:docPr id` — same global-counter mechanism (docPropertiesUniqueNumericId).
 *
 * This module rewrites all four to snapshot-derived values. The metadata timestamp is the
 * snapshot's own `generatedAt` (traceable, anti-hallucination-friendly): the document
 * «was created» when the snapshot was built, not when someone clicked export. Ids are
 * renumbered sequentially in order of first appearance, which keeps every
 * bookmarkStart/End, hyperlink anchor and PAGEREF field internally consistent.
 *
 * Re-packing uses the directly declared, exactly pinned `jszip` dependency (ADR-016 — the same
 * version `docx` itself resolves to), with pinned options, so the second pack of identical
 * (content, dates) is byte-stable. No Date.now() anywhere — the render path stays deterministic
 * (product invariant).
 */

/** Zip DOS timestamps cannot predate 1980; used when a snapshot carries no parseable ISO date. */
const DETERMINISM_FALLBACK_ISO = '1980-01-01T00:00:00.000Z';

/**
 * The deterministic metadata date for a snapshot: its own generatedAt when parseable,
 * the DOS-epoch constant otherwise (defensive; SnapshotBuilder always writes ISO).
 */
export function resolveDeterministicDate(generatedAt: string): Date {
  const parsed = new Date(generatedAt);
  return Number.isNaN(parsed.getTime()) ? new Date(DETERMINISM_FALLBACK_ISO) : parsed;
}

/** Map every distinct value, in order of first appearance, to «1», «2», … (ANA-188 id renumbering). */
function sequentialMapping(values: readonly string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const value of values) {
    if (!map.has(value)) map.set(value, String(map.size + 1));
  }
  return map;
}

/**
 * Renumber heading-bookmark names only in the navigational contexts Word uses them:
 * bookmarkStart's `w:name` attribute, hyperlink `w:anchor` attributes and `PAGEREF` field
 * instructions. A visible text run that merely contains «_TocN» (e.g. a hypothesis title
 * pasted into the narrative) is ordinary content — rewriting it there would corrupt the
 * document, so the rewrite is scoped to attribute values and field instructions (ANA-188).
 */
function renumberTocNames(document: string): string {
  const context = /(w:name="|w:anchor="|PAGEREF )(_Toc\d+)/g;
  const map = sequentialMapping([...document.matchAll(context)].map((m) => m[2]!));
  return document.replace(
    context,
    (_m, prefix: string, name: string) => `${prefix}_Toc${map.get(name)}`,
  );
}

/** Renumber bookmarkStart/bookmarkEnd w:id attributes (each bookmark keeps its pair consistent). */
function renumberBookmarkIds(document: string): string {
  const ids = [...document.matchAll(/w:bookmark(?:Start|End)[^>]*?w:id="(\d+)"/g)].map(
    (m) => m[1]!,
  );
  const map = sequentialMapping(ids);
  return document.replace(
    /w:bookmark(Start|End)([^>]*?)w:id="(\d+)"/g,
    (_tag, kind: string, between: string, id: string) =>
      `w:bookmark${kind}${between}w:id="${map.get(id)}"`,
  );
}

/** Renumber drawing ids wp:docPr id="N" sequentially in document order (1, 2, 3, …). */
function renumberDocPrIds(document: string): string {
  let next = 1;
  return document.replace(/wp:docPr id="\d+"/g, () => `wp:docPr id="${next++}"`);
}

/** Pin dcterms:created/modified in docProps/core.xml to the snapshot-derived date. */
function pinCoreProperties(core: string, iso: string): string {
  return core.replace(
    /(<dcterms:(?:created|modified)[^>]*>)[^<]*(<\/dcterms:(?:created|modified)>)/g,
    (_tag, open: string, close: string) => `${open}${iso}${close}`,
  );
}

/**
 * Rewrite a Packer-produced .docx buffer into its deterministic form (see file JSDoc).
 * Pure with respect to the wall clock: the same (buffer, date) always yields the same bytes.
 *
 * Entries are copied into a fresh zip in their original order with an explicit per-entry
 * date: mutating the dates of a loaded zip is ignored by generateAsync (it reads the date
 * captured at ZipObject creation), so re-adding with `{ date }` is the reliable pin.
 */
export async function determinizeDocx(buffer: Buffer, seed: Date): Promise<Buffer> {
  const iso = seed.toISOString();
  const loaded = await JSZip.loadAsync(buffer);

  const documentPath = 'word/document.xml';
  const corePath = 'docProps/core.xml';
  const stableDocument = renumberDocPrIds(
    renumberBookmarkIds(renumberTocNames(await loaded.file(documentPath)!.async('string'))),
  );
  const stableCore = pinCoreProperties(await loaded.file(corePath)!.async('string'), iso);

  const zip = new JSZip();
  for (const [name, entry] of Object.entries(loaded.files)) {
    const date = { date: new Date(iso) };
    if (entry.dir) {
      zip.file(name, null, { ...date, dir: true, createFolders: false });
    } else {
      const bytes =
        name === documentPath
          ? Buffer.from(stableDocument, 'utf8')
          : name === corePath
            ? Buffer.from(stableCore, 'utf8')
            : await entry.async('nodebuffer');
      zip.file(name, bytes, { ...date, createFolders: false });
    }
  }

  // Pinned options (compression level, platform, empty comment) keep the re-pack byte-stable.
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    platform: 'UNIX',
  });
}
