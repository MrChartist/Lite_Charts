// Fibonacci and Gann tools: extension, channel, fan, speed resistance fan, arcs, time zones, Gann fan and box. Ratios
// and constructions are ported from the host engine (`fibonacci.ts`, `gann.ts`; PROVENANCE.md) and computed here in
// pixel space from the projected anchors (x is linear in the logical index, so ratios of x are ratios of bars).

import { distToSegment, inBox, inPolygon, type Pt } from '../geometry';
import type { ToolDefinition } from '../contract';
import { alpha, colorOf, crispX, crispY, fillPoly, guide, label, labelPx, lineTo, lineYAt, spaced, stroke } from '../paint';
import { levelsOf, levelsReader, nearLine, ok, ratioText, ring } from './common';

export const FIB_EXTENSION_LEVELS: readonly number[] = [0, 0.382, 0.618, 1, 1.272, 1.618, 2, 2.618];
export const FIB_CHANNEL_LEVELS: readonly number[] = [0, 0.382, 0.618, 1, 1.618];
export const FIB_FAN_LEVELS: readonly number[] = [0.236, 0.382, 0.5, 0.618, 0.786, 1];
export const FIB_ARC_LEVELS: readonly number[] = [0.382, 0.5, 0.618, 1];
export const SPEED_FAN_LEVELS: readonly number[] = [1 / 3, 2 / 3, 1];
export const GANN_ANGLES: readonly { label: string; ratio: number }[] = [
  { label: '1x8', ratio: 1 / 8 }, { label: '1x4', ratio: 1 / 4 }, { label: '1x3', ratio: 1 / 3 }, { label: '1x2', ratio: 1 / 2 },
  { label: '1x1', ratio: 1 }, { label: '2x1', ratio: 2 }, { label: '3x1', ratio: 3 }, { label: '4x1', ratio: 4 }, { label: '8x1', ratio: 8 },
];
export const GANN_BOX_LEVELS: readonly number[] = [0, 0.25, 0.382, 0.5, 0.618, 0.75, 1];

/** Trend-based extension: each level is C plus `ratio` times the A to B move (ratio 0 on C, 1 a full repeat). */
export function fibExtensionPrices(a: number, b: number, c: number, levels: readonly number[] = FIB_EXTENSION_LEVELS): number[] {
  return levels.map(r => c + r * (b - a));
}

/** The Fibonacci numbers 0, 1, 2, 3, 5, 8 ... (the repeated 1 dropped), `count` of them. */
export function fibSequence(count: number): number[] {
  const out: number[] = [];
  let a = 0, b = 1;
  while (out.length < count) { if (out[out.length - 1] !== a) out.push(a); [a, b] = [b, a + b]; }
  return out;
}

const x01 = (a: Pt, b: Pt): [number, number] => [Math.min(a.x, b.x), Math.max(a.x, b.x)];

export const fibExtension: ToolDefinition = {
  id: 'fibExtension', label: 'Fibonacci extension', group: 'fib', points: 3,
  hint: 'Trend-based Fibonacci extension: the move A to B projected from C',
  icon: `${ring(4, 19)}M5.4 17.6L10 8l3.5 6M14 4.5h6.5M14 9.5h6.5M14 14.5h6.5`,
  defaults: { levels: FIB_EXTENSION_LEVELS.slice() },
  readOptions: levelsReader(FIB_EXTENSION_LEVELS),
  render(rc, d, [a, b, c], extra) {
    if (!ok([a, b], 2)) return;
    const color = colorOf(d, rc.colors);
    rc.ctx.beginPath();
    rc.ctx.moveTo(a.x, a.y); rc.ctx.lineTo(b.x, b.y);
    if (c && ok([c], 1)) rc.ctx.lineTo(c.x, c.y);
    guide(rc, d, color, extra, 0.6, 'dashed');
    if (!c || !ok([c], 1)) return;
    const levels = levelsOf(d.options, FIB_EXTENSION_LEVELS);
    const x0 = c.x, x1 = Math.max(b.x, c.x) + Math.max(60, Math.abs(b.x - a.x) * 0.6);
    let prev: number | null = null;
    levels.forEach((r, i) => {
      const y = crispY(rc, d, c.y + r * (b.y - a.y));
      if (prev !== null) { rc.ctx.fillStyle = alpha(color, i % 2 ? 0.06 : 0.03); rc.ctx.fillRect(x0, Math.min(prev, y), x1 - x0, Math.abs(y - prev)); }
      prev = y;
      rc.ctx.beginPath();
      rc.ctx.moveTo(x0, y); rc.ctx.lineTo(x1, y);
      stroke(rc, d, color, extra, d.style.dash, r === 0 || r === 1 ? d.style.width : 1);
    });
  },
  labels(rc, d, [a, b, c]) {
    if (!ok([a, b, c], 3)) return;
    const levels = levelsOf(d.options, FIB_EXTENSION_LEVELS);
    const prices = fibExtensionPrices(d.points[0].price, d.points[1].price, d.points[2].price, levels);
    const ys = levels.map(r => c.y + r * (b.y - a.y));
    const fits = spaced(ys, labelPx(rc) + 6);
    levels.forEach((r, i) => { if (fits[i]) label(rc, `${ratioText(r)} (${rc.fmt(prices[i])})`, c.x + 2, ys[i] - labelPx(rc) / 2 - 4, colorOf(d, rc.colors), 'left'); });
  },
  hit(d, [a, b, c], p, tol) {
    if (!ok([a, b, c], 3)) return false;
    if (distToSegment(p, a, b) <= tol || distToSegment(p, b, c) <= tol) return true;
    const levels = levelsOf(d.options, FIB_EXTENSION_LEVELS);
    const ys = levels.map(r => c.y + r * (b.y - a.y));
    const x1 = Math.max(b.x, c.x) + Math.max(60, Math.abs(b.x - a.x) * 0.6);
    return inBox(p, { x: c.x, y: Math.min(...ys) }, { x: x1, y: Math.max(...ys) }, tol);
  },
};

export const fibChannel: ToolDefinition = {
  id: 'fibChannel', label: 'Fibonacci channel', group: 'fib', points: 3,
  hint: 'Fibonacci channel: a base line, then a point for the width; levels parallel to the base',
  icon: `${ring(4, 15)}M5.5 13.6L20 5M4 20l16-9.5M4 10.5L13 5.2M9 19.6l11-6.6`,
  defaults: { levels: FIB_CHANNEL_LEVELS.slice() },
  readOptions: levelsReader(FIB_CHANNEL_LEVELS),
  render(rc, d, [a, b, c], extra) {
    if (!ok([a, b], 2)) return;
    const color = colorOf(d, rc.colors);
    const off = c && ok([c], 1) ? c.y - lineYAt(a, b, c.x) : 0;
    const levels = c ? levelsOf(d.options, FIB_CHANNEL_LEVELS) : [0];
    let prev: number | null = null;
    levels.forEach((r, i) => {
      const o = r * off;
      if (prev !== null) fillPoly(rc, [{ x: a.x, y: a.y + prev }, { x: b.x, y: b.y + prev }, { x: b.x, y: b.y + o }, { x: a.x, y: a.y + o }], color, i % 2 ? 0.06 : 0.03);
      prev = o;
      rc.ctx.beginPath();
      rc.ctx.moveTo(a.x, a.y + o); rc.ctx.lineTo(b.x, b.y + o);
      stroke(rc, d, color, extra, d.style.dash, r === 0 || r === 1 ? d.style.width : 1);
    });
  },
  labels(rc, d, [a, b, c]) {
    if (!ok([a, b, c], 3)) return;
    const off = c.y - lineYAt(a, b, c.x);
    const left = a.x <= b.x ? a : b;
    const lv = levelsOf(d.options, FIB_CHANNEL_LEVELS);
    const fits = spaced(lv.map(r => left.y + r * off), labelPx(rc) + 6);
    lv.forEach((r, i) => { if (fits[i]) label(rc, ratioText(r), left.x - 4, left.y + r * off, colorOf(d, rc.colors), 'right'); });
  },
  hit(d, [a, b, c], p, tol) {
    if (!ok([a, b, c], 3)) return false;
    const off = c.y - lineYAt(a, b, c.x);
    const lv = levelsOf(d.options, FIB_CHANNEL_LEVELS);
    const lo = Math.min(0, ...lv) * off, hi = Math.max(1, ...lv) * off;
    return inPolygon(p, [{ x: a.x, y: a.y + lo }, { x: b.x, y: b.y + lo }, { x: b.x, y: b.y + hi }, { x: a.x, y: a.y + hi }]) || distToSegment(p, a, b) <= tol;
  },
};

/** Rays of a fan from a: through (b.x, a.y + r * (b.y - a.y)) for each ratio. */
function fanTargets(a: Pt, b: Pt, levels: readonly number[]): Pt[] {
  return levels.map(r => ({ x: b.x, y: a.y + r * (b.y - a.y) }));
}

export const fibFan: ToolDefinition = {
  id: 'fibFan', label: 'Fibonacci fan', group: 'fib', points: 2, bounds: 'pane',
  hint: 'Fibonacci fan: rays from the first point through Fibonacci fractions of the move',
  icon: `${ring(4, 20)}M5.5 18.5L20 4M5.8 19.2L20 12M6 20h14.5`,
  defaults: { levels: FIB_FAN_LEVELS.slice() },
  readOptions: levelsReader(FIB_FAN_LEVELS),
  render(rc, d, [a, b], extra) {
    if (!ok([a, b], 2)) return;
    const color = colorOf(d, rc.colors);
    const ts = fanTargets(a, b, levelsOf(d.options, FIB_FAN_LEVELS));
    rc.ctx.beginPath();
    for (const t of ts) lineTo(rc, a, t, 'ray');
    stroke(rc, d, color, extra, d.style.dash, 1);
    rc.ctx.beginPath();
    rc.ctx.moveTo(b.x, a.y); rc.ctx.lineTo(b.x, b.y);
    guide(rc, d, color, extra, 0.5, 'dashed');
  },
  labels(rc, d, [a, b]) {
    if (!ok([a, b], 2)) return;
    const lv = levelsOf(d.options, FIB_FAN_LEVELS);
    const ts = fanTargets(a, b, lv);
    const fits = spaced(ts.map(t => t.y), labelPx(rc) + 6);
    ts.forEach((t, i) => { if (fits[i]) label(rc, ratioText(lv[i]), t.x + (b.x >= a.x ? 6 : -6), t.y, colorOf(d, rc.colors), b.x >= a.x ? 'left' : 'right'); });
  },
  hit: (d, [a, b], p, tol, view) => ok([a, b], 2) && fanTargets(a, b, levelsOf(d.options, FIB_FAN_LEVELS)).some(t => nearLine(p, a, t, tol, view, 'ray')),
};

export const fibSpeedFan: ToolDefinition = {
  id: 'fibSpeedFan', label: 'Speed resistance fan', group: 'fib', points: 2, bounds: 'pane',
  hint: 'Speed resistance fan: rays at thirds of the move in price and in time',
  icon: 'M4 20L20 4M4 20l16-5.3M4 20l5.3-16M4 4h16v16',
  render(rc, d, [a, b], extra) {
    if (!ok([a, b], 2)) return;
    const color = colorOf(d, rc.colors);
    rc.ctx.beginPath();
    for (const r of SPEED_FAN_LEVELS) {
      lineTo(rc, a, { x: b.x, y: a.y + r * (b.y - a.y) }, 'ray');
      if (r < 1) lineTo(rc, a, { x: a.x + r * (b.x - a.x), y: b.y }, 'ray');
    }
    stroke(rc, d, color, extra, d.style.dash, 1);
    rc.ctx.beginPath();
    rc.ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    guide(rc, d, color, extra, 0.45, 'dashed');
  },
  labels(rc, d, [a, b]) {
    if (!ok([a, b], 2)) return;
    const right = b.x >= a.x;
    const fits = spaced(SPEED_FAN_LEVELS.map(r => a.y + r * (b.y - a.y)), labelPx(rc) + 6);
    SPEED_FAN_LEVELS.forEach((r, i) => { if (fits[i]) label(rc, r === 1 ? '1' : r < 0.5 ? '1/3' : '2/3', b.x + (right ? 6 : -6), a.y + r * (b.y - a.y), colorOf(d, rc.colors), right ? 'left' : 'right'); });
  },
  hit(_d, [a, b], p, tol, view) {
    if (!ok([a, b], 2)) return false;
    for (const r of SPEED_FAN_LEVELS) {
      if (nearLine(p, a, { x: b.x, y: a.y + r * (b.y - a.y) }, tol, view, 'ray')) return true;
      if (r < 1 && nearLine(p, a, { x: a.x + r * (b.x - a.x), y: b.y }, tol, view, 'ray')) return true;
    }
    return false;
  },
};

export const fibArcs: ToolDefinition = {
  id: 'fibArcs', label: 'Fibonacci arcs', group: 'fib', points: 2,
  hint: 'Fibonacci arcs: half circles around the first point at Fibonacci fractions of the move, facing it',
  icon: `${ring(5, 12)}M7 12h13.5M20.5 12a8 8 0 0 0-8-8M20.5 12a8 8 0 0 1-8 8M16 12a4 4 0 0 0-4-4M16 12a4 4 0 0 1-4 4`,
  defaults: { levels: FIB_ARC_LEVELS.slice() },
  readOptions: levelsReader(FIB_ARC_LEVELS),
  render(rc, d, [a, b], extra) {
    if (!ok([a, b], 2)) return;
    const color = colorOf(d, rc.colors);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const t = Math.atan2(b.y - a.y, b.x - a.x);
    rc.ctx.beginPath();
    rc.ctx.moveTo(a.x, a.y); rc.ctx.lineTo(b.x, b.y);
    guide(rc, d, color, extra, 0.6, 'dashed');
    for (const r of levelsOf(d.options, FIB_ARC_LEVELS)) {
      rc.ctx.beginPath();
      rc.ctx.arc(a.x, a.y, r * len, t - Math.PI / 2, t + Math.PI / 2);
      stroke(rc, d, color, extra, d.style.dash, r === 1 ? d.style.width : 1);
    }
  },
  labels(rc, d, [a, b]) {
    if (!ok([a, b], 2)) return;
    // On the a-b line, where each arc crosses it; only those far enough apart to read.
    const lv = levelsOf(d.options, FIB_ARC_LEVELS);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    let last = -Infinity;
    for (const r of lv) {
      if (r * len - last < labelPx(rc) * 2.2) continue;
      last = r * len;
      label(rc, ratioText(r), a.x + r * (b.x - a.x), a.y + r * (b.y - a.y), colorOf(d, rc.colors));
    }
  },
  hit(d, [a, b], p, tol) {
    if (!ok([a, b], 2)) return false;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const dist = Math.hypot(p.x - a.x, p.y - a.y);
    const facing = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y) >= -tol * len;
    return facing && (levelsOf(d.options, FIB_ARC_LEVELS).some(r => Math.abs(dist - r * len) <= tol) || distToSegment(p, a, b) <= tol);
  },
  handles: (_d, [a, b]) => [a, b],
};

/** x of each time zone line: a + f * (b - a) for the Fibonacci numbers f, while inside `maxX` (at most 16). */
export function timeZoneXs(a: number, b: number, maxX: number, minX = -Infinity): { f: number; x: number }[] {
  const unit = b - a;
  if (Math.abs(unit) < 1e-9) return [];
  const out: { f: number; x: number }[] = [];
  for (const f of fibSequence(16)) {
    const x = a + f * unit;
    if ((unit > 0 && x > maxX) || (unit < 0 && x < minX)) break;
    out.push({ f, x });
  }
  return out;
}

export const fibTimeZones: ToolDefinition = {
  id: 'fibTimeZones', label: 'Fibonacci time zones', group: 'fib', points: 2, bounds: 'pane',
  hint: 'Fibonacci time zones: vertical lines at 0, 1, 2, 3, 5, 8 ... times the first span',
  icon: 'M4 3.5v17M7 3.5v17M10 3.5v17M14 3.5v17M20 3.5v17',
  render(rc, d, [a, b], extra) {
    if (!ok([a, b], 2)) return;
    const color = colorOf(d, rc.colors);
    const zs = timeZoneXs(a.x, b.x, rc.rect.x + rc.rect.width, rc.rect.x);
    rc.ctx.beginPath();
    for (const z of zs) { const x = crispX(rc, d, z.x, 1); rc.ctx.moveTo(x, rc.rect.y); rc.ctx.lineTo(x, rc.rect.y + rc.rect.height); }
    stroke(rc, d, color, extra, d.style.dash, 1);
    rc.ctx.beginPath();
    rc.ctx.moveTo(a.x, a.y); rc.ctx.lineTo(b.x, b.y);
    guide(rc, d, color, extra, 0.6, 'dashed');
  },
  labels(rc, d, [a, b]) {
    if (!ok([a, b], 2)) return;
    let last = -Infinity;
    for (const z of timeZoneXs(a.x, b.x, rc.rect.x + rc.rect.width, rc.rect.x)) {
      const w = rc.measure(String(z.f), 500) + 16;
      if (Math.abs(z.x - last) < w) continue;
      last = z.x;
      label(rc, String(z.f), z.x + 3, rc.rect.y + rc.rect.height - labelPx(rc), colorOf(d, rc.colors), 'left');
    }
  },
  hit: (_d, [a, b], p, tol, view) => ok([a, b], 2) && (timeZoneXs(a.x, b.x, view.rect.x + view.rect.width, view.rect.x).some(z => Math.abs(p.x - z.x) <= tol) || distToSegment(p, a, b) <= tol),
  handles: (_d, [a, b]) => [a, b],
};

/** Gann fan: through a, each angle's slope a multiple of the a-b slope (the person's own 1x1). Label anchor on the a-b box edge. */
export function gannRays(a: Pt, b: Pt): { label: string; ratio: number; to: Pt }[] {
  return GANN_ANGLES.map(g => ({
    label: g.label, ratio: g.ratio,
    to: g.ratio <= 1 ? { x: b.x, y: a.y + g.ratio * (b.y - a.y) } : { x: a.x + (b.x - a.x) / g.ratio, y: b.y },
  }));
}

export const gannFan: ToolDefinition = {
  id: 'gannFan', label: 'Gann fan', group: 'fib', points: 2, bounds: 'pane',
  hint: 'Gann fan: the first two points set the 1x1 angle; the others are its multiples',
  icon: `${ring(4, 20)}M5.4 18.6L20 4M5.9 19.4L20 14M4.6 18.1L10 4`,
  render(rc, d, [a, b], extra) {
    if (!ok([a, b], 2)) return;
    const color = colorOf(d, rc.colors);
    rc.ctx.beginPath();
    for (const g of gannRays(a, b)) if (g.ratio !== 1) lineTo(rc, a, g.to, 'ray');
    guide(rc, d, color, extra, 0.75, d.style.dash);
    rc.ctx.beginPath();
    lineTo(rc, a, b, 'ray');
    stroke(rc, d, color, extra);
  },
  labels(rc, d, [a, b]) {
    if (!ok([a, b], 2)) return;
    // Labels on the a-b box edge; the steep ones (labels close together) only when there is room.
    const room = Math.abs(b.x - a.x) > 120 && Math.abs(b.y - a.y) > 120;
    for (const g of gannRays(a, b)) {
      if (!room && g.ratio !== 1 && g.ratio !== 0.5 && g.ratio !== 2) continue;
      label(rc, g.label, g.to.x, g.to.y, colorOf(d, rc.colors));
    }
  },
  hit: (_d, [a, b], p, tol, view) => ok([a, b], 2) && gannRays(a, b).some(g => nearLine(p, a, g.to, tol, view, 'ray')),
};

export const gannBox: ToolDefinition = {
  id: 'gannBox', label: 'Gann box', group: 'fib', points: 2,
  hint: 'Gann box: the box of two points divided at the Gann ratios, with its diagonals',
  icon: 'M4 4h16v16H4zM4 20L20 4M4 4l16 16M12 4v16M4 12h16',
  render(rc, d, [a, b], extra) {
    if (!ok([a, b], 2)) return;
    const color = colorOf(d, rc.colors);
    const [x0, x1] = x01(a, b);
    const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    rc.ctx.fillStyle = alpha(color, 0.05);
    rc.ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    rc.ctx.beginPath();
    for (const r of GANN_BOX_LEVELS) {
      if (r === 0 || r === 1) continue;
      const x = crispX(rc, d, x0 + r * (x1 - x0), 1), y = crispY(rc, d, y0 + r * (y1 - y0), 1);
      rc.ctx.moveTo(x, y0); rc.ctx.lineTo(x, y1);
      rc.ctx.moveTo(x0, y); rc.ctx.lineTo(x1, y);
    }
    guide(rc, d, color, extra, 0.45);
    rc.ctx.beginPath();
    rc.ctx.moveTo(a.x, a.y); rc.ctx.lineTo(b.x, b.y);
    rc.ctx.moveTo(a.x, b.y); rc.ctx.lineTo(b.x, a.y);
    guide(rc, d, color, extra, 0.8);
    rc.ctx.beginPath();
    rc.ctx.rect(crispX(rc, d, x0), crispY(rc, d, y0), crispX(rc, d, x1) - crispX(rc, d, x0), crispY(rc, d, y1) - crispY(rc, d, y0));
    stroke(rc, d, color, extra);
  },
  labels(rc, d, [a, b]) {
    if (!ok([a, b], 2) || Math.abs(b.y - a.y) < 7 * (labelPx(rc) + 6)) return;
    const [x0] = x01(a, b);
    const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    for (const r of GANN_BOX_LEVELS) label(rc, ratioText(r), x0 - 4, y1 - r * (y1 - y0), colorOf(d, rc.colors), 'right');
  },
  hit: (_d, [a, b], p, tol) => ok([a, b], 2) && inBox(p, a, b, tol),
};

export const FIB_TOOLS: readonly ToolDefinition[] = [fibExtension, fibChannel, fibFan, fibSpeedFan, fibArcs, fibTimeZones, gannFan, gannBox];
