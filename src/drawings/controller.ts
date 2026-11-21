// The drawing tools controller: state, creation and editing by pointer and keyboard, undo / redo, events, JSON, the
// optional localStorage adapter. Painting goes through one series primitive per pane (main layer for settled drawings,
// overlay for hover, selection, the drawing being created and the one being dragged), input through the chart's
// pointer handler hook. See ARCHITECTURE.md "Drawing tools".

import type { AnySeriesDefinition, ChartApi, ChartPointerEvent, MouseEventParams, SeriesApi } from '../api';
import type { ThemeColors } from '../core/theme';
import { timeToSeconds, type Time } from '../core/time';
import type { ChartPrimitive, PrimitiveDrawScope, PrimitiveHost } from '../plugins/primitive';
import { createToolbar } from './toolbar';
import { constrainAngle, nearestOhlc, simplifyPath, type Pt, type Rect } from './geometry';
import {
  BODY, colorOf, handlePoints, hitDrawing, overlaps, paintBox, renderDrawing, renderLabels, toolInfo, TOOL_KEYS, TOOLS,
  type Anchor, type Drawing, type DrawingStyle, type Proj, type RenderCtx, type ToolId, type ToolInfo,
} from './tools';

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
}

export interface DrawingToolsOptions {
  /** The built-in toolbar: `true` (left rail) or `{ position: 'left' | 'top' }`. Default false. */
  toolbar?: boolean | { position?: 'left' | 'top' };
  /** Snap points to the nearest open, high, low or close (ctrl / cmd held inverts it). Default true. */
  magnet?: boolean;
  /** Stay on the tool after a drawing is finished. Default false (back to the cursor). */
  keepDrawing?: boolean;
  /** Style of new drawings. */
  defaultStyle?: Partial<DrawingStyle>;
  /** Opt-in persistence: drawings are saved under `key` after every change and loaded at start. */
  persist?: { key: string; storage?: Pick<Storage, 'getItem' | 'setItem'> };
}

export type DrawingEvent = 'created' | 'changed' | 'removed' | 'selected';

export interface DrawingToolsController {
  setTool(id: ToolId | null): void;
  tool(): ToolId | null;
  tools(): readonly ToolInfo[];
  drawings(): Drawing[];
  add(spec: DrawingSpec): Drawing;
  update(id: string, patch: Partial<Omit<DrawingSpec, 'id'>>): Drawing | null;
  remove(id: string): boolean;
  clear(): void;
  select(id: string | null): void;
  selected(): Drawing | null;
  exportJSON(): string;
  /** Load drawings from `exportJSON` text ('replace' by default, or 'append'). Returns how many were loaded. */
  importJSON(json: string, mode?: 'replace' | 'append'): number;
  on(event: DrawingEvent, handler: (drawing: Drawing | null) => void): () => void;
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
export interface DrawingToolsUi { sync(): void; editText(d: Drawing, at: Pt): void; destroy(): void }

export const FORMAT = 'chartist-lite-drawings';
export const VERSION = 1;

const TOUCH_LIFT = 36;
const DRAG_START = 4;

let seq = 0;
const newId = (): string => `d${Date.now().toString(36)}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function copy(d: Drawing): Drawing {
  return { ...d, points: d.points.map(p => ({ time: p.time, price: p.price })), style: { ...d.style } };
}

/** Validate a spec into a drawing (throws a TypeError naming the problem). */
export function normalizeSpec(spec: DrawingSpec, base: DrawingStyle): Drawing {
  const info = spec && toolInfo(spec.tool);
  if (!info) throw new TypeError(`Chartist Lite: unknown drawing tool "${String(spec && spec.tool)}"`);
  if (!Array.isArray(spec.points) || spec.points.length === 0) throw new TypeError(`Chartist Lite: a ${info.label.toLowerCase()} needs points`);
  const points = spec.points.map((p, i) => {
    const time = typeof p.time === 'number' ? p.time : timeToSeconds(p.time);
    if (!Number.isFinite(time) || typeof p.price !== 'number' || !Number.isFinite(p.price)) throw new TypeError(`Chartist Lite: drawing point ${i} needs a time and a finite price`);
    return { time, price: p.price };
  });
  if (info.id === 'long' || info.id === 'short') {
    // Two points (entry, target) get a stop at half the distance on the other side: a 2.00 reward to risk.
    if (points.length === 2) points.push({ time: points[1].time, price: points[0].price - (points[1].price - points[0].price) / 2 });
    if (points.length >= 3) points[2].time = points[1].time;
  }
  // A channel may come with two points (no width yet); long and short keep three; brush keeps them all.
  const need = info.id === 'long' || info.id === 'short' ? 3 : info.id === 'channel' ? 2 : info.points;
  if (points.length < need) throw new TypeError(`Chartist Lite: a ${info.label.toLowerCase()} needs ${need} points`);
  const keepN = info.id === 'long' || info.id === 'short' || info.id === 'channel' ? 3 : info.points;
  const st = { ...base, ...(spec.style ?? {}) };
  const width = st.width === 1 || st.width === 2 || st.width === 3 ? st.width : base.width;
  return {
    id: typeof spec.id === 'string' && spec.id ? spec.id : newId(),
    tool: info.id,
    points: keepN > 0 ? points.slice(0, keepN) : points,
    style: { color: st.color, width, dash: st.dash === 'dashed' ? 'dashed' : 'solid' },
    text: typeof spec.text === 'string' ? spec.text.slice(0, 200) : undefined,
    pane: Number.isInteger(spec.pane) && (spec.pane as number) >= 0 ? (spec.pane as number) : 0,
    locked: spec.locked === true ? true : undefined,
  };
}

/** Drawings as versioned JSON (times in UNIX seconds, so they survive zoom, resize, time zone and data updates). */
export function drawingsToJSON(list: readonly Drawing[]): string {
  return JSON.stringify({ format: FORMAT, version: VERSION, drawings: list.map(copy) });
}

/** Parse `drawingsToJSON` text; unknown tools and bad entries are skipped. */
export function drawingsFromJSON(json: string, base: DrawingStyle): Drawing[] {
  const data = JSON.parse(json) as { format?: string; version?: number; drawings?: unknown };
  if (!data || data.format !== FORMAT || !Array.isArray(data.drawings)) throw new TypeError('Chartist Lite: not a drawings export');
  if (typeof data.version !== 'number' || data.version > VERSION) throw new TypeError(`Chartist Lite: drawings export version ${String(data.version)} is newer than this library reads`);
  const out: Drawing[] = [];
  for (const raw of data.drawings) {
    try { out.push(normalizeSpec(raw as DrawingSpec, base)); } catch { /* skipped */ }
  }
  return out;
}

export function createDrawingTools(chart: ChartApi, series: AnySeries, options: DrawingToolsOptions = {}): DrawingToolsController {
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
  const listeners = new Map<DrawingEvent, Set<(d: Drawing | null) => void>>();
  const hosts = new Map<number, PrimitiveHost>();
  const prims = new Map<number, { series: AnySeries; prim: ChartPrimitive }>();

  // Creation and drag state.
  let creating: { tool: ToolId; pane: number; pts: Anchor[]; placed: number; down: Pt; moved: boolean; free: boolean } | null = null;
  let drag: { id: string; part: number; pane: number; start: { logical: number; price: number }; orig: Anchor[]; down: Pt; moved: boolean; before: string } | null = null;
  /** The drawing painted on the overlay instead of the main layer while it moves. */
  let liveId: string | null = null;
  let layoutKey = '';

  const ts = chart.timeScale();
  const emit = (ev: DrawingEvent, d: Drawing | null): void => { for (const h of listeners.get(ev) ?? []) h(d ? copy(d) : null); };
  const snapshot = (): string => JSON.stringify(list);
  const repaint = (): void => { for (const h of hosts.values()) h.requestUpdate(); };
  const repaintOverlay = (): void => { for (const h of hosts.values()) (h.requestOverlay ?? h.requestUpdate)(); };

  function persist(): void {
    const p = options.persist;
    if (!p) return;
    try { (p.storage ?? globalThis.localStorage)?.setItem(p.key, drawingsToJSON(list)); } catch { /* storage full or blocked */ }
  }

  function commit(before: string): void {
    past.push(before);
    if (past.length > 100) past.shift();
    future = [];
    persist();
    ui?.sync();
  }

  // ── panes and coordinates ──

  function seriesPane(): number { return series.paneIndex(); }

  function paneSeries(pane: number): AnySeries | null {
    if (pane === seriesPane()) return series;
    const panes = chart.panes();
    return panes[pane]?.getSeries()[0] ?? null;
  }

  function ensurePrims(): void {
    const panes = new Set<number>([seriesPane(), ...list.map(d => d.pane)]);
    for (const pane of panes) {
      const s = paneSeries(pane);
      const have = prims.get(pane);
      if (have && have.series === s) continue;
      if (have) { have.series.detachPrimitive(have.prim); prims.delete(pane); hosts.delete(pane); }
      if (!s) continue;
      const prim = makePrimitive(pane);
      prims.set(pane, { series: s, prim });
      s.attachPrimitive(prim);
    }
  }

  /** Anchors projected in the chart coordinates of a draw scope. */
  function projScope(d: Drawing, scope: PrimitiveDrawScope): Proj[] {
    return d.points.map(p => {
      const l = ts.timeToLogical(p.time) ?? Number.NaN;
      const y = scope.priceToY(p.price);
      return { x: scope.logicalToX(l), y: y ?? Number.NaN, l };
    });
  }

  /** Anchors projected in pane-relative API coordinates (as pointer events are). */
  function projApi(d: Drawing): Proj[] {
    const s = paneSeries(d.pane);
    return d.points.map(p => {
      const l = ts.timeToLogical(p.time) ?? Number.NaN;
      return { x: ts.logicalToCoordinate(l) ?? Number.NaN, y: s?.priceToCoordinate(p.price) ?? Number.NaN, l };
    });
  }

  function paneRect(pane: number): Rect {
    return { x: 0, y: 0, width: ts.width(), height: chart.panes()[pane]?.getHeight() ?? 0 };
  }

  const secondsCache = new WeakMap<object, Float64Array>();
  function rowAt(s: AnySeries, logical: number): Record<string, unknown> | null {
    const t = ts.logicalToTime(Math.round(logical));
    if (t === null) return null;
    const rows = s.data() as readonly { time: Time }[];
    let secs = secondsCache.get(rows);
    if (!secs) { secs = Float64Array.from(rows, r => timeToSeconds(r.time)); secondsCache.set(rows, secs); }
    let lo = 0, hi = secs.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (secs[mid] === t) return rows[mid] as unknown as Record<string, unknown>;
      if (secs[mid] < t) lo = mid + 1; else hi = mid - 1;
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
    const rect = paneRect(pane);
    // Topmost first: the last drawn is hit first.
    for (let i = list.length - 1; i >= 0; i--) {
      const d = list[i];
      if (d.pane !== pane) continue;
      const pts = projApi(d);
      const box = paintBox(d, pts);
      if (box && !overlaps(box, { x: p.x - tol, y: p.y - tol, width: 2 * tol, height: 2 * tol })) continue;
      const part = hitDrawing(d, pts, p, tol, rect);
      if (part >= 0) return { d, part: d.id === selectedId || part === BODY ? part : BODY };
    }
    return null;
  }

  // ── painting ──

  function makeRc(scope: PrimitiveDrawScope): RenderCtx {
    return {
      ctx: scope.ctx, rect: scope.pane, colors: scope.colors, ratio: scope.pixelRatio, fontFamily: scope.fontFamily,
      fontSize: scope.fontSize, fmt: scope.formatPrice, text: scope.text, measure: scope.measureText,
    };
  }

  function paint(rc: RenderCtx, d: Drawing, scope: PrimitiveDrawScope, extra = 0): void {
    const pts = projScope(d, scope);
    const box = paintBox(d, pts);
    if (box && !overlaps(box, scope.pane)) return; // off screen: nothing to paint
    rc.ctx.save();
    renderDrawing(rc, d, pts, extra);
    renderLabels(rc, d, pts);
    rc.ctx.restore();
  }

  function makePrimitive(pane: number): ChartPrimitive {
    return {
      zOrder: 'normal',
      attached(h) { hosts.set(pane, h); },
      detached() { hosts.delete(pane); },
      draw(scope) {
        const changed = colors !== scope.colors && JSON.stringify(colors) !== JSON.stringify(scope.colors);
        colors = scope.colors;
        // The toolbar follows the pane's size and place (a resize, a pane separator drag, a left axis appearing).
        const r = scope.pane;
        const key = `${r.x},${r.y},${r.width},${r.height}`;
        if (pane === 0 && key !== layoutKey) { layoutKey = key; ui?.sync(); } else if (changed) ui?.sync();
        if (hidden) return;
        const rc = makeRc(scope);
        for (const d of list) if (d.pane === pane && d.id !== liveId) paint(rc, d, scope);
      },
      drawOverlay(scope) {
        if (hidden) return;
        const rc = makeRc(scope);
        const ctx = scope.ctx;
        const live = liveId ? list.find(d => d.id === liveId) : null;
        if (live && live.pane === pane) paint(rc, live, scope);
        if (creating && creating.pane === pane) {
          const pts = creating.free ? creating.pts : creating.pts.slice(0, creating.placed + 1);
          const preview: Drawing = { id: '', tool: creating.tool, points: completePoints(creating.tool, pts), style: { ...base }, pane };
          paint(rc, preview, scope);
        }
        const hov = hoveredId && hoveredId !== selectedId ? list.find(d => d.id === hoveredId) : null;
        if (hov && hov.pane === pane) {
          ctx.save();
          ctx.globalAlpha = 0.25;
          renderDrawing(rc, hov, projScope(hov, scope), 3);
          ctx.restore();
        }
        const sel = selectedId ? list.find(d => d.id === selectedId) : null;
        if (sel && sel.pane === pane) {
          const color = colorOf(sel, scope.colors);
          for (const h of handlePoints(sel, projScope(sel, scope), scope.pane)) {
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
          if (d.pane !== pane || (d.tool !== 'horizontal' && d.tool !== 'horizontalRay')) continue;
          out.push({ price: d.points[0].price, color: colorOf(d, c) });
        }
        return out;
      },
    };
  }

  /** Points of a drawing being created, completed the way a finished one would be (long / short get a stop). */
  function completePoints(t: ToolId, pts: Anchor[]): Anchor[] {
    if ((t === 'long' || t === 'short') && pts.length >= 2) {
      const [e, g] = pts;
      return [e, g, { time: g.time, price: e.price - (g.price - e.price) / 2 }];
    }
    return pts;
  }

  // ── mutations ──

  function finishCreate(): void {
    if (!creating) return;
    const c = creating;
    creating = null;
    let pts = completePoints(c.tool, c.pts.slice(0, c.free ? c.pts.length : c.placed));
    if (c.free) {
      const s = paneSeries(c.pane);
      if (pts.length < 2 || !s) { repaintOverlay(); return; }
      // Simplify in pixel space, keep the anchors of the points that stay.
      const px = pts.map((p, i) => ({ x: ts.logicalToCoordinate(ts.timeToLogical(p.time) ?? 0) ?? 0, y: s.priceToCoordinate(p.price) ?? 0, i }));
      pts = simplifyPath(px, 1.5).map(p => pts[p.i]);
    }
    const d = ctl.add({ tool: c.tool, points: pts, pane: c.pane });
    ctl.select(d.id);
    if (d.tool === 'text') {
      const s = paneSeries(d.pane);
      const l = ts.timeToLogical(d.points[0].time);
      ui?.editText(d, { x: (l === null ? 0 : ts.logicalToCoordinate(l) ?? 0), y: s?.priceToCoordinate(d.points[0].price) ?? 0 });
    }
    if (!keep) ctl.setTool(null);
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
      if (d.tool === 'horizontal' || d.tool === 'horizontalRay') a = d.tool === 'horizontal' ? { time: d.points[0].time, price: a.price } : a;
      if (d.tool === 'vertical') a = { time: a.time, price: d.points[0].price };
      const pts = d.points.map(p => ({ ...p }));
      pts[i] = a;
      if (d.tool === 'long' || d.tool === 'short') {
        if (i === 1) pts[2] = { time: a.time, price: pts[2].price };
        if (i === 2) pts[2] = { time: pts[1].time, price: a.price };
      }
      d.points = pts;
    }
  }

  // ── input ──

  const handler = {
    pointerDown(e: ChartPointerEvent): boolean {
      if (destroyed || e.area !== 'pane' || e.paneIndex < 0) return false;
      const tol = e.pointerType === 'touch' ? 14 : 6;
      if (tool || creating) {
        const t = creating ? creating.tool : (tool as ToolId);
        const pane = creating ? creating.pane : e.paneIndex;
        const a = anchorAt(e, pane, true);
        if (!a) return true;
        const info = toolInfo(t) as ToolInfo;
        if (creating) {
          const prev = creating.pts[creating.placed - 1];
          creating.pts[creating.placed] = e.shiftKey && prev ? constrained(prev, a, pane) : a;
          creating.placed++;
          creating.down = e.point;
          creating.moved = false;
          if (creating.placed >= info.points) finishCreate();
          else creating.pts.push({ ...creating.pts[creating.placed - 1] });
          repaintOverlay();
          return true;
        }
        if (info.points === 1) {
          creating = { tool: t, pane, pts: [a], placed: 1, down: e.point, moved: false, free: false };
          finishCreate();
          return true;
        }
        creating = { tool: t, pane, pts: [a, { ...a }], placed: 1, down: e.point, moved: false, free: info.points === 0 };
        repaintOverlay();
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
          if (last.time !== a.time || last.price !== a.price) creating.pts.push(a);
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
          creating.placed = 2;
          if (creating.placed >= (toolInfo(creating.tool) as ToolInfo).points) finishCreate();
          else { creating.pts.push({ ...creating.pts[1] }); creating.moved = false; }
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
      chart.setCursor(hit ? (hit.d.locked ? 'pointer' : hit.part === BODY ? 'move' : 'grab') : null);
      if (id !== hoveredId) { hoveredId = id; repaintOverlay(); }
    },
    keyDown(e: KeyboardEvent): boolean {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key;
      if (mod && (k === 'z' || k === 'Z')) return e.shiftKey ? ctl.redo() || true : ctl.undo() || true;
      if (mod && (k === 'y' || k === 'Y')) return ctl.redo() || true;
      if (mod) return false;
      // Single-key tool shortcuts (TOOL_KEYS), only without modifiers.
      if (!e.shiftKey && !e.altKey && k.length === 1) {
        const id = (Object.keys(TOOL_KEYS) as ToolId[]).find(t => TOOL_KEYS[t] === k.toUpperCase());
        if (id) { ctl.setTool(tool === id ? null : id); return true; }
      }
      if (k === 'Escape') {
        if (creating) { creating = null; repaintOverlay(); return true; }
        if (tool) { ctl.setTool(null); return true; }
        if (selectedId) { ctl.select(null); return true; }
        return false;
      }
      // Shift + H: a horizontal line at the crosshair's bar close (inspect mode or hover), else the last close.
      if (e.shiftKey && (k === 'H' || k === 'h')) {
        const row = lastCross?.seriesData.get(series) as Record<string, unknown> | undefined;
        const all = series.data() as readonly Record<string, unknown>[];
        const last = all[all.length - 1];
        const src = row ?? last;
        const price = src ? (typeof src.close === 'number' ? src.close : src.value) as number : Number.NaN;
        const time = src ? timeToSeconds(src.time as Time) : Number.NaN;
        if (!Number.isFinite(price) || !Number.isFinite(time)) return true;
        const d = ctl.add({ tool: 'horizontal', points: [{ time, price }], pane: seriesPane() });
        ctl.select(d.id);
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
    blocksTouch(): boolean { return tool !== null || creating !== null; },
  };

  // ── public controller ──

  const ctl: DrawingToolsController = {
    setTool(id) {
      if (id !== null && !toolInfo(id)) throw new TypeError(`Chartist Lite: unknown drawing tool "${String(id)}"`);
      tool = id;
      creating = null;
      if (id) { hoveredId = null; selectedId = null; }
      chart.setCursor(id ? 'crosshair' : null);
      repaintOverlay();
      ui?.sync();
    },
    tool: () => tool,
    tools: () => TOOLS,
    drawings: () => list.map(copy),
    add(spec) {
      const d = normalizeSpec(spec, base);
      if (list.some(x => x.id === d.id)) d.id = newId();
      const before = snapshot();
      list.push(d);
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
        text: patch.text ?? d.text, pane: patch.pane ?? d.pane, locked: patch.locked ?? d.locked,
      }, base);
      const before = snapshot();
      Object.assign(d, next);
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
      if (selectedId === id) { selectedId = null; emit('selected', null); }
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
      selectedId = null;
      hoveredId = null;
      commit(before);
      for (const d of gone) emit('removed', d);
      emit('selected', null);
      repaint();
    },
    select(id) {
      const next = id && list.some(d => d.id === id) ? id : null;
      if (next === selectedId) return;
      selectedId = next;
      emit('selected', next ? list.find(d => d.id === next) ?? null : null);
      repaintOverlay();
      ui?.sync();
    },
    selected: () => { const d = list.find(x => x.id === selectedId); return d ? copy(d) : null; },
    exportJSON: () => drawingsToJSON(list),
    importJSON(json, mode = 'replace') {
      const incoming = drawingsFromJSON(json, base);
      const before = snapshot();
      const gone = mode === 'replace' ? list : [];
      list = mode === 'replace' ? incoming : [...list, ...incoming.filter(d => !list.some(x => x.id === d.id))];
      selectedId = null;
      ensurePrims();
      commit(before);
      for (const d of gone) emit('removed', d);
      for (const d of incoming) emit('created', d);
      repaint();
      return incoming.length;
    },
    on(event, h) {
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
    setHidden(on) { hidden = on; if (on) { selectedId = null; hoveredId = null; } repaint(); ui?.sync(); },
    hidden: () => hidden,
    colors: () => colors,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      removeHandler();
      chart.unsubscribeCrosshairMove(onCross);
      for (const { series: s, prim } of prims.values()) s.detachPrimitive(prim);
      prims.clear();
      hosts.clear();
      chart.setCursor(null);
      ui?.destroy();
      ui = null;
    },
  };

  function restore(from: string[], to: string[]): boolean {
    const snap = from.pop();
    if (snap === undefined) return false;
    to.push(snapshot());
    const prev = new Map(list.map(d => [d.id, JSON.stringify(d)]));
    list = (JSON.parse(snap) as Drawing[]);
    const now = new Map(list.map(d => [d.id, JSON.stringify(d)]));
    if (selectedId && !now.has(selectedId)) selectedId = null;
    ensurePrims();
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

  // Opt-in persistence: load what was saved under the key.
  if (options.persist) {
    try {
      const raw = (options.persist.storage ?? globalThis.localStorage)?.getItem(options.persist.key);
      if (raw) list = drawingsFromJSON(raw, base);
    } catch { list = []; }
  }
  ensurePrims();
  let ui: DrawingToolsUi | null = null;
  const tb = options.toolbar;
  if (tb) ui = createToolbar(chart, ctl, typeof tb === 'object' && tb.position === 'top' ? 'top' : 'left');
  return ctl;
}
