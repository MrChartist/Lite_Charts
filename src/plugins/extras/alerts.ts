// Price alerts. A "+" beside the crosshair price (near the price axis) adds an alert line with a bell; drag a line to
// move it; remove it with its close control or Delete. An alert fires once, when the series' price crosses it in either
// direction on `update()`: the plugin watches the series' `update` and `setData` (see `watch`), and `check()` lets the
// host feed prices itself. The crossing logic is pure. No notification API is used: the host decides in `onTrigger`.
// Drawn on the canvas (a series primitive plus pointer hooks), so nothing is left in the DOM.

import type { ChartApi, ChartPointerEvent, ChartPointerHandler } from '../../api';
import type { Time } from '../../core/time';
import { resolvePriceFormat } from '../../core/format';
import type { ChartPrimitive, PriceAxisLabel, PrimitiveHost } from '../primitive';
import type { AnySeries } from './common';
import { accentFor, numberOf, roundedRectPath, withAlpha } from './common';

export interface PriceAlert {
  id: string;
  price: number;
  /** True once it has fired (it stays drawn, muted, until removed or moved). */
  triggered: boolean;
}

export interface AlertTrigger {
  id: string;
  price: number;
  direction: 'up' | 'down';
  /** The price that crossed it. */
  value: number;
  time: Time | undefined;
}

export interface PriceAlertsOptions {
  /** Called once per alert when the price crosses it. Throwing here never breaks the chart. */
  onTrigger?: (trigger: AlertTrigger) => void;
  /** Called after an alert is added, moved, removed or imported. */
  onChange?: (alerts: readonly PriceAlert[]) => void;
  /** Remove an alert as soon as it has fired. Default false (it stays, muted). */
  removeOnTrigger: boolean;
  /** Show the "+" beside the crosshair price. Default true. */
  addButton: boolean;
}

export interface PriceAlertsHandle {
  /** A copy of every alert, in the order they were added. */
  alerts(): PriceAlert[];
  /** Add an alert at `price`; returns it. */
  add(price: number): PriceAlert;
  /** Remove one alert; false when there is none with that id. */
  remove(id: string): boolean;
  clear(): void;
  /** Feed a price by hand (`update()` does this for you). Returns what fired. */
  check(value: number, time?: Time): AlertTrigger[];
  exportJSON(): string;
  /** Replace all alerts from `exportJSON()` text or its parsed object. Throws a TypeError naming the problem. */
  importJSON(json: string | object): void;
  applyOptions(options: Partial<PriceAlertsOptions>): void;
  /** Take the plugin away: restores the series' `update` and `setData`, removes the pointer hook and the primitive. */
  destroy(): void;
}

/** Which alerts a move of the price from `prev` to `next` crosses, in the order the price meets them. Pure. */
export function crossings(prev: number | null, next: number, levels: readonly { id: string; price: number }[]): { id: string; direction: 'up' | 'down' }[] {
  if (prev === null || !Number.isFinite(prev) || !Number.isFinite(next) || prev === next) return [];
  const up = next > prev;
  const hit: { id: string; price: number; direction: 'up' | 'down' }[] = [];
  for (const l of levels) {
    // A touch counts (price == level on arrival); leaving a level it already stood on does not. A gap jumps over.
    if (up ? prev < l.price && next >= l.price : prev > l.price && next <= l.price) hit.push({ id: l.id, price: l.price, direction: up ? 'up' : 'down' });
  }
  hit.sort((a, b) => (up ? a.price - b.price : b.price - a.price));
  return hit.map(h => ({ id: h.id, direction: h.direction }));
}

/** `price` snapped to a multiple of `minMove` and written with the series' precision (as a number). */
export function snapPrice(price: number, minMove: number, precision: number): number {
  if (!(minMove > 0)) return Number(price.toFixed(precision));
  return Number((Math.round(price / minMove) * minMove).toFixed(Math.max(0, Math.min(10, precision))));
}

/** The id of the line nearest `y` within `tolerance` px (ys in the same space), or null. Pure. */
export function nearestLine(lines: readonly { id: string; y: number }[], y: number, tolerance: number): string | null {
  let best: string | null = null;
  let dist = tolerance + 1e-9;
  for (const l of lines) {
    const d = Math.abs(l.y - y);
    if (d <= dist) { dist = d; best = l.id; }
  }
  return best;
}

export const ALERTS_FORMAT = 'chartist-lite-alerts';

export function alertsToJSON(alerts: readonly PriceAlert[]): string {
  return JSON.stringify({ format: ALERTS_FORMAT, version: 1, alerts: alerts.map(a => ({ id: a.id, price: a.price, triggered: a.triggered })) });
}

/** Parse and validate exported alerts. Throws a TypeError naming the bad field. */
export function alertsFromJSON(json: string | object): PriceAlert[] {
  let data: unknown = json;
  if (typeof json === 'string') {
    try { data = JSON.parse(json); } catch { throw new TypeError('Chartist Lite: importJSON needs valid JSON text'); }
  }
  const d = data as { format?: unknown; version?: unknown; alerts?: unknown } | null;
  if (!d || typeof d !== 'object' || d.format !== ALERTS_FORMAT) throw new TypeError(`Chartist Lite: importJSON expects "format": "${ALERTS_FORMAT}"`);
  if (d.version !== 1) throw new TypeError('Chartist Lite: importJSON supports "version": 1');
  if (!Array.isArray(d.alerts)) throw new TypeError('Chartist Lite: importJSON needs an "alerts" array');
  const seen = new Set<string>();
  return d.alerts.map((a: unknown, i: number): PriceAlert => {
    const r = a as { id?: unknown; price?: unknown; triggered?: unknown } | null;
    if (!r || typeof r !== 'object') throw new TypeError(`Chartist Lite: alert ${i} is not an object`);
    if (typeof r.id !== 'string' || r.id === '') throw new TypeError(`Chartist Lite: alert ${i} needs a text "id"`);
    if (seen.has(r.id)) throw new TypeError(`Chartist Lite: alert id "${r.id}" appears twice`);
    seen.add(r.id);
    if (typeof r.price !== 'number' || !Number.isFinite(r.price)) throw new TypeError(`Chartist Lite: alert "${r.id}" needs a finite "price"`);
    return { id: r.id, price: r.price, triggered: r.triggered === true };
  });
}

interface Chip { x: number; y: number; w: number; h: number; closeX: number }

const CHIP_H = 22;
const BELL = 'M12 3.5a5 5 0 0 0-5 5v3.2c0 1.3-.5 2.3-1.4 3.3h12.8c-.9-1-1.4-2-1.4-3.3V8.5a5 5 0 0 0-5-5zM10 18.5a2 2 0 0 0 4 0';
const PLUS_X = 24; // centre of the "+" from the plot's right edge
const PLUS_R = 11;
const LINE_HIT = 5;

export function createPriceAlerts(chart: ChartApi, series: AnySeries, options: Partial<PriceAlertsOptions> = {}): PriceAlertsHandle {
  let opts: PriceAlertsOptions = { removeOnTrigger: false, addButton: true, ...options };
  let list: PriceAlert[] = [];
  let counter = 0;
  let selected: string | null = null;
  let host: PrimitiveHost | null = null;
  let hover: { x: number; y: number } | null = null;
  let drag: { id: string; moved: boolean } | null = null;
  let cursor: string | null = null;
  let prev: number | null = null;
  let destroyed = false;
  /** Chip geometry from the last draw, plot-relative x and pane-relative y, for hit tests. */
  const chips = new Map<string, Chip>();
  let plotW = 0;

  const lastValue = (): number | null => {
    const rows = series.data();
    for (let i = rows.length - 1; i >= 0; i--) { const v = numberOf(rows[i]); if (Number.isFinite(v)) return v; }
    return null;
  };
  prev = lastValue();

  const changed = (): void => { host?.requestUpdate(); try { opts.onChange?.(list.map(a => ({ ...a }))); } catch { /* host callback */ } };
  const fmtSeries = (): { minMove: number; precision: number } => resolvePriceFormat(series.options().priceFormat);
  const snap = (p: number): number => { const f = fmtSeries(); return snapPrice(p, f.minMove, f.precision); };

  const fire = (value: number, time: Time | undefined): AlertTrigger[] => {
    const levels = list.filter(a => !a.triggered);
    const hits = crossings(prev, value, levels);
    prev = value;
    const out: AlertTrigger[] = [];
    for (const h of hits) {
      const a = list.find(x => x.id === h.id);
      if (!a) continue;
      a.triggered = true;
      out.push({ id: a.id, price: a.price, direction: h.direction, value, time });
    }
    if (out.length) {
      if (opts.removeOnTrigger) list = list.filter(a => !out.some(o => o.id === a.id));
      changed();
      for (const t of out) { try { opts.onTrigger?.(t); } catch { /* the host's problem, not the chart's */ } }
    }
    return out;
  };

  // Watch the series: `update` is checked after it is applied, `setData` only re-bases the previous price.
  const origUpdate = series.update;
  const origSetData = series.setData;
  const wrapUpdate = (row: Parameters<typeof origUpdate>[0]): void => {
    origUpdate.call(series, row);
    if (destroyed) return;
    const v = numberOf(row);
    if (Number.isFinite(v)) fire(v, (row as { time: Time }).time);
  };
  const wrapSetData = (data: Parameters<typeof origSetData>[0]): void => {
    origSetData.call(series, data);
    if (!destroyed) prev = lastValue();
  };
  series.update = wrapUpdate as typeof origUpdate;
  series.setData = wrapSetData as typeof origSetData;

  const priceAt = (y: number): number | null => {
    const p = series.coordinateToPrice(y);
    return p === null || !Number.isFinite(p) ? null : snap(p);
  };
  const chipAt = (e: ChartPointerEvent): { id: string; close: boolean } | null => {
    for (const [id, c] of chips) {
      if (e.point.x >= c.x && e.point.x <= c.x + c.w && Math.abs(e.point.y - c.y) <= c.h / 2) return { id, close: e.point.x >= c.closeX };
    }
    return null;
  };
  const lineAt = (e: ChartPointerEvent): string | null => {
    const lines: { id: string; y: number }[] = [];
    for (const a of list) { const y = series.priceToCoordinate(a.price); if (y !== null) lines.push({ id: a.id, y }); }
    return nearestLine(lines, e.point.y, LINE_HIT);
  };
  const plusHit = (e: ChartPointerEvent): boolean => opts.addButton && plotW > 0 && Math.hypot(e.point.x - (plotW - PLUS_X), 0) <= PLUS_R + 2 && Math.abs(e.point.y - (hover ? hover.y : e.point.y)) <= PLUS_R + 2;

  const setCursor = (c: string | null): void => { if (c !== cursor) { cursor = c; chart.setCursor(c); } };
  const mine = (e: ChartPointerEvent): boolean => e.paneIndex === series.paneIndex() && series.options().visible;

  const removeAlert = (id: string): boolean => {
    const i = list.findIndex(a => a.id === id);
    if (i < 0) return false;
    list.splice(i, 1);
    chips.delete(id);
    if (selected === id) selected = null;
    changed();
    return true;
  };
  const addAlert = (price: number): PriceAlert => {
    if (typeof price !== 'number' || !Number.isFinite(price)) throw new TypeError('Chartist Lite: an alert needs a finite price');
    const a: PriceAlert = { id: `a${++counter}`, price, triggered: false };
    list.push(a);
    changed();
    return a;
  };

  const handler: ChartPointerHandler = {
    hover(e) {
      if (!mine(e) || e.area !== 'pane') { hover = null; setCursor(null); host?.requestOverlay?.(); return; }
      hover = { x: e.point.x, y: e.point.y };
      const chip = chipAt(e);
      if (chip) setCursor(chip.close ? 'pointer' : 'ns-resize');
      else if (plusHit(e)) setCursor('pointer');
      else setCursor(lineAt(e) ? 'ns-resize' : null);
      host?.requestOverlay?.();
    },
    pointerDown(e) {
      if (!mine(e) || e.area !== 'pane') return false;
      const chip = chipAt(e);
      if (chip?.close) { removeAlert(chip.id); return true; }
      if (!chip && plusHit(e)) {
        const p = priceAt(hover ? hover.y : e.point.y);
        if (p !== null) { const a = addAlert(p); selected = a.id; host?.requestUpdate(); }
        return true;
      }
      const id = chip ? chip.id : lineAt(e);
      if (!id) { if (selected) { selected = null; host?.requestUpdate(); } return false; }
      selected = id;
      drag = { id, moved: false };
      host?.requestUpdate();
      return true;
    },
    pointerMove(e) {
      if (!drag) return;
      const p = priceAt(e.point.y);
      const a = list.find(x => x.id === drag?.id);
      if (!a || p === null || p === a.price) return;
      a.price = p;
      drag.moved = true;
      host?.requestUpdate();
    },
    pointerUp(e, cancelled) {
      const d = drag;
      drag = null;
      if (!d || !d.moved) return;
      const a = list.find(x => x.id === d.id);
      if (a) {
        if (cancelled) return;
        // Moving an alert re-arms it, and the price already beyond it must not fire it at once.
        a.triggered = false;
        prev = lastValue();
        changed();
      }
      void e;
    },
    keyDown(e) {
      if (!selected || e.altKey || e.ctrlKey || e.metaKey) return false;
      if (e.key === 'Delete' || e.key === 'Backspace') { removeAlert(selected); return true; }
      if (e.key === 'Escape') { selected = null; host?.requestUpdate(); return true; }
      return false;
    },
  };
  const removeHandler = chart.addPointerHandler(handler);
  const leave = (): void => { hover = null; setCursor(null); host?.requestOverlay?.(); };
  chart.element().addEventListener('pointerleave', leave, { passive: true });

  const prim: ChartPrimitive = {
    zOrder: 'top',
    attached(h) { host = h; },
    detached() { host = null; },
    draw(s) {
      plotW = s.pane.width;
      chips.clear();
      if (!list.length) return;
      const { ctx, pane } = s;
      const accent = accentFor(s.colors);
      const size = Math.max(12, s.fontSize);
      const dashed = [4, 3];
      ctx.save();
      ctx.font = `500 ${size}px ${s.fontFamily}`;
      ctx.textBaseline = 'middle';
      for (const a of list) {
        const y = s.priceToY(a.price);
        if (y === null || y < pane.y - CHIP_H || y > pane.y + pane.height + CHIP_H) continue;
        const sel = a.id === selected;
        const colour = a.triggered ? s.colors.mutedText : accent;
        const yc = Math.round(y) + 0.5;
        ctx.strokeStyle = colour;
        ctx.lineWidth = sel ? 1.5 : 1;
        ctx.setLineDash(a.triggered ? [1, 3] : sel ? [] : dashed);
        ctx.beginPath();
        ctx.moveTo(pane.x, yc);
        ctx.lineTo(pane.x + pane.width, yc);
        ctx.stroke();
        ctx.setLineDash([]);
        // The chip: bell, label, close.
        const label = a.triggered ? 'Triggered' : 'Alert';
        const tw = ctx.measureText(label).width;
        const w = Math.round(10 + 16 + 6 + tw + 8 + 16 + 6);
        const x = pane.x + pane.width - 52 - w;
        const top = Math.round(y - CHIP_H / 2);
        ctx.fillStyle = s.colors.background;
        ctx.strokeStyle = colour;
        ctx.lineWidth = sel ? 2 : 1;
        ctx.beginPath();
        roundedRectPath(ctx, x + 0.5, top + 0.5, w, CHIP_H, CHIP_H / 2);
        ctx.fill();
        ctx.stroke();
        ctx.save();
        ctx.translate(x + 8, y - 8);
        ctx.scale(16 / 24, 16 / 24);
        ctx.strokeStyle = colour;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke(new Path2D(BELL));
        ctx.restore();
        ctx.fillStyle = colour;
        ctx.textAlign = 'left';
        ctx.fillText(label, x + 8 + 16 + 6, y + 0.5);
        const cx = x + w - 6 - 8;
        ctx.strokeStyle = colour;
        ctx.lineWidth = 1.6;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx - 3.5, y - 3.5); ctx.lineTo(cx + 3.5, y + 3.5);
        ctx.moveTo(cx + 3.5, y - 3.5); ctx.lineTo(cx - 3.5, y + 3.5);
        ctx.stroke();
        chips.set(a.id, { x: x - pane.x, y: y - pane.y, w, h: CHIP_H, closeX: cx - 9 - pane.x });
      }
      ctx.restore();
    },
    drawOverlay(s) {
      if (!opts.addButton || !hover || drag) return;
      const { ctx, pane } = s;
      const near = Math.max(0, Math.min(1, 1 - (pane.width - hover.x - PLUS_X) / 140));
      if (near <= 0 || hover.y < PLUS_R || hover.y > pane.height - PLUS_R) return;
      const over = chips.size > 0 && [...chips.values()].some(c => Math.abs(c.y - hover!.y) < c.h);
      if (over) return;
      const accent = accentFor(s.colors);
      const cx = pane.x + pane.width - PLUS_X;
      const cy = pane.y + hover.y;
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.65 * near;
      ctx.fillStyle = s.colors.background;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, PLUS_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - 4.5, cy); ctx.lineTo(cx + 4.5, cy);
      ctx.moveTo(cx, cy - 4.5); ctx.lineTo(cx, cy + 4.5);
      ctx.stroke();
      ctx.restore();
    },
    priceAxisLabels(colors): readonly PriceAxisLabel[] {
      const accent = accentFor(colors);
      return list.map(a => ({ price: a.price, color: a.triggered ? withAlpha(colors.mutedText, 1) : accent, textColor: colors.background }));
    },
  };
  series.attachPrimitive(prim);

  const dropWatchers = (): void => {
    destroyed = true;
    if (series.update === wrapUpdate) series.update = origUpdate;
    if (series.setData === wrapSetData) series.setData = origSetData;
  };

  let gone = false;
  return {
    alerts: () => list.map(a => ({ ...a })),
    add: addAlert,
    remove: removeAlert,
    clear() { if (list.length) { list = []; chips.clear(); selected = null; changed(); } },
    check: (value: number, time?: Time) => fire(value, time),
    exportJSON: () => alertsToJSON(list),
    importJSON(json: string | object) {
      const next = alertsFromJSON(json);
      list = next;
      for (const a of next) { const m = /^a(\d+)$/.exec(a.id); if (m) counter = Math.max(counter, Number(m[1])); }
      selected = null;
      prev = lastValue();
      changed();
    },
    applyOptions(patch: Partial<PriceAlertsOptions>) { opts = { ...opts, ...patch }; host?.requestUpdate(); },
    destroy() {
      if (gone) return;
      gone = true;
      dropWatchers();
      removeHandler();
      chart.element().removeEventListener('pointerleave', leave);
      setCursor(null);
      try { series.detachPrimitive(prim); } catch { /* series removed */ }
    },
  };
}
