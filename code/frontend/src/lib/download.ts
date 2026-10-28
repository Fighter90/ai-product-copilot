/**
 * Trigger a real browser download of a URL via a transient anchor element.
 * Used for report exports (DOCX/PDF) served by GET /api/report/download/:id/:format.
 */
export function downloadFile(url: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * БАГ-04: надёжное скачивание — fetch → blob → <a download>. Прямая навигация на
 * /api/report/download/… упиралась в nginx (503 на navigation-запросах) и не показывала
 * ошибку пользователю. Бросает Error с текстом ответа, если сервер не 2xx.
 */
export async function downloadFileViaFetch(url: string, filename: string): Promise<void> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.text();
      message = body.slice(0, 200) || message;
    } catch {
      /* пустое тело */
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
}

/** URL of the report download endpoint for a snapshot + format. */
export function reportDownloadUrl(snapshotId: string, format: 'docx' | 'pdf'): string {
  return `/api/report/download/${encodeURIComponent(snapshotId)}/${format}`;
}
