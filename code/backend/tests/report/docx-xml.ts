import JSZip from 'jszip';

/**
 * §6 test helper (report-gost-v2): unzip a built .docx and return one OOXML part as a string.
 * Keeps the acceptance checks narrow (marker presence, not full XPath parsing — see the change
 * proposal risks) while sharing one unzip path across all DOCX tests.
 */
export async function readDocxXml(buf: Buffer, part: string): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const file = zip.file(part);
  if (!file) throw new Error(`DOCX part not found: ${part}`);
  return file.async('string');
}

/** The two parts the ГОСТ acceptance checks look at. */
export const DOCX_PARTS = {
  document: 'word/document.xml',
  styles: 'word/styles.xml',
  coreProps: 'docProps/core.xml',
} as const;
