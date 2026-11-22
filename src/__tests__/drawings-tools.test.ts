// The tool contract and the tools added on 2026-11-22: hand-checked geometry and hit tests of every new tool, a render
// smoke test of all of them on a recording canvas, JSON migration from version 1, the `tools` subset option, and the
// pre-release review fixes of the controller (limits, ids, append, panes, persistence, touch).
import { describe, expect, it } from 'vitest';
import type { ChartPointerEvent, ChartPointerHandler } from '../api';
import { lightTheme } from '../core/theme';
import { createDrawingTools, drawingsFromJSON, drawingsToJSON, LIMITS, normalizeSpec, VERSION } from '../drawings/controller';
import type { BarAccess, Drawing, Proj, RenderCtx, ToolDefinition, View } from '../drawings/contract';
import { BODY, groupsFor, hitWith, plainView } from '../drawings/engine';
import { arcThrough, capPoints, chunkBoxes, distToPolylineChunked, rotatedRectCorners, sampleBezier } from '../drawings/geometry';
import { ALL_TOOLS } from '../drawings/tools/all';
import { BASIC_TOOLS } from '../drawings/tools/basic';
import { leastSquares, pitchforkLines } from '../drawings/tools/channels';
import { fibExtensionPrices, fibSequence, gannRays, timeZoneXs } from '../drawings/tools/fibonacci';
import { infoText } from '../drawings/tools/lines';
import { anchoredVwap, volumeProfile } from '../drawings/tools/ranges';
import { hitEllipse } from '../drawings/tools/shapes';
import { placeFlyout } from '../drawings/toolbar';

const T = (id: string): ToolDefinition => ALL_TOOLS.find(t => t.id === id) as ToolDefinition;
const rect = { x: 0, y: 0, width: 1000, height: 500 };
const P = (x: number, y: number, l = x / 10): Proj => ({ x, y, l });
const mk = (tool: string, n: number, extra: Partial<Drawing> = {}): Drawing => ({
  id: 'x', tool, points: Array.from({ length: n }, (_, i) => ({ time: 1000 + i * 600, price: 100 + i })), style: { width: 2, dash: 'solid' }, pane: 0, ...extra,
});
const hit = (id: string, pts: Proj[], p: { x: number; y: number }, view: View = plainView(rect), d = mk(id, pts.length)): number => hitWith(T(id), d, pts, p, 6, view);

/** Bars at logical i = row i, time 1000 + 60 i; x = 10 l; y = 500 - price. */
function barsView(rows: { open: number; high: number; low: number; close: number; volume: number | null }[]): View {
  const times = rows.map((_, i) => 1000 + 60 * i);
  const bars: BarAccess = {
    count: rows.length, times, version: Math.random(),
    row: i => ({ time: times[i], ...rows[i] }),
    indexAtOrAfter: t => { const i = times.findIndex(x => x >= t); return i < 0 ? rows.length : i; },
  };
  return { rect, x: l => l * 10, y: p => 500 - p, logical: t => (t - 1000) / 60, bars, measure: t => t.length * 7, fontSize: 12 };
}

describe('catalogue', () => {
  it('53 tools, unique ids, each with a glyph, a name, a group of the rail and a contract that works', () => {
    expect(ALL_TOOLS.length).toBe(53);
    expect(BASIC_TOOLS.length).toBe(15);
    expect(new Set(ALL_TOOLS.map(t => t.id)).size).toBe(53);
    for (const t of ALL_TOOLS) {
      expect(t.icon.length, t.id).toBeGreaterThan(8);
      expect(t.label.length, t.id).toBeGreaterThan(2);
      expect(typeof t.render).toBe('function');
      expect(typeof t.hit).toBe('function');
    }
    // One calm column: seven groups, every tool in exactly one.
    const groups = groupsFor(ALL_TOOLS);
    expect(groups.map(g => g.label)).toEqual(['Lines', 'Channels and pitchforks', 'Fibonacci and Gann', 'Shapes', 'Measure and analysis', 'Positions', 'Annotate']);
    expect(groups.reduce((n, g) => n + g.tools.length, 0)).toBe(53);
    for (const t of BASIC_TOOLS) expect(ALL_TOOLS).toContain(t);
  });

  it('every tool renders, labels, hits and has finite handles on a recording canvas, with and without bars', () => {
    const calls: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (o, k: string) => (k in o ? o[k] : (...a: unknown[]) => { calls.push(k); void a; return { width: 10 }; }),
      set: (o, k: string, v) => { o[k] = v; return true; },
    }) as unknown as CanvasRenderingContext2D;
    const rows = Array.from({ length: 100 }, (_, i) => ({ open: 100 + i, high: 103 + i, low: 98 + i, close: 101 + i, volume: 10 + (i % 7) }));
    for (const withBars of [false, true]) {
      const view = withBars ? barsView(rows) : plainView(rect);
      const rc = { ...view, ctx, colors: lightTheme, ratio: 2, fontFamily: 'sans-serif', fmt: (p: number) => p.toFixed(2), text: () => calls.push('text') } as RenderCtx;
      for (const t of ALL_TOOLS) {
        const n = t.points === 0 ? 12 : t.open ? 5 : t.points;
        const d = mk(t.id, n, { text: 'Note', options: t.readOptions?.(t.defaults) });
        if (t.complete) d.points = t.complete(d.points);
        const pts = d.points.map((p, i) => P(100 + i * 80, 250 - (i % 2 ? 60 : 0) - i * 10, (p.time - 1000) / 60));
        expect(() => { t.render(rc, d, pts, 0); t.labels?.(rc, d, pts); }, t.id).not.toThrow();
        const hs = t.handles ? t.handles(d, pts, view) : pts;
        for (const h of hs) expect(Number.isFinite(h.x) && Number.isFinite(h.y), `${t.id} handle`).toBe(true);
        expect(typeof t.hit(d, pts, { x: 500, y: 250 }, 6, view)).toBe('boolean');
      }
    }
    expect(calls.length).toBeGreaterThan(500);
  });
});

describe('lines', () => {
  it('info line reads change, percent, bars, time and screen angle', () => {
    const d = { points: [{ time: 0, price: 100 }, { time: 600, price: 110 }] };
    const { text, dir } = infoText(d, P(0, 400, 0), P(100, 390, 10), p => p.toFixed(2));
    expect(dir).toBe(1);
    expect(text).toBe('▲ +10.00 (+10.00%)  10 bars, 10m  6°');
    expect(hit('infoLine', [P(0, 400), P(100, 390)], { x: 50, y: 396 })).toBe(BODY);
  });
  it('cross line hits on either line; horizontal segment keeps one price and its span', () => {
    expect(hit('crossLine', [P(300, 200)], { x: 900, y: 203 })).toBe(BODY);
    expect(hit('crossLine', [P(300, 200)], { x: 302, y: 20 })).toBe(BODY);
    expect(hit('crossLine', [P(300, 200)], { x: 400, y: 300 })).toBe(-1);
    const hs = T('horizontalSegment');
    expect(hs.complete?.([{ time: 1, price: 5 }, { time: 2, price: 9 }])).toEqual([{ time: 1, price: 5 }, { time: 2, price: 5 }]);
    expect(hs.moveHandle?.([{ time: 1, price: 5 }, { time: 2, price: 5 }], 1, { time: 3, price: 8 })).toEqual([{ time: 1, price: 5 }, { time: 3, price: 5 }]);
    expect(hit('horizontalSegment', [P(100, 200), P(300, 200)], { x: 200, y: 204 })).toBe(BODY);
    expect(hit('horizontalSegment', [P(100, 200), P(300, 200)], { x: 400, y: 200 })).toBe(-1);
    expect(hit('trendAngle', [P(100, 300), P(300, 100)], { x: 200, y: 200 })).toBe(BODY);
  });
});

describe('channels and pitchforks', () => {
  it('least squares through exact points; the regression channel spans the bars between its anchors', () => {
    expect(leastSquares([0, 1, 2], [1, 3, 5])).toEqual({ slope: 2, intercept: 1, sd: 0, n: 3 });
    const r = leastSquares([0, 1, 2, 3], [0, 2, 0, 2]) as { slope: number; intercept: number; sd: number };
    expect(r.slope).toBeCloseTo(0.4);
    expect(r.intercept).toBeCloseTo(0.4);
    // Closes 100 + i: the centre is the closes themselves; sd 0, so the body is the centre line.
    const view = barsView(Array.from({ length: 50 }, (_, i) => ({ open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i, volume: 1 })));
    const d = { ...mk('regression', 2), points: [{ time: 1000 + 60 * 10, price: 0 }, { time: 1000 + 60 * 30, price: 0 }], options: { deviations: 2 } };
    const pts = [P(100, 0, 10), P(300, 0, 30)];
    const hs = T('regression').handles?.(d, pts, view) as { x: number; y: number }[];
    expect(hs[0]).toEqual({ x: 100, y: 500 - 110 });
    expect(hs[1]).toEqual({ x: 300, y: 500 - 130 });
    expect(hitWith(T('regression'), d, pts, { x: 200, y: 500 - 120 }, 6, view)).toBe(BODY);
    expect(hitWith(T('regression'), d, pts, { x: 400, y: 500 - 140 }, 6, view)).toBe(-1);
  });
  it('flat and disjoint channels hit inside their area', () => {
    expect(hit('flatChannel', [P(100, 400), P(300, 300), P(200, 100)], { x: 200, y: 200 })).toBe(BODY);
    expect(hit('flatChannel', [P(100, 400), P(300, 300), P(200, 100)], { x: 200, y: 450 })).toBe(-1);
    expect(hit('disjointChannel', [P(100, 100), P(400, 50), P(100, 300), P(400, 400)], { x: 250, y: 200 })).toBe(BODY);
    expect(hit('disjointChannel', [P(100, 100), P(400, 50), P(100, 300), P(400, 400)], { x: 500, y: 200 })).toBe(-1);
  });
  it('pitchfork constructions (hand-worked)', () => {
    const p0 = { x: 0, y: 0 }, p1 = { x: 10, y: -10 }, p2 = { x: 10, y: 10 };
    expect(pitchforkLines('andrews', p0, p1, p2)).toEqual({ origin: { x: 0, y: 0 }, target: { x: 10, y: 0 }, dir: { x: 10, y: 0 }, tines: [p1, p2] });
    expect(pitchforkLines('schiff', p0, p1, p2).origin).toEqual({ x: 0, y: -5 });
    expect(pitchforkLines('modifiedSchiff', p0, p1, p2).origin).toEqual({ x: 5, y: -5 });
    const inside = pitchforkLines('inside', p0, p1, p2);
    expect(inside.origin).toEqual({ x: 5, y: -5 });
    expect(inside.target).toEqual(p2);
    expect(inside.tines).toEqual([p0, p1]);
    // Andrews from (100, 250): tines through (200, 150) and (200, 350), running right; inside the fork is a hit.
    const pts = [P(100, 250), P(200, 150), P(200, 350)];
    expect(hit('pitchfork', pts, { x: 600, y: 250 })).toBe(BODY);
    expect(hit('pitchfork', pts, { x: 600, y: 120 })).toBe(-1);
  });
});

describe('Fibonacci and Gann', () => {
  it('extension prices, the sequence, time zones, Gann rays', () => {
    const e = fibExtensionPrices(100, 110, 105);
    expect(e[0]).toBe(105);
    expect(e[3]).toBe(115);
    expect(e[5]).toBeCloseTo(121.18);
    expect(fibSequence(8)).toEqual([0, 1, 2, 3, 5, 8, 13, 21]);
    expect(timeZoneXs(0, 10, 100)).toEqual([{ f: 0, x: 0 }, { f: 1, x: 10 }, { f: 2, x: 20 }, { f: 3, x: 30 }, { f: 5, x: 50 }, { f: 8, x: 80 }]);
    const g = gannRays({ x: 0, y: 100 }, { x: 100, y: 0 });
    expect(g.find(r => r.label === '1x1')?.to).toEqual({ x: 100, y: 0 });
    expect(g.find(r => r.label === '1x2')?.to).toEqual({ x: 100, y: 50 });
    expect(g.find(r => r.label === '2x1')?.to).toEqual({ x: 50, y: 0 });
  });
  it('fan, speed fan, arcs, time zones, Gann fan and box hit tests', () => {
    // Fan from (100, 400) to (300, 200): the 0.5 ray passes (300, 300) and (500, 200).
    expect(hit('fibFan', [P(100, 400), P(300, 200)], { x: 500, y: 200 })).toBe(BODY);
    expect(hit('fibFan', [P(100, 400), P(300, 200)], { x: 150, y: 250 })).toBe(-1);
    expect(hit('fibSpeedFan', [P(100, 400), P(400, 100)], { x: 400, y: 300 })).toBe(BODY); // the 1/3 ray
    // Arcs around (100, 300), b at (300, 300): the 0.5 arc has radius 100.
    expect(hit('fibArcs', [P(100, 300), P(300, 300)], { x: 100 + 100 * Math.cos(0.5), y: 300 + 100 * Math.sin(0.5) })).toBe(BODY);
    expect(hit('fibArcs', [P(100, 300), P(300, 300)], { x: 0, y: 300 })).toBe(-1); // behind the start: arcs face b
    expect(hit('fibTimeZones', [P(100, 300), P(120, 300)], { x: 160, y: 30 })).toBe(BODY); // the 3 line
    expect(hit('fibTimeZones', [P(100, 300), P(120, 300)], { x: 170, y: 30 })).toBe(-1);
    expect(hit('gannFan', [P(100, 400), P(200, 300)], { x: 300, y: 350 })).toBe(BODY); // 1x2 runs through (200, 350)
    expect(hit('gannBox', [P(100, 400), P(200, 300)], { x: 150, y: 350 })).toBe(BODY);
    // Editable levels: a retracement with levels [0, 0.5, 1, 1.618] reaches 1.618 of the move.
    const d = mk('fib', 2, { options: { levels: [0, 0.5, 1, 1.618] } });
    // Level 0 at the end (y 300), 1 at the start (y 400), 1.618 beyond it at y 461.8.
    expect(hitWith(T('fib'), d, [P(100, 400), P(300, 300)], { x: 200, y: 455 }, 6, plainView(rect))).toBe(BODY);
    expect(hitWith(T('fib'), d, [P(100, 400), P(300, 300)], { x: 200, y: 475 }, 6, plainView(rect))).toBe(-1);
    expect(hitWith(T('fib'), mk('fib', 2), [P(100, 400), P(300, 300)], { x: 200, y: 455 }, 6, plainView(rect))).toBe(-1);
    expect(T('fib').readOptions?.({ levels: [1, 'x', 0.5, 0.5, 99] })).toEqual({ levels: [0.5, 1] });
  });
});

describe('shapes', () => {
  it('ellipse, triangle, rotated rectangle, path, arc and curve geometry', () => {
    expect(hitEllipse({ x: 0, y: 0 }, { x: 200, y: 100 }, { x: 100, y: 50 }, 0)).toBe(true);
    expect(hitEllipse({ x: 0, y: 0 }, { x: 200, y: 100 }, { x: 5, y: 5 }, 0)).toBe(false);
    expect(hit('triangle', [P(100, 400), P(200, 200), P(300, 400)], { x: 200, y: 350 })).toBe(BODY);
    expect(hit('triangle', [P(100, 400), P(200, 200), P(300, 400)], { x: 120, y: 250 })).toBe(-1);
    expect(rotatedRectCorners({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 5 })).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }]);
    const rr = T('rotatedRectangle').handles?.(mk('rotatedRectangle', 3), [P(0, 0), P(100, 0), P(30, 50)], plainView(rect));
    expect(rr?.[2]).toEqual({ x: 50, y: 50 });
    const arc = arcThrough({ x: -10, y: 0 }, { x: 0, y: -10 }, { x: 10, y: 0 });
    for (const q of arc) expect(Math.hypot(q.x, q.y)).toBeCloseTo(10);
    expect(arc.some(q => Math.abs(q.x) < 1 && q.y < -9.9)).toBe(true);
    expect(sampleBezier({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }, 2)[1]).toEqual({ x: 5, y: 5 });
    expect(hit('curve', [P(100, 300), P(300, 300), P(200, 100)], { x: 200, y: 200 })).toBe(BODY);
    // Through (100, 300), (200, 200), (300, 300): the circle around (200, 300) of radius 100.
    expect(hit('arc', [P(100, 300), P(300, 300), P(200, 200)], { x: 200 + 100 * Math.SQRT1_2, y: 300 - 100 * Math.SQRT1_2 })).toBe(BODY);
    expect(hit('arc', [P(100, 300), P(300, 300), P(200, 200)], { x: 200, y: 300 })).toBe(-1);
    expect(hit('polyline', [P(0, 0), P(100, 100), P(200, 0)], { x: 150, y: 50 })).toBe(BODY);
  });
});

describe('ranges and analysis', () => {
  it('range tools hit their box', () => {
    for (const id of ['priceRange', 'dateRange', 'datePriceRange']) {
      expect(hit(id, [P(100, 300), P(300, 100)], { x: 200, y: 200 })).toBe(BODY);
      expect(hit(id, [P(100, 300), P(300, 100)], { x: 400, y: 200 })).toBe(-1);
    }
  });
  it('anchored VWAP from the anchor bar (typical price, volume-weighted; time-weighted without volume)', () => {
    const v = barsView([
      { open: 9, high: 11, low: 9, close: 10, volume: 5 }, // before the anchor
      { open: 10, high: 12, low: 8, close: 10, volume: 1 }, // tp 10
      { open: 20, high: 22, low: 18, close: 20, volume: 1 }, // tp 20
      { open: 30, high: 32, low: 28, close: 30, volume: 2 }, // tp 30
    ]);
    const s = anchoredVwap(v.bars as BarAccess, 1060);
    expect(s?.from).toBe(1);
    expect([...(s?.vwap ?? [])]).toEqual([10, 15, 22.5]);
    expect(s?.weighted).toBe(true);
    expect(s?.sd[1]).toBeCloseTo(5);
    const nv = barsView([{ open: 1, high: 1, low: 1, close: 1, volume: null }, { open: 3, high: 3, low: 3, close: 3, volume: null }]);
    const t = anchoredVwap(nv.bars as BarAccess, 0);
    expect([...(t?.vwap ?? [])]).toEqual([1, 2]);
    expect(t?.weighted).toBe(false);
    // The line runs through the VWAP of each bar on screen; a press on it is a hit.
    const d = { ...mk('anchoredVwap', 1), points: [{ time: 1060, price: 0 }], options: { bands: [] } };
    expect(hitWith(T('anchoredVwap'), d, [P(10, 490, 1)], { x: 25, y: 500 - 17.5 }, 6, v)).toBe(BODY);
  });
  it('volume profile: volume spread over each bar range, point of control, 70% value area', () => {
    const v = barsView([
      { open: 100, high: 101, low: 100, close: 101, volume: 10 },
      { open: 100, high: 101, low: 100, close: 100, volume: 10 },
      { open: 101, high: 104, low: 100, close: 103, volume: 4 },
    ]);
    const p = volumeProfile(v.bars as BarAccess, 0, 5000, 4);
    expect(p).not.toBeNull();
    const pr = p as NonNullable<typeof p>;
    expect(pr.low).toBe(100);
    expect(pr.high).toBe(104);
    // Bins of 1 from 100: the quiet bars (100 to 101) touch bins 0 and 1 (5 each), the wide one all four (1 each).
    expect([...pr.volume]).toEqual([11, 11, 1, 1]);
    expect(pr.poc).toBe(0);
    expect(pr.vaLow).toBe(0);
    expect(pr.vaHigh).toBe(1); // 22 of 24 passes 70%
  });
});

describe('annotations', () => {
  it('markers, flag, labels, callout, highlighter hit where they are drawn', () => {
    expect(hit('arrowUp', [P(200, 200)], { x: 200, y: 215 })).toBe(BODY);
    expect(hit('arrowUp', [P(200, 200)], { x: 200, y: 180 })).toBe(-1);
    expect(hit('arrowDown', [P(200, 200)], { x: 200, y: 185 })).toBe(BODY);
    expect(hit('flag', [P(200, 200)], { x: 208, y: 180 })).toBe(BODY);
    expect(hit('priceLabel', [P(200, 200)], { x: 200, y: 185 })).toBe(BODY);
    expect(hit('callout', [P(100, 300), P(300, 100)], { x: 200, y: 200 })).toBe(BODY);
    expect(hit('callout', [P(100, 300), P(300, 100)], { x: 300, y: 100 })).toBe(1); // the text box's handle
    expect(hit('priceNote', [P(100, 300), P(300, 100)], { x: 200, y: 200 })).toBe(BODY);
    expect(hit('anchoredText', [P(100, 300)], { x: 130, y: 284 })).toBe(BODY);
    // The highlighter is wide: 12 px at width 2, so it is hit further from its centre than a brush.
    const pts = [P(0, 100), P(200, 100)];
    expect(hitWith(T('highlighter'), mk('highlighter', 2), pts, { x: 100, y: 111 }, 6, plainView(rect))).toBe(BODY);
    expect(hitWith(T('brush'), mk('brush', 2), pts, { x: 100, y: 111 }, 6, plainView(rect))).toBe(-1);
  });
});

describe('JSON version 2 and migration', () => {
  const base = { width: 2 as const, dash: 'solid' as const };
  it('a version 1 export loads: retracements get their levels, long brushes are thinned, ids made unique', () => {
    const v1 = JSON.stringify({
      format: 'chartist-lite-drawings', version: 1, drawings: [
        { id: 'a', tool: 'fib', points: [{ time: 0, price: 1 }, { time: 60, price: 2 }], style: { width: 2, dash: 'solid' }, pane: 0 },
        { id: 'a', tool: 'brush', points: Array.from({ length: 3000 }, (_, i) => ({ time: i, price: Math.sin(i) })), style: { width: 1, dash: 'solid' }, pane: 0 },
      ],
    });
    const back = drawingsFromJSON(v1, base);
    expect(back[0].options).toEqual({ levels: [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] });
    expect(back[1].points.length).toBe(LIMITS.freehandPoints);
    expect(back[1].points[0]).toEqual({ time: 0, price: 0 });
    expect(back[1].points.at(-1)?.time).toBe(2999);
    expect(back[0].id).toBe('a');
    expect(back[1].id).not.toBe('a');
    expect(JSON.parse(drawingsToJSON(back)).version).toBe(VERSION);
    expect(VERSION).toBe(2);
  });
  it('new tools and their options round-trip; the default tool set does not know them', () => {
    const spec = { tool: 'anchoredVwap', points: [{ time: 100, price: 1 }], options: { bands: [1, 2, 9] } };
    expect(() => normalizeSpec(spec, base)).toThrow(/unknown drawing tool/);
    const d = normalizeSpec(spec, base, ALL_TOOLS);
    expect(d.options).toEqual({ bands: [1, 2] });
    expect(drawingsFromJSON(drawingsToJSON([d]), base, ALL_TOOLS)).toEqual([d]);
    expect(drawingsFromJSON(drawingsToJSON([d]), base)).toEqual([]); // skipped by a host that ships BASIC_TOOLS
    expect(capPoints([1, 2, 3, 4, 5], 3)).toEqual([1, 3, 5]);
  });
});

// ── a chart stand-in with panes ──

function fakeChart(paneCount = 1) {
  let handler: ChartPointerHandler | null = null;
  const rows = Array.from({ length: 100 }, (_, i) => ({ time: 1000 + i * 60, open: 100 + i, high: 105 + i, low: 95 + i, close: 102 + i }));
  const cursors: (string | null)[] = [];
  const mkSeries = (pane: number) => {
    const s = {
      pane, removed: false,
      paneIndex: () => (s.removed ? -1 : s.pane),
      priceToCoordinate: (p: number) => 500 - p,
      coordinateToPrice: (y: number) => 500 - y,
      attachPrimitive(p: { attached?: (h: unknown) => void }) { p.attached?.({ requestUpdate() {}, requestOverlay() {}, series: s }); },
      detachPrimitive() {},
      data: () => rows,
      options: () => ({ priceFormat: { precision: 2, minMove: 0.01 } }),
    };
    return s;
  };
  const all = Array.from({ length: paneCount }, (_, i) => mkSeries(i));
  const ts = {
    timeToLogical: (t: number) => (t - 1000) / 60, logicalToTime: (l: number) => 1000 + l * 60,
    logicalToCoordinate: (l: number) => l * 10, coordinateToLogical: (x: number) => x / 10, width: () => 1000,
  };
  const chart = {
    timeScale: () => ts,
    panes: () => all.filter(s => !s.removed).map(s => ({ getHeight: () => 500, getSeries: () => [s] })),
    addPointerHandler(h: ChartPointerHandler) { handler = h; return () => { handler = null; }; },
    setCursor(c: string | null) { cursors.push(c); },
    subscribeCrosshairMove() {},
    unsubscribeCrosshairMove() {},
    /** Remove pane i: its series goes, the panes below move up. */
    removePane(i: number) { const s = all.find(x => x.pane === i && !x.removed); if (s) s.removed = true; for (const x of all) if (!x.removed && x.pane > i) x.pane--; },
  };
  const ev = (x: number, y: number, extra: Partial<ChartPointerEvent> = {}): ChartPointerEvent => ({
    point: { x, y }, paneIndex: 0, logical: x / 10, area: 'pane', pointerType: 'mouse', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...extra,
  });
  return { chart, series: all[0], all, ev, rows, cursors, handler: () => handler as ChartPointerHandler };
}

describe('controller: subset and new tools', () => {
  it('a host ships only the tools it passes; BASIC_TOOLS by default', () => {
    const f = fakeChart();
    const few = createDrawingTools(f.chart as never, f.series as never, { tools: [T('trend'), T('fib')] });
    expect(few.tools().map(t => t.id)).toEqual(['trend', 'fib']);
    expect(() => few.setTool('rectangle')).toThrow(/unknown drawing tool/);
    expect(() => few.add({ tool: 'pitchfork', points: [{ time: 1, price: 1 }, { time: 2, price: 2 }, { time: 3, price: 3 }] })).toThrow(/unknown/);
    few.destroy();
    const def = createDrawingTools(f.chart as never, f.series as never);
    expect(def.tools()).toBe(BASIC_TOOLS);
    def.destroy();
  });

  it('a path takes clicks until a double click (or Enter); a pitchfork takes three clicks', () => {
    const f = fakeChart();
    const tools = createDrawingTools(f.chart as never, f.series as never, { tools: ALL_TOOLS, magnet: false });
    const h = f.handler();
    tools.setTool('polyline');
    for (const [x, y] of [[100, 300], [200, 200], [300, 300], [400, 200]]) { h.pointerDown?.(f.ev(x, y)); h.pointerUp?.(f.ev(x, y), false); }
    expect(tools.drawings().length).toBe(0);
    h.pointerDown?.(f.ev(401, 201)); h.pointerUp?.(f.ev(401, 201), false);
    expect(tools.drawings()[0].points.length).toBe(4);
    tools.setTool('polyline');
    h.pointerDown?.(f.ev(100, 100)); h.pointerUp?.(f.ev(100, 100), false);
    h.pointerDown?.(f.ev(200, 100)); h.pointerUp?.(f.ev(200, 100), false);
    h.keyDown?.({ key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false } as KeyboardEvent);
    expect(tools.drawings()[1].points.length).toBe(2);
    tools.setTool('pitchfork');
    for (const [x, y] of [[100, 300], [200, 200], [300, 300]]) { h.pointerDown?.(f.ev(x, y)); h.pointerUp?.(f.ev(x, y), false); }
    expect(tools.drawings()[2].tool).toBe('pitchfork');
    expect(tools.drawings()[2].points.length).toBe(3);
    // Undo removes it in one step; the style follows the tool (the highlighter's own colour).
    expect(tools.undo()).toBe(true);
    expect(tools.drawings().length).toBe(2);
    expect(tools.add({ tool: 'highlighter', points: [{ time: 1000, price: 1 }, { time: 1600, price: 2 }] }).style.color).toBe('#F5B700');
  });
});

describe('controller: review of 2026-11-22', () => {
  const two = (id?: string) => ({ tool: 'trend', id, points: [{ time: 1000, price: 100 }, { time: 1600, price: 110 }] });

  it('import reassigns duplicate ids; append counts and announces only what it added', () => {
    const f = fakeChart();
    const tools = createDrawingTools(f.chart as never, f.series as never);
    tools.add(two('same'));
    const json = tools.exportJSON();
    const created: string[] = [];
    tools.on('created', d => created.push((d as Drawing).id));
    expect(tools.importJSON(json, 'append')).toBe(1);
    expect(tools.drawings().length).toBe(2);
    expect(created.length).toBe(1);
    expect(created[0]).not.toBe('same');
    const dup = JSON.stringify({ format: 'chartist-lite-drawings', version: 2, drawings: [two('z'), two('z'), two('z')] });
    expect(tools.importJSON(dup)).toBe(3);
    expect(new Set(tools.drawings().map(d => d.id)).size).toBe(3);
  });

  it('limits: drawings per chart, JSON size; an error event says what was left out', () => {
    const f = fakeChart();
    const tools = createDrawingTools(f.chart as never, f.series as never);
    const errors: string[] = [];
    tools.on('error', e => errors.push(e.message));
    const many = JSON.stringify({ format: 'chartist-lite-drawings', version: 2, drawings: Array.from({ length: LIMITS.drawings + 50 }, () => two()) });
    expect(tools.importJSON(many)).toBe(LIMITS.drawings);
    expect(errors[0]).toMatch(/at most 2000 drawings; 50 of the imported/);
    expect(() => tools.add(two())).toThrow(RangeError);
    expect(errors.length).toBe(2);
    expect(tools.importJSON('x'.repeat(LIMITS.jsonChars + 1))).toBe(0);
    expect(errors[2]).toMatch(/limited to/);
    // A huge brush is thinned to the point cap.
    tools.clear();
    const b = tools.add({ tool: 'brush', points: Array.from({ length: 300_000 }, (_, i) => ({ time: 1000 + i, price: 100 + Math.sin(i) })) });
    expect(b.points.length).toBe(LIMITS.freehandPoints);
  });

  it('hover on a long path walks only the chunks near the pointer', () => {
    const pts = Array.from({ length: 2000 }, (_, i) => ({ x: i, y: 100 + (i % 2) }));
    const boxes = chunkBoxes(pts);
    expect(boxes.length).toBe(Math.ceil(1999 / 32));
    expect(distToPolylineChunked({ x: 1500, y: 103 }, pts, boxes, 6)).toBeLessThan(3);
    expect(distToPolylineChunked({ x: 1500, y: 300 }, pts, boxes, 6)).toBe(Infinity); // no chunk near: no segment walked
  });

  it('a selected drawing blocks native touch (drag in any direction); select re-syncs the chart', () => {
    const f = fakeChart();
    const tools = createDrawingTools(f.chart as never, f.series as never);
    const h = f.handler();
    const d = tools.add(two());
    expect(h.blocksTouch?.()).toBe(false);
    const n = f.cursors.length;
    tools.select(d.id);
    expect(h.blocksTouch?.()).toBe(true);
    expect(f.cursors.length).toBeGreaterThan(n); // the chart re-reads blocksTouch() on setCursor
    tools.select(null);
    expect(h.blocksTouch?.()).toBe(false);
  });

  it('drawings stay selectable when a pane above them is removed (panes tracked by series)', () => {
    const f = fakeChart(3);
    const tools = createDrawingTools(f.chart as never, f.series as never, { magnet: false });
    const h = f.handler();
    tools.add({ tool: 'horizontal', points: [{ time: 2000, price: 200 }], pane: 2 });
    expect(h.pointerDown?.(f.ev(500, 300, { paneIndex: 2 }))).toBe(true);
    h.pointerUp?.(f.ev(500, 300, { paneIndex: 2 }), false);
    tools.select(null);
    f.chart.removePane(1);
    expect(h.pointerDown?.(f.ev(500, 300, { paneIndex: 1 }))).toBe(true);
    expect(tools.selected()?.pane).toBe(1);
  });

  it('persistence: foreign data under the key is never overwritten; a full storage is reported', async () => {
    const f = fakeChart();
    const store = new Map<string, string>([['k', '{"some":"other app"}']]);
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
    const tools = createDrawingTools(f.chart as never, f.series as never, { persist: { key: 'k', storage } });
    const errors: string[] = [];
    tools.on('error', e => errors.push(e.message));
    await Promise.resolve();
    expect(errors[0]).toMatch(/left untouched/);
    tools.add(two());
    expect(store.get('k')).toBe('{"some":"other app"}');
    const full = { getItem: () => null, setItem: () => { throw Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError' }); } };
    const t2 = createDrawingTools(f.chart as never, f.series as never, { persist: { key: 'q', storage: full } });
    const e2: string[] = [];
    t2.on('error', e => e2.push(e.message));
    t2.add(two());
    expect(e2[0]).toMatch(/could not be saved under "q": QuotaExceededError/);
  });
});

describe('toolbar placement', () => {
  it('flyouts stay inside the chart: beside the button, up when short of room, flipped, scrolled', () => {
    const btn = { left: 10, top: 300, right: 38, bottom: 328 };
    expect(placeFlyout(btn, { width: 900, height: 600 }, { width: 220, height: 200 }, true)).toEqual({ left: 44, top: 296, width: 220, height: 200 });
    // Short of room below: it opens upwards, ending 4 px above the bottom.
    expect(placeFlyout(btn, { width: 900, height: 400 }, { width: 220, height: 200 }, true).top).toBe(196);
    // A list taller than the chart: the full height minus margins, from the top (it scrolls inside itself).
    expect(placeFlyout(btn, { width: 900, height: 220 }, { width: 220, height: 400 }, true)).toEqual({ left: 44, top: 4, width: 220, height: 212 });
    // A button at the right edge: flipped to its left. A 260 px chart: the width shrinks to fit.
    expect(placeFlyout({ left: 800, top: 10, right: 828, bottom: 38 }, { width: 900, height: 600 }, { width: 220, height: 100 }, true).left).toBe(574);
    const tiny = placeFlyout({ left: 10, top: 10, right: 38, bottom: 38 }, { width: 260, height: 220 }, { width: 300, height: 500 }, true);
    expect(tiny.left + tiny.width).toBeLessThanOrEqual(256);
    expect(tiny.top + tiny.height).toBeLessThanOrEqual(216);
  });
});
