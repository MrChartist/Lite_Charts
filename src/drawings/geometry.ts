// Pure geometry for the drawing tools: distances for hit testing, line extension to the pane, path simplification,
// arrow heads, angle constraint, Fibonacci levels, measure and position figures. Pixel space (CSS px), no canvas.
// Path simplification and the arrow head are ported from the host engine (PROVENANCE.md).

export interface Pt { x: number; y: number }
export interface Rect { x: number; y: number; width: number; height: number }

/** Distance from p to the segment a-b. */
export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Distance from p to a polyline. */
export function distToPolyline(p: Pt, pts: readonly Pt[]): number {
  if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y);
  let d = Infinity;
  for (let i = 1; i < pts.length; i++) d = Math.min(d, distToSegment(p, pts[i - 1], pts[i]));
  return d;
}

/**
 * The visible part of the line through a and b inside `r`: 'segment' a to b, 'ray' from a through b onwards,
 * 'extended' both ways. Null when nothing is inside (or a equals b for the unbounded modes).
 */
export function clipLine(a: Pt, b: Pt, r: Rect, mode: 'segment' | 'ray' | 'extended'): [Pt, Pt] | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = mode === 'extended' ? -Infinity : 0;
  let t1 = mode === 'segment' ? 1 : Infinity;
  if (dx === 0 && dy === 0) return mode === 'segment' ? [a, b] : null;
  // Liang-Barsky against the rectangle.
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - r.x, r.x + r.width - a.x, a.y - r.y, r.y + r.height - a.y];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return null; continue; }
    const t = q[i] / p[i];
    if (p[i] < 0) { if (t > t1) return null; if (t > t0) t0 = t; }
    else { if (t < t0) return null; if (t < t1) t1 = t; }
  }
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return null;
  return [{ x: a.x + t0 * dx, y: a.y + t0 * dy }, { x: a.x + t1 * dx, y: a.y + t1 * dy }];
}

function perpendicular(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Douglas-Peucker simplification (iterative, keeps the first and last point). */
export function simplifyPath<T extends Pt>(points: readonly T[], tolerance = 1.5): T[] {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop() as [number, number];
    let max = 0;
    let at = -1;
    for (let i = s + 1; i < e; i++) {
      const d = perpendicular(points[i], points[s], points[e]);
      if (d > max) { max = d; at = i; }
    }
    if (at >= 0 && max > tolerance) {
      keep[at] = 1;
      stack.push([s, at], [at, e]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

/** Wing, tip, wing of an arrow head `size` px long at `tip`, pointing away from `tail` (capped at half the line). */
export function arrowHead(tail: Pt, tip: Pt, size: number): [Pt, Pt, Pt] | null {
  const len = Math.hypot(tip.x - tail.x, tip.y - tail.y);
  if (!(len > 1e-8) || !(size > 0)) return null;
  const ux = (tip.x - tail.x) / len;
  const uy = (tip.y - tail.y) / len;
  const s = Math.min(len * 0.5, size);
  return [
    { x: tip.x - s * ux - s * 0.5 * uy, y: tip.y - s * uy + s * 0.5 * ux },
    { x: tip.x, y: tip.y },
    { x: tip.x - s * ux + s * 0.5 * uy, y: tip.y - s * uy - s * 0.5 * ux },
  ];
}

/** `b` moved so a-b is horizontal, vertical or at 45 degrees (the nearest), projected onto that direction. */
export function constrainAngle(a: Pt, b: Pt): Pt {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const step = Math.PI / 4;
  const ang = Math.round(Math.atan2(dy, dx) / step) * step;
  const cx = Math.round(Math.cos(ang) * 1e9) / 1e9;
  const cy = Math.round(Math.sin(ang) * 1e9) / 1e9;
  const along = dx * cx + dy * cy;
  return { x: a.x + along * cx, y: a.y + along * cy };
}

export const FIB_LEVELS: readonly number[] = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

/** Price of each retracement level from `start` to `end`: level 0 at the end, 1 at the start. */
export function fibPrices(start: number, end: number, levels: readonly number[] = FIB_LEVELS): number[] {
  return levels.map(l => end - (end - start) * l);
}

/** Readable span of seconds: "45m", "3h 20m", "4d 6h", "12w". */
export function formatSpan(seconds: number): string {
  const s = Math.abs(Math.round(seconds));
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 14) return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
  return `${Math.round(d / 7)}w`;
}

export interface MeasureStats {
  change: number;
  percent: number;
  bars: number;
  seconds: number;
  dir: 1 | -1 | 0;
}

/** From a to b: price change, percent of a, bars between (logical) and time span. */
export function measureStats(a: { logical: number; price: number; time: number }, b: { logical: number; price: number; time: number }): MeasureStats {
  const change = b.price - a.price;
  return {
    change,
    percent: a.price !== 0 ? (change / Math.abs(a.price)) * 100 : 0,
    bars: Math.round(b.logical - a.logical),
    seconds: b.time - a.time,
    dir: change > 0 ? 1 : change < 0 ? -1 : 0,
  };
}

export interface PositionStats { reward: number; risk: number; ratio: number; targetPct: number; stopPct: number }

/** Reward, risk and their ratio of a position from entry to target, stopped at stop (long or short alike). */
export function positionStats(entry: number, target: number, stop: number): PositionStats {
  const reward = Math.abs(target - entry);
  const risk = Math.abs(entry - stop);
  return {
    reward, risk, ratio: risk > 0 ? reward / risk : 0,
    targetPct: entry !== 0 ? ((target - entry) / Math.abs(entry)) * 100 : 0,
    stopPct: entry !== 0 ? ((stop - entry) / Math.abs(entry)) * 100 : 0,
  };
}

/** The price among open, high, low and close of `row` nearest to `price` (rows without them: their value). */
export function nearestOhlc(row: Record<string, unknown> | null, price: number): number {
  if (!row) return price;
  let best = price;
  let d = Infinity;
  for (const k of ['open', 'high', 'low', 'close', 'value']) {
    const v = row[k];
    if (typeof v === 'number' && Math.abs(v - price) < d) { d = Math.abs(v - price); best = v; }
  }
  return best;
}

/** Inside the rectangle spanned by a and b, grown by `tol`. */
export function inBox(p: Pt, a: Pt, b: Pt, tol = 0): boolean {
  return p.x >= Math.min(a.x, b.x) - tol && p.x <= Math.max(a.x, b.x) + tol && p.y >= Math.min(a.y, b.y) - tol && p.y <= Math.max(a.y, b.y) + tol;
}
