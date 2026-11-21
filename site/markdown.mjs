// A small Markdown renderer for this site: headings (with ids), paragraphs, lists (nested), tables, fenced code,
// blockquotes, rules, links, images, inline code, bold and italic. Raw HTML in the source is escaped, never passed on.
// Pure: no file or network access. `options.resolveLink(href)` may rewrite a link target; `options.imageSize(src)`
// may return { width, height } for an image.

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function slugify(text) {
  return String(text).toLowerCase().replace(/<[^>]*>/g, '').replace(/[`*_]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'section';
}

/** Front matter: a leading block of `key: value` lines between two `---` lines. */
export function parseFrontMatter(src) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
  if (!m) return { meta: {}, body: src };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { meta, body: src.slice(m[0].length) };
}

/** Inline markup to HTML. Code spans are lifted out first so their text is never touched. */
export function inline(text, options = {}) {
  const spans = [];
  let s = text.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_m, _t, code) => {
    spans.push(`<code>${esc(code.trim().replace(/\\\|/g, '|'))}</code>`);
    return `\u0000${spans.length - 1}\u0000`;
  });
  s = esc(s);
  // Images then links. The text part may hold placeholders for code spans.
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (_m, alt, src) => {
    const size = options.imageSize ? options.imageSize(src) : null;
    const url = options.resolveAsset ? options.resolveAsset(src) : src;
    const dims = size ? ` width="${size.width}" height="${size.height}"` : '';
    return `<img src="${url}" alt="${alt}"${dims} loading="lazy" decoding="async">`;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, href) => {
    const h = href.replace(/&amp;/g, '&');
    const out = options.resolveLink ? options.resolveLink(h) : { href: h };
    if (!out) return label;
    if (out.text) return `${label}`;
    const ext = /^https?:/i.test(out.href);
    return `<a href="${esc(out.href)}"${ext ? ' rel="noopener"' : ''}>${label}</a>`;
  });
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(])\*([^*\s][^*\n]*?)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i) => spans[Number(i)]);
}

function splitRow(line) {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
  const cells = [];
  let cur = '';
  let inCode = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '`') inCode = !inCode;
    if (c === '\\' && t[i + 1] === '|') { cur += '\\|'; i++; continue; }
    if (c === '|' && !inCode) { cells.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

const isTableSep = (l) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l) && l.includes('-');
const LIST_RE = /^(\s*)([-*]|\d+\.)\s+(.*)$/;

/**
 * Render Markdown. Returns { html, headings: [{ level, text, id }], title, firstParagraph }.
 * The first `# ` heading is the title; it is rendered as an h1.
 */
export function renderMarkdown(src, options = {}) {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  const headings = [];
  const usedIds = new Map();
  let title = '';
  let firstParagraph = '';
  let lastHeading = '';
  let i = 0;

  const uniqueId = (text) => {
    const base = slugify(text);
    const n = usedIds.get(base) ?? 0;
    usedIds.set(base, n + 1);
    return n === 0 ? base : `${base}-${n + 1}`;
  };

  function parseList(startIndent) {
    const m0 = LIST_RE.exec(lines[i]);
    const ordered = /\d/.test(m0[2]);
    const tag = ordered ? 'ol' : 'ul';
    const items = [];
    while (i < lines.length) {
      const m = LIST_RE.exec(lines[i]);
      if (!m || m[1].length < startIndent) break;
      if (m[1].length > startIndent) break;
      let text = m[3];
      i++;
      let nested = '';
      while (i < lines.length) {
        const l = lines[i];
        if (l.trim() === '') break;
        const nm = LIST_RE.exec(l);
        if (nm && nm[1].length > startIndent) { nested += parseList(nm[1].length); continue; }
        if (nm) break;
        if (/^\s+\S/.test(l)) { text += ' ' + l.trim(); i++; continue; }
        break;
      }
      items.push(`<li>${inline(text, options)}${nested}</li>`);
      // A blank line between items keeps the same list when the next line is another item at this indent.
      if (i < lines.length && lines[i].trim() === '' && LIST_RE.test(lines[i + 1] ?? '')) {
        const nm = LIST_RE.exec(lines[i + 1]);
        if (nm[1].length === startIndent) i++;
      }
    }
    return `<${tag}>${items.join('')}</${tag}>`;
  }

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') { i++; continue; }

    const fence = /^(\s*)(```+|~~~+)\s*([\w+-]*)\s*$/.exec(line);
    if (fence) {
      const close = fence[2];
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(close)) { body.push(lines[i].slice(Math.min(fence[1].length, lines[i].length - lines[i].trimStart().length))); i++; }
      i++;
      const lang = fence[3] ? ` class="language-${esc(fence[3])}"` : '';
      out.push(`<pre tabindex="0"><code${lang}>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }

    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      const level = h[1].length;
      const raw = h[2];
      const plain = raw.replace(/`/g, '').replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
      const id = uniqueId(plain);
      lastHeading = plain;
      if (level === 1 && !title) { title = plain; out.push(`<h1 id="${id}">${inline(raw, options)}</h1>`); }
      else {
        headings.push({ level, text: plain, id });
        out.push(`<h${level} id="${id}">${inline(raw, options)}<a class="anchor" href="#${id}" aria-label="Link to the section ${esc(plain)}">#</a></h${level}>`);
      }
      i++;
      continue;
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() !== '' && lines[i].includes('|')) { rows.push(splitRow(lines[i])); i++; }
      const th = head.map((c) => `<th scope="col">${inline(c, options)}</th>`).join('');
      const tr = rows.map((r) => `<tr>${head.map((_c, k) => `<td>${inline(r[k] ?? '', options)}</td>`).join('')}</tr>`).join('');
      out.push(`<div class="table-wrap" role="region" tabindex="0" aria-label="Table: ${esc(lastHeading || title)}"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`);
      continue;
    }

    if (/^\s*>/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { body.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      out.push(`<blockquote>${renderMarkdown(body.join('\n'), options).html}</blockquote>`);
      continue;
    }

    if (LIST_RE.test(line)) {
      out.push(parseList(LIST_RE.exec(line)[1].length));
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,6}\s|\s*```|\s*~~~|\s*>)/.test(lines[i]) && !LIST_RE.test(lines[i]) && !(lines[i].includes('|') && isTableSep(lines[i + 1] ?? ''))) {
      para.push(lines[i].trim());
      i++;
    }
    const text = para.join(' ');
    if (!firstParagraph && title) firstParagraph = text.replace(/[`*]/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    out.push(`<p>${inline(text, options)}</p>`);
  }
  return { html: out.join('\n'), headings, title, firstParagraph };
}
