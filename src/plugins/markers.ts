// Series markers: small shapes (arrows, circles, squares) with optional short text, placed above, below or inside
// the bar of the series they are attached to. Markers on one bar stack outward and never overlap the bar (or each
// other); only markers whose bar is inside the pane are drawn. A primitive attached to one series.

import type { Time } from '../core/time';
import { timeToSeconds } from '../core/time';
import type { ChartPrimitive, PrimitiveDrawScope, PrimitiveHost } from './primitive';
import type { PrimitiveOwner } from './price-line';

export type MarkerPosition = 'aboveBar' | 'belowBar' | 'inBar';
export type MarkerShape = 'arrowUp' | 'arrowDown' | 'circle' | 'square';

export interface SeriesMarker {
  time: Time;
  position: MarkerPosition;
  shape: MarkerShape;
  /** CSS colour. Arrows default to the theme's up / down colour, circle and square to its line colour. */
  color?: string;
  /** Short label next to the shape (16 characters at most; longer text is cut with an ellipsis). */
  text?: string;
  /** Multiplier on the base shape size (10 CSS px). Default 1; between 0.5 and 4. */
  size?: number;
}

/** What the series must offer: its rows (for the bar's high and low) plus the primitive hooks. */
export interface MarkerSeries extends PrimitiveOwner {
  data(): readonly object[];
}

export interface SeriesMarkersHandle {
  setMarkers(markers: readonly SeriesMarker[]): void;
  markers(): readonly SeriesMarker[];
  remove(): void;
}

export const MARKER_BASE_SIZE = 10;
export const MARKER_MAX_TEXT = 16;
const POSITIONS: readonly string[] = ['aboveBar', 'belowBar', 'inBar'];
const SHAPES: readonly string[] = ['arrowUp', 'arrowDown', 'circle', 'square'];

interface Prepared {
  /** Time in seconds (sort key and bar lookup). */
  t: number;
  m: SeriesMarker;
  size: number;
  text: string;
}

/** Validate markers and return stable-sorted copies (by time). Throws a TypeError naming marker and field. */
export function prepareMarkers(markers: readonly SeriesMarker[]): Prepared[] {
  if (!Array.isArray(markers)) throw new TypeError('Chartist Lite: setMarkers needs an array of markers');
  const out: Prepared[] = [];
  for (let i = 0; i < markers.length; i++) {
    const m = markers[i];
    if (!m || typeof m !== 'object') throw new TypeError(`Chartist Lite: marker ${i} is not an object`);
    if (!POSITIONS.includes(m.position)) throw new TypeError(`Chartist Lite: marker ${i} "position" must be "aboveBar", "belowBar" or "inBar"`);
    if (!SHAPES.includes(m.shape)) throw new TypeError(`Chartist Lite: marker ${i} "shape" must be "arrowUp", "arrowDown", "circle" or "square"`);
    if (m.size !== undefined && !(typeof m.size === 'number' && m.size >= 0.5 && m.size <= 4)) {
      throw new TypeError(`Chartist Lite: marker ${i} "size" must be a number from 0.5 to 4`);
    }
    let text = m.text === undefined ? '' : String(m.text);
    if (text.length > MARKER_MAX_TEXT) text = `${text.slice(0, MARKER_MAX_TEXT - 1)}…`;
    out.push({ t: timeToSeconds(m.time), m: { ...m, time: m.time }, size: Math.round(MARKER_BASE_SIZE * (m.size ?? 1)), text });
  }
  return out.sort((a, b) => a.t - b.t);
}

/**
 * Stacks markers on one bar. `reset` with the bar's y extent (CSS px, y grows downward), then `place` each marker in
 * order: the centre y of its shape lands in `shapeY` and of its text in `textY` (NaN when it has none). Above and
 * below markers stack outward from the bar, each leaving `gap` px; in-bar markers fan out from the bar's middle.
 */
export class StackCursor {
  shapeY = 0;
  textY = NaN;
  private top = 0;
  private bottom = 0;
  private mid = 0;
  private inCount = 0;

  reset(barTopY: number, barBottomY: number): void {
    this.top = Math.min(barTopY, barBottomY);
    this.bottom = Math.max(barTopY, barBottomY);
    this.mid = (this.top + this.bottom) / 2;
    this.inCount = 0;
  }

  place(position: MarkerPosition, size: number, textH: number, gap: number): void {
    this.textY = NaN;
    if (position === 'aboveBar') {
      this.shapeY = this.top - gap - size / 2;
      this.top = this.shapeY - size / 2;
      if (textH > 0) { this.textY = this.top - textH / 2; this.top -= textH; }
    } else if (position === 'belowBar') {
      this.shapeY = this.bottom + gap + size / 2;
      this.bottom = this.shapeY + size / 2;
      if (textH > 0) { this.textY = this.bottom + textH / 2; this.bottom += textH; }
    } else {
      const k = this.inCount++;
      const step = size + gap;
      this.shapeY = this.mid + (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * step;
      if (textH > 0) this.textY = this.shapeY + size / 2 + textH / 2;
    }
  }
}

/** Index of the row whose time is `seconds`, or -1. Rows are in ascending time order. */
export function findRow(rows: readonly { time: Time }[], seconds: number): number {
  let lo = 0;
  let hi = rows.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = timeToSeconds(rows[mid].time);
    if (t === seconds) return mid;
    if (t < seconds) lo = mid + 1; else hi = mid - 1;
  }
  return -1;
}

/** Lowest and highest price a row draws: its high / low when it has them, else its value or close. */
export function rowExtent(row: object): [number, number] | null {
  const r = row as Record<string, unknown>;
  if (typeof r.high === 'number' && typeof r.low === 'number') return [r.low, r.high];
  const v = typeof r.value === 'number' ? r.value : typeof r.close === 'number' ? r.close : NaN;
  return Number.isFinite(v) ? [v, v] : null;
}

function drawShape(ctx: CanvasRenderingContext2D, shape: MarkerShape, cx: number, cy: number, size: number): void {
  const h = size / 2;
  if (shape === 'circle') {
    ctx.moveTo(cx + h, cy);
    ctx.arc(cx, cy, h, 0, Math.PI * 2);
  } else if (shape === 'square') {
    const q = size * 0.8;
    ctx.rect(cx - q / 2, cy - q / 2, q, q);
  } else {
    // An arrow: a head over a short stem, pointing up or down.
    const d = shape === 'arrowUp' ? -1 : 1;
    const tip = cy + d * h;
    const baseY = cy - d * h * 0.1;
    const stemW = size * 0.3;
    const end = cy - d * h;
    ctx.moveTo(cx, tip);
    ctx.lineTo(cx + h, baseY);
    ctx.lineTo(cx + stemW / 2, baseY);
    ctx.lineTo(cx + stemW / 2, end);
    ctx.lineTo(cx - stemW / 2, end);
    ctx.lineTo(cx - stemW / 2, baseY);
    ctx.lineTo(cx - h, baseY);
    ctx.closePath();
  }
}

export function createSeriesMarkers(series: MarkerSeries, markers: readonly SeriesMarker[] = []): SeriesMarkersHandle {
  let list = prepareMarkers(markers);
  let host: PrimitiveHost | null = null;
  let attached = true;
  const cursor = new StackCursor();
  const GAP = 4;

  const primitive: ChartPrimitive = {
    zOrder: 'top',
    attached(h) { host = h; },
    detached() { host = null; },
    draw(s: PrimitiveDrawScope) {
      if (list.length === 0) return;
      const rows = series.data() as readonly { time: Time }[];
      if (rows.length === 0) return;
      const { ctx, pane, pixelRatio: r } = s;
      const fontSize = Math.max(12, s.fontSize);
      const textH = fontSize + 2;
      ctx.save();
      ctx.font = `500 ${fontSize}px ${s.fontFamily}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      let prevT = NaN;
      let pathColor = '';
      let pathOpen = false;
      const flush = (): void => {
        if (!pathOpen) return;
        ctx.fillStyle = pathColor;
        ctx.fill();
        pathOpen = false;
      };
      let barX = NaN;
      let skip = false;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (p.t !== prevT) {
          prevT = p.t;
          skip = true;
          barX = NaN;
          const x = s.timeToX(p.m.time);
          if (x !== null && x >= pane.x - 20 && x <= pane.x + pane.width + 20) {
            const idx = findRow(rows, p.t);
            const ext = idx >= 0 ? rowExtent(rows[idx]) : null;
            const yHigh = ext ? s.priceToY(ext[1]) : null;
            const yLow = ext ? s.priceToY(ext[0]) : null;
            if (yHigh !== null && yLow !== null) {
              skip = false;
              barX = Math.round(x * r) / r;
              cursor.reset(yHigh, yLow);
            }
          }
        }
        if (skip) continue;
        cursor.place(p.m.position, p.size, p.text ? textH : 0, GAP);
        const cy = Math.round(cursor.shapeY * r) / r;
        const color = p.m.color ?? (p.m.shape === 'arrowUp' ? s.colors.up : p.m.shape === 'arrowDown' ? s.colors.down : s.colors.line);
        if (!pathOpen || color !== pathColor) { flush(); ctx.beginPath(); pathColor = color; pathOpen = true; }
        drawShape(ctx, p.m.shape, barX, cy, p.size);
        if (p.text) {
          flush();
          ctx.fillStyle = color;
          ctx.fillText(p.text, barX, cursor.textY);
        }
      }
      flush();
      ctx.restore();
    },
  };
  series.attachPrimitive(primitive);

  return {
    setMarkers(next) {
      list = prepareMarkers(next);
      host?.requestUpdate();
    },
    markers: () => list.map(p => ({ ...p.m })),
    remove() {
      if (!attached) return;
      attached = false;
      series.detachPrimitive(primitive);
    },
  };
}
