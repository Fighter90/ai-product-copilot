/**
 * Human-friendly page label for tables: strips the scheme and host from a full URL
 * («https://productcamp.ru/tickets?utm=x» → «/tickets?utm=x»). Values that are already paths, or
 * not URLs at all, are returned unchanged; the bare host maps to «/».
 */
export function displayPath(url: string): string {
  const trimmed = url.trim();
  const m = /^(?:[a-z][a-z0-9+.-]*:)?\/\/[^/?#]*(.*)$/i.exec(trimmed);
  if (!m) return trimmed;
  const rest = m[1] ?? '';
  if (rest === '') return '/';
  return rest.startsWith('/') ? rest : `/${rest}`;
}
