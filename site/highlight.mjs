// A small build-time syntax highlighter for the site: js, ts, jsx, html, css, json and bash. It returns HTML with
// tokens as <span class="t-…"> (classes: k keyword, s string, c comment, n number, f function call, p property,
// tag, a attribute, v attribute value, x punctuation). No dependency, no regex backtracking traps: one left-to-right
// scan per language. Unknown languages come back escaped and unhighlighted.

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const span = (cls, text) => (text ? `<span class="t-${cls}">${esc(text)}</span>` : '');

const JS_KEYWORDS = new Set(('const let var function return if else for while do of in new import from export default as '
  + 'class extends interface type typeof keyof readonly async await try catch finally throw this null undefined true '
  + 'false void break continue switch case yield static implements enum declare').split(' '));
const TS_TYPES = new Set('string number boolean unknown any never object Record Partial Readonly Map Set Array Promise HTMLElement'.split(' '));

function highlightJs(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let prevSignificant = '';
  while (i < n) {
    const c = src[i];
    const rest = src.slice(i);
    // comments
    if (c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? n : e; out += span('c', src.slice(i, end)); i = end; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2; out += span('c', src.slice(i, end)); i = end; continue; }
    // strings
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === '\\') j++; if (c !== '`' && src[j] === '\n') break; j++; }
      out += span('s', src.slice(i, j + 1)); i = j + 1; prevSignificant = 's'; continue;
    }
    // numbers
    const num = /^(?:0x[\da-fA-F]+|\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?)/.exec(rest);
    if (num && !/[\w$]/.test(src[i - 1] || '')) { out += span('n', num[0]); i += num[0].length; prevSignificant = 'n'; continue; }
    // JSX tags
    if (c === '<' && /^<\/?[A-Za-z]/.test(rest) && /[(=,:?&|>{}\n]|return|^$/.test(prevSignificant || '\n')) {
      const m = /^<\/?([A-Za-z][\w.]*)/.exec(rest);
      out += span('x', m[0].startsWith('</') ? '</' : '<') + span('tag', m[1]);
      i += m[0].length;
      // attributes up to > (braces hold JS)
      while (i < n && src[i] !== '>') {
        if (src[i] === '{') {
          let depth = 0; let j = i;
          for (; j < n; j++) { if (src[j] === '{') depth++; else if (src[j] === '}') { depth--; if (depth === 0) break; } }
          out += span('x', '{') + highlightJs(src.slice(i + 1, j)) + span('x', '}');
          i = j + 1; continue;
        }
        const a = /^[A-Za-z_][\w-]*/.exec(src.slice(i));
        if (a) { out += span('a', a[0]); i += a[0].length; continue; }
        if (src[i] === '"' || src[i] === "'") { const q = src[i]; const e = src.indexOf(q, i + 1); const end = e < 0 ? n : e + 1; out += span('v', src.slice(i, end)); i = end; continue; }
        if (src[i] === '/') { out += span('x', '/'); i++; continue; }
        out += esc(src[i]); i++;
      }
      if (i < n) { out += span('x', '>'); i++; }
      prevSignificant = '>';
      continue;
    }
    // identifiers
    const id = /^[A-Za-z_$][\w$]*/.exec(rest);
    if (id) {
      const w = id[0];
      const after = src.slice(i + w.length);
      const before = src[i - 1];
      if (JS_KEYWORDS.has(w)) out += span('k', w);
      else if (TS_TYPES.has(w)) out += span('k', w);
      else if (/^\s*\(/.test(after) || /^\s*<[A-Z][\w<>, ]*>\s*\(/.test(after)) out += span('f', w);
      else if (before === '.') out += span('p', w);
      else if (/^\??\s*:(?!:)/.test(after) && /[{,\s(]/.test(before || ' ') && !/\?\s*$/.test(src.slice(Math.max(0, i - 3), i))) out += span('p', w);
      else out += esc(w);
      i += w.length; prevSignificant = w; continue;
    }
    if (/\s/.test(c)) { out += c; i++; continue; }
    out += esc(c); i++; prevSignificant = c;
  }
  return out;
}

function highlightHtml(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    if (src.startsWith('<!--', i)) { const e = src.indexOf('-->', i); const end = e < 0 ? n : e + 3; out += span('c', src.slice(i, end)); i = end; continue; }
    if (src[i] === '<' && /[A-Za-z/!]/.test(src[i + 1] || '')) {
      const m = /^<\/?!?([A-Za-z][\w-]*)/.exec(src.slice(i));
      if (!m) { out += esc(src[i]); i++; continue; }
      const name = m[1].toLowerCase();
      const closing = m[0].startsWith('</');
      out += span('x', m[0].slice(0, m[0].length - m[1].length)) + span('tag', m[1]);
      i += m[0].length;
      let typeAttr = '';
      while (i < n && src[i] !== '>') {
        const a = /^[A-Za-z_:@][\w:.-]*/.exec(src.slice(i));
        if (a) { out += span('a', a[0]); const attr = a[0]; i += a[0].length;
          if (src[i] === '=') { out += span('x', '='); i++;
            if (src[i] === '"' || src[i] === "'") { const q = src[i]; const e = src.indexOf(q, i + 1); const end = e < 0 ? n : e + 1; const val = src.slice(i, end); if (attr === 'type') typeAttr = val; out += span('v', val); i = end; }
            else { const v = /^[^\s>]+/.exec(src.slice(i)); if (v) { out += span('v', v[0]); i += v[0].length; } }
          }
          continue; }
        if (src[i] === '/') { out += span('x', '/'); i++; continue; }
        out += esc(src[i]); i++;
      }
      if (i < n) { out += span('x', '>'); i++; }
      // script and style bodies
      if (!closing && (name === 'script' || name === 'style')) {
        const close = src.toLowerCase().indexOf(`</${name}`, i);
        const end = close < 0 ? n : close;
        const body = src.slice(i, end);
        if (name === 'style') out += highlightCss(body);
        else if (/json/.test(typeAttr)) out += highlightJson(body);
        else if (/csv/.test(typeAttr)) out += esc(body);
        else out += highlightJs(body);
        i = end;
      }
      continue;
    }
    if (src[i] === '&') { const m = /^&[#\w]+;/.exec(src.slice(i)); if (m) { out += span('k', m[0]); i += m[0].length; continue; } }
    out += esc(src[i]); i++;
  }
  return out;
}

function highlightCss(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let inBlock = 0;
  while (i < n) {
    const rest = src.slice(i);
    if (rest.startsWith('/*')) { const e = src.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2; out += span('c', src.slice(i, end)); i = end; continue; }
    const c = src[i];
    if (c === '"' || c === "'") { const e = src.indexOf(c, i + 1); const end = e < 0 ? n : e + 1; out += span('s', src.slice(i, end)); i = end; continue; }
    if (c === '{') { inBlock++; out += span('x', c); i++; continue; }
    if (c === '}') { inBlock = Math.max(0, inBlock - 1); out += span('x', c); i++; continue; }
    if (inBlock) {
      const prop = /^(--[\w-]+|[a-z-]+)(\s*:)/.exec(rest);
      if (prop && /[{;\s]/.test(src[i - 1] || ' ')) { out += span('p', prop[1]) + span('x', prop[2]); i += prop[0].length; continue; }
      const num = /^-?\d*\.?\d+(px|em|rem|%|vh|vw|s|ms|deg)?/.exec(rest);
      if (num && !/[\w-]/.test(src[i - 1] || '')) { out += span('n', num[0]); i += num[0].length; continue; }
      const hex = /^#[\da-fA-F]{3,8}\b/.exec(rest);
      if (hex) { out += span('n', hex[0]); i += hex[0].length; continue; }
      const fn = /^([a-z-]+)\(/.exec(rest);
      if (fn) { out += span('f', fn[1]) + span('x', '('); i += fn[0].length; continue; }
    } else {
      const sel = /^[^{/"']+/.exec(rest);
      if (sel) { out += span('tag', sel[0].replace(/\s+$/, '')) + sel[0].slice(sel[0].replace(/\s+$/, '').length); i += sel[0].length; continue; }
    }
    out += esc(c); i++;
  }
  return out;
}

function highlightJson(src) {
  return src.replace(/("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],:])|([^"\d{}[\],:tfn-]+|[\s\S])/g,
    (m, str, colon, num, lit, punct) => {
      if (str) return colon ? span('p', str) + colon : span('s', str);
      if (num) return span('n', num);
      if (lit) return span('k', lit);
      if (punct) return punct;
      return esc(m);
    });
}

function highlightBash(src) {
  return src.split('\n').map((line) => {
    let out = '';
    let i = 0;
    let first = true;
    while (i < line.length) {
      const rest = line.slice(i);
      if (/^\s/.test(rest)) { const m = /^\s+/.exec(rest)[0]; out += m; i += m.length; continue; }
      if (rest[0] === '#') { out += span('c', rest); break; }
      if (rest[0] === '"' || rest[0] === "'") { const e = line.indexOf(rest[0], i + 1); const end = e < 0 ? line.length : e + 1; out += span('s', line.slice(i, end)); i = end; first = false; continue; }
      if (/^(&&|\|\||[|;])/.test(rest)) { const m = /^(&&|\|\||[|;])/.exec(rest)[0]; out += span('x', m); i += m.length; first = true; continue; }
      const w = /^[^\s"'#|;&]+/.exec(rest)[0];
      if (first) out += span('f', w);
      else if (w.startsWith('-')) out += span('a', w);
      else out += esc(w);
      i += w.length; first = false;
    }
    return out;
  }).join('\n');
}

const LANGS = { js: highlightJs, javascript: highlightJs, ts: highlightJs, typescript: highlightJs, jsx: highlightJs, tsx: highlightJs, html: highlightHtml, xml: highlightHtml, css: highlightCss, json: highlightJson, bash: highlightBash, sh: highlightBash, shell: highlightBash };

export const LANG_LABELS = { js: 'JavaScript', javascript: 'JavaScript', ts: 'TypeScript', typescript: 'TypeScript', jsx: 'JSX', tsx: 'TSX', html: 'HTML', xml: 'XML', css: 'CSS', json: 'JSON', bash: 'Terminal', sh: 'Terminal', shell: 'Terminal' };

/** Highlight `code` written in `lang`. Returns safe HTML. */
export function highlight(code, lang) {
  const fn = LANGS[(lang || '').toLowerCase()];
  return fn ? fn(code) : esc(code);
}
