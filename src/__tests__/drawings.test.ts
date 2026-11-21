// Drawing tools: geometry, hit testing, snapping, JSON round trip, undo / redo, creation by pointer (with a fake chart:
// a straight time and price mapping, so every expected number can be worked out by hand).
import { describe, expect, it } from 'vitest';
import type { ChartPointerEvent, ChartPointerHandler } from '../api';
import { createDrawingTools, drawingsFromJSON, drawingsToJSON, normalizeSpec } from '../drawings/controller';
import { arrowHead, clipLine, constrainAngle, distToSegment, fibPrices, formatSpan, measureStats, nearestOhlc, positionStats, simplifyPath } from '../drawings/geometry';
import { BODY, hitDrawing, type Drawing } from '../drawings/tools';

describe('geometry', () => {
  it('distance to a segment, clipped lines', () => {
    expect(distToSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(distToSegment({ x: -3, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    const r = { x: 0, y: 0, width: 100, height: 100 };
    expect(clipLine({ x: 10, y: 10 }, { x: 20, y: 20 }, r, 'segment')).toEqual([{ x: 10, y: 10 }, { x: 20, y: 20 }]);
    expect(clipLine({ x: 10, y: 10 }, { x: 20, y: 20 }, r, 'ray')).toEqual([{ x: 10, y: 10 }, { x: 100, y: 100 }]);
    expect(clipLine({ x: 10, y: 10 }, { x: 20, y: 20 }, r, 'extended')).toEqual([{ x: 0, y: 0 }, { x: 100, y: 100 }]);
    expect(clipLine({ x: 200, y: 10 }, { x: 300, y: 10 }, r, 'segment')).toBeNull();
  });

  it('simplifies a path, keeps its ends and corners', () => {
    const pts = [{ x: 0, y: 0 }, { x: 1, y: 0.1 }, { x: 2, y: -0.1 }, { x: 3, y: 0 }, { x: 3, y: 10 }];
    const s = simplifyPath(pts, 0.5);
    expect(s[0]).toEqual(pts[0]);
    expect(s[s.length - 1]).toEqual(pts[4]);
    expect(s).toContainEqual({ x: 3, y: 0 });
    expect(s.length).toBe(3);
  });

  it('arrow head, angle constraint', () => {
    const h = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 10) as { x: number; y: number }[];
    expect(h[1]).toEqual({ x: 100, y: 0 });
    expect(h[0].x).toBeCloseTo(90);
    expect(Math.abs(h[0].y)).toBeCloseTo(5);
    expect(constrainAngle({ x: 0, y: 0 }, { x: 10, y: 1 })).toEqual({ x: 10, y: 0 });
    const d = constrainAngle({ x: 0, y: 0 }, { x: 10, y: 9 });
    expect(d.x).toBeCloseTo(d.y);
    expect(constrainAngle({ x: 0, y: 0 }, { x: 1, y: 10 }).x).toBeCloseTo(0);
  });

  it('fibonacci, measure, position, spans, magnet', () => {
    expect(fibPrices(100, 200)).toEqual([200, 176.4, 161.8, 150, 138.2, 121.39999999999999, 100]);
    const m = measureStats({ logical: 10, price: 100, time: 0 }, { logical: 22, price: 95, time: 3 * 86400 + 4 * 3600 });
    expect(m).toEqual({ change: -5, percent: -5, bars: 12, seconds: 273600, dir: -1 });
    expect(formatSpan(m.seconds)).toBe('3d 4h');
    expect(formatSpan(45 * 60)).toBe('45m');
    expect(positionStats(100, 110, 95)).toEqual({ reward: 10, risk: 5, ratio: 2, targetPct: 10, stopPct: -5 });
    expect(nearestOhlc({ open: 10, high: 12, low: 9, close: 11 }, 11.8)).toBe(12);
    expect(nearestOhlc({ value: 5 }, 7)).toBe(5);
    expect(nearestOhlc(null, 7)).toBe(7);
  });
});

describe('hit testing', () => {
  const rect = { x: 0, y: 0, width: 1000, height: 500 };
  const mk = (tool: Drawing['tool'], n = 2): Drawing => ({ id: 'x', tool, points: Array.from({ length: n }, () => ({ time: 0, price: 0 })), style: { width: 2, dash: 'solid' }, pane: 0 });
  it('lines, handles, horizontal lines, boxes', () => {
    const pts = [{ x: 100, y: 100, l: 10 }, { x: 300, y: 300, l: 30 }];
    expect(hitDrawing(mk('trend'), pts, { x: 200, y: 203 }, 6, rect)).toBe(BODY);
    expect(hitDrawing(mk('trend'), pts, { x: 200, y: 220 }, 6, rect)).toBe(-1);
    expect(hitDrawing(mk('trend'), pts, { x: 102, y: 99 }, 6, rect)).toBe(0);
    expect(hitDrawing(mk('trend'), pts, { x: 400, y: 400 }, 6, rect)).toBe(-1);
    expect(hitDrawing(mk('ray'), pts, { x: 400, y: 400 }, 6, rect)).toBe(BODY);
    expect(hitDrawing(mk('horizontal', 1), [{ x: 500, y: 250, l: 50 }], { x: 10, y: 254 }, 6, rect)).toBe(BODY);
    expect(hitDrawing(mk('horizontalRay', 1), [{ x: 500, y: 250, l: 50 }], { x: 10, y: 250 }, 6, rect)).toBe(-1);
    expect(hitDrawing(mk('rectangle'), pts, { x: 150, y: 250 }, 6, rect)).toBe(BODY);
    // Touch tolerance is larger.
    expect(hitDrawing(mk('vertical', 1), [{ x: 500, y: 250, l: 50 }], { x: 512, y: 50 }, 6, rect)).toBe(-1);
    expect(hitDrawing(mk('vertical', 1), [{ x: 500, y: 250, l: 50 }], { x: 512, y: 50 }, 14, rect)).toBe(BODY);
  });
});

describe('JSON', () => {
  const base = { width: 2 as const, dash: 'solid' as const };
  it('round-trips, versioned, times in seconds; bad entries are skipped', () => {
    const a = normalizeSpec({ tool: 'trend', points: [{ time: '2026-01-02', price: 10 }, { time: 1767398400, price: 12 }], style: { color: '#123456' } }, base);
    expect(a.points[0].time).toBe(Date.UTC(2026, 0, 2) / 1000);
    const long = normalizeSpec({ tool: 'long', points: [{ time: 100, price: 100 }, { time: 200, price: 110 }] }, base);
    expect(long.points[2]).toEqual({ time: 200, price: 95 });
    const json = drawingsToJSON([a, long]);
    expect(JSON.parse(json).version).toBe(1);
    const back = drawingsFromJSON(json, base);
    expect(back).toEqual([a, long]);
    const withBad = JSON.stringify({ format: 'chartist-lite-drawings', version: 1, drawings: [{ tool: 'nope', points: [] }, a] });
    expect(drawingsFromJSON(withBad, base).length).toBe(1);
    expect(() => drawingsFromJSON('{"format":"x"}', base)).toThrow(/not a drawings export/);
    expect(() => drawingsFromJSON(JSON.stringify({ format: 'chartist-lite-drawings', version: 99, drawings: [] }), base)).toThrow(/newer/);
    expect(() => normalizeSpec({ tool: 'trend', points: [{ time: 1, price: 1 }] }, base)).toThrow(/needs 2 points/);
  });
});

/** A chart stand-in: logical = (t - 1000) / 60, x = logical * 10, y = 500 - price. */
function fakeChart() {
  let handler: ChartPointerHandler | null = null;
  const rows = Array.from({ length: 100 }, (_, i) => ({ time: 1000 + i * 60, open: 100 + i, high: 105 + i, low: 95 + i, close: 102 + i }));
  const prims: unknown[] = [];
  const series = {
    paneIndex: () => 0,
    priceToCoordinate: (p: number) => 500 - p,
    coordinateToPrice: (y: number) => 500 - y,
    attachPrimitive(p: { attached?: (h: unknown) => void }) { prims.push(p); p.attached?.({ requestUpdate() {}, requestOverlay() {}, series }); },
    detachPrimitive() {},
    data: () => rows,
    options: () => ({ priceFormat: { precision: 2, minMove: 0.01 } }),
  };
  const ts = {
    timeToLogical: (t: number) => (t - 1000) / 60, logicalToTime: (l: number) => 1000 + l * 60,
    logicalToCoordinate: (l: number) => l * 10, coordinateToLogical: (x: number) => x / 10, width: () => 1000,
  };
  const chart = {
    timeScale: () => ts,
    panes: () => [{ getHeight: () => 500, getSeries: () => [series] }],
    addPointerHandler(h: ChartPointerHandler) { handler = h; return () => { handler = null; }; },
    setCursor() {},
    subscribeCrosshairMove() {},
    unsubscribeCrosshairMove() {},
  };
  const ev = (x: number, y: number, extra: Partial<ChartPointerEvent> = {}): ChartPointerEvent => ({
    point: { x, y }, paneIndex: 0, logical: x / 10, area: 'pane', pointerType: 'mouse', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...extra,
  });
  return { chart, series, ev, rows, handler: () => handler as ChartPointerHandler, prims };
}

describe('controller', () => {
  it('creates by click-click and by press-drag-release, returns to the cursor, snaps with the magnet', () => {
    const f = fakeChart();
    const tools = createDrawingTools(f.chart as never, f.series as never, { magnet: true });
    const created: unknown[] = [];
    tools.on('created', d => created.push(d));
    tools.setTool('trend');
    const h = f.handler();
    // Click at bar 10 near its high (115), click at bar 20 near its low (115).
    expect(h.pointerDown?.(f.ev(100, 500 - 114))).toBe(true);
    h.pointerUp?.(f.ev(100, 500 - 114), false);
    h.hover?.(f.ev(150, 300));
    h.pointerDown?.(f.ev(200, 500 - 116));
    h.pointerUp?.(f.ev(200, 500 - 116), false);
    const [d] = tools.drawings();
    expect(d.tool).toBe('trend');
    expect(d.points).toEqual([{ time: 1600, price: 115 }, { time: 2200, price: 115 }]);
    expect(tools.tool()).toBe(null);
    expect(created.length).toBe(1);
    // Press-drag-release, magnet off with ctrl held.
    tools.setTool('rectangle');
    h.pointerDown?.(f.ev(300, 200, { ctrlKey: true }));
    h.pointerMove?.(f.ev(350, 180, { ctrlKey: true }));
    h.pointerUp?.(f.ev(400, 150, { ctrlKey: true }), false);
    const r = tools.drawings()[1];
    expect(r.tool).toBe('rectangle');
    expect(r.points[0]).toEqual({ time: 1000 + 30 * 60, price: 300 });
    expect(r.points[1].price).toBe(320);
  });

  it('selects, drags, deletes by key; undo and redo; export and import', () => {
    const f = fakeChart();
    const tools = createDrawingTools(f.chart as never, f.series as never, { magnet: false });
    const h = f.handler();
    tools.add({ tool: 'horizontal', points: [{ time: 2000, price: 200 }] });
    // Press on the line (y = 300), drag down 20 px: the price falls 20.
    expect(h.pointerDown?.(f.ev(500, 301))).toBe(true);
    expect(tools.selected()?.tool).toBe('horizontal');
    h.pointerMove?.(f.ev(500, 311));
    h.pointerMove?.(f.ev(500, 321));
    h.pointerUp?.(f.ev(500, 321), false);
    expect(tools.drawings()[0].points[0].price).toBe(180);
    expect(tools.undo()).toBe(true);
    expect(tools.drawings()[0].points[0].price).toBe(200);
    expect(tools.redo()).toBe(true);
    expect(tools.drawings()[0].points[0].price).toBe(180);
    // A press on empty space deselects and lets the chart pan.
    expect(h.pointerDown?.(f.ev(500, 50))).toBe(false);
    expect(tools.selected()).toBeNull();
    tools.select(tools.drawings()[0].id);
    const key = (k: string, mods: Partial<KeyboardEvent> = {}) => h.keyDown?.({ key: k, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...mods } as KeyboardEvent);
    expect(key('ArrowUp')).toBe(true);
    expect(tools.drawings()[0].points[0].price).toBeCloseTo(180.01);
    const json = tools.exportJSON();
    expect(key('Delete')).toBe(true);
    expect(tools.drawings().length).toBe(0);
    expect(key('z', { ctrlKey: true })).toBe(true);
    expect(tools.drawings().length).toBe(1);
    tools.clear();
    expect(tools.importJSON(json)).toBe(1);
    expect(tools.drawings()[0].points[0].price).toBeCloseTo(180.01);
    // Keyboard-only: Shift + H puts a horizontal line at the last close.
    expect(key('H', { shiftKey: true })).toBe(true);
    expect(tools.drawings().at(-1)?.points[0].price).toBe(f.rows[99].close);
  });

  it('freehand brush is simplified; a channel takes three points; touch lifts the point above the finger', () => {
    const f = fakeChart();
    const tools = createDrawingTools(f.chart as never, f.series as never, { magnet: false });
    const h = f.handler();
    tools.setTool('brush');
    h.pointerDown?.(f.ev(100, 100));
    for (let x = 101; x <= 200; x++) h.pointerMove?.(f.ev(x, 100 + (x % 2) * 0.2));
    h.pointerUp?.(f.ev(200, 100), false);
    const b = tools.drawings()[0];
    expect(b.tool).toBe('brush');
    expect(b.points.length).toBeLessThan(5);
    tools.setTool('channel');
    h.pointerDown?.(f.ev(100, 300)); h.pointerUp?.(f.ev(100, 300), false);
    h.pointerDown?.(f.ev(300, 200)); h.pointerUp?.(f.ev(300, 200), false);
    expect(tools.drawings().length).toBe(1);
    h.pointerDown?.(f.ev(200, 300)); h.pointerUp?.(f.ev(200, 300), false);
    expect(tools.drawings()[1].points.length).toBe(3);
    tools.setTool('horizontal');
    h.pointerDown?.(f.ev(100, 300, { pointerType: 'touch' }));
    expect(tools.drawings()[2].points[0].price).toBe(500 - (300 - 36));
  });
});

describe('toolbar groups and shortcuts', () => {
  it('every tool is in exactly one group; groups are the rail buttons', async () => {
    const { TOOL_GROUPS, TOOLS } = await import('../drawings/tools');
    const all = TOOL_GROUPS.flatMap(g => [...g.tools]);
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual(TOOLS.map(t => t.id).sort());
    expect(TOOL_GROUPS.map(g => g.label)).toEqual(['Lines', 'Shapes', 'Fibonacci', 'Measure', 'Positions', 'Annotate']);
  });

  it('single keys are unique letters that the chart does not use', async () => {
    const { TOOL_KEYS } = await import('../drawings/tools');
    const keys = Object.values(TOOL_KEYS);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[A-Z]$/);
    // The chart's own keys and the drawing keys stay free.
    for (const used of ['+', '-', '=', '_', ' ']) expect(keys).not.toContain(used);
    const { toolTitle } = await import('../drawings/toolbar');
    expect(toolTitle('trend')).toBe('Trend line (T)');
    expect(toolTitle('ray')).toBe('Ray');
  });

  it('a shortcut key arms its tool and the same key disarms it; Shift + H still adds a line', () => {
    const f = fakeChart();
    const tools = createDrawingTools(f.chart as never, f.series as never);
    const key = (k: string, mods: Partial<KeyboardEvent> = {}) => f.handler().keyDown?.({ key: k, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...mods } as KeyboardEvent);
    expect(key('t')).toBe(true);
    expect(tools.tool()).toBe('trend');
    expect(key('f')).toBe(true);
    expect(tools.tool()).toBe('fib');
    expect(key('F')).toBe(true);
    expect(tools.tool()).toBeNull();
    expect(key('q')).toBe(false);
    expect(key('H', { shiftKey: true })).toBe(true);
    expect(tools.drawings()[0].tool).toBe('horizontal');
    expect(tools.tool()).toBeNull();
  });
});
