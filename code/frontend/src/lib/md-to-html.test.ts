import { describe, it, expect } from 'vitest';
import { classifyLink, mdToHtml } from './md-to-html';

describe('mdToHtml', () => {
  it('renders ### headings as h4', () => {
    expect(mdToHtml('### Deep heading')).toContain('<h4>Deep heading</h4>');
  });

  it('renders ## headings as h3', () => {
    expect(mdToHtml('## Section')).toContain('<h3>Section</h3>');
  });

  it('renders # headings as h2', () => {
    expect(mdToHtml('# Main')).toContain('<h2>Main</h2>');
  });

  it('renders horizontal rules (--- and ***)', () => {
    expect(mdToHtml('---')).toContain('<hr class="ai-hr"/>');
    expect(mdToHtml('***')).toContain('<hr class="ai-hr"/>');
  });

  it('renders empty lines as <br/>', () => {
    expect(mdToHtml('\n')).toContain('<br/>');
  });

  it('renders unordered list items (- and *)', () => {
    const html = mdToHtml('- item one\n* item two');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>item one</li>');
    expect(html).toContain('<li>item two</li>');
    expect(html).toContain('</ul>');
  });

  it('flushes the list before a heading or table', () => {
    const html = mdToHtml('- item\n## After list');
    expect(html).toContain('</ul>');
    expect(html).toContain('<h3>After list</h3>');
  });

  it('renders a markdown table', () => {
    const md = '| Col A | Col B |\n|---|---|\n| val 1 | val 2 |';
    const html = mdToHtml(md);
    expect(html).toContain('<table class="ai-table">');
    expect(html).toContain('<th>Col A</th>');
    expect(html).toContain('<th>Col B</th>');
    expect(html).toContain('<td>val 1</td>');
    expect(html).toContain('<td>val 2</td>');
    expect(html).toContain('</tbody></table>');
  });

  it('flushes a table when a non-table line follows', () => {
    const md = '| Col |\n|---|\n| a |\nregular text';
    const html = mdToHtml(md);
    expect(html).toContain('</tbody></table>');
    expect(html).toContain('<p>regular text</p>');
  });

  it('handles inlineFormat: **bold**, *italic*, `code`', () => {
    const html = mdToHtml('**bold** and *italic* and `code`');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<code>code</code>');
  });

  it('renders plain paragraphs', () => {
    expect(mdToHtml('plain text line')).toContain('<p>plain text line</p>');
  });

  it('flushes list on empty line', () => {
    const html = mdToHtml('- item\n\ntext');
    expect(html).toContain('</ul>');
    expect(html).toContain('<br/>');
    expect(html).toContain('<p>text</p>');
  });

  it('flushes remaining table at end of input', () => {
    const md = '| H1 |\n|---|\n| row |';
    const html = mdToHtml(md);
    expect(html).toContain('</tbody></table>');
  });

  it('flushes remaining list at end of input', () => {
    const html = mdToHtml('- only item');
    expect(html).toContain('</ul>');
  });

  it('skips separator rows (|---) and bold-separator rows (| ***) in table body', () => {
    const md = '| Col |\n|---|\n| *** |\n| real |';
    const html = mdToHtml(md);
    // Separator rows should not produce <td> cells
    expect(html).not.toContain('<td>---</td>');
    expect(html).toContain('<td>real</td>');
  });

  it('flushes list before a table row', () => {
    const html = mdToHtml('- item\n| Col |\n|---|\n| val |');
    expect(html).toContain('</ul>');
    expect(html).toContain('<table');
  });

  it('handles a single empty-string input (outputs only the br for the empty line)', () => {
    // ''.split('\n') = [''] → one empty line → <br/>
    expect(mdToHtml('')).toContain('<br/>');
  });

  it('renders deep headings #### → h5 and ##### / ###### → h6 (no leaked #)', () => {
    expect(mdToHtml('#### Sub')).toContain('<h5>Sub</h5>');
    expect(mdToHtml('##### Deeper')).toContain('<h6>Deeper</h6>');
    expect(mdToHtml('###### Deepest')).toContain('<h6>Deepest</h6>');
    expect(mdToHtml('#### Sub')).not.toContain('#');
  });

  it('renders ordered lists (1. and 2)) as <ol>', () => {
    const html = mdToHtml('1. first\n2) second');
    expect(html).toContain('<ol>');
    expect(html).toContain('<li>first</li>');
    expect(html).toContain('<li>second</li>');
    expect(html).toContain('</ol>');
  });

  it('switches list type when ul follows ol', () => {
    const html = mdToHtml('1. ordered\n- unordered');
    expect(html).toContain('</ol>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>unordered</li>');
  });

  it('renders blockquotes', () => {
    expect(mdToHtml('> quoted line')).toContain('<blockquote>quoted line</blockquote>');
  });

  it('renders ***bold-italic*** and the • bullet', () => {
    expect(mdToHtml('***strong em***')).toContain('<strong><em>strong em</em></strong>');
    expect(mdToHtml('• bullet')).toContain('<li>bullet</li>');
  });

  it('strips stray markdown markers so nothing leaks', () => {
    // An unmatched ** and a mid-line ## must not survive in the output.
    const html = mdToHtml('text with ** stray and ## marker');
    expect(html).not.toContain('**');
    expect(html).not.toContain('##');
  });

  it('renders site-relative images with a caption, but blocks absolute/foreign URLs', () => {
    const ok = mdToHtml('![Обзор](/screenshots/03-overview.png)');
    expect(ok).toContain('<figure><img src="/screenshots/03-overview.png"');
    expect(ok).toContain('<figcaption>Обзор</figcaption>');

    // Только корневые пути: внешние и data-/javascript-URL не превращаются в <img>.
    expect(mdToHtml('![x](https://evil.com/x.png)')).not.toContain('<img');
    expect(mdToHtml('![x](data:text/html;base64,AAA)')).not.toContain('<img');
    expect(mdToHtml('![x](javascript:alert(1))')).not.toContain('<img');
  });

  describe('links', () => {
    it('renders internal /help and /app links same-origin (no target)', () => {
      expect(mdToHtml('see [Цели](/help/goals) now')).toContain(
        '<p>see <a href="/help/goals">Цели</a> now</p>',
      );
      expect(mdToHtml('[KPI](/app/kpi?tab=b2b&x=1#top)')).toContain(
        '<a href="/app/kpi?tab=b2b&amp;x=1#top">KPI</a>',
      );
      expect(mdToHtml('[up](#h-0)')).toContain('<a href="#h-0">up</a>');
    });

    it('opens external http(s) links in a new tab with rel=noopener noreferrer', () => {
      expect(mdToHtml('[Метрика](https://metrika.yandex.ru/list)')).toContain(
        '<a href="https://metrika.yandex.ru/list" target="_blank" rel="noopener noreferrer">Метрика</a>',
      );
      expect(mdToHtml('[w](http://example.com/a_(b))')).toContain(
        'href="http://example.com/a_(b)"',
      );
    });

    it('renders mailto links without target', () => {
      expect(mdToHtml('[write](mailto:team@example.com)')).toContain(
        '<a href="mailto:team@example.com">write</a>',
      );
    });

    it('supports an optional "title" and emphasis inside the label', () => {
      const html = mdToHtml('[**bold** link](/help/a "Title")');
      expect(html).toContain('<a href="/help/a"><strong>bold</strong> link</a>');
    });

    it('keeps emphasis markers in URLs intact (href is never formatted)', () => {
      expect(mdToHtml('[x](/help/a*b*c) and *em*')).toContain(
        '<a href="/help/a*b*c">x</a> and <em>em</em>',
      );
    });

    it('rejects dangerous / unsupported schemes → plain text, no <a>', () => {
      const bad = [
        '[x](javascript:alert(1))',
        '[x](JaVaScRiPt:alert(1))',
        '[x](data:text/html;base64,PHNjcmlwdD4=)',
        '[x](vbscript:msgbox)',
        '[x](//evil.com/path)',
        '[x](/\\evil.com)',
        '[x](&#106;avascript:alert(1))',
        '[x](relative/path)',
        '[x](https://user@evil.com)',
      ];
      for (const md of bad) {
        const html = mdToHtml(md);
        expect(html, md).not.toContain('<a');
        expect(html, md).toContain('x');
      }
    });

    it('cannot break out of the href attribute', () => {
      const html = mdToHtml('[x](/a"onmouseover="alert(1))');
      expect(html).not.toMatch(/<a[^>]*\sonmouseover=/);
      expect(html).toContain('&quot;');
      const html2 = mdToHtml('[<img src=x onerror=alert(1)>](/help)');
      expect(html2).not.toContain('<img');
      expect(html2).toContain('&lt;img src=x onerror=alert(1)&gt;');
    });

    it('does not turn a blocked image into a link', () => {
      expect(mdToHtml('![x](https://evil.com/x.png)')).not.toContain('<a');
    });
  });

  describe('inline code', () => {
    it('keeps code literal: no emphasis or links inside, HTML escaped', () => {
      const html = mdToHtml('use `a*b*c` and `[x](/help)` and `<script>`');
      expect(html).toContain('<code>a*b*c</code>');
      expect(html).toContain('<code>[x](/help)</code>');
      expect(html).toContain('<code>&lt;script&gt;</code>');
      expect(html).not.toContain('<em>');
      expect(html).not.toContain('<a ');
    });

    it('allows code inside a link label', () => {
      expect(mdToHtml('[`GOAL_ID`](/help/admin)')).toContain(
        '<a href="/help/admin"><code>GOAL_ID</code></a>',
      );
    });
  });

  describe('fenced code blocks', () => {
    it('renders ``` blocks literally with a language class, HTML escaped', () => {
      const md = '```ts\nconst a = 1 < 2 && "x";\n# not a heading\n- not a list\n**not bold**\n```';
      const html = mdToHtml(md);
      expect(html).toContain(
        '<pre class="md-code"><code class="language-ts">const a = 1 &lt; 2 &amp;&amp; &quot;x&quot;;\n# not a heading\n- not a list\n**not bold**</code></pre>',
      );
      expect(html).not.toContain('<h2>');
      expect(html).not.toContain('<li>');
    });

    it('supports ~~~ fences, preserves indentation and blank lines', () => {
      const html = mdToHtml('~~~\n  indented\n\nafter blank\n~~~\ntext');
      expect(html).toContain('<pre class="md-code"><code>  indented\n\nafter blank</code></pre>');
      expect(html).toContain('<p>text</p>');
    });

    it('a ``` line inside a ~~~ block does not close it; unclosed fences run to the end', () => {
      expect(mdToHtml('~~~\n```\nx\n~~~')).toContain('<code>```\nx</code>');
      expect(mdToHtml('```\nunclosed <b>')).toContain('<code>unclosed &lt;b&gt;</code></pre>');
    });

    it('escapes a </code></pre> breakout attempt and sanitises the language', () => {
      const html = mdToHtml('```js"onload=x\n</code></pre><script>alert(1)</script>\n```');
      expect(html).not.toContain('<script>');
      expect(html).toContain('class="language-js"');
      expect(html).toContain('&lt;/code&gt;&lt;/pre&gt;&lt;script&gt;');
    });

    it('flushes an open list / table before the block', () => {
      const html = mdToHtml('- item\n```\ncode\n```');
      expect(html.indexOf('</ul>')).toBeLessThan(html.indexOf('<pre'));
      const t = mdToHtml('| A |\n|---|\n| 1 |\n```\ncode\n```');
      expect(t.indexOf('</table>')).toBeLessThan(t.indexOf('<pre'));
    });

    it('```inline``` on one line is not a fence', () => {
      expect(mdToHtml('```inline```')).not.toContain('<pre');
    });
  });

  describe('tables', () => {
    it('skips spaced / aligned separator rows and keeps empty cells in place', () => {
      const html = mdToHtml('| A | B | C |\n| :--- | :---: | ---: |\n| 1 |  | 3 |');
      expect(html).not.toContain(':---');
      expect(html).toContain('<td>1</td>\n<td></td>\n<td>3</td>');
    });

    it('formats links and code inside cells', () => {
      const html = mdToHtml('| Ссылка |\n|---|\n| [Справка](/help/a) `x` |');
      expect(html).toContain('<td><a href="/help/a">Справка</a> <code>x</code></td>');
    });
  });

  it('strips the private-use slot sentinel from input (no slot spoofing)', () => {
    const html = mdToHtml('\uE0000\uE000 [a](/help)');
    expect(html).not.toContain('\uE000');
    expect(html).toContain('<a href="/help">a</a>');
  });
});

describe('classifyLink', () => {
  it('classifies allowed targets', () => {
    expect(classifyLink('/help/x')).toBe('internal');
    expect(classifyLink('#anchor')).toBe('internal');
    expect(classifyLink('https://a.ru')).toBe('external');
    expect(classifyLink('HTTP://a.ru/x')).toBe('external');
    expect(classifyLink('mailto:a@b.ru')).toBe('mailto');
  });

  it('rejects everything else', () => {
    for (const url of [
      '',
      'javascript:x',
      '//a.ru',
      '/\\a.ru',
      'ftp://a',
      'a/b',
      '/a b',
      '/a\tb',
      'https://',
      'mailto://x',
    ]) {
      expect(classifyLink(url), JSON.stringify(url)).toBeNull();
    }
  });
});
