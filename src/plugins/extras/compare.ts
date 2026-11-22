// Compare: plot other series as percent change from the first visible bar, on the base series' own axis. The axis
// goes to the chart's 'percent' mode (its base is the first visible value of the first series on that scale, so the
// base series re-bases itself for free). Each compared line is a real line series whose rows are scaled by
// `baseRef / ownRef`, so the percent axis reads the line's true change; the scale is recomputed when the first visible
// bar changes (the view panned or zoomed), once per painted frame, and settles after 120 ms for very long series.
// The chart's legend would show those scaled numbers, so compared series carry no title there: a chip legend (name,
// arrow, percent, close control) is drawn by this plugin, and `createTooltip` reads true percents through `setReadout`.

import type { AnySeriesDefinition, ChartApi, SeriesApi } from '../../api';
import type { Time } from '../../core/time';
import { timeToSeconds } from '../../core/time';
import { formatPercent } from '../../core/format';
import { LineSeries } from '../../series/line';
import type { LineData } from '../../series/line';
import type { AnySeries, Elem, UiState } from './common';
import {
  createHost, css, focusRing, iconEl, lowerBoundRows, make, numberOf, seriesPalette, setReadout, surfaceStyle, useChartUi,
} from './common';

export interface CompareOptions {
  /** The series that sets the pane, the axis and the percent base. It should be the first series on its scale. */
  base: SeriesApi<AnySeriesDefinition>;
  /** Only 'percent' for now. */
  mode: 'percent';
  /** Show the chip legend (default true). */
  legend: boolean;
}

export interface CompareAddOptions {
  /** Shown in the chip and the tooltip. */
  title: string;
  /** CSS colour; by default the next colour of a theme palette (re-picked when the theme changes). */
  color?: string;
}

/** A row to compare: a line value, or any row with a `close`. */
export type CompareRow = { time: Time } & ({ value: number } | { close: number });

export interface CompareLine {
  readonly id: string;
  readonly title: string;
  readonly series: SeriesApi<AnySeriesDefinition>;
}

export interface CompareHandle {
  add(data: readonly CompareRow[], options: CompareAddOptions): CompareLine;
  /** Remove one compared line (by handle or id); false when it is not there. */
  remove(line: CompareLine | string): boolean;
  lines(): CompareLine[];
  /** Remove every line, give the axis its old mode back and take the legend away. */
  destroy(): void;
}

/** Percent change of `value` from `ref`, as the chart's percent axis would show it; NaN without a usable reference. */
export function percentChange(value: number, ref: number): number {
  return ref !== 0 && Number.isFinite(ref) && Number.isFinite(value) ? ((value - ref) / Math.abs(ref)) * 100 : NaN;
}

/** The scale that makes a line's first visible value equal the base's, so a percent axis shows each one's own change. */
export function rebaseFactor(baseRef: number, ownRef: number): number {
  return ownRef !== 0 && Number.isFinite(ownRef) && Number.isFinite(baseRef) ? baseRef / ownRef : NaN;
}

/** First non-zero finite number at or after the first row with time >= `fromSeconds` (the chart's percent base rule); NaN when none. */
export function firstVisibleRef(rows: readonly { time: Time }[], fromSeconds: number, valueOf: (row: object) => number = numberOf): number {
  for (let i = lowerBoundRows(rows, fromSeconds); i < rows.length; i++) {
    const v = valueOf(rows[i]);
    if (Number.isFinite(v) && v !== 0) return v;
  }
  return NaN;
}

/** Rows `value * k`, same times. Pure. */
export function scaleRows(rows: readonly { time: Time; value: number }[], k: number): LineData[] {
  const out: LineData[] = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) out[i] = { time: rows[i].time, value: rows[i].value * k };
  return out;
}

/** Signed percent text with arrow ("▲ +12.30%", "▼ −4.10%", "0.00%"), or '' for NaN. */
export function percentText(p: number): string {
  if (!Number.isFinite(p)) return '';
  const t = formatPercent(p, 2);
  return `${p > 0 && t.startsWith('+') ? '▲ ' : t.startsWith('−') ? '▼ ' : ''}${t}`;
}

interface Line extends CompareLine {
  raw: { time: Time; value: number }[];
  color: string | undefined;
  ref: number;
  chip: { root: Elem; dot: Elem; value: Elem } | null;
}

export function createCompare(chart: ChartApi, options: Partial<CompareOptions> & { base: SeriesApi<AnySeriesDefinition> }): CompareHandle {
  if (!options.base || typeof options.base.data !== 'function') throw new TypeError('Chartist Lite: createCompare needs a "base" series');
  if (options.mode !== undefined && options.mode !== 'percent') throw new TypeError('Chartist Lite: createCompare "mode" must be "percent"');
  const opts: CompareOptions = { mode: 'percent', legend: true, ...options };
  const base = opts.base as AnySeries;
  const ui = useChartUi(chart);
  const lines: Line[] = [];
  let counter = 0;
  let prevMode: 'linear' | 'log' | 'percent' | null = null;
  let lastFrom = NaN;
  let baseRef = NaN;
  let legend: { dom: ReturnType<typeof createHost>; row: Elem; baseChip: { value: Elem; dot: Elem } } | null = null;
  let hoverTime: number | null = null;
  let dark = ui.state().dark;
  let timer = 0;
  const win = chart.element().ownerDocument.defaultView as Window;
  const scale = (): ReturnType<ChartApi['priceScale']> => chart.priceScale(base.options().priceScaleId, base.paneIndex());

  const paletteColor = (i: number): string => seriesPalette(ui.state().colors)[i % 6];
  const colorOf = (l: Line, i: number): string => l.color ?? paletteColor(i);

  const rebase = (force: boolean): void => {
    const vr = chart.timeScale().getVisibleRange();
    if (!vr || lines.length === 0) return;
    const from = timeToSeconds(vr.from);
    if (!force && from === lastFrom) return;
    lastFrom = from;
    baseRef = firstVisibleRef(base.data() as readonly { time: Time }[], from);
    for (const l of lines) {
      l.ref = firstVisibleRef(l.raw, from, r => (r as { value: number }).value);
      const k = rebaseFactor(baseRef, l.ref);
      l.series.setData(Number.isFinite(k) ? scaleRows(l.raw, k) : l.raw.map(r => ({ time: r.time })));
    }
    refreshLegend();
  };
  const schedule = (): void => {
    const big = lines.some(l => l.raw.length > 30000);
    if (!big) { rebase(false); return; }
    if (timer) win.clearTimeout(timer);
    timer = win.setTimeout(() => { timer = 0; rebase(false); }, 120);
  };
  const onRange = (): void => schedule();

  // ── legend chips ──
  const valueAt = (raw: readonly { time: Time }[], ref: number, valueOf: (r: object) => number): string => {
    let i: number;
    if (hoverTime === null) i = raw.length - 1;
    else { i = lowerBoundRows(raw, hoverTime); if (i >= raw.length || timeToSeconds(raw[i].time) !== hoverTime) return ''; }
    return i >= 0 ? percentText(percentChange(valueOf(raw[i]), ref)) : '';
  };
  const chipText = (value: Elem, text: string, colors: UiState['colors']): void => {
    value.textContent = text;
    css(value, { color: text.startsWith('▲') ? colors.upText : text.startsWith('▼') ? colors.downText : colors.text });
  };
  const refreshLegend = (): void => {
    if (!legend) return;
    const s = ui.state();
    chipText(legend.baseChip.value, valueAt(base.data() as readonly { time: Time }[], baseRef, numberOf), s.colors);
    lines.forEach((l, i) => {
      if (!l.chip) return;
      chipText(l.chip.value, valueAt(l.raw, l.ref, r => (r as { value: number }).value), s.colors);
      css(l.chip.dot, { background: colorOf(l, i) });
    });
  };
  const chipBase = (parent: Elem, doc: Document): Elem => {
    const s = ui.state();
    return make(doc, 'div', {
      display: 'flex', 'align-items': 'center', height: '26px', padding: '0 8px 0 10px', 'border-radius': '13px', gap: '6px', 'white-space': 'nowrap',
      font: `500 ${s.fontSize}px/16px ${s.fontFamily}`, color: s.colors.text, 'font-variant-numeric': 'tabular-nums', 'pointer-events': 'auto', ...surfaceStyle(s),
    }, parent);
  };
  const ensureLegend = (): void => {
    if (legend || !opts.legend) return;
    const dom = createHost(chart, 'compare', true, 3);
    const s = ui.state();
    const row = make(dom.doc, 'div', { position: 'absolute', left: '0', top: '0', display: 'flex', 'flex-wrap': 'wrap', 'justify-content': 'flex-end', gap: '6px', 'pointer-events': 'none' }, dom.root);
    row.setAttribute('role', 'list');
    row.setAttribute('aria-label', 'Compared series');
    const chip = chipBase(row, dom.doc);
    chip.setAttribute('role', 'listitem');
    const dot = make(dom.doc, 'span', { display: 'inline-block', width: '8px', height: '8px', 'border-radius': '4px', background: s.colors.text, 'flex-shrink': '0' }, chip);
    const title = make(dom.doc, 'span', { display: 'inline', font: 'inherit', 'font-weight': '600' }, chip);
    title.textContent = base.options().title || 'Base';
    const value = make(dom.doc, 'span', { display: 'inline', font: 'inherit', 'font-weight': '600' }, chip);
    legend = { dom, row, baseChip: { value, dot } };
    placeLegend();
  };
  const placeLegend = (): void => {
    if (!legend) return;
    const s = ui.state();
    css(legend.row, {
      transform: `translate(${Math.round(s.plot.x + s.plot.width - 8)}px, ${Math.round(s.plot.y + 8)}px) translateX(-100%)`,
      'max-width': `${Math.max(120, Math.floor(s.plot.width - 16))}px`,
    });
  };
  const addChip = (l: Line, i: number): void => {
    if (!legend) return;
    const doc = legend.dom.doc;
    const root = chipBase(legend.row, doc);
    root.setAttribute('role', 'listitem');
    const dot = make(doc, 'span', { display: 'inline-block', width: '8px', height: '8px', 'border-radius': '4px', background: colorOf(l, i), 'flex-shrink': '0' }, root);
    const title = make(doc, 'span', { display: 'inline', font: 'inherit', 'font-weight': '600' }, root);
    title.textContent = l.title;
    const value = make(doc, 'span', { display: 'inline', font: 'inherit', 'font-weight': '600' }, root);
    const close = make(doc, 'button', {
      display: 'flex', 'align-items': 'center', 'justify-content': 'center', width: '18px', height: '18px', 'border-radius': '9px', cursor: 'pointer', color: ui.state().colors.mutedText,
      appearance: 'none', '-webkit-appearance': 'none', 'margin-left': '2px', 'pointer-events': 'auto',
    }, root) as HTMLButtonElement;
    close.type = 'button';
    close.setAttribute('aria-label', `Remove ${l.title}`);
    close.appendChild(iconEl(doc, 'M6 6l12 12M18 6L6 18', 12, 2.2));
    focusRing(close, () => ui.state().colors.focusRing);
    close.addEventListener('click', () => { api.remove(l); });
    l.chip = { root, dot, value };
  };

  const setMode = (): void => {
    if (prevMode !== null) return;
    const sc = scale();
    prevMode = sc.options().mode;
    sc.applyOptions({ mode: 'percent' });
  };
  const restoreMode = (): void => {
    if (prevMode === null) return;
    try { scale().applyOptions({ mode: prevMode }); } catch { /* the chart is gone */ }
    prevMode = null;
  };

  const onCross = (p: { time?: Time }): void => {
    const t = p.time === undefined ? null : timeToSeconds(p.time);
    if (t === hoverTime) return;
    hoverTime = t;
    refreshLegend();
  };

  const onFrame = (s: UiState): void => {
    placeLegend();
    if (s.dark !== dark) {
      dark = s.dark;
      lines.forEach((l, i) => { if (!l.color) l.series.applyOptions({ color: paletteColor(i) } as never); });
      refreshLegend();
    }
  };

  chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
  chart.subscribeCrosshairMove(onCross);
  const offFrame = ui.onFrame(onFrame);
  let gone = false;

  const api: CompareHandle = {
    add(data, o) {
      if (gone) throw new Error('Chartist Lite: this compare handle was destroyed');
      if (!Array.isArray(data)) throw new TypeError('Chartist Lite: compare "add" needs an array of rows');
      if (!o || typeof o.title !== 'string') throw new TypeError('Chartist Lite: compare "add" needs a "title"');
      const raw: { time: Time; value: number }[] = [];
      for (const r of data) {
        const v = numberOf(r);
        if (Number.isFinite(v)) raw.push({ time: r.time, value: v });
      }
      raw.sort((a, b) => timeToSeconds(a.time) - timeToSeconds(b.time));
      setMode();
      const i = lines.length;
      const series = chart.addSeries(LineSeries, {
        color: o.color ?? paletteColor(i), title: '', priceScaleId: base.options().priceScaleId, lastValueVisible: true, priceLineVisible: false, lineWidth: 2,
      }, base.paneIndex());
      const id = `c${++counter}`;
      const line: Line = { id, title: o.title, series, raw, color: o.color, ref: NaN, chip: null };
      lines.push(line);
      setReadout(series, {
        title: o.title, color: o.color ?? paletteColor(i),
        text(seconds) {
          const k = lowerBoundRows(line.raw, seconds);
          return k < line.raw.length && timeToSeconds(line.raw[k].time) === seconds ? percentText(percentChange(line.raw[k].value, line.ref)) : null;
        },
      });
      ensureLegend();
      addChip(line, i);
      rebase(true);
      return line;
    },
    remove(l) {
      const id = typeof l === 'string' ? l : l.id;
      const i = lines.findIndex(x => x.id === id);
      if (i < 0) return false;
      const [line] = lines.splice(i, 1);
      line.chip?.root.remove();
      setReadout(line.series, null);
      try { chart.removeSeries(line.series); } catch { /* chart removed */ }
      if (lines.length === 0) {
        restoreMode();
        legend?.dom.destroy();
        legend = null;
        lastFrom = NaN;
      } else {
        lines.forEach((x, k) => { if (!x.color) x.series.applyOptions({ color: paletteColor(k) } as never); });
        refreshLegend();
      }
      return true;
    },
    lines: () => [...lines],
    destroy() {
      if (gone) return;
      for (const l of [...lines]) api.remove(l);
      gone = true;
      if (timer) win.clearTimeout(timer);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      chart.unsubscribeCrosshairMove(onCross);
      offFrame();
      restoreMode();
      ui.release();
    },
  };
  return api;
}
