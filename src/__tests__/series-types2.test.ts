import { describe, expect, it } from 'vitest';
import {
  applyChartType, CHART_TYPES, ColumnSeries, HighLowSeries, HlcAreaSeries, HollowCandlestickSeries, kagi, KagiSeries,
  pointFigure, PointFigureSeries, pointFigureLayout, StepLineSeries, chartType, cleanRows,
} from '../transforms';
import type { ChartTypeId, TransformRow } from '../transforms';
import { isUpBar } from '../series/hollow-candlestick';
import { SeriesModel } from '../series/series-model';
import type { RowBase, SeriesCommonOptions, SeriesDefinition } from '../series/definition';
import { darkTheme, lightTheme } from '../core/theme';
import { deviceWidth } from '../render/pixel';
import { walk } from './transforms-data';

type Call = [string, ...unknown[]];
function recorder(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy({}, {
    get(_t, k: string) { return k in state ? state[k] : (...a: unknown[]): void => { calls.push([k, ...a]); }; },
    set(_t, k: string, v) { state[k] = v; calls.push([`set:${k}`, v]); return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

const common: SeriesCommonOptions = { priceScaleId: 'right', visible: true, lastValueVisible: true, priceLineVisible: true, priceFormat: { precision: 2, minMove: 0.01 }, title: '' };

interface Opts<O> { spacing?: number; ratio?: number; options?: Partial<O>; y?: (p: number) => number; pane?: { x: number; y: number; width: number; height: number } }
function run<R extends RowBase, O extends object>(def: SeriesDefinition<R, O>, rows: (R | null)[], o: Opts<O> = {}): Call[] {
  const { ctx, calls } = recorder();
  const spacing = o.spacing ?? 20;
  def.draw({
    ctx, pixelRatio: o.ratio ?? 1, rows, from: 0, to: rows.length - 1, x: i => 50 + i * spacing, y: o.y ?? (p => 1000 - p * 10),
    barSpacing: spacing, options: { ...def.defaults, ...common, ...o.options } as never, colors: lightTheme,
    pane: o.pane ?? { x: 0, y: 0, width: 2000, height: 1000 },
  });
  return calls;
}
const norm = <R extends RowBase>(def: SeriesDefinition<R, object>, rows: Record<string, unknown>[]): R[] => rows.map(r => def.normalize(r as never) as R);
const named = (calls: Call[], name: string): Call[] => calls.filter(c => c[0] === name);

/** Each drawn group: what was added to the path between beginPath and fill / stroke, with the colour and width then. */
interface Group { kind: 'fill' | 'stroke'; rule?: unknown; color: unknown; width: unknown; rects: number[][]; moves: number[][]; lines: number[][]; ellipses: number[][] }
function groups(calls: Call[]): Group[] {
  const out: Group[] = [];
  let g: Group = { kind: 'fill', color: '', width: 0, rects: [], moves: [], lines: [], ellipses: [] };
  let fillStyle: unknown = '';
  let strokeStyle: unknown = '';
  let lineWidth: unknown = 1;
  for (const c of calls) {
    switch (c[0]) {
      case 'beginPath': g = { kind: 'fill', color: '', width: 0, rects: [], moves: [], lines: [], ellipses: [] }; break;
      case 'set:fillStyle': fillStyle = c[1]; break;
      case 'set:strokeStyle': strokeStyle = c[1]; break;
      case 'set:lineWidth': lineWidth = c[1]; break;
      case 'rect': g.rects.push(c.slice(1) as number[]); break;
      case 'moveTo': g.moves.push(c.slice(1) as number[]); break;
      case 'lineTo': g.lines.push(c.slice(1) as number[]); break;
      case 'ellipse': g.ellipses.push(c.slice(1) as number[]); break;
      case 'fill': out.push({ ...g, kind: 'fill', rule: c[1], color: fillStyle, width: lineWidth }); break;
      case 'stroke': out.push({ ...g, kind: 'stroke', color: strokeStyle, width: lineWidth }); break;
    }
  }
  return out;
}

describe('hollow candlestick', () => {
  const rows = norm(HollowCandlestickSeries, [
    { time: 1, open: 10, high: 13, low: 9, close: 12 },
    { time: 2, open: 12, high: 14, low: 9, close: 11 },
    { time: 3, open: 11, high: 14, low: 10, close: 13 },
  ]);
  it('normalize repairs a range, whitespace is null, a bad field is named', () => {
    expect(HollowCandlestickSeries.normalize({ time: 1, open: 5, high: 4, low: 6, close: 7 })).toEqual({ time: 1, open: 5, high: 7, low: 4, close: 7 });
    expect(HollowCandlestickSeries.normalize({ time: 1 })).toBeNull();
    expect(() => HollowCandlestickSeries.normalize({ time: 1, open: 1, high: 2, low: 0 })).toThrow(/hollow candlestick row needs a finite "close"/);
  });
  it('colour follows the change from the previous close (the first bar: its own open)', () => {
    expect(isUpBar(rows[0], NaN)).toBe(true);
    expect(isUpBar(rows[1], 12)).toBe(false);
    expect(isUpBar(rows[2], 11)).toBe(true);
    // A gap up whose body is down is still up-coloured.
    expect(isUpBar({ time: 2, open: 20, high: 21, low: 14, close: 15 }, 12)).toBe(true);
  });
  it('hollow when closed up (outer rectangle minus inner), filled when closed down; colour by prior close', () => {
    const gs = groups(run(HollowCandlestickSeries, rows));
    const up = lightTheme.up;
    const down = lightTheme.down;
    // wicks: up group (bars 1 and 3 are hollow: two stubs each), down group (bar 2: one full wick); then bodies.
    expect(gs.map(g => [g.color, g.rects.length, g.rule])).toEqual([
      [up, 4, 'evenodd'], [down, 1, 'evenodd'], [up, 4, 'evenodd'], [down, 1, 'evenodd'],
    ]);
    // y = 1000 - 10 p: bar 1 high 13 / close 12 / open 10 / low 9 -> stubs 870..880 and 900..910, nothing inside the body
    const stubs = gs[0].rects.slice(0, 2);
    expect(stubs.map(r => [r[1], r[1] + r[3]])).toEqual([[870, 880], [900, 910]]);
    // hollow body: outer 880..900 and the inner one inset by the edge
    const [outer, inner] = gs[2].rects.slice(0, 2);
    expect(outer.slice(1, 4)).toEqual([880, outer[2], 20]);
    expect(inner[0]).toBeGreaterThan(outer[0]);
    expect(inner[2]).toBeLessThan(outer[2]);
    expect(inner[3]).toBe(20 - 2);
    // filled down body is one rectangle
    expect(gs[3].rects[0][3]).toBe(10);
  });
  it('whole device pixels everywhere', () => {
    for (const ratio of [1, 1.5, 2]) {
      for (const g of groups(run(HollowCandlestickSeries, rows, { ratio }))) for (const r of g.rects) expect(r.every(Number.isInteger)).toBe(true);
    }
  });
  it('dense: one-pixel columns, no per-bar bodies', () => {
    const many = norm(HollowCandlestickSeries, Array.from({ length: 1000 }, (_, i) => ({ time: i + 1, open: 10 + (i % 5), high: 20, low: 5, close: 11 + (i % 4) })));
    const gs = groups(run(HollowCandlestickSeries, many, { spacing: 0.2 }));
    expect(gs.length).toBe(2);
    for (const g of gs) for (const r of g.rects) expect(r[2]).toBe(1);
    expect(gs[0].rects.length + gs[1].rects.length).toBeLessThanOrEqual(260);
  });
  it('autoscale range, value and tag colour', () => {
    expect([HollowCandlestickSeries.low(rows[0]), HollowCandlestickSeries.high(rows[0]), HollowCandlestickSeries.value(rows[0])]).toEqual([9, 13, 12]);
  });
});

describe('step line', () => {
  const rows = norm(StepLineSeries, [{ time: 1, value: 10 }, { time: 2, value: 14 }, { time: 3, value: 11 }]);
  it('normalize copies and validates', () => {
    expect(StepLineSeries.normalize({ time: 1, value: 3 })).toEqual({ time: 1, value: 3 });
    expect(StepLineSeries.normalize({ time: 1 })).toBeNull();
    expect(() => StepLineSeries.normalize({ time: 1, value: NaN })).toThrow(/step line row needs a finite "value"/);
  });
  it('holds each value until the next bar, then jumps: horizontal then vertical, on pixel centres for an odd width', () => {
    const { ctx, calls } = recorder();
    StepLineSeries.draw({
      ctx, pixelRatio: 1, rows, from: 0, to: 2, x: i => 50.3 + i * 20, y: p => 1000 - p * 10, barSpacing: 20,
      options: { ...StepLineSeries.defaults, ...common, lineWidth: 1 }, colors: lightTheme, pane: { x: 0, y: 0, width: 400, height: 1000 },
    });
    const pts = calls.filter(c => c[0] === 'moveTo' || c[0] === 'lineTo').map(c => [c[1], c[2]]);
    expect(pts).toEqual([[50.5, 900.5], [70.5, 900.5], [70.5, 860.5], [90.5, 860.5], [90.5, 890.5]]);
    expect(named(calls, 'stroke')).toHaveLength(1);
  });
  it("'before' jumps at the earlier bar, 'middle' halfway", () => {
    const pts = (stepAt: 'before' | 'middle'): number[][] => groups(run(StepLineSeries, rows, { options: { stepAt, lineWidth: 2 } }))[0]
      .moves.concat(groups(run(StepLineSeries, rows, { options: { stepAt, lineWidth: 2 } }))[0].lines);
    expect(pts('before').length).toBe(5);
    expect(pts('middle').length).toBe(7);
  });
  it('dense: joins the folded points straight and stays small', () => {
    const many = norm(StepLineSeries, Array.from({ length: 5000 }, (_, i) => ({ time: i + 1, value: 50 + Math.sin(i / 20) * 10 })));
    const g = groups(run(StepLineSeries, many, { spacing: 0.1 }))[0];
    expect(g.moves.length + g.lines.length).toBeLessThan(2400);
  });
});

describe('HLC area', () => {
  const rows = norm(HlcAreaSeries, [{ time: 1, high: 12, low: 8, close: 10 }, { time: 2, high: 13, low: 9, close: 12 }, { time: 3, high: 12, low: 7, close: 8 }]);
  it('normalize repairs the range around the close, validates', () => {
    expect(HlcAreaSeries.normalize({ time: 1, high: 5, low: 4, close: 9 })).toEqual({ time: 1, high: 9, low: 4, close: 9 });
    expect(HlcAreaSeries.normalize({ time: 1 })).toBeNull();
    expect(() => HlcAreaSeries.normalize({ time: 1, high: 1, low: 0 })).toThrow(/HLC area row needs a finite "close"/);
  });
  it('autoscale covers high and low; the tag value is the close', () => {
    expect([HlcAreaSeries.low(rows[2]), HlcAreaSeries.high(rows[2]), HlcAreaSeries.value(rows[2])]).toEqual([7, 12, 8]);
  });
  it('draws one band polygon (highs forward, lows back), two edge hairlines and the close line', () => {
    const gs = groups(run(HlcAreaSeries, rows));
    expect(gs.map(g => g.kind)).toEqual(['fill', 'stroke', 'stroke']);
    const band = gs[0];
    expect(band.moves).toEqual([[50, 880]]);
    expect(band.lines).toHaveLength(5);
    // highs 12, 13, 12 then lows 7, 9, 8 reversed
    expect([band.moves[0][1], ...band.lines.map(p => p[1])]).toEqual([880, 870, 880, 930, 910, 920]);
    expect(gs[2].moves).toEqual([[50, 900]]);
    expect(gs[2].lines.map(p => p[1])).toEqual([880, 920]);
  });
  it('a gap splits the band into two polygons', () => {
    const withGap = [rows[0], null, rows[1], rows[2]];
    const band = groups(run(HlcAreaSeries, withGap))[0];
    expect(band.moves).toHaveLength(2);
  });
  it('dense: points stay about one per pixel column', () => {
    const many = norm(HlcAreaSeries, Array.from({ length: 5000 }, (_, i) => ({ time: i + 1, high: 60 + (i % 7), low: 40 - (i % 5), close: 50 })));
    const gs = groups(run(HlcAreaSeries, many, { spacing: 0.1 }));
    expect(gs[0].lines.length).toBeLessThan(2 * 520);
  });
});

describe('column', () => {
  it('derives the direction from up, or from open and close', () => {
    expect(ColumnSeries.normalize({ time: 1, value: 5, up: false })).toEqual({ time: 1, value: 5, up: false });
    expect(ColumnSeries.normalize({ time: 1, value: 5, open: 4, close: 5 })).toEqual({ time: 1, value: 5, up: true });
    expect(ColumnSeries.normalize({ time: 1, value: 5, open: 6, close: 5 })).toEqual({ time: 1, value: 5, up: false });
    expect(ColumnSeries.normalize({ time: 1, value: 5 })).toEqual({ time: 1, value: 5 });
    expect(ColumnSeries.normalize({ time: 1 })).toBeNull();
    expect(() => ColumnSeries.normalize({ time: 1, value: Infinity })).toThrow(/column row needs a finite "value"/);
  });
  it('autoscale includes the base when there is one', () => {
    expect([ColumnSeries.low({ time: 1, value: 40 }), ColumnSeries.high({ time: 1, value: 40 })]).toEqual([40, 40]);
    expect([ColumnSeries.low({ time: 1, value: 40 }, { ...common, opacity: 1, base: 0 }), ColumnSeries.high({ time: 1, value: -5 }, { ...common, opacity: 1, base: 0 })]).toEqual([0, 0]);
  });
  const rows = norm(ColumnSeries, [{ time: 1, value: 10, up: true }, { time: 2, value: 12, up: false }, { time: 3, value: 8 }]);
  it('price columns grow from the pane bottom; two paths (up, down); a row without direction follows the previous value', () => {
    const calls = run(ColumnSeries, rows, { pane: { x: 0, y: 0, width: 800, height: 1000 } });
    const gs = groups(calls);
    expect(gs.map(g => [g.color, g.rects.length])).toEqual([[lightTheme.up, 1], [lightTheme.down, 2]]);
    for (const g of gs) for (const r of g.rects) expect(r[1] + r[3]).toBe(1000);
  });
  it('with a base the columns grow from it, and opacity is applied', () => {
    const calls = run(ColumnSeries, rows, { options: { base: 0, opacity: 0.5 } });
    expect(named(calls, 'set:globalAlpha')[0][1]).toBe(0.5);
    const g = groups(calls)[0];
    expect(g.rects[0][1] + g.rects[0][3]).toBe(1000);
    expect(g.rects[0][3]).toBe(100);
  });
  it('dense: one device-pixel column per x, taller wins and brings its colour', () => {
    const many = norm(ColumnSeries, Array.from({ length: 2000 }, (_, i) => ({ time: i + 1, value: 10 + (i % 9), up: i % 9 !== 8 })));
    const gs = groups(run(ColumnSeries, many, { spacing: 0.25 }));
    expect(gs.reduce((n, g) => n + g.rects.length, 0)).toBeLessThanOrEqual(520);
    for (const g of gs) for (const r of g.rects) expect(r[2]).toBe(1);
    // the highest value of a column is 18 (a down row), so a down column reaches y = 1000 - 180
    expect(gs[1].rects.some(r => r[1] === 820)).toBe(true);
  });
});

describe('high-low', () => {
  it('normalize orders the range, keeps open and close only as a pair', () => {
    expect(HighLowSeries.normalize({ time: 1, high: 3, low: 7 })).toEqual({ time: 1, high: 7, low: 3 });
    expect(HighLowSeries.normalize({ time: 1, high: 7, low: 3, open: 4, close: 6 })).toEqual({ time: 1, high: 7, low: 3, open: 4, close: 6 });
    expect(HighLowSeries.normalize({ time: 1, high: 7, low: 3, open: 4 })).toEqual({ time: 1, high: 7, low: 3 });
    expect(HighLowSeries.normalize({ time: 1 })).toBeNull();
    expect(() => HighLowSeries.normalize({ time: 1, high: 3 })).toThrow(/"low"/);
  });
  it('floating columns from low to high, coloured by close vs open or midpoint vs previous midpoint', () => {
    const rows = norm(HighLowSeries, [{ time: 1, high: 12, low: 8 }, { time: 2, high: 13, low: 9 }, { time: 3, high: 11, low: 7 }, { time: 4, high: 20, low: 1, open: 9, close: 4 }]);
    const gs = groups(run(HighLowSeries, rows));
    expect(gs.map(g => [g.color, g.rects.length])).toEqual([[lightTheme.up, 2], [lightTheme.down, 2]]);
    expect(gs[0].rects[1].slice(1, 4)).toEqual([870, gs[0].rects[1][2], 40]);
  });
  it('dense: folded to pixel columns', () => {
    const many = norm(HighLowSeries, Array.from({ length: 1000 }, (_, i) => ({ time: i + 1, high: 20 + (i % 3), low: 10 })));
    const gs = groups(run(HighLowSeries, many, { spacing: 0.3 }));
    for (const g of gs) for (const r of g.rects) expect(r[2]).toBe(1);
  });
});

describe('Kagi series', () => {
  const bars = [100, 110, 104, 112, 100, 108, 115, 109].map((c, i) => ({ time: 1000 + i * 60, open: c, high: c, low: c, close: c, volume: 1 }));
  const rows = norm(KagiSeries, kagi(bars).rows as never);
  it('normalize keeps the thickness fields, repairs high and low, validates', () => {
    expect(KagiSeries.normalize({ time: 1, open: 5, close: 9 })).toEqual({ time: 1, open: 5, close: 9, high: 9, low: 5 });
    expect(KagiSeries.normalize({ time: 1, open: 5, close: 9, startYang: true, endYang: false, flipAt: 7 })).toMatchObject({ startYang: true, endYang: false, flipAt: 7 });
    expect(KagiSeries.normalize({ time: 1 })).toBeNull();
    expect(() => KagiSeries.normalize({ time: 1, open: 5 })).toThrow(/Kagi row needs a finite "close"/);
  });
  it('draws two strokes: the thick yang line (up colour) and the thin yin line (down colour), broken only where it changes', () => {
    for (const ratio of [1, 2]) {
      const gs = groups(run(KagiSeries, rows, { ratio, spacing: 30 * ratio }));
      expect(gs.map(g => g.kind)).toEqual(['stroke', 'stroke']);
      const [yang, yin] = gs;
      expect(yang.color).toBe(lightTheme.up);
      expect(yin.color).toBe(lightTheme.down);
      expect(yang.width as number).toBeGreaterThan(yin.width as number);
      expect(((yang.width as number) - (yin.width as number)) % 2).toBe(0);
      expect(yin.width).toBe(Math.min(deviceWidth(1.25, ratio), Math.floor(30 * ratio * 0.5)));
      // yang: seg 0..3 down to the 104 waist, and again from the 112 shoulder; yin: one run (104 down to 100 and across)
      expect(yang.moves).toHaveLength(2);
      expect(yin.moves).toHaveLength(1);
      // every point sits on the stroke grid: a pixel centre for an odd width, an edge for an even one
      for (const [g, w] of [[yang, yang.width], [yin, yin.width]] as const) {
        for (const p of [...g.moves, ...g.lines]) for (const v of p) expect(Math.abs(((v % 1) + 1) % 1 - ((w as number) % 2 === 1 ? 0.5 : 0))).toBeLessThan(1e-9);
      }
    }
  });
  it('the thick/thin change sits at the flip price inside the stroke', () => {
    // y = 2000 - 10 p: the 104 waist is y 960, the 112 shoulder y 880; x of segment k is 50 + 30 k, snapped to .5
    const [yang, yin] = groups(run(KagiSeries, rows, { spacing: 30, y: p => 2000 - p * 10 }));
    expect(yin.moves[0]).toEqual([140.5, 960.5]);
    expect(yang.lines).toContainEqual([140.5, 960.5]);
    expect(yang.moves[1]).toEqual([170.5, 880.5]);
  });
  it('dense: one-pixel columns coloured by the line\'s thickness', () => {
    const many = norm(KagiSeries, Array.from({ length: 600 }, (_, i) => ({ time: i + 1, open: 50 + (i % 2) * 5, close: 55 - (i % 2) * 5, endYang: i % 3 !== 0 })));
    const gs = groups(run(KagiSeries, many, { spacing: 0.4 }));
    expect(gs.map(g => g.color)).toEqual([lightTheme.up, lightTheme.down]);
    for (const g of gs) for (const r of g.rects) expect(r[2]).toBe(1);
  });
  it('rows without thickness fields follow their own direction', () => {
    const own = norm(KagiSeries, [{ time: 1, open: 10, close: 20 }, { time: 2, open: 20, close: 12 }]);
    const [yang, yin] = groups(run(KagiSeries, own, { spacing: 30 }));
    expect(yang.moves).toHaveLength(1);
    expect(yin.moves).toHaveLength(1);
  });
});

describe('Point and figure series', () => {
  const bars = [10, 11, 12, 13, 11, 9, 8, 12].map((c, i) => ({ time: 1000 + i * 60, close: c, volume: 1 }));
  const pf = pointFigure(bars, { box: 1 });
  const rows = norm(PointFigureSeries, pf.rows as never);
  it('normalize derives the direction, validates', () => {
    expect(PointFigureSeries.normalize({ time: 1, high: 9, low: 5, up: false })).toMatchObject({ up: false, open: 9, close: 5 });
    expect(PointFigureSeries.normalize({ time: 1, high: 9, low: 5, open: 9, close: 5 })).toMatchObject({ up: false });
    expect(PointFigureSeries.normalize({ time: 1, high: 9, low: 5 })).toMatchObject({ up: true, open: 5, close: 9 });
    expect(PointFigureSeries.normalize({ time: 1 })).toBeNull();
    expect(() => PointFigureSeries.normalize({ time: 1, high: 9 })).toThrow(/point and figure row needs a finite "low"/);
  });
  it('autoscale reaches half a box past the end levels', () => {
    const o = { ...common, box: 2 };
    expect([PointFigureSeries.low(rows[0], o), PointFigureSeries.high(rows[0], o)]).toEqual([9, 14]);
  });
  it('three looks by size: glyphs, bars, fold', () => {
    expect(pointFigureLayout(2.9, 40).mode).toBe('fold');
    expect(pointFigureLayout(12, 12).mode).toBe('glyphs');
    expect(pointFigureLayout(12, 4).mode).toBe('bars');
    expect(pointFigureLayout(4, 12).mode).toBe('bars');
    expect(pointFigureLayout(12, 0).mode).toBe('fold');
    expect(pointFigureLayout(12, Number.NaN).mode).toBe('fold');
    // the glyph is never larger than the cell
    const l = pointFigureLayout(30, 12);
    expect(l.gw).toBeLessThanOrEqual(30);
    expect(l.gh).toBeLessThanOrEqual(12);
  });
  it('glyphs: an X is two strokes and an O an ellipse, one box per level, one path per colour', () => {
    const gs = groups(run(PointFigureSeries, rows, { spacing: 24, options: { box: 1 }, y: p => 1000 - p * 20 }));
    expect(gs.map(g => [g.kind, g.color])).toEqual([['stroke', lightTheme.up], ['stroke', lightTheme.down]]);
    // X columns 10..13 (4 marks) and 9..12 (4 marks): 8 marks x two strokes; O column 8..12: 5 ellipses
    expect(gs[0].moves).toHaveLength(16);
    expect(gs[0].lines).toHaveLength(16);
    expect(gs[1].ellipses).toHaveLength(5);
    expect(gs[1].ellipses[0].slice(2, 4).every(v => v > 4)).toBe(true);
  });
  it('bars: X solid, O an outline, when marks are too small for strokes', () => {
    const gs = groups(run(PointFigureSeries, rows, { spacing: 12, options: { box: 1 }, y: p => 1000 - p * 6 }));
    expect(gs).toHaveLength(2);
    expect(gs[0].rects).toHaveLength(2);
    expect(gs[1].rects).toHaveLength(2); // outer and inner of the one O column
    expect(gs.every(g => g.rule === 'evenodd')).toBe(true);
    expect(gs[1].rects[1][3]).toBeLessThan(gs[1].rects[0][3]);
  });
  it('fold: one-pixel columns when columns are under 3 px', () => {
    const many = norm(PointFigureSeries, Array.from({ length: 800 }, (_, i) => ({ time: i + 1, high: 30 + (i % 5), low: 20, up: i % 2 === 0 })));
    const gs = groups(run(PointFigureSeries, many, { spacing: 0.5, options: { box: 1 } }));
    for (const g of gs) for (const r of g.rects) expect(r[2]).toBe(1);
    expect(gs.reduce((n, g) => n + g.rects.length, 0)).toBeLessThanOrEqual(410);
  });
  it('marks outside the pane are not drawn', () => {
    const tall = norm(PointFigureSeries, [{ time: 1, high: 1000, low: 0, up: true }]);
    const g = groups(run(PointFigureSeries, tall, { spacing: 24, options: { box: 1 }, y: p => 1000 - p * 20, pane: { x: 0, y: 0, width: 400, height: 400 } }))[0];
    expect(g.moves.length).toBeLessThan(2 * 30);
  });
});

describe('applyChartType and CHART_TYPES', () => {
  const ids: ChartTypeId[] = ['candles', 'hollow', 'bars', 'highLow', 'line', 'stepLine', 'area', 'hlcArea', 'baseline', 'columns', 'heikinAshi', 'renko', 'lineBreak', 'kagi', 'pointFigure', 'rangeBars'];
  it('lists every chart type, in order, with the contract shape', () => {
    expect(CHART_TYPES.map(t => t.id)).toEqual(ids);
    for (const t of CHART_TYPES) {
      expect(typeof t.name).toBe('string');
      expect(['series', 'transform']).toContain(t.kind);
      expect(typeof t.irregularTime).toBe('boolean');
      for (const i of t.inputs) {
        expect(Object.keys(i).filter(k => !['key', 'label', 'type', 'default', 'min', 'max'].includes(k))).toEqual([]);
        expect(i.type === 'number' || i.type === 'boolean').toBe(true);
        expect(typeof i.default).toBe(i.type);
        if (i.min !== undefined && i.max !== undefined) expect(i.min).toBeLessThan(i.max);
        if (typeof i.default === 'number') {
          if (i.min !== undefined) expect(i.default).toBeGreaterThanOrEqual(i.min);
          if (i.max !== undefined) expect(i.default).toBeLessThanOrEqual(i.max);
        }
      }
    }
    expect(CHART_TYPES.filter(t => t.irregularTime).map(t => t.id)).toEqual(['renko', 'lineBreak', 'kagi', 'pointFigure', 'rangeBars']);
    expect(CHART_TYPES.filter(t => t.kind === 'transform').map(t => t.id)).toEqual(['heikinAshi', 'renko', 'lineBreak', 'kagi', 'pointFigure', 'rangeBars']);
    expect(chartType('renko')?.name).toBe('Renko');
    expect(chartType('nope')).toBeUndefined();
  });
  it('every type gives a definition, rows its own normalize accepts, strictly ascending times, and a SeriesModel accepts them', () => {
    const rows = walk(400, 13);
    const seen = new Set<string>();
    for (const id of ids) {
      const a = applyChartType(id, rows);
      seen.add(a.definition.type);
      expect(a.data.length).toBeGreaterThan(0);
      const m = new SeriesModel(a.definition, { ...a.definition.defaults, ...common, ...a.options } as never);
      expect(() => m.setData(a.data as never)).not.toThrow();
      expect(m.count).toBe(a.data.length);
      for (let i = 1; i < a.data.length; i++) expect(a.data[i].time as number).toBeGreaterThan(a.data[i - 1].time as number);
      expect(Boolean(a.info)).toBe(chartType(id)!.irregularTime);
    }
    expect(seen.size).toBe(12);
  });
  it('the series types keep one row per source bar; transforms carry the chosen size', () => {
    const rows = walk(300, 2);
    for (const id of ['candles', 'hollow', 'bars', 'highLow', 'line', 'stepLine', 'area', 'hlcArea', 'baseline', 'columns', 'heikinAshi'] as ChartTypeId[]) {
      expect(applyChartType(id, rows).data).toHaveLength(300);
    }
    const r = applyChartType('renko', rows, { brick: 1 });
    expect(r.info).toMatchObject({ brick: 1 });
    expect(r.definition.type).toBe('candlestick');
    expect(applyChartType('renko', rows).info!.brick).toBeGreaterThan(0);
    expect(applyChartType('rangeBars', rows, { range: 2 }).info!.range).toBe(2);
    expect(applyChartType('rangeBars', rows).info!.range).toBeGreaterThan(0);
    const p = applyChartType('pointFigure', rows, { box: 0.5, reversal: 4 });
    expect(p.info).toMatchObject({ box: 0.5, reversal: 4 });
    expect(p.options).toEqual({ box: 0.5 });
    expect(applyChartType('pointFigure', rows).info!.box).toBeGreaterThan(0);
    expect(applyChartType('lineBreak', rows, { lines: 2 }).info!.lines).toBe(2);
    expect(applyChartType('kagi', rows, { reversal: 1 }).info).toMatchObject({ reversal: 1, reversalMode: 'percent' });
    expect(applyChartType('kagi', rows).info!.reversal).toBe(4);
  });
  it('renko of the same bar shares one source time, spread so setData accepts it; the source index survives', () => {
    const rows = walk(300, 2);
    const r = applyChartType('renko', rows, { brick: 0.3 });
    expect(r.info!.shifted).toBeGreaterThan(0);
    expect(r.data.every(d => typeof d.sourceIndex === 'number')).toBe(true);
  });
  it('rows are cleaned: unreadable, older and repeated times never reach setData', () => {
    const rows = walk(50, 3);
    const dirty = [...rows.slice(0, 20), { time: Number.NaN, close: 1 } as TransformRow, rows[19], { ...rows[25], time: 5 }, null as never, ...rows.slice(20)];
    const clean = cleanRows(dirty);
    expect(clean).toHaveLength(50);
    expect(clean[19]).toBe(rows[19]);
    for (const id of ids) {
      const a = applyChartType(id, dirty);
      expect(() => new SeriesModel(a.definition, { ...a.definition.defaults, ...common, ...a.options } as never).setData(a.data as never)).not.toThrow();
    }
    expect(cleanRows(rows)).toBe(rows);
  });
  it('bad rows become whitespace in the series types, and nothing throws', () => {
    const rows: TransformRow[] = [{ time: 1, open: 1, high: 2, low: 0, close: 1 }, { time: 2 }, { time: 3, open: 'x' as never, close: 2 }, { time: 4, value: 5 }];
    for (const id of ids) {
      const a = applyChartType(id, rows);
      expect(() => new SeriesModel(a.definition, { ...a.definition.defaults, ...common, ...a.options } as never).setData(a.data as never)).not.toThrow();
    }
    expect(applyChartType('candles', rows).data).toEqual([{ time: 1, open: 1, high: 2, low: 0, close: 1 }, { time: 2 }, { time: 3 }, { time: 4 }]);
    expect(applyChartType('line', rows).data.map(d => d.value)).toEqual([1, undefined, 2, 5]);
    expect(applyChartType('renko', []).data).toEqual([]);
  });
  it('business-day rows keep their kind through a transform', () => {
    const days = Array.from({ length: 120 }, (_, i) => {
      const d = new Date(Date.UTC(2024, 0, 1 + i));
      return { ...walk(120, 5)[i], time: d.toISOString().slice(0, 10) };
    });
    const a = applyChartType('renko', days as never, { brick: 0.2 });
    expect(a.data.every(d => typeof d.time === 'string')).toBe(true);
    expect(() => new SeriesModel(a.definition, { ...a.definition.defaults, ...common } as never).setData(a.data as never)).not.toThrow();
  });
  it('baseline takes the first close unless a base is given; series options are merged', () => {
    const rows = walk(20, 3);
    expect(applyChartType('baseline', rows).options).toEqual({ baseValue: rows[0].close });
    expect(applyChartType('baseline', rows, { base: 90, series: { title: 'X' } }).options).toEqual({ baseValue: 90, title: 'X' });
  });
  it('an unknown id throws a plain message', () => {
    expect(() => applyChartType('nope' as never, [])).toThrow(/unknown chart type "nope"/);
  });
  it('does not change its input', () => {
    const rows = walk(100, 9);
    const copy = JSON.stringify(rows);
    for (const id of ids) applyChartType(id, rows);
    expect(JSON.stringify(rows)).toBe(copy);
  });
  it('no purple in the new series\' default colours', () => {
    for (const t of [lightTheme, darkTheme]) expect([t.up, t.down, t.line]).not.toContain('#800080');
  });
});
