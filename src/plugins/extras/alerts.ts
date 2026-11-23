// Price alerts. A "+" beside the crosshair price (near the price axis) adds an alert line with a bell; drag a line to
// move it; remove it with its close control or Delete. An alert fires once, when the series' price crosses it in either
// direction on `update()`: the plugin watches the series' `update` and `setData` (see `watch`), and `check()` lets the
// host feed prices itself. The crossing logic is pure. No notification API is used: the host decides in `onTrigger`.
// Drawn on the canvas (a series primitive plus pointer hooks), so nothing is left in the DOM.

import type { ChartApi, ChartPointerEvent, ChartPointerHandler } from '../../api';
import type { Time } from '../../core/time';
import { resolvePriceFormat } from '../../core/format';
import type { ChartPrimitive, PriceAxisLabel, PrimitiveDrawScope, PrimitiveHost } from '../primitive';

type PrimitiveScopeColors = PrimitiveDrawScope['colors'];
import type { AnySeries } from './common';
import { accentFor, createHost, css, formatterFor, make, numberOf, roundedRectPath, withAlpha, type DomHost } from './common';

export interface PriceAlert {
  id: string;
  price: number;
  /** True once it has fired (it stays drawn, muted, until removed or moved). */
  triggered: boolean;
  /** Once triggered: which way the price crossed it. */
  direction?: 'up' | 'down';
  /** Once triggered: the price that crossed it. */
  value?: number;
  /** Once triggered: the time of the bar that crossed it, when it is a number (UNIX seconds). */
  time?: number;
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
  /**
   * Watch the series' `update` and `setData` (default true). False: the host feeds every new price with `check()` and
   * calls `rebase()` after replacing the history (for a series whose rows are not the prices to watch, such as Renko
   * bricks built from source bars).
   */
  watch: boolean;
  /** The current price to start from (and after `rebase()`, `importJSON()` or a move). Default: the series' last value. */
  lastPrice?: () => number | null;
  /** At most this many alerts: `add` throws a RangeError and the "+" does nothing past it. Default no limit. */
  maxAlerts?: number;
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
  /** Start again from the current price (`lastPrice`) without firing: after the history was replaced. */
  rebase(): void;
  /**
   * Where the chips were drawn last (pane px, top to bottom): each chip's alert ids (more than one for a collapsed
   * "N alerts" group), its centre `y` and its line's `line` (a group: the mean). The dragged alert is last.
   */
  placements(): PlacedChip[];
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

/** A copy with only the known fields (the trigger details only on a triggered alert). */
function cleanAlert(a: PriceAlert): PriceAlert {
  const out: PriceAlert = { id: a.id, price: a.price, triggered: a.triggered };
  if (a.triggered) {
    if (a.direction === 'up' || a.direction === 'down') out.direction = a.direction;
    if (typeof a.value === 'number' && Number.isFinite(a.value)) out.value = a.value;
    if (typeof a.time === 'number' && Number.isFinite(a.time)) out.time = a.time;
  }
  return out;
}

export function alertsToJSON(alerts: readonly PriceAlert[]): string {
  return JSON.stringify({ format: ALERTS_FORMAT, version: 1, alerts: alerts.map(cleanAlert) });
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
    // Trigger details are optional (older exports have none); anything malformed in them is left out.
    return cleanAlert({ ...(r as object), id: r.id, price: r.price, triggered: r.triggered === true } as PriceAlert);
  });
}

/** A placed chip: its centre `y` and the `line` it belongs to (a group: the mean of its lines). */
export interface PlacedChip { ids: string[]; y: number; line: number }

/**
 * Where the alert chips go along the pane's height (pure; all in the same px space). Each chip sits as close as it
 * can to its own line; chips that would overlap are stacked edge to edge (`gap` apart) around the mean of their lines,
 * kept inside [`top`, `bottom`] and out of the `obstacles` bands. Order is the lines' order (ties: input order), so
 * nothing jumps while prices tick. A stack of more than `maxStack` chips, or more than fit, collapses into one group
 * (`ids.length > 1`) at the mean of its lines. Lines are { id, y }.
 */
export function layoutAlertChips(
  lines: readonly { id: string; y: number }[],
  o: { height: number; gap?: number; top: number; bottom: number; maxStack?: number; obstacles?: readonly { y0: number; y1: number }[] },
): PlacedChip[] {
  const h = o.height;
  const gap = o.gap ?? 2;
  const step = h + gap;
  // Free intervals between the obstacles (each obstacle widened by the gap).
  const blocked = [...(o.obstacles ?? [])].map(b => ({ y0: Math.min(b.y0, b.y1) - gap, y1: Math.max(b.y0, b.y1) + gap })).sort((a, b) => a.y0 - b.y0);
  const free: { lo: number; hi: number }[] = [];
  let at = o.top;
  for (const b of blocked) { if (b.y0 - at >= h) free.push({ lo: at, hi: b.y0 }); at = Math.max(at, b.y1); }
  if (o.bottom - at >= h) free.push({ lo: at, hi: o.bottom });
  if (!free.length) free.push({ lo: o.top, hi: Math.max(o.top + h, o.bottom) });
  type Item = { ids: string[]; line: number; n: number };
  const sorted = lines.map((l, i) => ({ l, i })).filter(x => Number.isFinite(x.l.y)).sort((a, b) => a.l.y - b.l.y || a.i - b.i);
  const per = free.map(() => [] as Item[]);
  for (const { l } of sorted) {
    let best = 0, dist = Infinity;
    free.forEach((f, k) => { const d = l.y < f.lo ? f.lo - l.y : l.y > f.hi ? l.y - f.hi : 0; if (d < dist) { dist = d; best = k; } });
    per[best].push({ ids: [l.id], line: l.y, n: 1 });
  }
  const out: PlacedChip[] = [];
  free.forEach((f, k) => {
    let items = per[k];
    if (!items.length) return;
    const cap = Math.max(1, Math.floor((f.hi - f.lo + gap) / step));
    const maxStack = Math.max(1, Math.min(o.maxStack ?? 5, cap));
    for (;;) {
      // Stack: each block is a run of chips edge to edge, centred on the mean of their lines, kept in the interval.
      const blocks: { items: Item[]; top: number }[] = [];
      const place = (b: { items: Item[]; top: number }): void => {
        const size = b.items.length * step - gap;
        let sum = 0;
        b.items.forEach((it, j) => { sum += it.line - h / 2 - j * step; });
        b.top = Math.max(f.lo, Math.min(f.hi - size, sum / b.items.length));
      };
      for (const it of items) {
        const b = { items: [it], top: 0 };
        place(b);
        blocks.push(b);
        while (blocks.length > 1) {
          const last = blocks[blocks.length - 1], prev = blocks[blocks.length - 2];
          if (last.top >= prev.top + prev.items.length * step) break;
          blocks.pop();
          prev.items = prev.items.concat(last.items);
          place(prev);
        }
      }
      const big = blocks.find(b => b.items.length > maxStack);
      if (!big) {
        for (const b of blocks) b.items.forEach((it, j) => out.push({ ids: it.ids, y: b.top + j * step + h / 2, line: it.line }));
        return;
      }
      // Too many together: the whole stack becomes one group at the mean of its lines.
      const n = big.items.reduce((a, it) => a + it.n, 0);
      const group: Item = { ids: big.items.flatMap(it => it.ids), line: big.items.reduce((a, it) => a + it.line * it.n, 0) / n, n };
      const first = items.indexOf(big.items[0]);
      items = [...items.slice(0, first), group, ...items.slice(first + big.items.length)];
    }
  });
  return out.sort((a, b) => a.y - b.y);
}

interface Chip { x: number; y: number; w: number; h: number; closeX: number }

const CHIP_H = 22;
const BELL = 'M12 3.5a5 5 0 0 0-5 5v3.2c0 1.3-.5 2.3-1.4 3.3h12.8c-.9-1-1.4-2-1.4-3.3V8.5a5 5 0 0 0-5-5zM10 18.5a2 2 0 0 0 4 0';
const PLUS_X = 24; // centre of the "+" from the plot's right edge
const PLUS_R = 11;
const LINE_HIT = 5;

export function createPriceAlerts(chart: ChartApi, series: AnySeries, options: Partial<PriceAlertsOptions> = {}): PriceAlertsHandle {
  let opts: PriceAlertsOptions = { removeOnTrigger: false, addButton: true, watch: true, ...options };
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
    if (opts.lastPrice) { try { const v = opts.lastPrice(); return typeof v === 'number' && Number.isFinite(v) ? v : null; } catch { return null; } }
    const rows = series.data();
    for (let i = rows.length - 1; i >= 0; i--) { const v = numberOf(rows[i]); if (Number.isFinite(v)) return v; }
    return null;
  };
  prev = lastValue();

  const changed = (): void => { host?.requestUpdate(); try { opts.onChange?.(list.map(cleanAlert)); } catch { /* host callback */ } };
  const full = (): boolean => typeof opts.maxAlerts === 'number' && list.length >= opts.maxAlerts;
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
      a.direction = h.direction;
      a.value = value;
      if (typeof time === 'number' && Number.isFinite(time)) a.time = time; else delete a.time;
      out.push({ id: a.id, price: a.price, direction: h.direction, value, time });
    }
    if (out.length) {
      if (opts.removeOnTrigger) list = list.filter(a => !out.some(o => o.id === a.id));
      changed();
      for (const t of out) { try { opts.onTrigger?.(t); } catch { /* the host's problem, not the chart's */ } }
    }
    return out;
  };

  // Watch the series through the core's data hook (no method wrapping, so several plugins can watch one series):
  // `update` is checked after it is applied, `setData` only re-bases the previous price.
  const onData = (kind: 'set' | 'update', row?: unknown): void => {
    if (destroyed || !opts.watch) return;
    if (kind === 'set') { prev = lastValue(); return; }
    const v = numberOf(row as never);
    if (Number.isFinite(v)) fire(v, (row as { time: Time }).time);
  };
  series.subscribeDataChanged(onData);

  const priceAt = (y: number): number | null => {
    const p = series.coordinateToPrice(y);
    return p === null || !Number.isFinite(p) ? null : snap(p);
  };
  const chipAt = (e: ChartPointerEvent): { id: string; close: boolean } | null => {
    // A finger gets a 44 px tall target: the nearest chip within 22 px (stacked chips split the space between them).
    const tol = e.pointerType === 'touch' || coarse() ? 22 : CHIP_H / 2;
    let best: { id: string; close: boolean } | null = null;
    let dist = Infinity;
    for (const [id, c] of chips) {
      const d = Math.abs(e.point.y - c.y);
      if (e.point.x >= c.x - 4 && e.point.x <= c.x + c.w + 4 && d <= tol && d < dist) { dist = d; best = { id, close: e.point.x >= c.closeX }; }
    }
    return best;
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
    if (full()) throw new RangeError(`Chartist Lite: at most ${opts.maxAlerts} price alerts`);
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
        const p = full() ? null : priceAt(hover ? hover.y : e.point.y);
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
    pointerUp(_e, cancelled) {
      const d = drag;
      drag = null;
      if (!d || !d.moved) return;
      const a = list.find(x => x.id === d.id);
      if (a) {
        if (cancelled) return;
        // Moving an alert re-arms it, and the price already beyond it must not fire it at once.
        a.triggered = false;
        delete a.direction; delete a.value; delete a.time;
        prev = lastValue();
        changed();
      }
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

  // ── chip layout: computed from the lines' positions only (cheap, no DOM read), so the chips never overlap ──
  let paneH = 0;
  const coarse = (): boolean => { try { return !!chart.element().ownerDocument.defaultView?.matchMedia?.('(pointer: coarse)').matches; } catch { return false; } };
  /** The chips' places for the current lines (pane px); the dragged alert is left out (drawn on top, on its line). */
  const layout = (): PlacedChip[] => {
    const lines: { id: string; y: number }[] = [];
    for (const a of list) {
      if (drag && drag.id === a.id) continue;
      const y = series.priceToCoordinate(a.price);
      if (y === null || y < -CHIP_H || y > paneH + CHIP_H) continue;
      lines.push({ id: a.id, y });
    }
    return paneH > 0 ? layoutAlertChips(lines, { height: CHIP_H, gap: 2, top: 2, bottom: paneH - 2 }) : [];
  };
  let groups: PlacedChip[] = [];
  let lastPlaced: PlacedChip[] = [];

  // ── collapsed groups: a DOM button ("N alerts") per group, which opens a small list on hover, focus or tap ──
  // Written only when the groups, their places or the theme change (no read, no write while nothing moved).
  let ui: DomHost | null = null;
  let groupKey = '';
  let openGroup: string | null = null;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  let look: { colors: PrimitiveScopeColors; font: string; size: number; pane: { x: number; y: number; width: number; height: number } } | null = null;
  const fmt = (): ((v: number) => string) => formatterFor(chart, series);
  function syncGroups(colors: PrimitiveScopeColors, family: string, size: number, pane: { x: number; y: number; width: number; height: number }): void {
    look = { colors, font: family, size, pane };
    const key = `${groups.map(g => `${g.ids.join(',')}@${Math.round(g.y)}`).join(';')}|${pane.x},${pane.y},${pane.width}|${colors.background}|${size}|${openGroup ?? ''}|${coarse()}|${list.map(a => `${a.id}:${a.price}:${a.triggered}`).join(',')}`;
    if (key === groupKey) return;
    groupKey = key;
    if (!groups.length) { openGroup = null; if (ui) { ui.destroy(); ui = null; } return; }
    if (!ui) ui = createHost(chart, 'alert-groups', true, 4);
    const root = ui.root;
    const active = (root as { activeElement?: Element | null }).activeElement ?? null;
    const focusedGroup = active?.getAttribute?.('data-group') ?? null;
    const focusedPanel = active?.closest?.('[data-panel]')?.getAttribute('data-panel') ?? null;
    while (root.firstChild) root.removeChild(root.firstChild);
    const accent = accentFor(colors);
    const big = coarse();
    const hgt = big ? 44 : CHIP_H;
    const f = fmt();
    // A group that changed (an alert removed or added) keeps its list open: the new group with any of its alerts.
    const follow = (gid: string | null): string | null => {
      if (!gid || groups.some(g => g.ids.join(',') === gid)) return gid;
      const old = new Set(gid.split(','));
      const g = groups.find(x => x.ids.some(id => old.has(id)));
      return g ? g.ids.join(',') : null;
    };
    openGroup = follow(openGroup);
    const panelNow = follow(focusedPanel);
    for (const g of groups) {
      const gid = g.ids.join(',');
      const members = list.filter(a => g.ids.includes(a.id)).sort((a, b) => b.price - a.price);
      // A row, right-aligned on the chips' right edge: [the list, when open] [the chip], the chip first in the tab
      // order. No size is read.
      const wrap = make(ui.doc, 'div', {
        position: 'absolute', display: 'flex', 'flex-direction': 'row-reverse', 'align-items': 'flex-start', gap: '8px', 'pointer-events': 'none',
        left: `${pane.x + pane.width - 52}px`, top: `${pane.y + g.y - hgt / 2}px`, transform: 'translateX(-100%)',
      }, root);
      const btn = make(ui.doc, 'button', {
        position: 'relative', 'pointer-events': 'auto', height: `${hgt}px`, 'min-width': `${hgt}px`, padding: '0 10px', 'border-radius': `${hgt / 2}px`,
        background: colors.background, color: accent, border: `1px solid ${accent}`, font: `600 ${size}px ${family}`, cursor: 'pointer',
        'white-space': 'nowrap', 'box-sizing': 'border-box', display: 'inline-flex', 'align-items': 'center', gap: '6px', outline: 'none', 'flex-shrink': '0',
      }, wrap) as HTMLButtonElement;
      btn.type = 'button';
      btn.setAttribute('data-group', gid);
      btn.setAttribute('aria-haspopup', 'true');
      btn.setAttribute('aria-expanded', String(openGroup === gid));
      btn.setAttribute('aria-label', `${members.length} price alerts from ${f(members[members.length - 1]?.price ?? 0)} to ${f(members[0]?.price ?? 0)}`);
      btn.textContent = `${members.length} alerts`;
      const ring = (on: boolean): void => css(btn, { 'box-shadow': on ? `0 0 0 2px ${colors.focusRing}` : 'none' });
      btn.addEventListener('focus', () => { ring(true); openList(gid); });
      btn.addEventListener('blur', () => ring(false));
      btn.addEventListener('pointerenter', ev => { if (ev.pointerType === 'mouse') openList(gid); });
      btn.addEventListener('pointerleave', ev => { if (ev.pointerType === 'mouse') closeSoon(); });
      btn.addEventListener('click', () => { if (openGroup === gid) closeList(); else openList(gid); });
      btn.addEventListener('keydown', ev => { if (ev.key === 'Escape') { closeList(); chart.element().focus(); } });
      if (openGroup === gid) {
        const panel = make(ui.doc, 'div', {
          position: 'relative', 'pointer-events': 'auto', 'min-width': '180px', padding: '4px', 'border-radius': '10px', 'box-sizing': 'border-box',
          background: colors.background, border: `1px solid ${colors.paneSeparator}`, 'box-shadow': '0 4px 16px rgba(0,0,0,0.18)',
          font: `500 ${size}px ${family}`, color: colors.text, 'flex-shrink': '0',
          display: 'flex', 'flex-direction': 'column', gap: '2px', 'max-height': `${Math.max(80, pane.height - 8)}px`, 'overflow-y': 'auto',
        });
        wrap.appendChild(panel); // after the chip in the tab order, drawn to its left (row-reverse)
        panel.setAttribute('role', 'group');
        panel.setAttribute('data-panel', gid);
        panel.setAttribute('aria-label', 'Price alerts');
        // Beside the chip (to its left, so it never covers it), centred on it and kept inside the pane.
        const rowH = big ? 44 : 30;
        const want = Math.min(members.length * (rowH + 2) + 8, pane.height - 8);
        const topAt = Math.max(pane.y + 4, Math.min(pane.y + pane.height - 4 - want, pane.y + g.y - want / 2));
        css(panel, { top: `${topAt - (pane.y + g.y - hgt / 2)}px` });
        panel.addEventListener('pointerenter', ev => { if ((ev as PointerEvent).pointerType === 'mouse' && closeTimer) { clearTimeout(closeTimer); closeTimer = null; } });
        panel.addEventListener('pointerleave', ev => { if ((ev as PointerEvent).pointerType === 'mouse') closeSoon(); });
        panel.addEventListener('keydown', ev => { if (ev.key === 'Escape') { closeList(); (root.querySelector(`[data-group="${gid}"]`) as HTMLElement | null)?.focus(); } });
        for (const a of members) {
          const row = make(ui.doc, 'div', { display: 'flex', 'align-items': 'center', gap: '8px', height: `${rowH}px`, padding: '0 4px 0 8px', 'border-radius': '6px' }, panel);
          const price = make(ui.doc, 'span', { 'flex-grow': '1', color: colors.text, font: `600 ${size}px ${family}`, 'font-variant-numeric': 'tabular-nums' }, row);
          price.textContent = f(a.price);
          const state = make(ui.doc, 'span', { color: a.triggered ? colors.mutedText : accent, font: `500 ${size}px ${family}` }, row);
          state.textContent = a.triggered ? 'Triggered' : 'Alert';
          const rm = make(ui.doc, 'button', {
            width: `${big ? 44 : 26}px`, height: `${big ? 44 : 26}px`, 'border-radius': '13px', background: 'transparent', color: colors.text,
            border: '0', cursor: 'pointer', font: `500 ${size + 2}px ${family}`, display: 'inline-flex', 'align-items': 'center', 'justify-content': 'center', outline: 'none',
          }, row) as HTMLButtonElement;
          rm.type = 'button';
          rm.textContent = '×';
          rm.setAttribute('aria-label', `Remove the alert at ${f(a.price)}`);
          rm.addEventListener('focus', () => css(rm, { 'box-shadow': `0 0 0 2px ${colors.focusRing}` }));
          rm.addEventListener('blur', () => css(rm, { 'box-shadow': 'none' }));
          rm.addEventListener('click', () => { removeAlert(a.id); });
        }
      }
    }
    if (focusedGroup) (root.querySelector(`[data-group="${focusedGroup}"]`) as HTMLElement | null)?.focus();
    // A row removed from the list: the focus stays in the list (or on its button when the group is gone).
    else if (focusedPanel) {
      const next = ((panelNow && root.querySelector(`[data-panel="${panelNow}"] button`)) || root.querySelector('[data-group]')) as HTMLElement | null;
      next?.focus();
    }
  }
  function openList(gid: string): void {
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    if (openGroup === gid) return;
    openGroup = gid;
    if (look) { groupKey = ''; syncGroups(look.colors, look.font, look.size, look.pane); }
  }
  function closeList(): void {
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    if (!openGroup) return;
    openGroup = null;
    if (look) { groupKey = ''; syncGroups(look.colors, look.font, look.size, look.pane); }
  }
  function closeSoon(): void {
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = setTimeout(() => { closeTimer = null; closeList(); }, 250);
  }

  const prim: ChartPrimitive = {
    zOrder: 'top',
    attached(h) { host = h; },
    detached() { host = null; },
    draw(s) {
      plotW = s.pane.width;
      paneH = s.pane.height;
      chips.clear();
      const { ctx, pane } = s;
      const placed = list.length ? layout() : [];
      lastPlaced = placed.map(p => ({ ids: p.ids.slice(), y: p.y, line: p.line }));
      groups = placed.filter(p => p.ids.length > 1);
      syncGroups(s.colors, s.fontFamily, Math.max(12, s.fontSize), pane);
      if (!list.length) return;
      const accent = accentFor(s.colors);
      const size = Math.max(12, s.fontSize);
      ctx.save();
      ctx.font = `500 ${size}px ${s.fontFamily}`;
      ctx.textBaseline = 'middle';
      // Every line, full width (grouped ones too); then the chips; the dragged one last, on top.
      for (const a of list) {
        const y = s.priceToY(a.price);
        if (y === null || y < pane.y - 2 || y > pane.y + pane.height + 2) continue;
        const sel = a.id === selected;
        const colour = a.triggered ? s.colors.mutedText : accent;
        const yc = Math.round(y) + 0.5;
        ctx.strokeStyle = colour;
        ctx.lineWidth = sel ? 1.5 : 1;
        ctx.setLineDash(a.triggered ? [1, 3] : sel ? [] : [4, 3]);
        ctx.beginPath();
        ctx.moveTo(pane.x, yc);
        ctx.lineTo(pane.x + pane.width, yc);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      const one = (a: PriceAlert, lineY: number, chipY: number): void => {
        const sel = a.id === selected;
        const colour = a.triggered ? s.colors.mutedText : accent;
        const label = a.triggered ? 'Triggered' : 'Alert';
        const tw = ctx.measureText(label).width;
        const w = Math.round(10 + 16 + 6 + tw + 8 + 16 + 6);
        const x = pane.x + pane.width - 52 - w;
        const y = pane.y + chipY;
        // A chip moved off its line keeps a thin leader to it.
        if (Math.abs(chipY - lineY) > 2) {
          ctx.strokeStyle = colour;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x + 2, y);
          ctx.lineTo(x - 10, pane.y + lineY);
          ctx.stroke();
        }
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
        chips.set(a.id, { x: x - pane.x, y: chipY, w, h: CHIP_H, closeX: cx - 9 - pane.x });
      };
      for (const p of placed) {
        if (p.ids.length > 1) continue;
        const a = list.find(x => x.id === p.ids[0]);
        if (a) one(a, p.line, p.y);
      }
      const dragged = drag ? list.find(x => x.id === drag?.id) : undefined;
      if (dragged) {
        const y = series.priceToCoordinate(dragged.price);
        if (y !== null) { const cy = Math.max(CHIP_H / 2, Math.min(pane.height - CHIP_H / 2, y)); one(dragged, y, cy); lastPlaced.push({ ids: [dragged.id], y: cy, line: y }); }
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
      // One tag per alert, and one per collapsed group (at the mean of its prices): the chart pushes tags apart.
      const accent = accentFor(colors);
      const grouped = new Set(groups.flatMap(g => g.ids));
      const out: PriceAxisLabel[] = list.filter(a => !grouped.has(a.id)).map(a => ({ price: a.price, color: a.triggered ? withAlpha(colors.mutedText, 1) : accent, textColor: colors.background }));
      for (const g of groups) {
        const members = list.filter(a => g.ids.includes(a.id));
        if (!members.length) continue;
        const armed = members.some(a => !a.triggered);
        out.push({ price: members.reduce((t, a) => t + a.price, 0) / members.length, color: armed ? accent : withAlpha(colors.mutedText, 1), textColor: colors.background });
      }
      return out;
    },
  };
  series.attachPrimitive(prim);

  const dropWatchers = (): void => {
    destroyed = true;
    series.unsubscribeDataChanged(onData);
  };

  let gone = false;
  return {
    alerts: () => list.map(cleanAlert),
    add: addAlert,
    remove: removeAlert,
    clear() { if (list.length) { list = []; chips.clear(); selected = null; changed(); } },
    check: (value: number, time?: Time) => fire(value, time),
    rebase() { prev = lastValue(); },
    placements: () => lastPlaced.map(p => ({ ids: p.ids.slice(), y: p.y, line: p.line })),
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
      if (closeTimer) clearTimeout(closeTimer);
      ui?.destroy();
      ui = null;
    },
  };
}
