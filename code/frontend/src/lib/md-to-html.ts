/**
 * Markdown-to-HTML converter for AI analysis and help-centre rendering.
 * Handles: headers (#…######), tables, fenced code blocks (```/~~~), bold, italic, inline code,
 * links, ordered + unordered lists, blockquotes, site-relative images, paragraphs and horizontal
 * rules. Any stray markdown markers are stripped so no raw «##»/«**»/«1.» leak into the output.
 */
/** Escape HTML special characters BEFORE any tag building — the input (LLM output,
 *  Metrika-sourced utm/URL strings) is untrusted and rendered via dangerouslySetInnerHTML. */
const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Inverse of {@link escapeHtml} — only used to inspect a URL, never to build output. */
const unescapeHtml = (s: string): string =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');

/** Private-use sentinel for protected inline fragments (code spans, links). Stripped from input. */
const SLOT = '\uE000';

const FENCE = /^(`{3,}|~{3,})\s*([\w+-]*)/;

export type LinkKind = 'internal' | 'external' | 'mailto';

/**
 * Classify a link target (plain, unescaped URL) or reject it. Allowed: site-relative paths
 * (`/help/…`, `/app/…` — but not protocol-relative `//host` or `/\host`), in-page `#anchors`,
 * absolute `http(s)://` and `mailto:`. Everything else — `javascript:`, `data:`, `vbscript:`,
 * relative `foo/bar`, control characters, backslashes — is rejected (rendered as plain text).
 */
export function classifyLink(url: string): LinkKind | null {
  // eslint-disable-next-line no-control-regex
  if (!url || /[\u0000-\u001f\u007f\s\\]/.test(url)) return null;
  if (/^\/(?!\/)/.test(url) || /^#[^#]*$/.test(url)) return 'internal';
  // Authority without userinfo (`https://trusted.ru@evil.com` is a phishing classic).
  if (/^https?:\/\/[^/?#@]+(?:[/?#]|$)/i.test(url)) return 'external';
  if (/^mailto:[^/]/i.test(url)) return 'mailto';
  return null;
}

export function mdToHtml(md: string): string {
  const lines = escapeHtml(md.split(SLOT).join('')).split('\n');
  const html: string[] = [];
  let inTable = false;
  let tableRows: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let fence: { marker: string; lang: string; body: string[] } | null = null;

  const cellsOf = (row: string): string[] =>
    row
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());
  const isSeparatorRow = (row: string): boolean => {
    const cells = cellsOf(row);
    return (
      cells.every((c) => /^:?-{3,}:?$/.test(c)) || row.startsWith('|---') || row.startsWith('| ***')
    );
  };

  const flushTable = () => {
    if (tableRows.length > 0) {
      const headerRow = tableRows[0]!;
      const dataRows = tableRows.slice(1).filter((r) => !isSeparatorRow(r));
      html.push('<table class="ai-table">');
      html.push('<thead><tr>');
      cellsOf(headerRow).forEach((cell) => {
        html.push(`<th>${inlineFormat(cell)}</th>`);
      });
      html.push('</tr></thead><tbody>');
      dataRows.forEach((row) => {
        html.push('<tr>');
        cellsOf(row).forEach((cell) => {
          html.push(`<td>${inlineFormat(cell)}</td>`);
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

  const flushFence = () => {
    if (!fence) return;
    // Body lines are already HTML-escaped and are emitted verbatim (no inline formatting).
    const cls = fence.lang ? ` class="language-${fence.lang}"` : '';
    html.push(`<pre class="md-code"><code${cls}>${fence.body.join('\n')}</code></pre>`);
    fence = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();

    // Fenced code block: everything up to the matching closing fence is literal text.
    if (fence) {
      const close = FENCE.exec(trimmed);
      const closes =
        close !== null &&
        trimmed === close[1] &&
        close[1][0] === fence.marker[0] &&
        close[1].length >= fence.marker.length;
      if (closes) flushFence();
      else fence.body.push(line);
      continue;
    }
    const open = FENCE.exec(trimmed);
    // A backtick fence's info string can't contain backticks (```inline``` is not a fence).
    if (open && !(open[1]![0] === '`' && trimmed.slice(open[1]!.length).includes('`'))) {
      if (inTable) flushTable();
      flushList();
      fence = { marker: open[1]!, lang: open[2]!.slice(0, 32), body: [] };
      continue;
    }

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

  if (fence) flushFence(); // unclosed fence: render what we have as code
  if (inTable) flushTable();
  flushList();

  return html.join('\n');
}

/** Bold / italic / stray-marker cleanup on already-escaped text without protected slots. */
function emphasis(text: string): string {
  // Bold+italic: ***text***
  text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  // Bold: **text**
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic: *text*
  text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Strip any stray markdown markers that didn't match a pattern, so nothing leaks visually.
  return text.replace(/\*\*/g, '').replace(/(^|\s)#{1,6}(\s|$)/g, '$1$2');
}

function inlineFormat(text: string): string {
  // Text is already HTML-escaped (see escapeHtml at the entry) — only safe tags are added here.
  // Code spans and links are rendered first and parked in slots, so emphasis/marker stripping
  // never touches code contents or href attributes.
  const slots: string[] = [];
  const park = (fragment: string): string => `${SLOT}${slots.push(fragment) - 1}${SLOT}`;

  // Inline code: `text` — literal (no emphasis, no links inside).
  text = text.replace(/`([^`]+)`/g, (_m, code: string) => park(`<code>${code}</code>`));

  // Links: [text](url) or [text](url "title"); one level of parentheses allowed in the URL.
  // Not preceded by «!» — image syntax is handled at line level (site-relative only).
  text = text.replace(
    /(?<!!)\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)(?:\s+&quot;(?:(?!&quot;).)*&quot;)?\)/g,
    (_m, label: string, href: string) => {
      const kind = classifyLink(unescapeHtml(href));
      const inner = emphasis(label);
      if (!kind) return park(inner);
      // `href` is still HTML-escaped (& → &amp;, " → &quot;), so it is attribute-safe as-is.
      const attrs = kind === 'external' ? ' target="_blank" rel="noopener noreferrer"' : '';
      return park(`<a href="${href}"${attrs}>${inner}</a>`);
    },
  );

  text = emphasis(text);
  // Restore parked fragments (a link label may itself hold a parked code span → recurse).
  const restore = (s: string): string =>
    s.replace(new RegExp(`${SLOT}(\\d+)${SLOT}`, 'g'), (_m, i: string) =>
      restore(slots[Number(i)] ?? ''),
    );
  return restore(text);
}
