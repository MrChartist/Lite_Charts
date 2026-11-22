// Ranges and analysis: price range, date range, date and price range, anchored VWAP (with optional bands) and a
// fixed-range volume profile. The VWAP, the bands and the range figures are ported from the host engine
// (`anchoredVWAP.ts`, `vwapBands.ts`, `measurement.ts`, `volumeProfile.ts`; PROVENANCE.md), simplified.

import { formatPercent, MINUS_SIGN } from '../../core/format';
import { distToPolyline, formatSpan, inBox, measureStats, type Pt } from '../geometry';
import type { BarAccess, Drawing, Proj, RenderCtx, ToolDefinition, View } from '../contract';
import { readNumbers } from '../contract';
import { alpha, arrowFor, colorOf, crispX, crispY, dirMark, dirText, guide, head, label, labelPx, sign, stroke } from '../paint';
import { ok, ring } from './common';

// ── ranges ──

function priceText(rc: RenderCtx, d: Drawing): { text: string; dir: number } {
  const p0 = d.points[0].price, p1 = d.points[1].price;
  const change = p1 - p0;
  const dir = change > 0 ? 1 : change < 0 ? -1 : 0;
  const body = rc.fmt(Math.abs(change)).replace(MINUS_SIGN, '');
  return { text: `${arrowFor(dir)}${sign(change, body)} (${formatPercent(p0 !== 0 ? (change / Math.abs(p0)) * 100 : 0, 2)})`, dir };
}

function dateText(d: Drawing, a: Proj, b: Proj): string {
  const st = measureStats({ logical: a.l, price: 0, time: d.points[0].time }, { logical: b.l, price: 0, time: d.points[1].time });
  return `${st.bars} bars, ${formatSpan(st.seconds)}`;
}

export const priceRange: ToolDefinition = {
  id: 'priceRange', label: 'Price range', group: 'measure', points: 2,
  hint: 'Price range: the change and percent between two prices',
  icon: 'M4 4.5h16M4 19.5h16M12 7.5v9M9 10l3-3 3 3M9 14l3 3 3-3',
  render(rc, d, [a, b], extra) {
    if (!ok([a, b], 2)) return;
    const dir = Math.sign(d.points[1].price - d.points[0].price);
    const mark = dirMark(rc, dir);
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
    rc.ctx.fillStyle = alpha(mark, 0.08);
    rc.ctx.fillRect(x0, Math.min(a.y, b.y), x1 - x0, Math.abs(b.y - a.y));
    rc.ctx.beginPath();
    for (const y of [crispY(rc, d, a.y), crispY(rc, d, b.y)]) { rc.ctx.moveTo(x0, y); rc.ctx.lineTo(x1, y); }
    stroke(rc, d, mark, extra);
    const xm = crispX(rc, d, (a.x + b.x) / 2);
    rc.ctx.beginPath();
    rc.ctx.moveTo(xm, a.y); rc.ctx.lineTo(xm, b.y);
    stroke(rc, d, mark, extra);
    if (Math.abs(b.y - a.y) > 12) head(rc, { x: xm, y: a.y }, { x: xm, y: b.y }, 8 + 2 * d.style.width, mark);
  },
  labels(rc, d, [a, b]) {
    if (!ok([a, b], 2)) return;
    const { text, dir } = priceText(rc, d);
    const fs = labelPx(rc);
    label(rc, text, (a.x + b.x) / 2, b.y + (b.y <= a.y ? -fs - 6 : fs + 6), dirText(rc, dir));
  },
  hit: (_d, [a, b], p, tol) => ok([a, b], 2) && inBox(p, a, b, tol),
};

export const dateRange: ToolDefinition = {
  id: 'dateRange', label: 'Date range', group: 'measure', points: 2,
  hint: 'Date range: bars and time between two dates',
  icon: 'M4.5 4v16M19.5 4v16M7.5 12h9M10 9l-3 3 3 3M14 9l3 3-3 3',
  render(rc, d, [a, b], extra) {
    if (!ok([a, b], 2)) return;
    const color = colorOf(d, rc.colors);
    const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    rc.ctx.fillStyle = alpha(color, 0.08);
    rc.ctx.fillRect(Math.min(a.x, b.x), y0, Math.abs(b.x - a.x), y1 - y0);
    rc.ctx.beginPath();
    for (const x of [crispX(rc, d, a.x), crispX(rc, d, b.x)]) { rc.ctx.moveTo(x, y0); rc.ctx.lineTo(x, y1); }
    const ym = crispY(rc, d, (a.y + b.y) / 2);
    rc.ctx.moveTo(a.x, ym); rc.ctx.lineTo(b.x, ym);
    stroke(rc, d, color, extra);
    if (Math.abs(b.x - a.x) > 12) head(rc, { x: a.x, y: ym }, { x: b.x, y: ym }, 8 + 2 * d.style.width, color);
  },
  labels(rc, d, [a, b]) {
    if (!ok([a, b], 2)) return;
    label(rc, dateText(d, a, b), (a.x + b.x) / 2, Math.max(a.y, b.y) + labelPx(rc) + 6, rc.colors.text);
  },
  hit: (_d, [a, b], p, tol) => ok([a, b], 2) && inBox(p, a, b, tol),
};

export const datePriceRange: ToolDefinition = {
  id: 'datePriceRange', label: 'Date and price range', group: 'measure', points: 2,
  hint: 'Date and price range: change, percent, bars and time across a box',
  icon: 'M4 4h16v16H4zM8 16l8-8M16 8h-4M16 8v4',
  render(rc, d, [a, b], extra) {
    if (!ok([a, b], 2)) return;
    const dir = Math.sign(d.points[1].price - d.points[0].price);
    const mark = dirMark(rc, dir);
    const x0 = crispX(rc, d, Math.min(a.x, b.x)), x1 = crispX(rc, d, Math.max(a.x, b.x));
    const y0 = crispY(rc, d, Math.min(a.y, b.y)), y1 = crispY(rc, d, Math.max(a.y, b.y));
    rc.ctx.fillStyle = alpha(mark, 0.08);
    rc.ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    rc.ctx.beginPath();
    rc.ctx.rect(x0, y0, x1 - x0, y1 - y0);
    guide(rc, d, mark, extra, 0.5);
    const xm = crispX(rc, d, (a.x + b.x) / 2), ym = crispY(rc, d, (a.y + b.y) / 2);
    rc.ctx.beginPath();
    rc.ctx.moveTo(xm, a.y); rc.ctx.lineTo(xm, b.y);
    rc.ctx.moveTo(a.x, ym); rc.ctx.lineTo(b.x, ym);
    stroke(rc, d, mark, extra);
    if (Math.abs(b.y - a.y) > 12) head(rc, { x: xm, y: a.y }, { x: xm, y: b.y }, 8 + 2 * d.style.width, mark);
    if (Math.abs(b.x - a.x) > 12) head(rc, { x: a.x, y: ym }, { x: b.x, y: ym }, 8 + 2 * d.style.width, mark);
  },
  labels(rc, d, [a, b]) {
    if (!ok([a, b], 2)) return;
    const { text, dir } = priceText(rc, d);
    const fs = labelPx(rc);
    const y = b.y <= a.y ? Math.min(a.y, b.y) - fs - 6 : Math.max(a.y, b.y) + fs + 6;
    label(rc, `${text}  ${dateText(d, a, b)}`, (a.x + b.x) / 2, y, dirText(rc, dir));
  },
  hit: (_d, [a, b], p, tol) => ok([a, b], 2) && inBox(p, a, b, tol),
};

// ── anchored VWAP ──

export interface VwapSeries { from: number; vwap: Float64Array; sd: Float64Array; weighted: boolean }

const vwapCache = new Map<string, VwapSeries>();

/**
 * Cumulative VWAP of the typical price (high + low + close) / 3 from the first bar at or after `time` to the last bar,
 * with the volume-weighted standard deviation for bands. Bars without volume weigh 1 each when no bar in the span has
 * volume (then it is a time-weighted average, and `weighted` is false); a bar with no volume adds no weight otherwise.
 */
export function anchoredVwap(bars: BarAccess, time: number): VwapSeries | null {
  const from = bars.indexAtOrAfter(time);
  if (from >= bars.count) return null;
  const key = `${bars.version}:${from}`;
  const hit = vwapCache.get(key);
  if (hit) return hit;
  const n = bars.count - from;
  let weighted = false;
  for (let i = from; i < bars.count; i++) { const v = bars.row(i).volume; if (v !== null && v > 0) { weighted = true; break; } }
  const vwap = new Float64Array(n), sd = new Float64Array(n);
  let sv = 0, spv = 0, sppv = 0;
  for (let k = 0; k < n; k++) {
    const r = bars.row(from + k);
    const tp = (r.high + r.low + r.close) / 3;
    const v = weighted ? (r.volume !== null && r.volume > 0 ? r.volume : 0) : 1;
    if (Number.isFinite(tp) && v > 0) { sv += v; spv += tp * v; sppv += tp * tp * v; }
    const m = sv > 0 ? spv / sv : Number.NaN;
    vwap[k] = m;
    sd[k] = sv > 0 ? Math.sqrt(Math.max(0, sppv / sv - m * m)) : Number.NaN;
  }
  const out = { from, vwap, sd, weighted };
  if (vwapCache.size > 32) vwapCache.clear();
  vwapCache.set(key, out);
  return out;
}

/** The VWAP line (and bands) over the visible bars from the anchor, in pixels. */
function vwapLines(d: Drawing, view: View): { mid: Pt[]; bands: Pt[][]; last: number; weighted: boolean } | null {
  if (!view.bars) return null;
  const s = anchoredVwap(view.bars, d.points[0].time);
  if (!s) return null;
  const bands = readNumbers(d.options?.bands, 0.1, 5, 3) ?? [];
  const bars = view.bars;
  // Only the bars on screen are projected (plus one each side).
  const leftL = Math.floor(lookupLogical(view, view.rect.x)) - 1;
  const mid: Pt[] = [];
  const bandPts: Pt[][] = bands.flatMap(() => [[], []]);
  // First bar on screen, by binary search (logical grows with time).
  let lo = s.from, hi = bars.count;
  while (lo < hi) { const m = (lo + hi) >> 1; if (view.logical(bars.times[m]) < leftL) lo = m + 1; else hi = m; }
  for (let k = lo - s.from; k < s.vwap.length; k++) {
    const t = bars.times[s.from + k];
    const l = view.logical(t);
    const x = view.x(l);
    if (x > view.rect.x + view.rect.width + 20) break;
    const m = s.vwap[k];
    if (!Number.isFinite(m)) continue;
    mid.push({ x, y: view.y(m) });
    bands.forEach((b, j) => { bandPts[2 * j].push({ x, y: view.y(m + b * s.sd[k]) }); bandPts[2 * j + 1].push({ x, y: view.y(m - b * s.sd[k]) }); });
  }
  return { mid, bands: bandPts, last: s.vwap[s.vwap.length - 1], weighted: s.weighted };
}

/** Logical index at an x, by inverting the view's x() (linear) from two samples. */
function lookupLogical(view: View, x: number): number {
  const x0 = view.x(0), x1 = view.x(1);
  return x1 !== x0 ? (x - x0) / (x1 - x0) : 0;
}

export const anchoredVwapTool: ToolDefinition = {
  id: 'anchoredVwap', label: 'Anchored VWAP', group: 'measure', points: 1, usesBars: true, bounds: 'pane',
  hint: 'Anchored VWAP: the volume-weighted average price from the bar you click',
  icon: `${ring(4, 18)}M5.6 16.6C9 12 12 13 14 10s4-4 6.5-4.5M8 20.5c3-3 6-2.5 8-5s3-3.5 4.5-4`,
  defaults: { bands: [] },
  readOptions(raw) { return { bands: readNumbers((raw as { bands?: unknown } | null)?.bands, 0.1, 5, 3) ?? [] }; },
  moveHandle: (_pts, _i, a) => [a],
  render(rc, d, _pts, extra) {
    const g = vwapLines(d, rc);
    if (!g || g.mid.length < 1) return;
    const color = colorOf(d, rc.colors);
    if (g.bands.length) {
      rc.ctx.beginPath();
      for (const b of g.bands) { if (b.length < 2) continue; rc.ctx.moveTo(b[0].x, b[0].y); for (let i = 1; i < b.length; i++) rc.ctx.lineTo(b[i].x, b[i].y); }
      guide(rc, d, color, extra, 0.7, 'dashed');
    }
    rc.ctx.beginPath();
    rc.ctx.moveTo(g.mid[0].x, g.mid[0].y);
    for (let i = 1; i < g.mid.length; i++) rc.ctx.lineTo(g.mid[i].x, g.mid[i].y);
    stroke(rc, d, color, extra);
  },
  labels(rc, d) {
    const g = vwapLines(d, rc);
    if (!g || !g.mid.length) return;
    const end = g.mid[g.mid.length - 1];
    label(rc, `${g.weighted ? 'AVWAP' : 'AVWAP, no volume: time-weighted'} ${rc.fmt(g.last)}`, end.x - 4, end.y - labelPx(rc) - 2, colorOf(d, rc.colors), 'right');
  },
  hit(d, _pts, p, tol, view) {
    const g = vwapLines(d, view);
    return !!g && g.mid.length > 1 && distToPolyline(p, g.mid) <= tol;
  },
  handles(d, pts, view) {
    const g = vwapLines(d, view);
    const a = pts[0];
    if (!a || !g) return a ? [a] : [];
    const first = g.mid.find(q => Math.abs(q.x - a.x) < 1);
    return [first ?? a];
  },
};

// ── fixed-range volume profile ──

export interface Profile { bins: number; low: number; high: number; volume: Float64Array; poc: number; vaLow: number; vaHigh: number; weighted: boolean }

/**
 * Volume by price over the bars from t0 to t1: each bar's volume is spread evenly across the bins its low to high
 * range covers (count 1 per bar when no bar has volume). The point of control is the fullest bin; the value area is
 * the 70% of the volume grown outwards from it, the larger neighbour first.
 */
export function volumeProfile(bars: BarAccess, t0: number, t1: number, bins = 24): Profile | null {
  const lo = Math.min(t0, t1), hi = Math.max(t0, t1);
  const from = bars.indexAtOrAfter(lo);
  let low = Infinity, high = -Infinity, weighted = false, to = from;
  for (let i = from; i < bars.count && bars.times[i] <= hi; i++, to = i) {
    const r = bars.row(i);
    if (r.low < low) low = r.low;
    if (r.high > high) high = r.high;
    if (r.volume !== null && r.volume > 0) weighted = true;
  }
  if (to <= from || !Number.isFinite(low) || !(high > low)) return null;
  const volume = new Float64Array(bins);
  const step = (high - low) / bins;
  for (let i = from; i < to; i++) {
    const r = bars.row(i);
    const v = weighted ? (r.volume !== null && r.volume > 0 ? r.volume : 0) : 1;
    if (!(v > 0)) continue;
    const b0 = Math.max(0, Math.min(bins - 1, Math.floor((r.low - low) / step)));
    const b1 = Math.max(0, Math.min(bins - 1, Math.floor((r.high - low) / step)));
    for (let b = b0; b <= b1; b++) volume[b] += v / (b1 - b0 + 1);
  }
  let poc = 0, total = 0;
  for (let b = 0; b < bins; b++) { total += volume[b]; if (volume[b] > volume[poc]) poc = b; }
  let vaLow = poc, vaHigh = poc, acc = volume[poc];
  while (acc < total * 0.7 && (vaLow > 0 || vaHigh < bins - 1)) {
    const down = vaLow > 0 ? volume[vaLow - 1] : -1;
    const up = vaHigh < bins - 1 ? volume[vaHigh + 1] : -1;
    if (up >= down) { vaHigh++; acc += volume[vaHigh]; } else { vaLow--; acc += volume[vaLow]; }
  }
  return { bins, low, high, volume, poc, vaLow, vaHigh, weighted };
}

const vpCache = new Map<string, Profile | null>();
function profileOf(d: Drawing, bars: BarAccess): Profile | null {
  const key = `${bars.version}:${d.points[0].time}:${d.points[1]?.time}`;
  if (vpCache.has(key)) return vpCache.get(key) ?? null;
  const p = d.points[1] ? volumeProfile(bars, d.points[0].time, d.points[1].time) : null;
  if (vpCache.size > 32) vpCache.clear();
  vpCache.set(key, p);
  return p;
}

export const volumeProfileTool: ToolDefinition = {
  id: 'volumeProfile', label: 'Fixed range volume profile', group: 'measure', points: 2, usesBars: true,
  hint: 'Volume profile: volume by price between two times, with the point of control and the 70% value area',
  icon: 'M4 4v16M4 6.5h6M4 9.5h10M4 12.5h15M4 15.5h9M4 18.5h5',
  render(rc, d, [a, b], extra) {
    if (!ok([a, b], 2)) return;
    const color = colorOf(d, rc.colors);
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
    const pr = rc.bars ? profileOf(d, rc.bars) : null;
    if (!pr) {
      rc.ctx.beginPath(); rc.ctx.rect(x0, Math.min(a.y, b.y), x1 - x0, Math.abs(b.y - a.y));
      guide(rc, d, color, extra, 0.6, 'dashed');
      return;
    }
    const step = (pr.high - pr.low) / pr.bins;
    let max = 0;
    for (let i = 0; i < pr.bins; i++) max = Math.max(max, pr.volume[i]);
    const width = (x1 - x0) * 0.7;
    const yTop = rc.y(pr.high), yBot = rc.y(pr.low);
    rc.ctx.beginPath();
    rc.ctx.rect(crispX(rc, d, x0, 1), Math.min(yTop, yBot), crispX(rc, d, x1, 1) - crispX(rc, d, x0, 1), Math.abs(yBot - yTop));
    guide(rc, d, color, extra, 0.35);
    for (let i = 0; i < pr.bins; i++) {
      const ya = rc.y(pr.low + i * step), yb = rc.y(pr.low + (i + 1) * step);
      const h = Math.abs(ya - yb);
      const w = max > 0 ? (pr.volume[i] / max) * width : 0;
      rc.ctx.fillStyle = alpha(color, i >= pr.vaLow && i <= pr.vaHigh ? 0.32 : 0.14);
      rc.ctx.fillRect(x0, Math.min(ya, yb) + (h > 3 ? 0.5 : 0), w, Math.max(1, h - (h > 3 ? 1 : 0)));
    }
    const yPoc = crispY(rc, d, rc.y(pr.low + (pr.poc + 0.5) * step));
    rc.ctx.beginPath();
    rc.ctx.moveTo(x0, yPoc); rc.ctx.lineTo(x1, yPoc);
    stroke(rc, d, color, extra);
  },
  labels(rc, d, [a, b]) {
    if (!ok([a, b], 2) || !rc.bars) return;
    const pr = profileOf(d, rc.bars);
    if (!pr) return;
    const step = (pr.high - pr.low) / pr.bins;
    const price = pr.low + (pr.poc + 0.5) * step;
    label(rc, `${pr.weighted ? 'POC' : 'POC, no volume: bar count'} ${rc.fmt(price)}`, Math.max(a.x, b.x) - 4, rc.y(price) - labelPx(rc) / 2 - 6, colorOf(d, rc.colors), 'right');
  },
  hit(d, [a, b], p, tol, view) {
    if (!ok([a, b], 2)) return false;
    const pr = view.bars ? profileOf(d, view.bars) : null;
    if (!pr) return inBox(p, a, b, tol);
    return inBox(p, { x: a.x, y: view.y(pr.high) }, { x: b.x, y: view.y(pr.low) }, tol);
  },
  handles(d, [a, b], view) {
    const pr = view.bars && a && b ? profileOf(d, view.bars) : null;
    if (!pr) return [a, b].filter(Boolean);
    const y = view.y((pr.low + pr.high) / 2);
    return [{ x: a.x, y }, { x: b.x, y }];
  },
};

export const RANGE_TOOLS: readonly ToolDefinition[] = [priceRange, dateRange, datePriceRange, anchoredVwapTool, volumeProfileTool];
