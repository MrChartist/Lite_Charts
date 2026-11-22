// Shared helpers of the extras plugins: theme and geometry of the chart (read from a hidden primitive, so no core
// hook is needed), the DOM host every plugin with chart DOM uses (shadow root, CSSOM-only styles with important
// resets, never innerHTML), number and time text through the chart's own formatters, and a few pure helpers.
// Nothing here touches the DOM at import time.

import type { AnySeriesDefinition, ChartApi, SeriesApi } from '../../api';
import type { ThemeColors } from '../../core/theme';
import { darkTheme, lightTheme, parseColor } from '../../core/theme';
import { formatPrice, formatStamp, resolvePriceFormat } from '../../core/format';
import type { TimeKind } from '../../core/time';
import { inferTimeKind, timeToSeconds } from '../../core/time';
import type { Time } from '../../core/time';
import { civilKeyFromDays, localTimeZone, weekdayOfDay, zoneDayNumber, zoneMinuteOfDay } from '../../core/zone';
import { css, cssReset } from '../../render/dom';
import type { ChartPrimitive, CssRect } from '../primitive';

export type AnySeries = SeriesApi<AnySeriesDefinition>;
export type Elem = HTMLElement;

/** What every handle returned by an extras plugin can do: take the plugin away and leave nothing behind. */
export interface Removable {
  remove(): void;
  /** The same as `remove()`. */
  destroy(): void;
}

// ── colours ──

export function isDarkColor(color: string): boolean {
  const rgb = parseColor(color);
  return !!rgb && (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000 < 128;
}

/** The theme colours the chart is using now (built-in theme by name or system preference, plus `colors`). */
export function resolveColors(chart: ChartApi): ThemeColors {
  const o = chart.options();
  let name = o.theme;
  if (name === 'auto') {
    let dark = false;
    try { dark = !!chart.element().ownerDocument.defaultView?.matchMedia?.('(prefers-color-scheme: dark)').matches; } catch { dark = false; }
    name = dark ? 'dark' : 'light';
  }
  return { ...(name === 'dark' ? darkTheme : lightTheme), ...o.colors };
}

export function withAlpha(color: string, alpha: number): string {
  const rgb = parseColor(color);
  return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})` : color;
}

/** `a` mixed with `b` (`t` of b, 0..1) as an opaque rgb colour; `a` unchanged when either cannot be parsed. */
export function mixColors(a: string, b: string, t: number): string {
  const x = parseColor(a);
  const y = parseColor(b);
  if (!x || !y) return a;
  const m = (i: number): number => Math.round(x[i] + (y[i] - x[i]) * t);
  return `rgb(${m(0)}, ${m(1)}, ${m(2)})`;
}

function luminance(rgb: readonly [number, number, number]): number {
  const f = (c: number): number => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}

/** WCAG contrast ratio of two colours (1..21); 1 when either cannot be parsed. */
export function contrastRatio(a: string, b: string): number {
  const x = parseColor(a);
  const y = parseColor(b);
  if (!x || !y) return 1;
  const la = luminance(x);
  const lb = luminance(y);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The accent for alerts and the replay marker: amber, readable as text on the theme's background (4.5:1). No purple. */
export function accentFor(colors: Readonly<ThemeColors>): string {
  return isDarkColor(colors.background) ? '#FFB340' : '#A84A00';
}

/** A palette of distinct series colours per theme, none purple, each readable against the background. */
export function seriesPalette(colors: Readonly<ThemeColors>): string[] {
  return isDarkColor(colors.background)
    ? ['#FFB340', '#40C8E0', '#FF6482', '#63E6BE', '#E5E54C', '#FF8A5C']
    : ['#B25000', '#007A99', '#C41E3A', '#00785A', '#8A7A00', '#C24100'];
}

// ── chart geometry and theme through a hidden primitive ──

export interface UiState {
  colors: Readonly<ThemeColors>;
  fontFamily: string;
  fontSize: number;
  /** The top pane's plot rectangle in chart CSS px. */
  plot: CssRect;
  pixelRatio: number;
  dark: boolean;
}

export interface ChartUi {
  state(): UiState;
  /** `fn` runs after every main repaint of the chart (a pan, a data change, a theme change, a resize). */
  onFrame(fn: (s: UiState) => void): () => void;
  release(): void;
}

interface UiEntry { state: UiState; subs: Set<(s: UiState) => void>; refs: number; prim: ChartPrimitive }
const uiRegistry = new WeakMap<object, UiEntry>();

/** Acquire the shared per-chart theme and geometry feed. Call `release()` when the plugin goes. */
export function useChartUi(chart: ChartApi): ChartUi {
  let entry = uiRegistry.get(chart);
  if (!entry) {
    const el = chart.element();
    const colors = resolveColors(chart);
    const state: UiState = {
      colors, fontFamily: chart.options().fontFamily, fontSize: Math.max(12, chart.options().fontSize),
      plot: { x: 0, y: 0, width: el.clientWidth, height: el.clientHeight }, pixelRatio: 1, dark: isDarkColor(colors.background),
    };
    const subs = new Set<(s: UiState) => void>();
    const prim: ChartPrimitive = {
      zOrder: 'bottom',
      draw(s) {
        state.colors = s.colors;
        state.fontFamily = s.fontFamily;
        state.fontSize = Math.max(12, s.fontSize);
        state.plot = { x: s.pane.x, y: s.pane.y, width: s.pane.width, height: s.pane.height };
        state.pixelRatio = s.pixelRatio;
        state.dark = isDarkColor(s.colors.background);
        for (const fn of [...subs]) fn(state);
      },
    };
    entry = { state, subs, refs: 0, prim };
    chart.attachPrimitive(prim);
    uiRegistry.set(chart, entry);
  }
  const e = entry;
  e.refs++;
  const mine = new Set<(s: UiState) => void>();
  let released = false;
  return {
    state: () => e.state,
    onFrame(fn) {
      e.subs.add(fn);
      mine.add(fn);
      return () => { e.subs.delete(fn); mine.delete(fn); };
    },
    release() {
      if (released) return;
      released = true;
      for (const fn of mine) e.subs.delete(fn);
      mine.clear();
      if (--e.refs === 0) {
        try { chart.detachPrimitive(e.prim); } catch { /* the chart is gone */ }
        uiRegistry.delete(chart);
      }
    },
  };
}

export function reducedMotion(chart: ChartApi): boolean {
  try { return !!chart.element().ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

// ── DOM host ──

export interface DomHost {
  host: Elem;
  /** Where the plugin's elements go: the shadow root (open), or the host itself when shadow DOM is unavailable. */
  root: ShadowRoot | Elem;
  doc: Document;
  destroy(): void;
}

/**
 * One absolutely placed zero-size host inside the chart's root, with an open shadow root and important CSSOM resets,
 * so page CSS and a strict CSP cannot reach it. `interactive` hosts keep pointer, wheel and key events away from the
 * chart; others are invisible to the pointer (`pointer-events: none` is set on the host and must be re-enabled on a
 * child that wants events).
 */
export function createHost(chart: ChartApi, name: string, interactive: boolean, z = 3, placement: { parent?: Elem; inline?: boolean } = {}): DomHost {
  const parent = placement.parent ?? chart.element();
  const doc = parent.ownerDocument;
  const host = doc.createElement('div');
  host.setAttribute(`data-chartist-${name}`, '');
  cssReset(host, placement.inline ? {
    position: 'relative', display: 'inline-block', 'z-index': String(z), direction: 'ltr', 'text-align': 'left',
  } : {
    position: 'absolute', left: '0', top: '0', width: '0', height: '0', 'z-index': String(z), display: 'block',
    overflow: 'visible', 'pointer-events': 'none', direction: 'ltr', 'text-align': 'left',
  });
  let root: ShadowRoot | Elem = host;
  try { root = host.attachShadow({ mode: 'open' }); } catch { root = host; }
  if (interactive) {
    for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'wheel', 'dblclick', 'keydown']) {
      host.addEventListener(t, ev => ev.stopPropagation());
    }
  }
  parent.appendChild(host);
  return { host, root, doc, destroy: () => host.remove() };
}

/** An element with the resets and `styles` written, optionally appended to `parent`. */
export function make(doc: Document, tag: string, styles: Readonly<Record<string, string>>, parent?: Node): Elem {
  const el = doc.createElement(tag);
  cssReset(el, styles);
  if (parent) parent.appendChild(el);
  return el;
}

export { css, cssReset };

/** Font shorthand for chart text. */
export function fontOf(ui: UiState, weight = 400, size = ui.fontSize): string {
  return `${weight} ${Math.max(12, size)}px ${ui.fontFamily}`;
}

// ── numbers and times ──

/** The chart's price text for one series: the localization formatter, else the series' own precision. */
export function formatterFor(chart: ChartApi, series: AnySeries): (v: number) => string {
  const f = chart.options().localization.priceFormatter;
  if (f) return f;
  const precision = resolvePriceFormat(series.options().priceFormat).precision;
  return v => formatPrice(v, precision);
}

export function zoneOf(chart: ChartApi): string {
  const tz = chart.options().timeScale.timeZone;
  return tz === 'local' ? localTimeZone() : tz;
}

export interface Calendar { year: number; month: number; day: number; minute: number; weekday: number; dayNum: number }

/** Calendar fields of a time in seconds: a business day on the UTC calendar, an instant in `zone`. */
export function calendarOf(seconds: number, zone: string, businessDay: boolean): Calendar {
  let dayNum: number;
  let minute: number;
  if (businessDay) { dayNum = Math.floor(seconds / 86400); minute = 0; } else {
    const ms = seconds * 1000;
    dayNum = zoneDayNumber(zone, ms);
    minute = zoneMinuteOfDay(zone, ms);
  }
  const key = civilKeyFromDays(dayNum);
  return { year: Math.floor(key / 10000), month: Math.floor(key / 100) % 100, day: key % 100, minute, weekday: weekdayOfDay(dayNum), dayNum };
}

/** Bar granularity of a series' rows (median gap of the last bars). */
export function kindOfRows(rows: readonly { time: Time }[]): TimeKind {
  const n = Math.min(rows.length, 257);
  const times: number[] = [];
  for (let i = rows.length - n; i < rows.length; i++) times.push(timeToSeconds(rows[i].time));
  return inferTimeKind(times, n);
}

/** The crosshair's time stamp for a bar (the chart's own `timeFormatter` when set). */
export function stampText(chart: ChartApi, time: Time, kind: TimeKind): string {
  const o = chart.options().localization;
  if (o.timeFormatter) return o.timeFormatter(time);
  const c = calendarOf(timeToSeconds(time), zoneOf(chart), typeof time !== 'number');
  return formatStamp(c, kind, { hours12: o.hours12, dateOrder: o.dateOrder });
}

// ── rows ──

/** Index of the first row with time >= `seconds` (rows ascending). */
export function lowerBoundRows(rows: readonly { time: Time }[], seconds: number): number {
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (timeToSeconds(rows[mid].time) < seconds) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/** Index of the row at exactly `seconds`, or -1. */
export function rowIndexAt(rows: readonly { time: Time }[], seconds: number): number {
  const i = lowerBoundRows(rows, seconds);
  return i < rows.length && timeToSeconds(rows[i].time) === seconds ? i : -1;
}

/** The single number a row stands for: `value`, else `close`, else NaN. */
export function numberOf(row: object | null | undefined): number {
  const r = row as Record<string, unknown> | null | undefined;
  if (!r) return NaN;
  if (typeof r.value === 'number') return r.value;
  if (typeof r.close === 'number') return r.close;
  return NaN;
}

/** Rows carrying open, high, low and close. */
export function isOhlcRow(row: object | null | undefined): boolean {
  const r = row as Record<string, unknown> | null | undefined;
  return !!r && ['open', 'high', 'low', 'close'].every(k => typeof r[k] === 'number');
}

/** Top y (chart CSS px) of pane `index`: panes are stacked with a 1 px separator. */
export function paneTopOf(chart: ChartApi, index: number): number {
  const panes = chart.panes();
  let y = 0;
  for (let i = 0; i < index && i < panes.length; i++) y += panes[i].getHeight() + 1;
  return y;
}

/** Every series of the chart, pane by pane. */
export function allSeries(chart: ChartApi): AnySeries[] {
  const out: AnySeries[] = [];
  for (const p of chart.panes()) for (const s of p.getSeries()) out.push(s);
  return out;
}

/** Make a handle with `remove` and the `destroy` alias. */
export function removable<T extends object>(h: T, remove: () => void): T & Removable {
  let done = false;
  const once = (): void => { if (done) return; done = true; remove(); };
  return Object.assign(h, { remove: once, destroy: once });
}

/** Per-frame throttle: `fn` runs at most once per animation frame, at the end. Returns `{ run, cancel }`. */
export function frameThrottle(chart: ChartApi, fn: () => void): { run(): void; cancel(): void } {
  const win = chart.element().ownerDocument.defaultView;
  let id = 0;
  return {
    run() {
      if (id || !win) return;
      id = win.requestAnimationFrame(() => { id = 0; fn(); });
    },
    cancel() { if (id && win) win.cancelAnimationFrame(id); id = 0; },
  };
}

// ── readouts: how a plugin that owns an untitled series lets the tooltip show it ──

export interface Readout {
  title: string;
  color: string;
  /** Text for the series at `seconds` (a percent for a compare line), or null for none. */
  text(seconds: number): string | null;
}

const readouts = new WeakMap<object, Readout>();
export function setReadout(series: object, r: Readout | null): void { if (r) readouts.set(series, r); else readouts.delete(series); }
export function readoutOf(series: object): Readout | undefined { return readouts.get(series); }

// ── small DOM pieces ──

/** A focus ring on keyboard focus only (CSSOM cannot write `:focus-visible`), read on the element itself. */
export function focusRing(el: Elem, color: () => string): void {
  const on = (): void => {
    let visible = true;
    try { visible = el.matches(':focus-visible'); } catch { visible = true; }
    if (visible) css(el, { outline: `2px solid ${color()}`, 'outline-offset': '2px' });
  };
  el.addEventListener('focus', on);
  el.addEventListener('blur', () => css(el, { outline: 'none' }));
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** One-path line icon on a 24 grid, currentColor stroke, hidden from assistive technology. */
export function iconEl(doc: Document, path: string, px = 18, strokeWidth = 1.8): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(px));
  svg.setAttribute('height', String(px));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', String(strokeWidth));
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const p = doc.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', path);
  svg.appendChild(p);
  return svg;
}

/** The surface of a floating control: chart background, hairline, soft shadow (stronger in dark). */
export function surfaceStyle(ui: UiState): Record<string, string> {
  return {
    background: ui.colors.background,
    border: `1px solid ${ui.colors.paneSeparator}`,
    'box-shadow': ui.dark ? '0 2px 10px rgba(0,0,0,0.5)' : '0 2px 10px rgba(0,0,0,0.1)',
  };
}

/** A rounded-rectangle path (arcs, so it needs no `roundRect` support). Does not begin or fill the path. */
export function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const k = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}
