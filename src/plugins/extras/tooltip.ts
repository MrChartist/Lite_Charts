// Tooltip: three looks for the values under the crosshair. 'floating' follows the pointer and flips at the edges;
// 'tracking' is a compact card pinned above the hovered bar with a marker dot; 'magnifier' is a fixed strip along the
// top of the plot with the value large. Every mode lists the date and, for each visible titled series, O H L C or the
// value, with the change and percent (sign and arrow as well as colour). It reads the crosshair (so the mouse and the
// keyboard inspect mode work), shows on a touch long-press then drag, hides when the pointer leaves, and never takes
// a pointer event. DOM lives in a shadow root with CSSOM styles; text is set with textContent only.

import type { ChartApi, MouseEventParams } from '../../api';
import type { ThemeColors } from '../../core/theme';
import { formatPercent, MINUS_SIGN } from '../../core/format';
import type { Time, TimeKind } from '../../core/time';
import { timeToSeconds } from '../../core/time';
import type { ChartPrimitive, PrimitiveHost } from '../primitive';
import type { AnySeries, Elem, Removable, UiState } from './common';
import {
  allSeries, createHost, css, formatterFor, isOhlcRow, kindOfRows, make, numberOf, paneTopOf, readoutOf, removable, rowIndexAt,
  stampText, useChartUi, withAlpha,
} from './common';

export type TooltipMode = 'floating' | 'tracking' | 'magnifier';

export interface TooltipChange {
  /** "▲ +1.20 (+1.10%)": arrow, sign, amount and percent. */
  text: string;
  dir: 1 | -1 | 0;
  amount: string;
  percent: string;
}

/** The numbers of one row as text, ready to lay out. Pure. */
export interface BarText {
  kind: 'ohlc' | 'value' | 'none';
  /** O, H, L, C (empty for a value row). */
  cells: { label: string; value: string }[];
  /** The close, or the value. */
  value: string;
  change: TooltipChange | null;
}

export interface TooltipEntry {
  title: string;
  /** Mark colour: up / down for candles, the line colour otherwise. */
  color: string;
  text: BarText;
  /** A plugin-owned readout (a compare line's percent) replaces the numbers. */
  readout: string | null;
}

export interface TooltipInfo {
  time: Time;
  stamp: string;
  entries: TooltipEntry[];
}

export interface TooltipOptions {
  mode: TooltipMode;
  /** Series to list; by default every visible series that has a title. */
  series?: readonly AnySeries[];
  /** Replace the card text: one string (lines split at "\n") or an array of lines. Set with textContent. */
  format?: (info: TooltipInfo) => string | readonly string[];
}

export interface TooltipHandle extends Removable {
  applyOptions(options: Partial<TooltipOptions>): void;
  options(): Readonly<TooltipOptions>;
}

/** Text of a change from `base`: sign, arrow and percent, never colour alone. `null` when it cannot be computed. */
export function describeChange(close: number, base: number, fmt: (v: number) => string): TooltipChange | null {
  const ch = close - base;
  if (!Number.isFinite(ch) || !Number.isFinite(base) || base === 0) return null;
  const amount = fmt(Math.abs(ch));
  const zero = !/[1-9]/.test(amount);
  const dir: 1 | -1 | 0 = zero ? 0 : ch > 0 ? 1 : -1;
  const sign = dir > 0 ? '+' : dir < 0 ? MINUS_SIGN : '';
  const arrow = dir > 0 ? '▲ ' : dir < 0 ? '▼ ' : '';
  const percent = formatPercent((ch / Math.abs(base)) * 100, 2);
  return { text: `${arrow}${sign}${amount} (${percent})`, dir, amount: `${sign}${amount}`, percent };
}

/**
 * Text of one bar. The change of a candle is from the previous close (its own open for the first bar); of a value
 * row from the previous value.
 */
export function describeBar(row: object | null, prev: object | null, fmt: (v: number) => string): BarText {
  if (!row) return { kind: 'none', cells: [], value: '', change: null };
  const r = row as Record<string, number>;
  if (isOhlcRow(row)) {
    const base = isOhlcRow(prev) ? (prev as Record<string, number>).close : r.open;
    return {
      kind: 'ohlc',
      cells: [{ label: 'O', value: fmt(r.open) }, { label: 'H', value: fmt(r.high) }, { label: 'L', value: fmt(r.low) }, { label: 'C', value: fmt(r.close) }],
      value: fmt(r.close),
      change: describeChange(r.close, base, fmt),
    };
  }
  const v = numberOf(row);
  if (!Number.isFinite(v)) return { kind: 'none', cells: [], value: '', change: null };
  const pv = numberOf(prev);
  return { kind: 'value', cells: [], value: fmt(v), change: Number.isFinite(pv) ? describeChange(v, pv, fmt) : null };
}

interface Size { w: number; h: number }
interface Pt { x: number; y: number }
const MARGIN = 4;

const clamp = (v: number, lo: number, hi: number): number => (hi < lo ? lo : Math.max(lo, Math.min(hi, v)));

/**
 * Where a card follows a pointer: right and below by `gap`, flipped to the left / above when it would leave `bounds`,
 * then kept inside. `above` puts it over the pointer first (a finger covers what is below it).
 */
export function placeFloating(pointer: Pt, size: Size, bounds: Size, gap = 14, above = false): Pt {
  let x = pointer.x + gap;
  if (x + size.w > bounds.w - MARGIN) x = pointer.x - gap - size.w;
  let y = above ? pointer.y - gap - size.h : pointer.y + gap;
  if (above ? y < MARGIN : y + size.h > bounds.h - MARGIN) y = above ? pointer.y + gap : pointer.y - gap - size.h;
  return { x: clamp(x, MARGIN, bounds.w - size.w - MARGIN), y: clamp(y, MARGIN, bounds.h - size.h - MARGIN) };
}

/**
 * A card pinned over a bar: centred on `barX`, its bottom `gap` above `topY` (the bar's high). With no room above it
 * goes below `bottomY` (the low). `plot` limits the card sideways.
 */
export function placeTracking(barX: number, topY: number, bottomY: number, size: Size, plot: { x: number; width: number; height: number }, gap = 14): Pt & { below: boolean } {
  const x = clamp(barX - size.w / 2, plot.x + MARGIN, plot.x + plot.width - size.w - MARGIN);
  let y = topY - gap - size.h;
  let below = false;
  if (y < MARGIN) { y = bottomY + gap; below = true; }
  return { x: Math.round(x), y: Math.round(clamp(y, MARGIN, plot.height - size.h - MARGIN)), below };
}

const ARROW_DIR_COLOR = (c: Readonly<ThemeColors>, dir: number): string => (dir > 0 ? c.upText : dir < 0 ? c.downText : c.mutedText);

interface Style { colors: Readonly<ThemeColors>; ui: UiState }

function text(doc: Document, parent: Node, value: string, color: string, extra: Record<string, string> = {}): Elem {
  const el = make(doc, 'span', { display: 'inline', color, 'white-space': 'pre', font: 'inherit', 'font-variant-numeric': 'tabular-nums', ...extra }, parent);
  el.textContent = value;
  return el;
}

function dotEl(doc: Document, parent: Node, color: string): Elem {
  return make(doc, 'span', { display: 'inline-block', width: '8px', height: '8px', 'border-radius': '4px', background: color, 'margin-right': '6px', 'vertical-align': 'middle', 'margin-top': '-2px', 'flex-shrink': '0' }, parent);
}

function cellsGrid(doc: Document, parent: Node, entry: TooltipEntry, st: Style, columns: number): void {
  const c = st.colors;
  const grid = make(doc, 'div', { display: 'grid', 'grid-template-columns': `repeat(${columns}, auto)`, 'column-gap': '14px', 'row-gap': '1px', 'justify-content': 'start' }, parent);
  for (const cell of entry.text.cells) {
    const item = make(doc, 'div', { display: 'block', 'white-space': 'pre' }, grid);
    text(doc, item, `${cell.label} `, c.mutedText);
    text(doc, item, cell.value, c.text);
  }
}

function changeLine(doc: Document, parent: Node, entry: TooltipEntry, st: Style, extra: Record<string, string> = {}): void {
  const ch = entry.text.change;
  if (!ch) return;
  text(doc, parent, ch.text, ARROW_DIR_COLOR(st.colors, ch.dir), { 'font-weight': '600', ...extra });
}

/** Build the card body for a mode (plain DOM, textContent only). */
export function renderCard(doc: Document, card: Elem, info: TooltipInfo, mode: TooltipMode, st: Style, format?: TooltipOptions['format']): void {
  card.textContent = '';
  const c = st.colors;
  if (format) {
    const out = format(info);
    const lines = typeof out === 'string' ? out.split('\n') : out;
    for (const line of lines) make(doc, 'div', { display: 'block', 'white-space': 'pre' }, card).textContent = line;
    return;
  }
  if (mode === 'magnifier') { renderStrip(doc, card, info, st); return; }
  const compact = mode === 'tracking';
  make(doc, 'div', { display: 'block', color: c.mutedText, 'font-weight': '500', 'white-space': 'nowrap' }, card).textContent = info.stamp;
  info.entries.forEach((entry, i) => {
    const block = make(doc, 'div', { display: 'block', 'margin-top': i === 0 ? '4px' : '8px' }, card);
    const head = make(doc, 'div', { display: 'flex', 'align-items': 'center', 'white-space': 'nowrap', 'justify-content': 'space-between', gap: '12px' }, block);
    const left = make(doc, 'span', { display: 'inline-flex', 'align-items': 'center', font: 'inherit' }, head);
    dotEl(doc, left, entry.color);
    text(doc, left, entry.title, c.text, { 'font-weight': '600' });
    if (entry.readout !== null) { text(doc, head, entry.readout, c.text, { 'font-weight': '600' }); return; }
    if (entry.text.kind === 'value') text(doc, head, entry.text.value, c.text, { 'font-weight': '600' });
    if (entry.text.kind === 'ohlc') cellsGrid(doc, block, entry, st, compact ? 4 : 2);
    if (entry.text.change) {
      const line = make(doc, 'div', { display: 'block', 'white-space': 'nowrap', 'margin-top': entry.text.kind === 'ohlc' ? '3px' : '1px' }, block);
      changeLine(doc, line, entry, st);
    }
  });
}

function renderStrip(doc: Document, card: Elem, info: TooltipInfo, st: Style): void {
  const c = st.colors;
  css(card, { display: 'flex', 'align-items': 'center', gap: '22px', 'flex-wrap': 'nowrap', overflow: 'hidden' });
  info.entries.forEach((entry, i) => {
    const lead = i === 0;
    const block = make(doc, 'div', { display: 'flex', 'flex-direction': 'column', 'flex-shrink': '0' }, card);
    const top = make(doc, 'div', { display: 'flex', 'align-items': 'center', 'white-space': 'nowrap' }, block);
    if (lead) text(doc, top, `${info.stamp}   ${entry.title}`, c.mutedText, { 'font-weight': '500' });
    else { dotEl(doc, top, entry.color); text(doc, top, entry.title, c.mutedText, { 'font-weight': '500' }); }
    const big = make(doc, 'div', { display: 'flex', 'align-items': 'baseline', gap: '10px', 'white-space': 'nowrap' }, block);
    text(doc, big, entry.readout ?? entry.text.value, c.text, { 'font-size': lead ? '24px' : '16px', 'font-weight': '600', 'line-height': lead ? '30px' : '20px' });
    if (lead) changeLine(doc, big, entry, st);
    if (lead && entry.text.kind === 'ohlc') {
      const cells = make(doc, 'div', { display: 'flex', gap: '14px', 'white-space': 'nowrap', 'flex-shrink': '0' }, card);
      for (const cell of entry.text.cells) {
        const col = make(doc, 'div', { display: 'flex', 'flex-direction': 'column' }, cells);
        text(doc, col, cell.label, c.mutedText, { 'font-weight': '500' });
        text(doc, col, cell.value, c.text);
      }
    }
  });
}

export function createTooltip(chart: ChartApi, options: Partial<TooltipOptions> = {}): TooltipHandle {
  let opts: TooltipOptions = { mode: 'floating', ...options };
  const checkMode = (m: string): void => {
    if (m !== 'floating' && m !== 'tracking' && m !== 'magnifier') throw new TypeError('Chartist Lite: tooltip "mode" must be "floating", "tracking" or "magnifier"');
  };
  checkMode(opts.mode);
  const ui = useChartUi(chart);
  const dom = createHost(chart, 'tooltip', false, 4);
  const doc = dom.doc;
  const win = doc.defaultView as Window;
  const card = make(doc, 'div', {
    position: 'absolute', left: '0', top: '0', display: 'none', 'pointer-events': 'none', 'white-space': 'nowrap',
    'user-select': 'none', '-webkit-user-select': 'none', 'will-change': 'transform',
  }, dom.root);
  card.setAttribute('aria-hidden', 'true');
  const dot = make(doc, 'div', { position: 'absolute', left: '0', top: '0', display: 'none', 'pointer-events': 'none', width: '12px', height: '12px', 'border-radius': '6px' }, dom.root);
  dot.setAttribute('aria-hidden', 'true');

  let shown = false;
  let lastKey = '';
  let size: Size = { w: 0, h: 0 };
  let touchX: number | null = null;
  let primHost: PrimitiveHost | null = null;
  const kinds = new WeakMap<object, { n: number; kind: TimeKind }>();

  const kindOf = (s: AnySeries): TimeKind => {
    const rows = s.data();
    const hit = kinds.get(rows);
    if (hit && hit.n === rows.length) return hit.kind;
    const kind = rows.length ? kindOfRows(rows, chart.timeScale().isOrdinal?.()) : 'daily';
    kinds.set(rows, { n: rows.length, kind });
    return kind;
  };

  const picked = (): AnySeries[] => (opts.series ? [...opts.series].filter(s => s.options().visible) : allSeries(chart).filter(s => {
    const o = s.options();
    return o.visible && (!!o.title || !!readoutOf(s));
  }));

  // The row of `s` at the hovered bar. On an ordinal (brick) axis several rows share a time: `rep` is how many bricks
  // of that time come before the hovered one (0 on a calendar axis).
  const rowOf = (s: AnySeries, seconds: number, rep: number): number => {
    const rows = s.data() as readonly { time: Time }[];
    const i = rowIndexAt(rows, seconds);
    return i < 0 || !rep ? i : i + rep < rows.length && timeToSeconds(rows[i + rep].time) === seconds ? i + rep : i;
  };
  const repOf = (time: Time, l: number): number => Math.max(0, l - Math.round(chart.timeScale().timeToLogical(time) ?? l));

  const info = (time: Time, st: Style, rep = 0): TooltipInfo | null => {
    const seconds = timeToSeconds(time);
    const entries: TooltipEntry[] = [];
    let lead: AnySeries | null = null;
    for (const s of picked()) {
      const rows = s.data() as readonly { time: Time }[];
      const idx = rowOf(s, seconds, rep);
      if (idx < 0) continue;
      const row = rows[idx];
      const prev = idx > 0 ? rows[idx - 1] : null;
      const ro = readoutOf(s);
      const o = s.options() as unknown as { title: string; color?: string };
      const fmt = formatterFor(chart, s);
      const bar = describeBar(row, prev, fmt);
      const dir = bar.change ? bar.change.dir : 0;
      const color = ro ? ro.color : bar.kind === 'ohlc' ? (dir < 0 ? st.colors.down : st.colors.up) : (o.color ?? st.colors.line);
      entries.push({ title: o.title || ro?.title || s.seriesType(), color, text: bar, readout: ro ? ro.text(seconds) : null });
      lead ??= s;
    }
    if (!entries.length || !lead) return null;
    return { time, stamp: stampText(chart, time, kindOf(lead)), entries };
  };

  const hide = (): void => {
    if (!shown) return;
    shown = false;
    lastKey = '';
    css(card, { display: 'none' });
    css(dot, { display: 'none' });
  };

  /** Draw the card for a bar (`l`: its logical index); `p` is the pointer in chart CSS px. */
  const show = (time: Time, l: number, p: Pt, touch: boolean): void => {
    const st: Style = { colors: ui.state().colors, ui: ui.state() };
    const rep = repOf(time, l);
    const data = info(time, st, rep);
    if (!data) { hide(); return; }
    const plot = ui.state().plot;
    const mode = opts.mode;
    const key = JSON.stringify([data.stamp, data.entries.map(e => [e.title, e.color, e.text, e.readout]), mode, st.colors.background, st.colors.text, !!opts.format, opts.format ? opts.format(data) : 0]);
    if (key !== lastKey || !shown) {
      lastKey = key;
      const c = st.colors;
      css(card, {
        display: mode === 'magnifier' ? 'flex' : 'block', font: `400 ${ui.state().fontSize}px/${Math.round(ui.state().fontSize * 1.4)}px ${ui.state().fontFamily}`, color: c.text,
        'font-variant-numeric': 'tabular-nums', direction: 'ltr', 'text-align': 'left', 'box-sizing': 'border-box',
        background: withAlpha(c.background, mode === 'magnifier' ? 1 : 0.96),
        border: mode === 'magnifier' ? '0' : `1px solid ${c.paneSeparator}`,
        'border-bottom': mode === 'magnifier' ? `1px solid ${c.paneSeparator}` : `1px solid ${c.paneSeparator}`,
        'border-radius': mode === 'magnifier' ? '0' : '10px',
        'box-shadow': mode === 'magnifier' ? 'none' : ui.state().dark ? '0 6px 20px rgba(0,0,0,0.5)' : '0 6px 20px rgba(0,0,0,0.12)',
        padding: mode === 'magnifier' ? '6px 14px' : mode === 'tracking' ? '6px 9px' : '8px 11px',
        width: mode === 'magnifier' ? `${Math.round(plot.width)}px` : 'max-content',
        'min-width': mode === 'floating' ? '168px' : '0',
      });
      renderCard(doc, card, data, mode, st, opts.format);
      shown = true;
      size = { w: card.offsetWidth, h: card.offsetHeight };
    }
    const bounds: Size = { w: dom.host.parentElement?.clientWidth ?? plot.x + plot.width, h: dom.host.parentElement?.clientHeight ?? plot.height };
    let at: Pt;
    let dotAt: Pt | null = null;
    if (mode === 'magnifier') at = { x: plot.x, y: plot.y };
    else if (mode === 'floating') at = placeFloating(p, size, bounds, touch ? 28 : 14, touch);
    else {
      const lead = picked().find(s => rowOf(s, timeToSeconds(time), rep) >= 0);
      const bx = barX(l);
      const row = lead ? (lead.data() as readonly object[])[rowOf(lead, timeToSeconds(time), rep)] as Record<string, number> : null;
      const top = lead ? paneTopOf(chart, lead.paneIndex()) : 0;
      const yOf = (v: number): number | null => { const y = lead ? lead.priceToCoordinate(v) : null; return y === null ? null : top + y; };
      const hi = row ? yOf(typeof row.high === 'number' ? row.high : numberOf(row)) : null;
      const lo = row ? yOf(typeof row.low === 'number' ? row.low : numberOf(row)) : null;
      const mark = row ? yOf(numberOf(row)) : null;
      if (bx === null || hi === null || lo === null) at = placeFloating(p, size, bounds, 14, false);
      else {
        const t = placeTracking(bx, Math.min(hi, lo), Math.max(hi, lo), size, { x: plot.x, width: plot.width, height: plot.y + plot.height }, 16);
        at = t;
        if (mark !== null) dotAt = { x: bx, y: mark };
      }
    }
    css(card, { transform: `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px)` });
    if (dotAt) {
      const c = st.colors;
      css(dot, {
        display: 'block', transform: `translate(${Math.round(dotAt.x - 6)}px, ${Math.round(dotAt.y - 6)}px)`,
        background: data.entries[0].color, border: `2px solid ${c.background}`, 'box-shadow': `0 0 0 1px ${data.entries[0].color}`,
      });
    } else css(dot, { display: 'none' });
  };

  const fromCrosshair = (params: MouseEventParams): void => {
    if (touchX !== null) return;
    if (params.time === undefined || !params.point) { hide(); return; }
    const plot = ui.state().plot;
    show(params.time, params.logical ?? 0, { x: plot.x + params.point.x, y: paneTopOf(chart, params.paneIndex ?? 0) + params.point.y }, false);
  };
  chart.subscribeCrosshairMove(fromCrosshair);

  // ── touch: long-press, then drag ──
  const root = chart.element();
  const MOVE_SLOP = 8;
  let press: { id: number; sx: number; sy: number; x: number; y: number; timer: number; active: boolean } | null = null;
  const barX = (l: number): number | null => {
    const x = chart.timeScale().logicalToCoordinate(l);
    return x === null ? null : x + ui.state().plot.x;
  };
  const clearPress = (): void => {
    if (press && press.timer) win.clearTimeout(press.timer);
    press = null;
  };
  const endTouch = (): void => {
    touchX = null;
    hide();
    primHost?.requestOverlay?.();
  };
  const touchShow = (cx: number, cy: number): void => {
    const r = root.getBoundingClientRect();
    const x = cx - r.left;
    const y = cy - r.top;
    const plot = ui.state().plot;
    if (x < plot.x || x > plot.x + plot.width) { endTouch(); return; }
    const time = chart.timeScale().coordinateToTime(x - plot.x);
    const l = Math.round(chart.timeScale().coordinateToLogical(x - plot.x) ?? 0);
    if (time === null) { endTouch(); return; }
    touchX = barX(l);
    primHost?.requestOverlay?.();
    show(time, l, { x, y }, true);
  };
  const onDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch' || !e.isTrusted) return;
    if (press) { const was = press.active; clearPress(); if (was) endTouch(); return; } // a second finger: pinch
    const id = e.pointerId;
    // The chart decides when a touch is a long press (`ChartPointerHandler.longPress` below) and hands us the gesture.
    press = { id, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, timer: 0, active: false };
  };
  const onMove = (e: PointerEvent): void => {
    if (!press || e.pointerId !== press.id || !e.isTrusted) return;
    press.x = e.clientX;
    press.y = e.clientY;
    if (press.active) touchShow(e.clientX, e.clientY);
    else if (Math.hypot(e.clientX - press.sx, e.clientY - press.sy) > MOVE_SLOP) clearPress();
  };
  const onUp = (e: PointerEvent): void => {
    if (!e.isTrusted || !press || e.pointerId !== press.id) return;
    const was = press.active;
    clearPress();
    if (was) endTouch();
  };
  const onTouchMove = (e: TouchEvent): void => { if (press?.active && e.cancelable) e.preventDefault(); };
  const listeners: [string, EventListener, AddEventListenerOptions][] = [
    ['pointerdown', onDown as EventListener, { passive: true }],
    ['pointermove', onMove as EventListener, { passive: true }],
    ['pointerup', onUp as EventListener, { passive: true }],
    ['pointercancel', onUp as EventListener, { passive: true }],
    ['touchmove', onTouchMove as EventListener, { passive: false }],
  ];
  for (const [t, fn, o] of listeners) root.addEventListener(t, fn, o);
  // The core's long-press hook claims the gesture (the chart stops panning; no synthetic pointercancel needed).
  const removeLongPress = chart.addPointerHandler({
    longPress: () => {
      if (!press || press.active) return false;
      press.active = true;
      touchShow(press.x, press.y);
      return true;
    },
    pointerUp: () => { if (press?.active) { clearPress(); endTouch(); } },
  });

  // The touch crosshair line (the chart draws no crosshair for a long press).
  const prim: ChartPrimitive = {
    zOrder: 'top',
    attached(h) { primHost = h; },
    detached() { primHost = null; },
    drawOverlay(s) {
      if (touchX === null) return;
      const { ctx, pane } = s;
      ctx.save();
      ctx.strokeStyle = s.colors.crosshair;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      const x = Math.round(touchX) + 0.5;
      ctx.moveTo(x, pane.y);
      ctx.lineTo(x, pane.y + pane.height);
      ctx.stroke();
      ctx.restore();
    },
  };
  chart.attachPrimitive(prim);

  return removable({
    applyOptions(patch: Partial<TooltipOptions>) {
      if (patch.mode !== undefined) checkMode(patch.mode);
      opts = { ...opts, ...patch };
      lastKey = '';
      hide();
    },
    options: () => ({ ...opts }),
  }, () => {
    chart.unsubscribeCrosshairMove(fromCrosshair);
    for (const [t, fn, o] of listeners) root.removeEventListener(t, fn, o);
    removeLongPress();
    clearPress();
    try { chart.detachPrimitive(prim); } catch { /* chart removed */ }
    dom.destroy();
    ui.release();
  });
}
