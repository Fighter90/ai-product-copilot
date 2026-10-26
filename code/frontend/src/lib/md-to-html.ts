/**
 * Markdown-to-HTML converter for AI analysis rendering.
 * Handles: headers (#…######), tables, bold, italic, inline code, ordered + unordered lists,
 * blockquotes, paragraphs and horizontal rules. Any stray markdown markers are stripped so no raw
 * «##»/«**»/«1.» leak into the rendered Executive Summary.
 */
/** Escape HTML special characters BEFORE any tag building — the input (LLM output,
 *  Metrika-sourced utm/URL strings) is untrusted and rendered via dangerouslySetInnerHTML. */
const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function mdToHtml(md: string): string {
  const lines = escapeHtml(md).split('\n');
  const html: string[] = [];
  let inTable = false;
  let tableRows: string[] = [];
  let listType: 'ul' | 'ol' | null = null;

  const flushTable = () => {
    if (tableRows.length > 0) {
      const headerRow = tableRows[0]!;
      const dataRows = tableRows
        .slice(1)
        .filter((r) => !r.startsWith('|---') && !r.startsWith('| ***'));
      html.push('<table class="ai-table">');
      html.push('<thead><tr>');
      headerRow
        .split('|')
        .filter((c) => c.trim())
        .forEach((cell) => {
          html.push(`<th>${inlineFormat(cell.trim())}</th>`);
        });
      html.push('</tr></thead><tbody>');
      dataRows.forEach((row) => {
        html.push('<tr>');
        row
          .split('|')
          .filter((c) => c.trim())
          .forEach((cell) => {
            html.push(`<td>${inlineFormat(cell.trim())}</td>`);
          });
        html.push('</tr>');
      });
      html.push('</tbody></table>');
      tableRows = [];
      inTable = false;
    }
  };

  const flushList = () => {
    if (listType) {
      html.push(listType === 'ol' ? '</ol>' : '</ul>');
      listType = null;
    }
  };

  const openList = (type: 'ul' | 'ol') => {
    if (listType && listType !== type) flushList();
    if (!listType) {
      html.push(type === 'ol' ? '<ol>' : '<ul>');
      listType = type;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    // Table detection
    if (trimmed.startsWith('|') && !trimmed.startsWith('||')) {
      if (!inTable) inTable = true;
      tableRows.push(trimmed);
      flushList();
      continue;
    } else if (inTable) {
      flushTable();
    }

    // Horizontal rule — only a line that is ENTIRELY dashes/asterisks (not «***bold***»).
    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      flushList();
      html.push('<hr class="ai-hr"/>');
      continue;
    }

    // Empty line
    if (trimmed === '') {
      flushList();
      html.push('<br/>');
      continue;
    }

    // Headers (#…######) → h2…h6 (capped). Keeps «#»→h2, «##»→h3, «###»→h4 for back-compat.
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushList();
      const level = Math.min(heading[1]!.length + 1, 6);
      html.push(`<h${level}>${inlineFormat(heading[2]!)}</h${level}>`);
      continue;
    }

    // Blockquote — '>' was HTML-escaped at entry, so match the escaped form.
    if (trimmed.startsWith('&gt; ')) {
      flushList();
      html.push(`<blockquote>${inlineFormat(trimmed.slice('&gt; '.length))}</blockquote>`);
      continue;
    }

    // Ordered list: «1. », «2) »
    const ordered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (ordered) {
      openList('ol');
      html.push(`<li>${inlineFormat(ordered[1]!)}</li>`);
      continue;
    }

    // Unordered list
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('• ')) {
      openList('ul');
      html.push(`<li>${inlineFormat(trimmed.slice(2))}</li>`);
      continue;
    }

    flushList();
    // Images: ONLY site-relative paths (/screenshots/…), so docs can embed product screenshots.
    // Everything else (http://, data:, javascript:) is intentionally not rendered.
    const img = /^!\[([^\]]*)\]\((\/[^)\s]+)\)$/.exec(trimmed);
    if (img) {
      flushList();
      const caption = img[1]!.trim();
      html.push(
        `<figure><img src="${img[2]}" alt="${caption}" loading="lazy"/>${
          caption ? `<figcaption>${caption}</figcaption>` : ''
        }</figure>`,
      );
      continue;
    }

    flushList();
    html.push(`<p>${inlineFormat(trimmed)}</p>`);
  }

  if (inTable) flushTable();
  flushList();

  return html.join('\n');
}

function inlineFormat(text: string): string {
  // Text is already HTML-escaped (see escapeHtml at the entry) — only safe tags are added here.
  // Bold+italic: ***text***
  text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  // Bold: **text**
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic: *text*
  text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Inline code: `text`
  text = text.replace(/`(.+?)`/g, '<code>$1</code>');
  // Strip any stray markdown markers that didn't match a pattern, so nothing leaks visually.
  text = text.replace(/\*\*/g, '').replace(/(^|\s)#{1,6}(\s|$)/g, '$1$2');
  return text;
}
