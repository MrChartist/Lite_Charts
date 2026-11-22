import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HeatmapSeries, RoundedCandlesSeries, StackedAreaSeries, WhiskerBoxSeries, boxWidth, cornerRadius, peakPrice } from '../plugins/extras/series';
import type { SeriesDefinition, SeriesDrawScope } from '../series/definition';
import { lightTheme } from '../core/theme';

/** A context that records calls and the extreme points it was given. */
function recorder(): { ctx: CanvasRenderingContext2D; calls: string[]; xs: number[]; ys: number[] } {
  const calls: string[] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  const point = (a: unknown[]): void => { for (let i = 0; i + 1 < a.length; i += 2) { if (typeof a[i] === 'number') xs.push(a[i] as number); if (typeof a[i + 1] === 'number') ys.push(a[i + 1] as number); } };
  const ctx = new Proxy({}, {
    get: (_t, k: string) => (...a: unknown[]) => {
      calls.push(k);
      if (['moveTo', 'lineTo', 'rect', 'fillRect', 'arcTo'].includes(k)) point(a);
    },
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls, xs, ys };
}

function scopeFor<R extends { time: number | string }, O>(def: SeriesDefinition<never, never>, rows: (R | null)[], options: O): { s: SeriesDrawScope<never, never>; rec: ReturnType<typeof recorder> } {
  const rec = recorder();
  const s = {
    ctx: rec.ctx, pixelRatio: 1, rows, from: 0, to: rows.length - 1, barSpacing: 12,
    x: (i: number) => 20 + i * 12, y: (p: number) => 300 - p * 2,
    options: { ...(def.defaults as object), ...(options as object), priceScaleId: 'right', visible: true, lastValueVisible: true, priceLineVisible: true, priceFormat: { precision: 2, minMove: 0.01 }, title: '' },
    colors: lightTheme, pane: { x: 0, y: 0, width: 400, height: 300 },
  } as unknown as SeriesDrawScope<never, never>;
  return { s, rec };
}

const T = (n: number): string => `2026-01-${String(n).padStart(2, '0')}`;

describe('stacked area', () => {
  it('copies rows, sums them, and rejects bad rows naming the field', () => {
    const r = StackedAreaSeries.normalize({ time: T(2), values: [1, 2, 3] });
    expect(r).toMatchObject({ values: [1, 2, 3], value: 6 });
    expect(StackedAreaSeries.normalize({ time: T(2) })).toBeNull();
    expect(() => StackedAreaSeries.normalize({ time: T(2), values: [] })).toThrow(/values/);
    expect(() => StackedAreaSeries.normalize({ time: T(2), values: [1, -1] })).toThrow(/values/);
    expect(() => StackedAreaSeries.normalize({ time: T(2), values: [1, NaN] })).toThrow(/values/);
    const input = [1, 2];
    const copy = StackedAreaSeries.normalize({ time: T(2), values: input }) as unknown as { values: number[] };
    input[0] = 99;
    expect(copy.values[0]).toBe(1);
  });
  it('autoscale runs from 0 to the total; the value is the total', () => {
    const r = StackedAreaSeries.normalize({ time: T(2), values: [4, 6] }) as never;
    expect(StackedAreaSeries.low(r)).toBe(0);
    expect(StackedAreaSeries.high(r)).toBe(10);
    expect(StackedAreaSeries.value(r)).toBe(10);
  });
  it('draws one fill and one edge per layer inside the pane and skips whitespace', () => {
    const rows = [1, 2, 3, 4, 5].map(i => StackedAreaSeries.normalize({ time: T(i), values: [i, i * 2, 3] })) as never[];
    const { s, rec } = scopeFor(StackedAreaSeries as never, rows, {});
    StackedAreaSeries.draw(s as never);
    expect(rec.calls.filter(c => c === 'fill')).toHaveLength(3);
    expect(rec.calls.filter(c => c === 'stroke')).toHaveLength(3);
    expect(rec.ys.every(Number.isFinite)).toBe(true);
    const gap = [rows[0], rows[1], null, rows[3], rows[4]];
    const g = scopeFor(StackedAreaSeries as never, gap as never, {});
    StackedAreaSeries.draw(g.s as never);
    expect(g.rec.calls.filter(c => c === 'fill')).toHaveLength(6);
  });
});

describe('heatmap', () => {
  it('validates rows, clamps intensity and finds the peak', () => {
    const r = HeatmapSeries.normalize({ time: T(2), low: 100, step: 0.5, cells: [0, 0.3, 1.4, -2] }) as unknown as { cells: number[]; value: number };
    expect(r.cells).toEqual([0, 0.3, 1, 0]);
    expect(r.value).toBe(101.25);
    expect(peakPrice({ low: 10, step: 2, cells: [0.1, 0.9, 0.9] })).toBe(13);
    expect(HeatmapSeries.normalize({ time: T(2) })).toBeNull();
    expect(() => HeatmapSeries.normalize({ time: T(2), low: 1, step: 0, cells: [1] })).toThrow(/step/);
    expect(() => HeatmapSeries.normalize({ time: T(2), low: 1, step: 1, cells: [] })).toThrow(/cells/);
    expect(() => HeatmapSeries.normalize({ time: T(2), low: NaN, step: 1, cells: [1] })).toThrow(/low/);
  });
  it('autoscale spans the buckets; drawing skips cells under the floor', () => {
    const rows = [1, 2, 3].map(i => HeatmapSeries.normalize({ time: T(i), low: 100, step: 1, cells: [0, 0.5, 1, 0.01] })) as never[];
    expect(HeatmapSeries.low(rows[0])).toBe(100);
    expect(HeatmapSeries.high(rows[0])).toBe(104);
    const { s, rec } = scopeFor(HeatmapSeries as never, rows, {});
    HeatmapSeries.draw(s as never);
    expect(rec.calls.filter(c => c === 'fillRect')).toHaveLength(6);
  });
});

describe('rounded candles', () => {
  const row = (i: number, o: number, c: number): never => RoundedCandlesSeries.normalize({ time: T(i), open: o, high: Math.max(o, c) + 1, low: Math.min(o, c) - 1, close: c }) as never;
  it('reuses the candlestick rows and autoscale', () => {
    const r = row(2, 10, 12) as { high: number; low: number };
    expect(RoundedCandlesSeries.high(r as never)).toBe(r.high);
    expect(RoundedCandlesSeries.low(r as never)).toBe(r.low);
    expect(RoundedCandlesSeries.type).toBe('rounded-candles');
    expect(RoundedCandlesSeries.defaults).toMatchObject({ wickVisible: true, radius: 0.5 });
  });
  it('clamps the radius to half the body width and half its height', () => {
    expect(cornerRadius(0.5, 10, 40)).toBe(2.5);
    expect(cornerRadius(1, 10, 40)).toBe(5);
    expect(cornerRadius(1, 10, 4)).toBe(2);
    expect(cornerRadius(0, 10, 40)).toBe(0);
  });
  it('draws rounded bodies when wide, and hands narrow bars to the built-in painter', () => {
    const rows = [row(1, 10, 12), row(2, 12, 11), row(3, 11, 14)];
    const wide = scopeFor(RoundedCandlesSeries as never, rows, {});
    RoundedCandlesSeries.draw(wide.s as never);
    expect(wide.rec.calls).toContain('arcTo');
    const narrow = scopeFor(RoundedCandlesSeries as never, rows, {});
    (narrow.s as { barSpacing: number }).barSpacing = 4;
    RoundedCandlesSeries.draw(narrow.s as never);
    expect(narrow.rec.calls).not.toContain('arcTo');
  });
});

describe('whisker box', () => {
  it('needs five ordered numbers and names the bad one', () => {
    expect(WhiskerBoxSeries.normalize({ time: T(2), min: 1, q1: 2, median: 3, q3: 4, max: 5 })).toMatchObject({ median: 3 });
    expect(WhiskerBoxSeries.normalize({ time: T(2) })).toBeNull();
    expect(() => WhiskerBoxSeries.normalize({ time: T(2), min: 1, q1: 2, median: 'x', q3: 4, max: 5 })).toThrow(/"median"/);
    expect(() => WhiskerBoxSeries.normalize({ time: T(2), min: 1, q1: 5, median: 3, q3: 4, max: 5 })).toThrow(/min <= q1/);
  });
  it('autoscale covers the whiskers and the value is the median', () => {
    const r = WhiskerBoxSeries.normalize({ time: T(2), min: 1, q1: 2, median: 3, q3: 4, max: 9 }) as never;
    expect(WhiskerBoxSeries.low(r)).toBe(1);
    expect(WhiskerBoxSeries.high(r)).toBe(9);
    expect(WhiskerBoxSeries.value(r)).toBe(3);
  });
  it('box width is odd and bounded; drawing stays inside the pane', () => {
    expect([2, 10, 20, 200].map(boxWidth)).toEqual([3, 7, 13, 41]);
    const rows = [1, 2, 3].map(i => WhiskerBoxSeries.normalize({ time: T(i), min: i, q1: i + 1, median: i + 2, q3: i + 3, max: i + 5 })) as never[];
    const { s, rec } = scopeFor(WhiskerBoxSeries as never, rows, {});
    WhiskerBoxSeries.draw(s as never);
    expect(rec.calls.filter(c => c === 'stroke')).toHaveLength(2);
    expect(rec.xs.every(x => x >= 0 && x <= 400)).toBe(true);
  });
});

// ── source hygiene of the whole extras folder ──

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'plugins', 'extras');
function walk(d: string): string[] {
  return readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(d, e.name)) : /\.ts$/.test(e.name) ? [join(d, e.name)] : []));
}

describe('extras source rules', () => {
  const files = walk(dir);
  const code = (f: string): string => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  it('finds the files', () => { expect(files.length).toBeGreaterThan(12); });
  it('never writes markup or inline style markup, never uses a notification or storage API', () => {
    const bad: string[] = [];
    const rules: [RegExp, string][] = [
      [/\.(innerHTML|outerHTML)\b|insertAdjacentHTML|document\.write/, 'markup'],
      [/cssText|setAttribute\(\s*['"]style['"]/, 'inline style markup'],
      [/\bNotification\b|serviceWorker|localStorage|sessionStorage|indexedDB/, 'browser API outside the chart'],
      [/\beval\(|new Function\(/, 'eval'],
    ];
    for (const f of files) for (const [re, why] of rules) if (re.test(code(f))) bad.push(`${relative(dir, f)}: ${why}`);
    expect(bad).toEqual([]);
  });
  it('uses no purple colour (hue 255-320 degrees at real saturation) in any hex literal', () => {
    const bad: string[] = [];
    for (const f of files) {
      for (const m of readFileSync(f, 'utf8').matchAll(/#([0-9a-fA-F]{6})\b/g)) {
        const n = parseInt(m[1], 16);
        const r = (n >> 16) / 255; const g = ((n >> 8) & 255) / 255; const b = (n & 255) / 255;
        const max = Math.max(r, g, b); const min = Math.min(r, g, b); const d = max - min;
        if (d < 0.12) continue;
        let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
        h = (h * 60 + 360) % 360;
        if (h >= 255 && h <= 320) bad.push(`${relative(dir, f)} ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });
  it('text is never set under 12px', () => {
    const bad: string[] = [];
    for (const f of files) for (const m of code(f).matchAll(/(?:font(?:-size)?|font:)[^;\n]*?['"`:]\s*[^'"`]*?\b(\d+(?:\.\d+)?)px/g)) {
      if (Number(m[1]) < 12 && /font/.test(m[0])) bad.push(`${relative(dir, f)}: ${m[0]}`);
    }
    expect(bad).toEqual([]);
  });
});
