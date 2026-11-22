// The drawing tools controller: state, creation and editing by pointer and keyboard, undo / redo, events, JSON, the
// optional localStorage adapter. Every tool is a `ToolDefinition` (contract.ts); the controller dispatches through the
// definitions it is given (`tools`, default BASIC_TOOLS), so a host bundles only the tools it passes. Painting goes
// through one series primitive per pane (main layer for settled drawings, overlay for hover, selection, the drawing
// being created and the one being dragged), input through the chart's pointer handler hook. See ARCHITECTURE.md
// "Plugin input hooks and drawing tools".

import type { AnySeriesDefinition, ChartApi, ChartPointerEvent, MouseEventParams, SeriesApi } from '../api';
import type { ThemeColors } from '../core/theme';
import { timeToSeconds, type Time } from '../core/time';
import type { ChartPrimitive, PrimitiveDrawScope, PrimitiveHost } from '../plugins/primitive';
import { createToolbar } from './toolbar';
import { capPoints, constrainAngle, FIB_LEVELS, nearestOhlc, simplifyPath, type Pt, type Rect } from './geometry';
import type { Anchor, BarAccess, BarRow, Drawing, DrawingOptions, DrawingStyle, Proj, RenderCtx, ToolDefinition, ToolId, View } from './contract';
import { BODY, handlePoints, hitWith, keysFor, overlaps, paintBox, registry, type Registry } from './engine';
import { colorOf } from './paint';
import { BASIC_TOOLS } from './tools/basic';

type AnySeries = SeriesApi<AnySeriesDefinition>;

export interface DrawingSpec {
  tool: ToolId;
  /** Times as UNIX seconds, 'YYYY-MM-DD' or a business-day object. */
  points: { time: Time | number; price: number }[];
  style?: Partial<DrawingStyle>;
  text?: string;
  pane?: number;
  locked?: boolean;
  id?: string;
  /** Tool options (Fibonacci `levels`, anchored VWAP `bands`, regression `deviations`). */
  options?: DrawingOptions;
}

export interface DrawingToolsOptions {
  /** The built-in toolbar: `true` (left rail) or `{ position: 'left' | 'top' }`. Default false. */
  toolbar?: boolean | { position?: 'left' | 'top' };
  /** The tools on offer: `BASIC_TOOLS` (default, the first fifteen), `ALL_TOOLS`, or any subset or tools of your own. */
  tools?: readonly ToolDefinition[];
  /** Snap points to the nearest open, high, low or close (ctrl / cmd held inverts it). Default true. */
  magnet?: boolean;
  /** Stay on the tool after a drawing is finished. Default false (back to the cursor). */
  keepDrawing?: boolean;
  /** Style of new drawings. */
  defaultStyle?: Partial<DrawingStyle>;
  /** Volume for the anchored VWAP and the volume profile when the series' rows carry none (a volume histogram). */
  volumeSeries?: AnySeries;
  /** Opt-in persistence: drawings are saved under `key` after every change and loaded at start. */
  persist?: { key: string; storage?: Pick<Storage, 'getItem' | 'setItem'> };
}

export type DrawingEvent = 'created' | 'changed' | 'removed' | 'selected' | 'error';

export interface DrawingToolsController {
  setTool(id: ToolId | null): void;
  tool(): ToolId | null;
  /** The tools on offer (the `tools` option). */
  tools(): readonly ToolDefinition[];
  drawings(): Drawing[];
  /** Add a drawing; throws a TypeError for a bad spec and a RangeError past `LIMITS.drawings`. */
  add(spec: DrawingSpec): Drawing;
  update(id: string, patch: Partial<Omit<DrawingSpec, 'id' | 'tool'>>): Drawing | null;
  remove(id: string): boolean;
  clear(): void;
  select(id: string | null): void;
  selected(): Drawing | null;
  exportJSON(): string;
  /**
   * Load drawings from `exportJSON` text ('replace' by default, or 'append'). Returns how many were added. Ids that
   * clash are given new ones. Past the limits (`LIMITS`), the rest is left out and an 'error' event says so.
   */
  importJSON(json: string, mode?: 'replace' | 'append'): number;
  on(event: 'error', handler: (error: Error) => void): () => void;
  on(event: Exclude<DrawingEvent, 'error'>, handler: (drawing: Drawing | null) => void): () => void;
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  setMagnet(on: boolean): void;
  magnet(): boolean;
  setKeepDrawing(on: boolean): void;
  keepDrawing(): boolean;
  setHidden(on: boolean): void;
  hidden(): boolean;
  /** Theme colours in use (from the last paint): for a toolbar or legend of your own. */
  colors(): Readonly<ThemeColors> | null;
  destroy(): void;
}

/** What the toolbar module provides to the controller. */
export interface DrawingToolsUi {
  sync(): void;
  /** Edit a note's text; `done` gets the text, or null when cancelled or left empty. */
  editText(d: Drawing, at: Pt, done?: (text: string | null) => void): void;
  destroy(): void;
}

export const FORMAT = 'chartist-lite-drawings';
/** JSON format version: 2 adds tool options and the new tools (version 1 exports load unchanged, see `migrate`). */
export const VERSION = 2;

/** Limits that keep a page fast whatever is imported or saved. */
export const LIMITS = {
  /** Drawings per chart. */
  drawings: 2000,
  /** Points of one freehand drawing (brush, highlighter): longer strokes are thinned evenly. */
  freehandPoints: 2000,
  /** Characters of JSON `importJSON` and persistence accept. */
  jsonChars: 4_000_000,
} as const;

const TOUCH_LIFT = 36;
const DRAG_START = 4;

let seq = 0;
const newId = (): string => `d${Date.now().toString(36)}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function copy(d: Drawing): Drawing {
  const out: Drawing = { ...d, points: d.points.map(p => ({ time: p.time, price: p.price })), style: { ...d.style } };
  if (d.options) out.options = JSON.parse(JSON.stringify(d.options)) as DrawingOptions;
  return out;
}

const BASIC: Registry = registry(BASIC_TOOLS);
const asRegistry = (tools?: readonly ToolDefinition[] | Registry): Registry => (!tools ? BASIC : tools instanceof Map ? tools as Registry : registry(tools as readonly ToolDefinition[]));

/**
 * Validate a spec into a drawing (throws a TypeError naming the problem). `tools`: the definitions that may be used
 * (default BASIC_TOOLS).
 */
export function normalizeSpec(spec: DrawingSpec, base: DrawingStyle, tools?: readonly ToolDefinition[] | Registry): Drawing {
  const reg = asRegistry(tools);
  const def = spec && typeof spec.tool === 'string' ? reg.get(spec.tool) : undefined;
  if (!def) throw new TypeError(`Chartist Lite: unknown drawing tool "${String(spec && spec.tool)}"`);
  const name = def.label.toLowerCase();
  if (!Array.isArray(spec.points) || spec.points.length === 0) throw new TypeError(`Chartist Lite: a ${name} needs points`);
  let points: Anchor[] = spec.points.map((p, i) => {
    const time = typeof p.time === 'number' ? p.time : timeToSeconds(p.time);
    if (!Number.isFinite(time) || typeof p.price !== 'number' || !Number.isFinite(p.price)) throw new TypeError(`Chartist Lite: drawing point ${i} needs a time and a finite price`);
    return { time, price: p.price };
  });
  const need = def.minPoints ?? (def.points || 2);
  if (points.length < need) throw new TypeError(`Chartist Lite: a ${name} needs ${need} points`);
  if (def.complete) points = def.complete(points);
  const keep = def.maxPoints ?? def.points;
  points = keep > 0 ? points.slice(0, keep) : capPoints(points, LIMITS.freehandPoints);
  const st = { ...base, ...(def.style ?? {}), ...(spec.style ?? {}) };
  const width = st.width === 1 || st.width === 2 || st.width === 3 ? st.width : base.width;
  const d: Drawing = {
    id: typeof spec.id === 'string' && spec.id ? spec.id.slice(0, 64) : newId(),
    tool: def.id,
    points,
    style: { color: typeof st.color === 'string' && st.color.length < 64 ? st.color : undefined, width, dash: st.dash === 'dashed' ? 'dashed' : 'solid' },
    text: typeof spec.text === 'string' ? spec.text.slice(0, 200) : undefined,
    pane: Number.isInteger(spec.pane) && (spec.pane as number) >= 0 ? (spec.pane as number) : 0,
    locked: spec.locked === true ? true : undefined,
  };
  const options = def.readOptions ? def.readOptions(spec.options ?? def.defaults) : undefined;
  if (options) d.options = options;
  return d;
}

/** Drawings as versioned JSON (times in UNIX seconds, so they survive zoom, resize, time zone and data updates). */
export function drawingsToJSON(list: readonly Drawing[]): string {
  return JSON.stringify({ format: FORMAT, version: VERSION, drawings: list.map(copy) });
}

/**
 * Bring an export of an older version to the current one. Version 1 had no tool options: a Fibonacci retracement gets
 * the levels it was drawn with (the default set). Brushes longer than `LIMITS.freehandPoints` are thinned on load.
 */
export function migrate(data: { version: number; drawings: unknown[] }): { version: number; drawings: unknown[] } {
  if (data.version >= VERSION) return data;
  const drawings = data.drawings.map(raw => {
    const r = raw as Record<string, unknown> | null;
    if (r && r.tool === 'fib' && r.options === undefined) return { ...r, options: { levels: FIB_LEVELS.slice() } };
    return raw;
  });
  return { version: VERSION, drawings };
}

/** Parse `drawingsToJSON` text; unknown tools and bad entries are skipped; clashing ids get new ones. */
export function drawingsFromJSON(json: string, base: DrawingStyle, tools?: readonly ToolDefinition[] | Registry): Drawing[] {
  if (typeof json !== 'string') throw new TypeError('Chartist Lite: not a drawings export');
  if (json.length > LIMITS.jsonChars) throw new RangeError(`Chartist Lite: a drawings export is limited to ${LIMITS.jsonChars} characters (this one has ${json.length})`);
  const data = JSON.parse(json) as { format?: string; version?: number; drawings?: unknown };
  if (!data || data.format !== FORMAT || !Array.isArray(data.drawings)) throw new TypeError('Chartist Lite: not a drawings export');
  if (typeof data.version !== 'number' || data.version > VERSION) throw new TypeError(`Chartist Lite: drawings export version ${String(data.version)} is newer than this library reads`);
  const m = migrate({ version: data.version, drawings: data.drawings });
  const reg = asRegistry(tools);
  const out: Drawing[] = [];
  const ids = new Set<string>();
  for (const raw of m.drawings) {
    try {
      const d = normalizeSpec(raw as DrawingSpec, base, reg);
      if (ids.has(d.id)) d.id = newId();
      ids.add(d.id);
      out.push(d);
    } catch { /* skipped */ }
  }
  return out;
}

export function createDrawingTools(chart: ChartApi, series: AnySeries, options: DrawingToolsOptions = {}): DrawingToolsController {
  const defList: readonly ToolDefinition[] = options.tools && options.tools.length ? options.tools : BASIC_TOOLS;
  const defs = registry(defList);
  const keys = keysFor(defList);
  const base: DrawingStyle = { color: undefined, width: 2, dash: 'solid', ...(options.defaultStyle ?? {}) };
  let list: Drawing[] = [];
  let tool: ToolId | null = null;
  let selectedId: string | null = null;
  let hoveredId: string | null = null;
  let magnet = options.magnet !== false;
  let keep = options.keepDrawing === true;
  let hidden = false;
  let colors: Readonly<ThemeColors> | null = null;
  let past: string[] = [];
  let future: string[] = [];
  let lastCross: MouseEventParams | null = null;
  let destroyed = false;
  let cursor: string | null = null;
  /** Persistence is off when the saved data could not be read (it is left as it is, never overwritten). */
  let persistBlocked = false;
  const listeners = new Map<DrawingEvent, Set<(x: never) => void>>();
  /** Each drawing's pane, by the series that was first in it (pane indexes shift when a pane above is removed). */
  const anchors = new Map<string, AnySeries>();
  const prims = new Map<AnySeries, { prim: ChartPrimitive; host: PrimitiveHost | null }>();

  // Creation and drag state.
  let creating: { tool: ToolId; pane: number; pts: Anchor[]; placed: number; down: Pt; moved: boolean; free: boolean } | null = null;
  let drag: { id: string; part: number; pane: number; start: { logical: number; price: number }; orig: Anchor[]; down: Pt; moved: boolean; before: string } | null = null;
  /** The drawing painted on the overlay instead of the main layer while it moves. */
  let liveId: string | null = null;
  let layoutKey = '';

  const ts = chart.timeScale();
  const def = (id: ToolId): ToolDefinition | undefined => defs.get(id);
  const emit = (ev: Exclude<DrawingEvent, 'error'>, d: Drawing | null): void => { for (const h of listeners.get(ev) ?? []) (h as (d: Drawing | null) => void)(d ? copy(d) : null); };
  const emitError = (e: Error): void => { for (const h of listeners.get('error') ?? []) { try { (h as (e: Error) => void)(e); } catch { /* the host's handler */ } } };
  const snapshot = (): string => JSON.stringify(list);
  const repaint = (): void => { for (const p of prims.values()) p.host?.requestUpdate(); };
  const repaintOverlay = (): void => { for (const p of prims.values()) { const h = p.host; if (h) (h.requestOverlay ?? h.requestUpdate)(); } };
  const setCursor = (c: string | null): void => { cursor = c; chart.setCursor(c); };

  function persist(): void {
    const p = options.persist;
    if (!p || persistBlocked) return;
    try {
      const json = drawingsToJSON(list);
      if (json.length > LIMITS.jsonChars) throw new RangeError(`the drawings need ${json.length} characters, over the limit of ${LIMITS.jsonChars}`);
      (p.storage ?? globalThis.localStorage)?.setItem(p.key, json);
    } catch (e) {
      emitError(new Error(`Chartist Lite: drawings could not be saved under "${p.key}": ${(e as Error)?.message ?? String(e)}`));
    }
  }

  function commit(before: string): void {
    past.push(before);
    if (past.length > 100) past.shift();
    future = [];
    persist();
    ui?.sync();
  }

  // ── panes and coordinates ──

  function seriesPane(): number { return paneOf(series); }
  function paneOf(s: AnySeries): number { try { return s.paneIndex(); } catch { return -1; } }

  function paneSeries(pane: number): AnySeries | null {
    if (pane === seriesPane()) return series;
    const panes = chart.panes();
    return panes[pane]?.getSeries()[0] ?? null;
  }

  function anchorOf(d: Drawing): AnySeries | null {
    let s = anchors.get(d.id) ?? null;
    if (!s) { s = paneSeries(d.pane); if (s) anchors.set(d.id, s); }
    return s;
  }

  let paneSig = '';
  /** Pane indexes follow each drawing's series (a pane above removed, a series moved); primitives follow too. */
  function syncPanes(force = false): void {
    let sig = String(chart.panes().length);
    for (const s of new Set(anchors.values())) sig += `,${paneOf(s)}`;
    if (!force && sig === paneSig) return;
    paneSig = sig;
    for (const d of list) {
      const s = anchorOf(d);
      const p = s ? paneOf(s) : -1;
      if (p >= 0) d.pane = p;
    }
    ensurePrims();
  }

  function ensurePrims(): void {
    const want = new Set<AnySeries>([series]);
    for (const d of list) { const s = anchorOf(d); if (s && paneOf(s) >= 0) want.add(s); }
    for (const [s, p] of prims) if (!want.has(s)) { try { s.detachPrimitive(p.prim); } catch { /* gone */ } prims.delete(s); }
    for (const s of want) {
      if (prims.has(s)) continue;
      const entry: { prim: ChartPrimitive; host: PrimitiveHost | null } = { prim: null as unknown as ChartPrimitive, host: null };
      entry.prim = makePrimitive(s, entry);
      prims.set(s, entry);
      try { s.attachPrimitive(entry.prim); } catch { prims.delete(s); }
    }
  }

  /** Drawings painted by the primitive on `s` (alive: their series is on a pane). */
  const drawnBy = (s: AnySeries, d: Drawing): boolean => anchors.get(d.id) === s;
  /** The drawing's series is still on a pane (a drawing whose pane went is kept, not shown, until undo brings it back). */
  const alive = (d: Drawing): boolean => { const s = anchors.get(d.id); return !!s && paneOf(s) >= 0; };

  // Read access to the series' bars, for tools that use them (rebuilt when the rows change).
  let barCache: { rows: readonly unknown[]; vol: readonly unknown[] | null; access: BarAccess } | null = null;
  let barVersion = 0;
  function bars(): BarAccess | null {
    let rows: readonly Record<string, unknown>[];
    try { rows = series.data() as unknown as readonly Record<string, unknown>[]; } catch { return null; }
    const volRows = options.volumeSeries ? (() => { try { return options.volumeSeries.data() as unknown as readonly Record<string, unknown>[]; } catch { return null; } })() : null;
    if (barCache && barCache.rows === rows && barCache.vol === volRows) return barCache.access;
    const n = rows.length;
    const times = new Float64Array(n);
    for (let i = 0; i < n; i++) times[i] = timeToSeconds(rows[i].time as Time);
    let volByTime: Map<number, number> | null = null;
    if (volRows) { volByTime = new Map(); for (const r of volRows) { const v = r.value; if (typeof v === 'number') volByTime.set(timeToSeconds(r.time as Time), v); } }
    const num = (v: unknown): number => (typeof v === 'number' ? v : Number.NaN);
    const access: BarAccess = {
      count: n, times, version: ++barVersion,
      row(i): BarRow {
        const r = rows[i];
        const v = typeof r.value === 'number' ? r.value : Number.NaN;
        const close = typeof r.close === 'number' ? r.close : v;
        const vol = typeof r.volume === 'number' ? r.volume : volByTime ? volByTime.get(times[i]) ?? null : null;
        return { time: times[i], open: Number.isFinite(num(r.open)) ? num(r.open) : close, high: Number.isFinite(num(r.high)) ? num(r.high) : close, low: Number.isFinite(num(r.low)) ? num(r.low) : close, close, volume: vol };
      },
      indexAtOrAfter(t) { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (times[m] < t) lo = m + 1; else hi = m; } return lo; },
    };
    barCache = { rows, vol: volRows, access };
    return access;
  }

  /** The view of a draw scope (chart coordinates). */
  function scopeView(scope: PrimitiveDrawScope, usesBars: boolean): View {
    return {
      rect: scope.pane,
      x: l => scope.logicalToX(l),
      y: p => scope.priceToY(p) ?? Number.NaN,
      logical: t => ts.timeToLogical(t) ?? Number.NaN,
      get bars() { return usesBars ? bars() : null; },
      measure: (t, w) => scope.measureText(t, w),
      fontSize: scope.fontSize,
    };
  }

  function chartFont(): { size: number; family: string } {
    try { const o = chart.options(); return { size: Math.max(12, o.fontSize ?? 12), family: o.fontFamily }; } catch { return { size: 12, family: 'sans-serif' }; }
  }

  /** The view in pane-relative API coordinates (as pointer events are). */
  let measureCtx: CanvasRenderingContext2D | null | undefined;
  function apiView(pane: number): View {
    const s = paneSeries(pane);
    const f = chartFont();
    return {
      rect: paneRect(pane),
      x: l => ts.logicalToCoordinate(l) ?? Number.NaN,
      y: p => s?.priceToCoordinate(p) ?? Number.NaN,
      logical: t => ts.timeToLogical(t) ?? Number.NaN,
      get bars() { return bars(); },
      measure(t, w = 500) {
        try {
          if (measureCtx === undefined) measureCtx = chart.element().ownerDocument.createElement('canvas').getContext('2d');
          if (measureCtx) { measureCtx.font = `${w} ${f.size}px ${f.family}`; return measureCtx.measureText(t).width; }
        } catch { measureCtx = null; }
        return t.length * f.size * 0.6;
      },
      fontSize: f.size,
    };
  }

  /** Anchors projected in the chart coordinates of a draw scope. */
  function projScope(d: Drawing, scope: PrimitiveDrawScope): Proj[] {
    return d.points.map(p => {
      const l = ts.timeToLogical(p.time) ?? Number.NaN;
      const y = scope.priceToY(p.price);
      return { x: scope.logicalToX(l), y: y ?? Number.NaN, l };
    });
  }

  // Projections in API coordinates are cached per points array (replaced on every edit) and view (scales, data).
  const projCache = new WeakMap<Anchor[], { key: string; pts: Proj[] }>();
  function viewKey(pane: number): string {
    const s = paneSeries(pane);
    let n = 0;
    try { n = series.data().length; } catch { n = 0; }
    return `${ts.logicalToCoordinate(0)}|${ts.logicalToCoordinate(1)}|${ts.width()}|${s?.priceToCoordinate(1)}|${s?.priceToCoordinate(1000)}|${n}|${pane}`;
  }
  function projApi(d: Drawing, key = viewKey(d.pane)): Proj[] {
    const hit = projCache.get(d.points);
    if (hit && hit.key === key) return hit.pts;
    const s = paneSeries(d.pane);
    const pts = d.points.map(p => {
      const l = ts.timeToLogical(p.time) ?? Number.NaN;
      return { x: ts.logicalToCoordinate(l) ?? Number.NaN, y: s?.priceToCoordinate(p.price) ?? Number.NaN, l };
    });
    projCache.set(d.points, { key, pts });
    return pts;
  }

  function paneRect(pane: number): Rect {
    return { x: 0, y: 0, width: ts.width(), height: chart.panes()[pane]?.getHeight() ?? 0 };
  }

  function rowAt(s: AnySeries, logical: number): Record<string, unknown> | null {
    const t = ts.logicalToTime(Math.round(logical));
    if (t === null) return null;
    if (s === series) {
      const b = bars();
      if (!b) return null;
      const i = b.indexAtOrAfter(t);
      return i < b.count && b.times[i] === t ? (series.data()[i] as unknown as Record<string, unknown>) : null;
    }
    const rows = s.data() as readonly { time: Time }[];
    let lo = 0, hi = rows.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const tm = timeToSeconds(rows[mid].time);
      if (tm === t) return rows[mid] as unknown as Record<string, unknown>;
      if (tm < t) lo = mid + 1; else hi = mid - 1;
    }
    return null;
  }

  /** The anchor under a pointer: magnet to the bar's O/H/L/C (ctrl / cmd inverts), lifted on touch while placing. */
  function anchorAt(e: ChartPointerEvent, pane: number, lift: boolean): Anchor | null {
    const s = paneSeries(pane);
    if (!s) return null;
    const y = e.point.y - (lift && e.pointerType === 'touch' ? TOUCH_LIFT : 0);
    let logical = e.logical;
    let price = s.coordinateToPrice(y);
    if (price === null) return null;
    if (magnet !== (e.ctrlKey || e.metaKey)) {
      logical = Math.round(logical);
      price = nearestOhlc(rowAt(s, logical), price);
    }
    const time = ts.logicalToTime(logical);
    return time === null ? null : { time, price };
  }

  /** Shift: the new point on a horizontal, vertical or 45 degree line from the previous one. */
  function constrained(prev: Anchor, a: Anchor, pane: number): Anchor {
    const s = paneSeries(pane);
    const l0 = ts.timeToLogical(prev.time);
    const l1 = ts.timeToLogical(a.time);
    if (!s || l0 === null || l1 === null) return a;
    const p0 = { x: ts.logicalToCoordinate(l0) ?? 0, y: s.priceToCoordinate(prev.price) ?? 0 };
    const p1 = { x: ts.logicalToCoordinate(l1) ?? 0, y: s.priceToCoordinate(a.price) ?? 0 };
    const c = constrainAngle(p0, p1);
    const l = ts.coordinateToLogical(c.x);
    const price = s.coordinateToPrice(c.y);
    const time = l === null ? null : ts.logicalToTime(l);
    return time === null || price === null ? a : { time, price };
  }

  function hitTest(p: Pt, pane: number, tol: number): { d: Drawing; part: number } | null {
    if (hidden) return null;
    syncPanes();
    const view = apiView(pane);
    const key = viewKey(pane);
    const near: Rect = { x: p.x - tol, y: p.y - tol, width: 2 * tol, height: 2 * tol };
    // Topmost first: the last drawn is hit first.
    for (let i = list.length - 1; i >= 0; i--) {
      const d = list[i];
      const t = def(d.tool);
      if (d.pane !== pane || !t || !alive(d)) continue;
      const pts = projApi(d, key);
      const box = paintBox(t, pts);
      if (box && !overlaps(box, near)) continue;
      const part = hitWith(t, d, pts, p, tol, view);
      if (part >= 0) return { d, part: d.id === selectedId || part === BODY ? part : BODY };
    }
    return null;
  }

  // ── painting ──

  function makeRc(scope: PrimitiveDrawScope, usesBars: boolean): RenderCtx {
    const v = scopeView(scope, usesBars);
    return Object.assign(v, {
      ctx: scope.ctx, colors: scope.colors, ratio: scope.pixelRatio, fontFamily: scope.fontFamily,
      fmt: scope.formatPrice, text: scope.text,
    }) as RenderCtx;
  }

  function paint(scope: PrimitiveDrawScope, d: Drawing, extra = 0, labels = true): void {
    const t = def(d.tool);
    if (!t) return;
    const pts = projScope(d, scope);
    const box = paintBox(t, pts);
    if (box && !overlaps(box, scope.pane)) return; // off screen: nothing to paint
    const rc = makeRc(scope, !!t.usesBars);
    rc.ctx.save();
    rc.ctx.beginPath();
    t.render(rc, d, pts, extra);
    if (labels && t.labels) t.labels(rc, d, pts);
    rc.ctx.restore();
  }

  function makePrimitive(s: AnySeries, entry: { host: PrimitiveHost | null }): ChartPrimitive {
    return {
      zOrder: 'normal',
      attached(h) { entry.host = h; },
      detached() {
        entry.host = null;
        // The chart was removed (every primitive is detached and the root leaves the page): tidy up our listeners.
        queueMicrotask(() => {
          if (destroyed) return;
          let gone = false;
          try { const root = chart.element(); gone = !root.isConnected && root.parentNode === null; } catch { gone = true; }
          if (gone) ctl.destroy(); else { syncPanes(true); repaint(); }
        });
      },
      draw(scope) {
        syncPanes();
        const changed = colors !== scope.colors && JSON.stringify(colors) !== JSON.stringify(scope.colors);
        colors = scope.colors;
        // The toolbar follows the pane's size and place (a resize, a pane separator drag, a left axis appearing).
        const r = scope.pane;
        const key = `${r.x},${r.y},${r.width},${r.height}`;
        if (s === series && seriesPane() === 0 && key !== layoutKey) { layoutKey = key; ui?.sync(); } else if (changed) ui?.sync();
        if (hidden) return;
        for (const d of list) if (d.id !== liveId && drawnBy(s, d)) paint(scope, d);
      },
      drawOverlay(scope) {
        if (hidden) return;
        const ctx = scope.ctx;
        const pane = paneOf(s);
        const live = liveId ? list.find(d => d.id === liveId) : null;
        if (live && drawnBy(s, live)) paint(scope, live);
        if (creating && creating.pane === pane && paneSeries(pane) === s) {
          const t = def(creating.tool);
          const pts = creating.free ? creating.pts : creating.pts.slice(0, creating.placed + 1);
          const done = t?.complete && pts.length >= (t.minPoints ?? (t.points || 2)) ? t.complete(pts) : pts;
          const preview: Drawing = { id: '', tool: creating.tool, points: done, style: { ...base, ...(t?.style ?? {}) }, pane };
          if (t?.readOptions) preview.options = t.readOptions(t.defaults);
          paint(scope, preview);
        }
        const hov = hoveredId && hoveredId !== selectedId ? list.find(d => d.id === hoveredId) : null;
        if (hov && drawnBy(s, hov)) {
          ctx.save();
          ctx.globalAlpha = 0.25;
          paint(scope, hov, 3, false);
          ctx.restore();
        }
        const sel = selectedId ? list.find(d => d.id === selectedId) : null;
        const st = sel ? def(sel.tool) : undefined;
        if (sel && st && drawnBy(s, sel)) {
          const color = colorOf(sel, scope.colors);
          for (const h of handlePoints(st, sel, projScope(sel, scope), scopeView(scope, !!st.usesBars))) {
            if (!Number.isFinite(h.x) || !Number.isFinite(h.y)) continue;
            ctx.beginPath();
            ctx.arc(h.x, h.y, 5, 0, Math.PI * 2);
            ctx.fillStyle = scope.colors.background;
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = color;
            ctx.stroke();
          }
        }
      },
      priceAxisLabels(c) {
        if (hidden) return [];
        const out = [];
        for (const d of list) {
          if (!drawnBy(s, d)) continue;
          const t = def(d.tool);
          if (t?.axisTags) out.push(...t.axisTags(d, c));
        }
        return out;
      },
    };
  }

  // ── mutations ──

  function finishCreate(): void {
    if (!creating) return;
    const c = creating;
    creating = null;
    const t = def(c.tool) as ToolDefinition;
    let pts = c.pts.slice(0, c.free ? c.pts.length : c.placed);
    if (c.free) {
      const s = paneSeries(c.pane);
      if (pts.length < 2 || !s) { repaintOverlay(); return; }
      // Simplify in pixel space, keep the anchors of the points that stay.
      const px = pts.map((p, i) => ({ x: ts.logicalToCoordinate(ts.timeToLogical(p.time) ?? 0) ?? 0, y: s.priceToCoordinate(p.price) ?? 0, i }));
      pts = simplifyPath(px, 1.5).map(p => pts[p.i]);
    }
    if (pts.length < (t.minPoints ?? (t.points || 2))) { repaintOverlay(); return; }
    let d: Drawing;
    try { d = ctl.add({ tool: c.tool, points: pts, pane: c.pane }); } catch { repaintOverlay(); return; }
    ctl.select(d.id);
    if (t.text !== undefined && ui) {
      const s = paneSeries(d.pane);
      const l = ts.timeToLogical(d.points[0].time);
      const at = { x: (l === null ? 0 : ts.logicalToCoordinate(l) ?? 0), y: s?.priceToCoordinate(d.points[0].price) ?? 0 };
      const id = d.id;
      ui.editText(d, at, text => finishText(id, text));
    }
    if (!keep) ctl.setTool(null);
  }

  /**
   * The text of a note just placed: kept as part of the one undo step that created it; a cancelled or empty note is
   * removed as if it had never been placed.
   */
  function finishText(id: string, text: string | null): void {
    const d = list.find(x => x.id === id);
    if (!d) return;
    if (!text) {
      list = list.filter(x => x !== d);
      anchors.delete(id);
      past.pop();
      if (selectedId === id) { selectedId = null; emit('selected', null); }
      if (hoveredId === id) hoveredId = null;
      persist();
      emit('removed', d);
    } else {
      d.text = text.slice(0, 200);
      persist();
      emit('changed', d);
    }
    repaint();
    ui?.sync();
  }

  function movePoints(d: Drawing, e: ChartPointerEvent): void {
    if (!drag) return;
    const s = paneSeries(drag.pane);
    if (!s) return;
    if (drag.part === BODY) {
      const price = s.coordinateToPrice(e.point.y);
      if (price === null) return;
      const dl = Math.round(e.logical - drag.start.logical);
      const dp = price - drag.start.price;
      d.points = drag.orig.map(p => {
        const l = ts.timeToLogical(p.time);
        const t = l === null ? p.time : ts.logicalToTime(l + dl) ?? p.time;
        return { time: t, price: p.price + dp };
      });
    } else {
      let a = anchorAt(e, drag.pane, true);
      if (!a) return;
      const i = drag.part;
      if (e.shiftKey && i > 0) a = constrained(d.points[i - 1], a, drag.pane);
      const t = def(d.tool);
      if (t?.moveHandle) d.points = t.moveHandle(d.points, i, a);
      else { const pts = d.points.map(p => ({ ...p })); pts[i] = a; d.points = pts; }
    }
  }

  function startCreate(t: ToolDefinition, pane: number, a: Anchor, e: ChartPointerEvent): void {
    if (t.points === 1) {
      creating = { tool: t.id, pane, pts: [a], placed: 1, down: e.point, moved: false, free: false };
      finishCreate();
      return;
    }
    creating = { tool: t.id, pane, pts: [a, { ...a }], placed: 1, down: e.point, moved: false, free: t.points === 0 };
    repaintOverlay();
  }

  // ── input ──

  const handler = {
    pointerDown(e: ChartPointerEvent): boolean {
      if (destroyed || e.area !== 'pane' || e.paneIndex < 0) return false;
      syncPanes();
      const tol = e.pointerType === 'touch' ? 14 : 6;
      if (tool || creating) {
        const t = def(creating ? creating.tool : tool as ToolId) as ToolDefinition;
        const pane = creating ? creating.pane : e.paneIndex;
        const a = anchorAt(e, pane, true);
        if (!a) return true;
        if (creating) {
          const prev = creating.pts[creating.placed - 1];
          // An open tool (a path) ends with a second click on the last point (a double click).
          if (t.open && Math.hypot(e.point.x - creating.down.x, e.point.y - creating.down.y) <= tol && creating.placed >= (t.minPoints ?? 2)) {
            finishCreate();
            return true;
          }
          creating.pts[creating.placed] = e.shiftKey && prev ? constrained(prev, a, pane) : a;
          creating.placed++;
          creating.down = e.point;
          creating.moved = false;
          if (creating.placed >= t.points) finishCreate();
          else creating.pts[creating.placed] = { ...creating.pts[creating.placed - 1] };
          repaintOverlay();
          return true;
        }
        startCreate(t, pane, a, e);
        return true;
      }
      const hit = hitTest(e.point, e.paneIndex, tol);
      if (!hit) { if (selectedId) ctl.select(null); return false; }
      ctl.select(hit.d.id);
      if (!hit.d.locked) {
        const s = paneSeries(hit.d.pane);
        drag = {
          id: hit.d.id, part: hit.part, pane: hit.d.pane, start: { logical: e.logical, price: s?.coordinateToPrice(e.point.y) ?? 0 },
          orig: hit.d.points.map(p => ({ ...p })), down: e.point, moved: false, before: snapshot(),
        };
      }
      return true;
    },
    pointerMove(e: ChartPointerEvent): void {
      if (creating) {
        const a = anchorAt(e, creating.pane, true);
        if (!a) return;
        if (Math.hypot(e.point.x - creating.down.x, e.point.y - creating.down.y) > DRAG_START) creating.moved = true;
        if (creating.free) {
          const last = creating.pts[creating.pts.length - 1];
          // Raw points are bounded; the stroke is simplified and thinned when it ends.
          if ((last.time !== a.time || last.price !== a.price) && creating.pts.length < 20 * LIMITS.freehandPoints) creating.pts.push(a);
        } else {
          const prev = creating.pts[creating.placed - 1];
          creating.pts[creating.placed] = e.shiftKey && prev ? constrained(prev, a, creating.pane) : a;
        }
        repaintOverlay();
        return;
      }
      if (!drag) return;
      const d = list.find(x => x.id === drag?.id);
      if (!d) return;
      if (!drag.moved && Math.hypot(e.point.x - drag.down.x, e.point.y - drag.down.y) < 2) return;
      movePoints(d, e);
      if (!drag.moved) {
        drag.moved = true;
        liveId = d.id;
        repaint(); // once: the drawing leaves the main layer for the overlay while it moves
      } else repaintOverlay();
    },
    pointerUp(_e: ChartPointerEvent, cancelled: boolean): void {
      if (creating) {
        if (cancelled) { creating = null; repaintOverlay(); return; }
        if (creating.free) { finishCreate(); return; }
        if (creating.moved && creating.placed === 1) {
          const t = def(creating.tool) as ToolDefinition;
          creating.placed = 2;
          if (creating.placed >= t.points) finishCreate();
          else { creating.pts.push({ ...creating.pts[1] }); creating.moved = false; creating.down = _e.point; }
        }
        repaintOverlay();
        return;
      }
      if (!drag) return;
      const g = drag;
      drag = null;
      liveId = null;
      if (g.moved) {
        const d = list.find(x => x.id === g.id);
        if (cancelled && d) d.points = g.orig;
        else if (d) { commit(g.before); emit('changed', d); }
      }
      repaint();
    },
    hover(e: ChartPointerEvent): void {
      if (creating && !creating.free) {
        const a = anchorAt(e, creating.pane, false);
        if (a) {
          const prev = creating.pts[creating.placed - 1];
          creating.pts[creating.placed] = e.shiftKey && prev ? constrained(prev, a, creating.pane) : a;
          repaintOverlay();
        }
        return;
      }
      if (tool) return;
      const hit = e.area === 'pane' && e.paneIndex >= 0 ? hitTest(e.point, e.paneIndex, 6) : null;
      const id = hit ? hit.d.id : null;
      setCursor(hit ? (hit.d.locked ? 'pointer' : hit.part === BODY ? 'move' : 'grab') : null);
      if (id !== hoveredId) { hoveredId = id; repaintOverlay(); }
    },
    keyDown(e: KeyboardEvent): boolean {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key;
      if (mod && (k === 'z' || k === 'Z')) return e.shiftKey ? ctl.redo() || true : ctl.undo() || true;
      if (mod && (k === 'y' || k === 'Y')) return ctl.redo() || true;
      if (mod) return false;
      if (creating && (k === 'Enter' || k === 'Escape')) {
        const t = def(creating.tool);
        // A path ends with Enter (or Escape once it has two points); anything else is cancelled by Escape.
        if (t?.open && creating.placed >= (t.minPoints ?? 2)) { finishCreate(); return true; }
        if (k === 'Escape') { creating = null; repaintOverlay(); return true; }
      }
      // Single-key tool shortcuts, only without modifiers.
      if (!e.shiftKey && !e.altKey && k.length === 1) {
        const id = (Object.keys(keys) as ToolId[]).find(t => keys[t] === k.toUpperCase());
        if (id) { ctl.setTool(tool === id ? null : id); return true; }
      }
      if (k === 'Escape') {
        if (tool) { ctl.setTool(null); return true; }
        if (selectedId) { ctl.select(null); return true; }
        return false;
      }
      // Shift + H: a horizontal line at the crosshair's bar close (inspect mode or hover), else the last close.
      if (e.shiftKey && (k === 'H' || k === 'h') && defs.has('horizontal')) {
        const row = lastCross?.seriesData.get(series) as Record<string, unknown> | undefined;
        const all = series.data() as readonly Record<string, unknown>[];
        const last = all[all.length - 1];
        const src = row ?? last;
        const price = src ? (typeof src.close === 'number' ? src.close : src.value) as number : Number.NaN;
        const time = src ? timeToSeconds(src.time as Time) : Number.NaN;
        if (!Number.isFinite(price) || !Number.isFinite(time)) return true;
        try { const d = ctl.add({ tool: 'horizontal', points: [{ time, price }], pane: seriesPane() }); ctl.select(d.id); } catch { /* at the limit */ }
        return true;
      }
      const sel = selectedId ? list.find(d => d.id === selectedId) : null;
      if (!sel) return false;
      if (k === 'Delete' || k === 'Backspace') { ctl.remove(sel.id); return true; }
      if (sel.locked) return false;
      const step = e.shiftKey ? 10 : 1;
      if (k === 'ArrowLeft' || k === 'ArrowRight') {
        const before = snapshot();
        const dl = (k === 'ArrowLeft' ? -1 : 1) * step;
        sel.points = sel.points.map(p => { const l = ts.timeToLogical(p.time); return { time: l === null ? p.time : ts.logicalToTime(l + dl) ?? p.time, price: p.price }; });
        commit(before); emit('changed', sel); repaint();
        return true;
      }
      if (k === 'ArrowUp' || k === 'ArrowDown') {
        const before = snapshot();
        const pf = (paneSeries(sel.pane)?.options() as { priceFormat?: { minMove?: number } } | undefined)?.priceFormat;
        const move = (pf?.minMove ?? 0.01) * step * (k === 'ArrowUp' ? 1 : -1);
        sel.points = sel.points.map(p => ({ time: p.time, price: p.price + move }));
        commit(before); emit('changed', sel); repaint();
        return true;
      }
      return false;
    },
    // Native touch gestures are off while a tool is armed, a drawing is being made, or one is selected (so a selected
    // drawing can be dragged in any direction with a finger); a tap on empty space deselects and gives them back.
    blocksTouch(): boolean { return tool !== null || creating !== null || selectedId !== null; },
  };

  // ── public controller ──

  function room(): number { return LIMITS.drawings - list.length; }

  const ctl: DrawingToolsController = {
    setTool(id) {
      if (id !== null && !defs.has(id)) throw new TypeError(`Chartist Lite: unknown drawing tool "${String(id)}"`);
      tool = id;
      creating = null;
      if (id) { hoveredId = null; if (selectedId) { selectedId = null; emit('selected', null); } }
      setCursor(id ? 'crosshair' : null);
      repaintOverlay();
      ui?.sync();
    },
    tool: () => tool,
    tools: () => defList,
    drawings: () => list.map(copy),
    add(spec) {
      const d = normalizeSpec(spec, base, defs);
      if (room() <= 0) {
        const err = new RangeError(`Chartist Lite: a chart holds at most ${LIMITS.drawings} drawings; remove some first`);
        emitError(err);
        throw err;
      }
      if (list.some(x => x.id === d.id)) d.id = newId();
      const before = snapshot();
      list.push(d);
      anchorOf(d);
      ensurePrims();
      commit(before);
      emit('created', d);
      repaint();
      return copy(d);
    },
    update(id, patch) {
      const d = list.find(x => x.id === id);
      if (!d) return null;
      const next = normalizeSpec({
        tool: d.tool, id: d.id, points: patch.points ?? d.points, style: { ...d.style, ...(patch.style ?? {}) },
        text: patch.text ?? d.text, pane: patch.pane ?? d.pane, locked: patch.locked ?? d.locked, options: patch.options ?? d.options,
      }, base, defs);
      const before = snapshot();
      if (next.pane !== d.pane) anchors.delete(d.id);
      Object.assign(d, next);
      anchorOf(d);
      ensurePrims();
      commit(before);
      emit('changed', d);
      repaint();
      return copy(d);
    },
    remove(id) {
      const i = list.findIndex(x => x.id === id);
      if (i < 0) return false;
      const before = snapshot();
      const [d] = list.splice(i, 1);
      anchors.delete(id);
      if (selectedId === id) { selectedId = null; emit('selected', null); syncTouch(); }
      if (hoveredId === id) hoveredId = null;
      commit(before);
      emit('removed', d);
      repaint();
      return true;
    },
    clear() {
      if (!list.length) return;
      const before = snapshot();
      const gone = list;
      list = [];
      anchors.clear();
      selectedId = null;
      hoveredId = null;
      commit(before);
      for (const d of gone) emit('removed', d);
      emit('selected', null);
      syncTouch();
      repaint();
    },
    select(id) {
      const next = id && list.some(d => d.id === id) ? id : null;
      if (next === selectedId) return;
      selectedId = next;
      emit('selected', next ? list.find(d => d.id === next) ?? null : null);
      syncTouch();
      repaintOverlay();
      ui?.sync();
    },
    selected: () => { const d = list.find(x => x.id === selectedId); return d ? copy(d) : null; },
    exportJSON: () => drawingsToJSON(list),
    importJSON(json, mode = 'replace') {
      let incoming: Drawing[];
      try { incoming = drawingsFromJSON(json, base, defs); } catch (e) {
        if (e instanceof RangeError) { emitError(e); return 0; }
        throw e;
      }
      const keepList = mode === 'replace' ? [] : list;
      const free = LIMITS.drawings - keepList.length;
      if (incoming.length > free) {
        emitError(new RangeError(`Chartist Lite: a chart holds at most ${LIMITS.drawings} drawings; ${incoming.length - Math.max(0, free)} of the imported ones were left out`));
        incoming = incoming.slice(0, Math.max(0, free));
      }
      // Ids already in use get new ones (an append of the same export twice adds a copy, it does not vanish).
      const used = new Set(keepList.map(d => d.id));
      for (const d of incoming) { if (used.has(d.id)) d.id = newId(); used.add(d.id); }
      const before = snapshot();
      const gone = mode === 'replace' ? list : [];
      list = [...keepList, ...incoming];
      if (mode === 'replace') anchors.clear();
      for (const d of incoming) anchorOf(d);
      if (selectedId && !list.some(d => d.id === selectedId)) selectedId = null;
      if (mode === 'replace') selectedId = null;
      syncPanes(true);
      commit(before);
      for (const d of gone) emit('removed', d);
      for (const d of incoming) emit('created', d);
      syncTouch();
      repaint();
      return incoming.length;
    },
    on(event: DrawingEvent, h: (x: never) => void) {
      let set = listeners.get(event);
      if (!set) { set = new Set(); listeners.set(event, set); }
      set.add(h);
      return () => { set?.delete(h); };
    },
    undo() { return restore(past, future); },
    redo() { return restore(future, past); },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    setMagnet(on) { magnet = on; ui?.sync(); },
    magnet: () => magnet,
    setKeepDrawing(on) { keep = on; ui?.sync(); },
    keepDrawing: () => keep,
    setHidden(on) { hidden = on; if (on) { selectedId = null; hoveredId = null; syncTouch(); } repaint(); ui?.sync(); },
    hidden: () => hidden,
    colors: () => colors,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      removeHandler();
      try { chart.unsubscribeCrosshairMove(onCross); } catch { /* removed chart */ }
      for (const [s, p] of prims) { try { s.detachPrimitive(p.prim); } catch { /* gone */ } }
      prims.clear();
      try { if (cursor !== null) chart.setCursor(null); } catch { /* removed chart */ }
      ui?.destroy();
      ui = null;
    },
  } as DrawingToolsController;

  /** The chart reads `blocksTouch()` when the cursor is set: re-set it so touch-action follows the selection. */
  function syncTouch(): void {
    if (destroyed) return;
    try { chart.setCursor(cursor); } catch { /* removed chart */ }
  }

  function restore(from: string[], to: string[]): boolean {
    const snap = from.pop();
    if (snap === undefined) return false;
    to.push(snapshot());
    const prev = new Map(list.map(d => [d.id, JSON.stringify(d)]));
    list = (JSON.parse(snap) as Drawing[]);
    const now = new Map(list.map(d => [d.id, JSON.stringify(d)]));
    if (selectedId && !now.has(selectedId)) { selectedId = null; syncTouch(); }
    for (const id of [...anchors.keys()]) if (!now.has(id)) anchors.delete(id);
    syncPanes(true);
    persist();
    for (const [id, j] of prev) if (!now.has(id)) emit('removed', JSON.parse(j) as Drawing);
    for (const d of list) {
      const was = prev.get(d.id);
      if (was === undefined) emit('created', d);
      else if (was !== now.get(d.id)) emit('changed', d);
    }
    repaint();
    ui?.sync();
    return true;
  }

  const onCross = (p: MouseEventParams): void => { lastCross = p.point || p.logical !== undefined ? p : null; };
  chart.subscribeCrosshairMove(onCross);
  const removeHandler = chart.addPointerHandler(handler);

  // Opt-in persistence: load what was saved under the key. Data that cannot be read is never overwritten.
  if (options.persist) {
    const key = options.persist.key;
    let raw: string | null = null;
    try { raw = (options.persist.storage ?? globalThis.localStorage)?.getItem(key) ?? null; } catch (e) {
      persistBlocked = true;
      queueMicrotask(() => emitError(new Error(`Chartist Lite: saved drawings under "${key}" could not be read (${(e as Error)?.message ?? e}); nothing will be saved`)));
    }
    if (raw) {
      try {
        list = drawingsFromJSON(raw, base, defs).slice(0, LIMITS.drawings);
      } catch (e) {
        persistBlocked = true;
        list = [];
        // Deferred, so a handler added right after createDrawingTools hears it.
        queueMicrotask(() => emitError(new Error(`Chartist Lite: the data saved under "${key}" is not a drawings export this library reads (${(e as Error)?.message ?? e}); it is left untouched and nothing will be saved under that key`)));
      }
    }
  }
  for (const d of list) anchorOf(d);
  syncPanes(true);
  let ui: DrawingToolsUi | null = null;
  const tb = options.toolbar;
  if (tb) ui = createToolbar(chart, ctl, typeof tb === 'object' && tb.position === 'top' ? 'top' : 'left');
  return ctl;
}
