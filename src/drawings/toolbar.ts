// The optional drawing toolbar: a compact rail of icon buttons (tools, keep drawing, magnet, hide all, delete all,
// undo, redo), a floating style bar for the selected drawing, and the text-note editor. DOM in a shadow root, every
// style a CSSOM write with the same important resets as the legend (CSP-safe, page CSS cannot reach it), themed from
// the chart's colours. Icons are our own single-colour line drawings on a 24 grid.

import type { ChartApi } from '../api';
import type { ThemeColors } from '../core/theme';
import { lightTheme } from '../core/theme';
import { css, cssReset } from '../render/dom';
import type { Pt } from './geometry';
import type { DrawingToolsController, DrawingToolsUi } from './controller';
import type { Drawing, ToolId } from './tools';

const SVG = 'http://www.w3.org/2000/svg';
/** The left rail starts under the legend (two lines at the top-left of the pane). */
const RAIL_TOP = 52;

/** 24-grid line icons, drawn for this toolbar (stroke 1.6, round caps; dots are short zero-length strokes). */
export const ICONS: Readonly<Record<string, string>> = {
  cursor: 'M6.5 4.5l11 6.6-4.9 1.4-2.4 4.6z',
  trend: 'M5 19L19 5M5 19h.01M19 5h.01',
  ray: 'M5 19L21 3M5 19h.01',
  extended: 'M2 22L22 2M8 16h.01M16 8h.01',
  horizontal: 'M3 12h18M12 12h.01',
  horizontalRay: 'M8 12h13M8 12h.01',
  vertical: 'M12 3v18M12 12h.01',
  rectangle: 'M5 7h14v10H5z',
  channel: 'M3 14L14 4M10 20L21 10',
  fib: 'M4 5h16M4 9.5h16M4 14h16M4 19h16',
  measure: 'M4 17L17 4l3 3L7 20zM8 13l2 2M11 10l2 2M14 7l2 2',
  long: 'M4 20h16M12 16V5M8 9l4-4 4 4',
  short: 'M4 4h16M12 8v11M8 15l4 4 4-4',
  arrow: 'M5 19L18 6M10 6h8v8',
  text: 'M6 6h12M12 6v13M9 19h6',
  brush: 'M4 17c2.5 0 3-4 5.5-4s3 4 5.5 4 3-6 5-9',
  keep: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z',
  magnet: 'M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4zM6 8h4M14 8h4',
  hide: 'M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 1 0 0-5',
  trash: 'M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13M10.5 11v5M13.5 11v5',
  undo: 'M9 6L4 11l5 5M4 11h10a5 5 0 0 1 0 10h-2',
  redo: 'M15 6l5 5-5 5M20 11H10a5 5 0 0 0 0 10h2',
  dash: 'M3 12h4M10 12h4M17 12h4',
  solid: 'M3 12h18',
};

function icon(doc: Document, name: string): SVGSVGElement {
  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = doc.createElementNS(SVG, 'path');
  path.setAttribute('d', ICONS[name] ?? '');
  svg.appendChild(path);
  return svg;
}

const TOOL_ICON: Record<ToolId, string> = {
  trend: 'trend', ray: 'ray', extended: 'extended', horizontal: 'horizontal', horizontalRay: 'horizontalRay',
  vertical: 'vertical', rectangle: 'rectangle', channel: 'channel', fib: 'fib', measure: 'measure', long: 'long',
  short: 'short', arrow: 'arrow', text: 'text', brush: 'brush',
};

/** Swatch colours for the style bar, per theme (no purple): line blue, green, red, orange, ink. */
function swatches(c: Readonly<ThemeColors>): string[] {
  const dark = c.background !== lightTheme.background && isDark(c.background);
  return [c.line, c.up, c.down, dark ? '#FF9F0A' : '#C93400', c.text];
}

function isDark(hex: string): boolean {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 < 128;
}

interface Btn { el: HTMLButtonElement; kind: string; tool?: ToolId | null }

export function createToolbar(chart: ChartApi, ctl: DrawingToolsController, position: 'left' | 'top'): DrawingToolsUi {
  const root = chart.element();
  const doc = root.ownerDocument;
  const coarse = (): boolean => { try { return !!doc.defaultView?.matchMedia?.('(pointer: coarse)').matches; } catch { return false; } };
  const size = coarse() ? 44 : 28;

  const host = doc.createElement('div');
  host.setAttribute('data-chartist-drawing-ui', '');
  cssReset(host, { position: 'absolute', 'z-index': '3', display: 'block', left: '0', top: '0', width: '0', height: '0' });
  let shadow: ShadowRoot | HTMLElement = host;
  try { shadow = host.attachShadow({ mode: 'open' }); } catch { shadow = host; }
  // The chart must not pan, zoom or take keys for what happens on the toolbar.
  for (const t of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'dblclick', 'keydown']) host.addEventListener(t, ev => ev.stopPropagation());
  root.appendChild(host);

  const rail = doc.createElement('div');
  rail.setAttribute('role', 'toolbar');
  rail.setAttribute('aria-label', 'Drawing tools');
  rail.setAttribute('aria-orientation', position === 'left' ? 'vertical' : 'horizontal');
  shadow.appendChild(rail);

  const buttons: Btn[] = [];
  let confirmClear = false;

  function button(kind: string, label: string, iconName: string, onClick: () => void, tool?: ToolId | null): Btn {
    const el = doc.createElement('button');
    el.type = 'button';
    el.setAttribute('aria-label', label);
    el.title = label;
    el.tabIndex = -1;
    el.appendChild(icon(doc, iconName));
    el.addEventListener('click', () => { if (kind !== 'clear') confirmClear = false; onClick(); sync(); });
    el.addEventListener('pointerdown', () => css(el, { transform: 'scale(0.97)' }));
    const release = (): void => css(el, { transform: 'none' });
    el.addEventListener('pointerup', release);
    el.addEventListener('pointerleave', () => { release(); hover(el, false); });
    el.addEventListener('pointerenter', () => hover(el, true));
    el.addEventListener('focus', () => ring(el));
    el.addEventListener('blur', () => { ring(el); if (kind === 'clear' && confirmClear) { confirmClear = false; sync(); } });
    const b: Btn = { el, kind, tool };
    buttons.push(b);
    return b;
  }

  function sep(): HTMLElement {
    const d = doc.createElement('div');
    d.setAttribute('role', 'separator');
    rail.appendChild(d);
    return d;
  }

  const seps: HTMLElement[] = [];
  rail.appendChild(button('tool', 'Cursor', 'cursor', () => ctl.setTool(null), null).el);
  for (const t of ctl.tools()) rail.appendChild(button('tool', t.label, TOOL_ICON[t.id], () => ctl.setTool(ctl.tool() === t.id ? null : t.id), t.id).el);
  seps.push(sep());
  rail.appendChild(button('keep', 'Keep drawing', 'keep', () => ctl.setKeepDrawing(!ctl.keepDrawing())).el);
  rail.appendChild(button('magnet', 'Magnet: snap to open, high, low, close', 'magnet', () => ctl.setMagnet(!ctl.magnet())).el);
  rail.appendChild(button('hide', 'Hide drawings', 'hide', () => ctl.setHidden(!ctl.hidden())).el);
  rail.appendChild(button('clear', 'Delete all drawings', 'trash', () => {
    if (!ctl.drawings().length) return;
    if (confirmClear) { confirmClear = false; ctl.clear(); } else confirmClear = true;
  }).el);
  seps.push(sep());
  rail.appendChild(button('undo', 'Undo', 'undo', () => ctl.undo()).el);
  rail.appendChild(button('redo', 'Redo', 'redo', () => ctl.redo()).el);

  // Roving tab index: one stop for the rail, arrows move inside it.
  let focusAt = 0;
  rail.addEventListener('keydown', ev => {
    const k = ev.key;
    const next = position === 'left' ? 'ArrowDown' : 'ArrowRight';
    const prev = position === 'left' ? 'ArrowUp' : 'ArrowLeft';
    let i = focusAt;
    if (k === next) i = (focusAt + 1) % buttons.length;
    else if (k === prev) i = (focusAt - 1 + buttons.length) % buttons.length;
    else if (k === 'Home') i = 0;
    else if (k === 'End') i = buttons.length - 1;
    else if (k === 'Escape') { ctl.setTool(null); root.focus(); ev.preventDefault(); return; }
    else return;
    ev.preventDefault();
    focusAt = i;
    sync();
    buttons[i].el.focus();
  });
  rail.addEventListener('focusin', ev => {
    const i = buttons.findIndex(b => b.el === ev.target);
    if (i >= 0 && i !== focusAt) { focusAt = i; sync(); }
  });

  // ── style bar for the selected drawing ──
  const bar = doc.createElement('div');
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Drawing style');
  shadow.appendChild(bar);
  const swatchEls: HTMLButtonElement[] = [];
  for (let i = 0; i < 5; i++) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => { const sel = ctl.selected(); if (sel) ctl.update(sel.id, { style: { color: (b as HTMLButtonElement & { _c?: string })._c } }); sync(); });
    swatchEls.push(b);
    bar.appendChild(b);
  }
  const widthEls: HTMLButtonElement[] = [];
  for (const w of [1, 2, 3] as const) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', `Line width ${w}`);
    b.title = `Line width ${w}`;
    const svg = icon(doc, 'solid');
    svg.setAttribute('stroke-width', String(w * 1.2));
    b.appendChild(svg);
    b.addEventListener('click', () => { const sel = ctl.selected(); if (sel) ctl.update(sel.id, { style: { width: w } }); sync(); });
    widthEls.push(b);
    bar.appendChild(b);
  }
  const dashEl = doc.createElement('button');
  dashEl.type = 'button';
  dashEl.setAttribute('aria-label', 'Dashed line');
  dashEl.title = 'Dashed line';
  dashEl.appendChild(icon(doc, 'dash'));
  dashEl.addEventListener('click', () => { const sel = ctl.selected(); if (sel) ctl.update(sel.id, { style: { dash: sel.style.dash === 'dashed' ? 'solid' : 'dashed' } }); sync(); });
  bar.appendChild(dashEl);
  const delEl = doc.createElement('button');
  delEl.type = 'button';
  delEl.setAttribute('aria-label', 'Delete drawing');
  delEl.title = 'Delete drawing';
  delEl.appendChild(icon(doc, 'trash'));
  delEl.addEventListener('click', () => { const sel = ctl.selected(); if (sel) ctl.remove(sel.id); sync(); });
  bar.appendChild(delEl);
  for (const b of [...swatchEls, ...widthEls, dashEl, delEl]) {
    b.addEventListener('focus', () => ring(b));
    b.addEventListener('blur', () => ring(b));
  }

  // ── text editor ──
  let editor: HTMLInputElement | null = null;

  function colors(): Readonly<ThemeColors> { return ctl.colors() ?? lightTheme; }

  function hover(el: HTMLElement, on: boolean): void {
    if (el.getAttribute('aria-pressed') === 'true') return;
    css(el, { background: on ? colors().grid : 'transparent' });
  }

  function ring(el: HTMLElement): void {
    let v = false;
    try { v = el.matches(':focus-visible'); } catch { v = false; }
    css(el, { 'box-shadow': v ? `0 0 0 2px ${colors().focusRing}` : 'none' });
  }

  function plotLeft(): number { return chart.priceScale('left').width(); }
  function paneTop(pane: number): number {
    const panes = chart.panes();
    let y = 0;
    for (let i = 0; i < pane && i < panes.length; i++) y += panes[i].getHeight() + 1;
    return y;
  }

  function sync(): void {
    const c = colors();
    const font = `500 12px ${chart.options().fontFamily}`;
    const vertical = position === 'left';
    const p0h = chart.panes()[0]?.getHeight() ?? 0;
    const n = buttons.length;
    const railLen = n * (size + 2) + seps.length * 9 + 8;
    const maxH = Math.max(60, p0h - RAIL_TOP - 8);
    const cols = vertical ? Math.max(1, Math.ceil(railLen / maxH)) : 1;
    cssReset(rail, {
      position: 'absolute', display: 'flex', 'flex-direction': vertical ? 'column' : 'row', 'align-items': 'center', gap: '2px',
      padding: '4px', background: c.background, border: `1px solid ${c.paneSeparator}`, 'border-radius': '12px',
      left: vertical ? `${plotLeft() + 8}px` : `${Math.max(8, (root.clientWidth - railLen) / 2)}px`,
      // Below the legend's two lines; a rail taller than the pane wraps into a second column.
      top: vertical ? `${Math.max(RAIL_TOP, (p0h - Math.min(railLen, maxH)) / 2)}px` : '8px',
      'max-height': vertical ? `${maxH}px` : 'none', 'flex-wrap': 'wrap', 'align-content': 'flex-start',
      // A wrapped column flex box does not grow wider by itself: give it the width of its columns.
      width: vertical ? `${cols * (size + 2) + 8}px` : 'auto', 'box-sizing': 'border-box',
      'pointer-events': 'auto',
    });
    for (const s of seps) cssReset(s, { display: 'block', [vertical ? 'width' : 'height']: '18px', [vertical ? 'height' : 'width']: '1px', background: c.paneSeparator, margin: vertical ? '3px 0' : '0 3px', 'flex-shrink': '0' });
    buttons.forEach((b, i) => {
      let pressed: boolean | null = null;
      if (b.kind === 'tool') pressed = ctl.tool() === (b.tool ?? null);
      else if (b.kind === 'keep') pressed = ctl.keepDrawing();
      else if (b.kind === 'magnet') pressed = ctl.magnet();
      else if (b.kind === 'hide') pressed = ctl.hidden();
      const disabled = (b.kind === 'undo' && !ctl.canUndo()) || (b.kind === 'redo' && !ctl.canRedo());
      if (pressed === null) b.el.removeAttribute('aria-pressed'); else b.el.setAttribute('aria-pressed', String(pressed));
      b.el.disabled = disabled;
      b.el.tabIndex = i === focusAt ? 0 : -1;
      const danger = b.kind === 'clear' && confirmClear;
      if (b.kind === 'clear') { const l = danger ? 'Click again to delete all drawings' : 'Delete all drawings'; b.el.setAttribute('aria-label', l); b.el.title = l; }
      // Selected = inverted ink (the house rule); the rest in plain ink, disabled at 35%.
      cssReset(b.el, {
        display: 'inline-flex', 'align-items': 'center', 'justify-content': 'center', width: `${size}px`, height: `${size}px`,
        'border-radius': `${size / 2}px`, background: pressed ? c.text : danger ? c.grid : 'transparent',
        color: pressed ? c.background : danger ? c.downText : c.text, cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? '0.35' : '1', font, 'flex-shrink': '0', transition: 'background-color 120ms, color 120ms',
      });
    });
    // Style bar: above the selected drawing, inside the chart.
    const sel = ctl.hidden() ? null : ctl.selected();
    if (!sel) { cssReset(bar, { display: 'none' }); return; }
    const sw = swatches(c);
    const items = [...swatchEls, ...widthEls, dashEl, delEl];
    const barW = items.length * (size + 2) + 8;
    const pos = selectionPoint(sel);
    // Inside the plot: never over the price axis.
    const left = Math.max(plotLeft() + 4, Math.min(plotLeft() + chart.timeScale().width() - barW - 4, pos.x - barW / 2));
    const top = Math.max(4, pos.y - size - 22);
    cssReset(bar, {
      position: 'absolute', display: 'flex', 'flex-direction': 'row', 'align-items': 'center', gap: '2px', padding: '4px',
      background: c.background, border: `1px solid ${c.paneSeparator}`, 'border-radius': '12px', left: `${left}px`, top: `${top}px`,
      'pointer-events': 'auto',
    });
    swatchEls.forEach((b, i) => {
      const col = sw[i];
      (b as HTMLButtonElement & { _c?: string })._c = col;
      const on = (sel.style.color ?? c.line) === col;
      b.setAttribute('aria-checked', String(on));
      b.setAttribute('aria-label', ['Blue', 'Green', 'Red', 'Orange', 'Ink'][i]);
      b.title = ['Blue', 'Green', 'Red', 'Orange', 'Ink'][i];
      cssReset(b, {
        display: 'inline-block', width: `${size}px`, height: `${size}px`, 'border-radius': `${size / 2}px`, background: 'transparent',
        cursor: 'pointer', 'flex-shrink': '0', 'box-shadow': on ? `inset 0 0 0 2px ${c.text}` : 'none', padding: '0',
      });
      b.textContent = '';
      const dot = doc.createElement('span');
      cssReset(dot, { display: 'block', width: '14px', height: '14px', 'border-radius': '7px', background: col, margin: 'auto' });
      b.appendChild(dot);
    });
    widthEls.forEach((b, i) => {
      const on = sel.style.width === i + 1;
      b.setAttribute('aria-checked', String(on));
      cssReset(b, { display: 'inline-flex', 'align-items': 'center', 'justify-content': 'center', width: `${size}px`, height: `${size}px`, 'border-radius': `${size / 2}px`, background: on ? c.text : 'transparent', color: on ? c.background : c.text, cursor: 'pointer', 'flex-shrink': '0' });
    });
    dashEl.setAttribute('aria-pressed', String(sel.style.dash === 'dashed'));
    for (const [b, on] of [[dashEl, sel.style.dash === 'dashed'], [delEl, false]] as const) {
      cssReset(b, { display: 'inline-flex', 'align-items': 'center', 'justify-content': 'center', width: `${size}px`, height: `${size}px`, 'border-radius': `${size / 2}px`, background: on ? c.text : 'transparent', color: on ? c.background : c.text, cursor: 'pointer', 'flex-shrink': '0' });
    }
  }

  /** Chart coordinates of the top centre of a drawing (for the style bar). */
  function selectionPoint(d: Drawing): Pt {
    const ts = chart.timeScale();
    const s = chart.panes()[d.pane]?.getSeries()[0];
    let x = 0, y = Infinity, n = 0;
    for (const p of d.points) {
      const l = ts.timeToLogical(p.time);
      const px = l === null ? null : ts.logicalToCoordinate(l);
      const py = s?.priceToCoordinate(p.price) ?? null;
      if (px === null || py === null) continue;
      x += px; n++;
      y = Math.min(y, py);
    }
    const ph = chart.panes()[d.pane]?.getHeight() ?? 0;
    const top = paneTop(d.pane);
    return { x: plotLeft() + (n ? x / n : ts.width() / 2), y: top + (Number.isFinite(y) ? Math.max(0, Math.min(ph, y)) : 0) };
  }

  function editText(d: Drawing, at: Pt): void {
    editor?.remove();
    const input = doc.createElement('input');
    input.type = 'text';
    input.value = d.text ?? '';
    input.placeholder = 'Text';
    input.setAttribute('aria-label', 'Text of the note');
    const c = colors();
    cssReset(input, {
      position: 'absolute', left: `${plotLeft() + at.x}px`, top: `${paneTop(d.pane) + at.y - 14}px`, width: '160px', height: '28px',
      padding: '0 8px', 'border-radius': '8px', border: `1px solid ${c.focusRing}`, background: c.background, color: c.text,
      font: `500 13px ${chart.options().fontFamily}`, 'pointer-events': 'auto', outline: 'none',
    });
    let done = false;
    const finish = (keepText: boolean): void => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      input.remove();
      editor = null;
      if (keepText && v) ctl.update(d.id, { text: v });
      root.focus();
    };
    input.addEventListener('keydown', ev => {
      ev.stopPropagation();
      if (ev.key === 'Enter') finish(true);
      else if (ev.key === 'Escape') finish(false);
    });
    let focused = false;
    input.addEventListener('focus', () => { focused = true; });
    input.addEventListener('blur', () => { if (focused) finish(true); });
    shadow.appendChild(input);
    editor = input;
    // After the press that placed the note has finished (its mousedown focuses the chart).
    const win = doc.defaultView;
    if (win) win.requestAnimationFrame(() => input.focus()); else input.focus();
  }

  sync();
  return {
    sync,
    editText,
    destroy() { editor?.remove(); host.remove(); },
  };
}

