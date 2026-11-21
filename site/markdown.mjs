// A small Markdown renderer for this site: headings (with ids), paragraphs, lists (nested), tables, fenced code,
// blockquotes, rules, links, images, inline code, bold and italic. Raw HTML in the source is escaped, never passed on.
// Pure: no file or network access. `options.resolveLink(href)` may rewrite a link target; `options.imageSize(src)`
// may return { width, height } for an image.
//
// Site conventions on top of plain Markdown:
//   ```js live height=360 controls=zone      a live example: `options.live({ lang, code, attrs })` returns its HTML
//   > [!NOTE] / [!TIP] / [!WARNING] / [!VERIFY]   a callout (VERIFY reads "Needs verification")
//   options.entries = true                     each h3 and what follows it is wrapped in <section class="entry">
//   options.html = true                        (the README only) the small HTML set GitHub renders: <p align>, <div align>,
//                                              <picture>/<source>/<img>, <details>/<summary>, <h1 align>. Image paths go
//                                              through resolveAsset; remote images (badges) become text chips, so the site
//                                              loads nothing from other hosts.
// Code is highlighted at build time (highlight.mjs) and framed with a language label and a copy button.
import { highlight, LANG_LABELS } from './highlight.mjs';

const CALLOUTS = { NOTE: 'Note', TIP: 'Tip', WARNING: 'Warning', VERIFY: 'Needs verification' };

/** One line of the README's GitHub HTML, made safe for the site: known tags only, images resolved, badges as text. */
function rawHtml(line, options) {
  let s = line.replace(/<img\b([^>]*)>/gi, (_m, attrs) => {
    const get = (k) => { const m = new RegExp(`\\b${k}="([^"]*)"`, 'i').exec(attrs); return m ? m[1] : ''; };
    const src = get('src'); const alt = get('alt');
    if (/^https?:/i.test(src)) return `<span class="tag">${esc(alt)}</span>`;
    const size = options.imageSize ? options.imageSize(src) : null;
    const url = options.resolveAsset ? options.resolveAsset(src) : src;
    return `<img src="${esc(url)}" alt="${esc(alt)}"${size ? ` width="${size.width}" height="${size.height}"` : ''} loading="lazy" decoding="async">`;
  });
  s = s.replace(/<source\b([^>]*)>/gi, (_m, attrs) => {
    const media = /media="([^"]*)"/i.exec(attrs); const set = /srcset="([^"]*)"/i.exec(attrs);
    if (!set) return '';
    const url = options.resolveAsset ? options.resolveAsset(set[1]) : set[1];
    return `<source${media ? ` media="${esc(media[1])}"` : ''} srcset="${esc(url)}">`;
  });
  s = s.replace(/<a href="([^"]*)">/gi, (_m, href) => { const r = options.resolveLink ? options.resolveLink(href) : { href }; return r && r.href ? `<a href="${esc(r.href)}">` : '<a>'; });
  // Keep only these tags; anything else is shown as text.
  return s.replace(/<(?!\/?(p|div|picture|source|img|details|summary|br|a|span)\b)/gi, '&lt;');
}

/** A framed, highlighted code block. */
export function codeBlock(code, lang, extraClass = '') {
  const label = LANG_LABELS[(lang || '').toLowerCase()] || (lang ? lang.toUpperCase() : 'Code');
  const cls = lang ? ` class="language-${esc(lang)}"` : '';
  return `<div class="code${extraClass ? ` ${extraClass}` : ''}"><div class="code-head"><span class="code-lang">${esc(label)}</span><button class="copy" type="button" hidden>Copy</button></div><pre tabindex="0"><code${cls}>${highlight(code, lang)}</code></pre></div>`;
}

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
  let entryOpen = false;
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

    if (options.html && /^\s*<\/?(p|div|picture|source|img|details|summary|h1|br|a)\b/i.test(line)) {
      const h1 = /^\s*<h1[^>]*>(.*?)<\/h1>\s*$/i.exec(line);
      if (h1) { lines[i] = `# ${h1[1]}`; continue; }
      out.push(rawHtml(line, options));
      i++;
      continue;
    }

    const fence = /^(\s*)(```+|~~~+)\s*([\w+-]*)((?:\s+[\w-]+(?:=\S+)?)*)\s*$/.exec(line);
    if (fence) {
      const close = fence[2];
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(close)) { body.push(lines[i].slice(Math.min(fence[1].length, lines[i].length - lines[i].trimStart().length))); i++; }
      i++;
      const attrs = {};
      for (const m of (fence[4] || '').trim().split(/\s+/).filter(Boolean)) { const [k, v] = m.split('='); attrs[k] = v === undefined ? true : v; }
      const code = body.join('\n');
      if (attrs.live && options.live) out.push(options.live({ lang: fence[3], code, attrs, heading: lastHeading }));
      else if (fence[3] === 'sig') out.push(`<pre class="sig" tabindex="0" aria-label="Signature"><code class="language-ts">${highlight(code, 'ts')}</code></pre>`);
      else out.push(codeBlock(code, fence[3]));
      continue;
    }

    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      const level = h[1].length;
      const raw = h[2];
      const plain = raw.replace(/`/g, '').replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
      const id = uniqueId(plain);
      lastHeading = plain;
      if (options.entries && entryOpen && level <= 3) { out.push('</section>'); entryOpen = false; }
      if (level === 1 && !title) { title = plain; out.push(`<h1 id="${id}">${inline(raw, options)}</h1>`); }
      else {
        if (options.entries && level === 3) { out.push(`<section class="entry" data-entry="${esc(plain.toLowerCase())}">`); entryOpen = true; }
        headings.push({ level, text: plain, id, lead: '' });
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
      const tr = rows.map((r) => `<tr>${head.map((_c, k) => `<td${k === 0 ? ' class="key"' : ''}>${inline(r[k] ?? '', options)}</td>`).join('')}</tr>`).join('');
      const kind = head.length >= 3 && head.some((h) => /^default$/i.test(h.trim())) ? ' table--options' : '';
      out.push(`<div class="table-wrap${kind}" role="region" tabindex="0" aria-label="Table: ${esc(lastHeading || title)}"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`);
      continue;
    }

    if (/^\s*>/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { body.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      const kind = /^\[!(NOTE|TIP|WARNING|VERIFY)\]\s*$/.exec(body[0] || '');
      if (kind) {
        const inner = renderMarkdown(body.slice(1).join('\n'), { ...options, entries: false }).html;
        out.push(`<aside class="callout callout--${kind[1].toLowerCase()}" aria-label="${CALLOUTS[kind[1]]}"><p class="callout-title">${CALLOUTS[kind[1]]}</p>${inner}</aside>`);
      } else out.push(`<blockquote>${renderMarkdown(body.join('\n'), { ...options, entries: false }).html}</blockquote>`);
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
    const plainText = text.replace(/[`*]/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    if (!firstParagraph && title) firstParagraph = plainText;
    const lastH = headings[headings.length - 1];
    if (lastH && !lastH.lead) lastH.lead = plainText;
    out.push(`<p>${inline(text, options)}</p>`);
  }
  if (entryOpen) out.push('</section>');
  return { html: out.join('\n'), headings, title, firstParagraph };
}
