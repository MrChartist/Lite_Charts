// The built-in legend: a small block of DOM text at the top-left of each pane naming its series and the values of the
// hovered bar (the last bar when nothing is hovered). DOM, not canvas, so it can be selected and read by screen
// readers. It lives in a closed shadow root and every style is a CSSOM write, so page CSS and a strict CSP cannot
// reach it (the same rules as the attribution link). The text builders are pure and tested.

import { formatPercent, MINUS_SIGN } from '../core/format';
import { cssReset, css } from '../render/dom';

export interface LegendEntry {
  title: string;
  /** Colour dot before the title (single-value series), or '' for none. */
  dot: string;
  /** "O 110.11  H 111.54  L 108.84  C 110.51", or one value. Empty when the series has no row at that bar. */
  values: string;
  /** Change from the previous close (OHLC rows): text with sign and arrow, and its direction. */
  change: { text: string; dir: 1 | -1 | 0 } | null;
}

type Row = Record<string, unknown>;

const num = (r: Row | null, k: string): number => (r && typeof r[k] === 'number' ? (r[k] as number) : Number.NaN);

/** True for a row with open, high, low and close. */
export function isOhlc(row: Row | null): boolean {
  return !!row && ['open', 'high', 'low', 'close'].every(k => typeof row[k] === 'number');
}

/**
 * Values and change of one row. `prev` is the series' previous row (its close is the base of the change; without it
 * the bar's own open is). `fmt` formats a price; `single` is the value of a single-value row.
 */
export function describeRow(row: Row | null, prev: Row | null, fmt: (v: number) => string, single: (r: Row) => number): Pick<LegendEntry, 'values' | 'change'> {
  if (!row) return { values: '', change: null };
  if (!isOhlc(row)) {
    const v = single(row);
    return { values: Number.isFinite(v) ? fmt(v) : '', change: null };
  }
  const o = num(row, 'open');
  const c = num(row, 'close');
  const values = `O ${fmt(o)}  H ${fmt(num(row, 'high'))}  L ${fmt(num(row, 'low'))}  C ${fmt(c)}`;
  const base = isOhlc(prev) ? num(prev, 'close') : o;
  const ch = c - base;
  if (!Number.isFinite(ch) || base === 0) return { values, change: null };
  const body = fmt(Math.abs(ch));
  const zero = !/[1-9]/.test(body);
  const dir: 1 | -1 | 0 = zero ? 0 : ch > 0 ? 1 : -1;
  const sign = dir > 0 ? '+' : dir < 0 ? MINUS_SIGN : '';
  const arrow = dir > 0 ? '▲ ' : dir < 0 ? '▼ ' : '';
  return { values, change: { text: `${arrow}${sign}${body} (${formatPercent((ch / Math.abs(base)) * 100, 2)})`, dir } };
}

export interface LegendStyle {
  fontFamily: string;
  fontSize: number;
  text: string;
  muted: string;
  up: string;
  down: string;
  background: string;
}

/** One pane's legend box. `update` writes the DOM only when the text or the place changed. */
export class LegendBox {
  readonly host: HTMLElement;
  private body: HTMLElement;
  private doc: Document;
  private key = '';

  constructor(doc: Document, parent: HTMLElement) {
    this.doc = doc;
    this.host = doc.createElement('div');
    this.host.setAttribute('data-chartist-legend', '');
    cssReset(this.host, { position: 'absolute', 'z-index': '1', display: 'none', 'pointer-events': 'auto', 'user-select': 'text', '-webkit-user-select': 'text' });
    let root: ShadowRoot | null = null;
    try { root = this.host.attachShadow({ mode: 'open' }); } catch { root = null; }
    this.body = doc.createElement('div');
    cssReset(this.body, { display: 'block', 'border-radius': '6px', padding: '2px 6px', 'white-space': 'nowrap' });
    if (root) root.appendChild(this.body); else this.host.appendChild(this.body);
    parent.appendChild(this.host);
  }

  hide(): void {
    if (this.key === '') return;
    this.key = '';
    css(this.host, { display: 'none' });
  }

  update(entries: readonly LegendEntry[], box: { left: number; top: number; maxWidth: number }, st: LegendStyle): void {
    const key = JSON.stringify([entries, box, st]);
    if (key === this.key) return;
    this.key = key;
    if (entries.length === 0 || box.maxWidth < 40) { css(this.host, { display: 'none' }); return; }
    css(this.host, { display: 'block', left: `${box.left}px`, top: `${box.top}px`, 'max-width': `${box.maxWidth}px` });
    css(this.body, {
      font: `400 ${st.fontSize}px ${st.fontFamily}`, 'line-height': `${Math.round(st.fontSize * 1.5)}px`, color: st.text,
      'font-variant-numeric': 'tabular-nums', background: withOpacity(st.background, 0.92), direction: 'ltr', 'text-align': 'left',
    });
    this.body.textContent = '';
    // Line 1: the lead series in full. Line 2: the others, side by side. Each line is cut with an ellipsis when narrow.
    const [lead, ...rest] = entries;
    this.body.appendChild(this.line([lead], st));
    if (rest.length) this.body.appendChild(this.line(rest, st));
  }

  private line(entries: readonly LegendEntry[], st: LegendStyle): HTMLElement {
    const d = this.doc;
    const line = d.createElement('div');
    cssReset(line, { display: 'block', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' });
    entries.forEach((e, i) => {
      if (i > 0) line.appendChild(this.span('   ', st.muted));
      if (e.dot) {
        const dot = d.createElement('span');
        cssReset(dot, { display: 'inline-block', width: '8px', height: '8px', 'border-radius': '4px', background: e.dot, 'margin-right': '6px', 'vertical-align': 'middle', 'margin-top': '-2px' });
        line.appendChild(dot);
      }
      const title = this.span(e.title, st.text);
      css(title, { 'font-weight': '600' });
      line.appendChild(title);
      if (e.values) line.appendChild(this.span(`  ${e.values}`, st.muted));
      if (e.change) line.appendChild(this.span(`  ${e.change.text}`, e.change.dir > 0 ? st.up : e.change.dir < 0 ? st.down : st.muted));
    });
    return line;
  }

  private span(text: string, color: string): HTMLElement {
    const s = this.doc.createElement('span');
    cssReset(s, { display: 'inline', color, 'white-space': 'pre', font: 'inherit', 'font-variant-numeric': 'tabular-nums' });
    s.textContent = text;
    return s;
  }

  remove(): void { this.host.remove(); }
}

/** A colour with its alpha set (hex or rgb/rgba); anything else is returned unchanged. */
export function withOpacity(color: string, alpha: number): string {
  const c = color.trim();
  let r: number, g: number, b: number;
  if (c[0] === '#' && (c.length === 7 || c.length === 9)) { r = parseInt(c.slice(1, 3), 16); g = parseInt(c.slice(3, 5), 16); b = parseInt(c.slice(5, 7), 16); }
  else if (c[0] === '#' && (c.length === 4 || c.length === 5)) { r = parseInt(c[1] + c[1], 16); g = parseInt(c[2] + c[2], 16); b = parseInt(c[3] + c[3], 16); }
  else {
    const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(c);
    if (!m) return color;
    r = Number(m[1]); g = Number(m[2]); b = Number(m[3]);
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
