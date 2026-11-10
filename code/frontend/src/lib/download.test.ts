import { describe, it, expect, vi, afterEach } from 'vitest';
import { downloadFile, downloadFileViaFetch, reportDownloadUrl } from './download';

describe('reportDownloadUrl', () => {
  it('builds the endpoint URL with an encoded snapshot id', () => {
    expect(reportDownloadUrl('snap 1', 'pdf')).toBe('/api/report/download/snap%201/pdf');
    expect(reportDownloadUrl('s1', 'docx')).toBe('/api/report/download/s1/docx');
  });
});

describe('downloadFile', () => {
  afterEach(() => vi.restoreAllMocks());

  it('creates a transient anchor, clicks it, and removes it from the DOM', () => {
    const click = vi.fn();
    const realCreate = document.createElement.bind(document);
    const created: HTMLAnchorElement[] = [];
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreate(tag) as HTMLElement;
      if (tag === 'a') {
        (el as HTMLAnchorElement).click = click;
        created.push(el as HTMLAnchorElement);
      }
      return el;
    });

    downloadFile('/api/report/download/snap-1/docx');

    expect(created).toHaveLength(1);
    expect(created[0]!.href).toContain('/api/report/download/snap-1/docx');
    expect(click).toHaveBeenCalledOnce();
    expect(created[0]!.isConnected).toBe(false);
  });
});

/**
 * ANA-119 (регресс 28.10, БАГ-04): прямые кейсы downloadFileViaFetch — fetch → blob →
 * клик по <a download>; не-OK ответ бросает Error с текстом ответа (его показывает UI
 * через .catch в report-preview), пустое тело/упавший text() → «HTTP <status>».
 */
describe('downloadFileViaFetch (БАГ-04)', () => {
  const realCreateObjectUrl = URL.createObjectURL;
  const realRevokeObjectUrl = URL.revokeObjectURL;

  afterEach(() => {
    URL.createObjectURL = realCreateObjectUrl;
    URL.revokeObjectURL = realRevokeObjectUrl;
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function captureAnchorClick(): { created: HTMLAnchorElement[]; click: ReturnType<typeof vi.fn> } {
    const click = vi.fn();
    const realCreate = document.createElement.bind(document);
    const created: HTMLAnchorElement[] = [];
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreate(tag) as HTMLElement;
      if (tag === 'a') {
        (el as HTMLAnchorElement).click = click;
        created.push(el as HTMLAnchorElement);
      }
      return el;
    });
    return { created, click };
  }

  it('fetch → blob → transient anchor with download attribute; object URL revoked after 30s', async () => {
    vi.useFakeTimers();
    const revoke = vi.fn();
    URL.createObjectURL = vi.fn((_blob: Blob) => 'blob:mock-url');
    URL.revokeObjectURL = revoke;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        blob: async () => new Blob(['%PDF-1.4'], { type: 'application/pdf' }),
      } as unknown as Response),
    );
    const { created, click } = captureAnchorClick();

    await downloadFileViaFetch('/api/report/download/snap-1/pdf', 'report.pdf');

    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/report/download/snap-1/pdf', {
      credentials: 'same-origin',
    });
    expect(created).toHaveLength(1);
    expect(created[0]!.download).toBe('report.pdf');
    expect(created[0]!.href).toBe('blob:mock-url');
    expect(click).toHaveBeenCalledOnce();
    expect(created[0]!.isConnected).toBe(false);
    expect(revoke).not.toHaveBeenCalled();

    vi.advanceTimersByTime(30_000);
    expect(revoke).toHaveBeenCalledWith('blob:mock-url');
  });

  it('non-OK response: rejects with the server body text (shown via .catch in the UI)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => 'upstream unavailable',
      } as unknown as Response),
    );

    await expect(
      downloadFileViaFetch('/api/report/download/snap-1/pdf', 'report.pdf'),
    ).rejects.toThrow('upstream unavailable');
  });

  it('non-OK response with an empty body: rejects with «HTTP <status>»', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => '',
      } as unknown as Response),
    );

    await expect(
      downloadFileViaFetch('/api/report/download/snap-1/docx', 'report.docx'),
    ).rejects.toThrow('HTTP 500');
  });

  it('non-OK response whose body cannot be read: falls back to «HTTP <status>»', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        text: async () => {
          throw new Error('body read failed');
        },
      } as unknown as Response),
    );

    await expect(
      downloadFileViaFetch('/api/report/download/snap-1/pdf', 'report.pdf'),
    ).rejects.toThrow('HTTP 502');
  });
});
