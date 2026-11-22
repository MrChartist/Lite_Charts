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

/** Point inside a polygon (even-odd rule). */
export function inPolygon(p: Pt, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Distance from p to a closed polygon's edges. */
export function distToPolygon(p: Pt, poly: readonly Pt[]): number {
  if (poly.length < 2) return poly.length ? Math.hypot(p.x - poly[0].x, p.y - poly[0].y) : Infinity;
  let d = distToSegment(p, poly[poly.length - 1], poly[0]);
  for (let i = 1; i < poly.length; i++) d = Math.min(d, distToSegment(p, poly[i - 1], poly[i]));
  return d;
}

/** Points on the ellipse with centre c and radii rx, ry (n segments). */
export function ellipsePoints(c: Pt, rx: number, ry: number, n = 64): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) { const t = (i / n) * Math.PI * 2; out.push({ x: c.x + rx * Math.cos(t), y: c.y + ry * Math.sin(t) }); }
  return out;
}

/** The circle through three points, or null when they are on one line. */
export function circleThrough(a: Pt, b: Pt, c: Pt): { x: number; y: number; r: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
  const x = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const y = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  return { x, y, r: Math.hypot(a.x - x, a.y - y) };
}

/**
 * Samples of the circular arc from a to c through b (n segments); a straight a-c when the three are on one line.
 * Ported in spirit from the host engine's arc tool (PROVENANCE.md).
 */
export function arcThrough(a: Pt, b: Pt, c: Pt, n = 48): Pt[] {
  const k = circleThrough(a, b, c);
  if (!k || k.r > 1e5) return [a, c];
  const t0 = Math.atan2(a.y - k.y, a.x - k.x);
  const tb = Math.atan2(b.y - k.y, b.x - k.x);
  let t1 = Math.atan2(c.y - k.y, c.x - k.x);
  // Go the way that passes b.
  const norm = (t: number): number => ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const ccw = norm(tb - t0) < norm(t1 - t0);
  if (ccw) { while (t1 < t0) t1 += 2 * Math.PI; } else { while (t1 > t0) t1 -= 2 * Math.PI; }
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) { const t = t0 + ((t1 - t0) * i) / n; out.push({ x: k.x + k.r * Math.cos(t), y: k.y + k.r * Math.sin(t) }); }
  return out;
}

/**
 * Quadratic Bezier from start to end bent towards `control` (de Casteljau), n segments. Ported from the host engine's
 * `curveSampling.ts` (PROVENANCE.md), simplified to the quadratic form.
 */
export function sampleBezier(start: Pt, end: Pt, control: Pt, n = 48): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push({ x: u * u * start.x + 2 * u * t * control.x + t * t * end.x, y: u * u * start.y + 2 * u * t * control.y + t * t * end.y });
  }
  return out;
}

/**
 * Corners of the rectangle whose base is a-b and whose height is the signed distance of c from that base (host
 * engine `curveSampling.ts`, PROVENANCE.md). Null when the base has no length.
 */
export function rotatedRectCorners(a: Pt, b: Pt, c: Pt): [Pt, Pt, Pt, Pt] | null {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length < 1e-8) return null;
  const nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length;
  const height = (c.x - a.x) * nx + (c.y - a.y) * ny;
  return [a, b, { x: b.x + height * nx, y: b.y + height * ny }, { x: a.x + height * nx, y: a.y + height * ny }];
}

/** Bounding boxes of consecutive chunks of a long polyline, so a hit test walks only the chunks near the pointer. */
export function chunkBoxes(pts: readonly Pt[], size = 32): Rect[] {
  const out: Rect[] = [];
  for (let s = 0; s < pts.length - 1; s += size) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const e = Math.min(pts.length - 1, s + size);
    for (let i = s; i <= e; i++) { const p = pts[i]; if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
    out.push({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
  }
  return out;
}

/** Distance from p to a polyline, walking only the chunks (from `chunkBoxes(pts, size)`) within `tol` of p. */
export function distToPolylineChunked(p: Pt, pts: readonly Pt[], boxes: readonly Rect[], tol: number, size = 32): number {
  if (pts.length < 2) return distToPolyline(p, pts);
  let d = Infinity;
  for (let c = 0; c < boxes.length; c++) {
    const b = boxes[c];
    if (p.x < b.x - tol || p.x > b.x + b.width + tol || p.y < b.y - tol || p.y > b.y + b.height + tol) continue;
    const s = c * size, e = Math.min(pts.length - 1, s + size);
    for (let i = s + 1; i <= e; i++) d = Math.min(d, distToSegment(p, pts[i - 1], pts[i]));
  }
  return d;
}

/** Evenly thinned to at most `max` points, keeping the first and the last. */
export function capPoints<T>(pts: readonly T[], max: number): T[] {
  if (pts.length <= max) return pts.slice();
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(pts[Math.round((i * (pts.length - 1)) / (max - 1))]);
  return out;
}

/** Angle of a-b in degrees as a person reads it on screen (up is positive), -180 to 180. */
export function screenAngle(a: Pt, b: Pt): number {
  return (Math.atan2(a.y - b.y, b.x - a.x) * 180) / Math.PI;
}
