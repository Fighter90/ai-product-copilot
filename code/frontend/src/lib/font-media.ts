/**
 * ANA-41 → CSP: Google Fonts подключены неблокирующе (`<link rel="stylesheet" media="print">`).
 * Раньше media подменял инлайновый `onload="this.media='all'"` — CSP прода блокирует инлайновые
 * event-хендлеры (script-src без 'unsafe-inline', хеши на них не действуют), поэтому шрифт
 * навсегда оставался «print-only» и Inter не применялся. Подмена делается отсюда, из бандла
 * ('self' разрешён CSP): первый рендер к этому моменту уже состоялся, так что переключение
 * media не блокирует отрисовку. Idempotent: валидный link не находится — no-op.
 */
export function enablePrintStylesheet(doc: Document = document): HTMLLinkElement | null {
  const link = doc.querySelector<HTMLLinkElement>('link[rel="stylesheet"][media="print"]');
  if (link) link.media = 'all';
  return link;
}
