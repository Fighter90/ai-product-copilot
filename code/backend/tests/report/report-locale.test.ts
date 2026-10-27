import { describe, it, expect } from 'vitest';
import type { ReportSnapshot } from '@pca/shared';
import { reportHtml } from '../../src/report/pdf/html';
import { buildDocx } from '../../src/report/docx/builder';
import { DOCX_PARTS, readDocxXml } from './docx-xml';
import { richSnapshot } from '../../../shared/src/test-fixtures/report-snapshot';

/**
 * ANA-42: report language at export time. Russian output must stay byte-identical to the
 * pre-i18n renderers (the ГОСТ verifier pins it); English renders the same content through
 * the shared REPORT_TEXT.en plus the renderer chrome (cover, TOC, figure captions).
 */
describe('report locale (ANA-42) — PDF html', () => {
  it('RU stays the default and is byte-identical to the explicit ru call', () => {
    expect(reportHtml(richSnapshot)).toBe(reportHtml(richSnapshot, 'ru'));
    expect(reportHtml(richSnapshot)).toContain('<html lang="ru">');
    expect(reportHtml(richSnapshot)).toContain('АНАЛИТИЧЕСКИЙ ОТЧЁТ');
    expect(reportHtml(richSnapshot)).toContain('СОДЕРЖАНИЕ');
  });

  it('EN renders the chrome and section headings in English', () => {
    const html = reportHtml({ ...richSnapshot, charts: { channelBar: 'aGVsbG8=' } }, 'en');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('ANALYTICAL REPORT');
    expect(html).toContain('CONTENTS');
    expect(html).toContain('LIST OF FIGURES');
    expect(html).toContain('Figure 1 —');
    expect(html).toContain('EXECUTIVE SUMMARY');
    expect(html).not.toContain('АНАЛИТИЧЕСКИЙ ОТЧЁТ');
  });

  it('EN keeps appendix headings unnumbered and verbatim', () => {
    const html = reportHtml(richSnapshot, 'en');
    const appendixLine = html.split('\n').find((l) => l.includes('Appendix'));
    expect(appendixLine).toBeTruthy();
  });
});

describe('report locale (ANA-42) — DOCX', () => {
  it('RU title page is unchanged; EN renders the English cover', async () => {
    const ru = await buildDocx(richSnapshot);
    const ruXml = await readDocxXml(ru, DOCX_PARTS.document);
    expect(ruXml).toContain('АНАЛИТИЧЕСКИЙ ОТЧЁТ');
    expect(ruXml).toContain('СОДЕРЖАНИЕ');

    const en = await buildDocx(richSnapshot, 'en');
    const enXml = await readDocxXml(en, DOCX_PARTS.document);
    expect(enXml).toContain('ANALYTICAL REPORT');
    expect(enXml).toContain('CONTENTS');
    expect(enXml).not.toContain('АНАЛИТИЧЕСКИЙ ОТЧЁТ');
  });
});

describe('report locale (ANA-42) — period label', () => {
  it('EN months are used for the cover period line', () => {
    const s: ReportSnapshot = {
      ...richSnapshot,
      period: { from: '2026-01-01', to: '2026-06-30' },
    };
    const html = reportHtml(s, 'en');
    expect(html).toContain('January – June 2026');
    const ru = reportHtml(s, 'ru');
    expect(ru).toContain('Январь – июнь 2026');
  });
});
