import { describe, expect, it } from 'vitest';
import { AreaSeries, collectPoints, withAlpha } from '../series/area';
import { BarSeries, barGeometry } from '../series/bar';
import { HistogramSeries, histogramColumn } from '../series/histogram';
import { BaselineSeries, crossingX, sideOf, traceSide } from '../series/baseline';

describe('area', () => {
  it('copies rows, treats time-only as whitespace, names a bad field', () => {
    const input = { time: '2024-01-02', value: 5 };
    const row = AreaSeries.normalize(input)!;
    expect(row).toEqual({ time: '2024-01-02', value: 5 });
    expect(row).not.toBe(input);
    expect(AreaSeries.normalize({ time: 1 })).toBeNull();
    expect(() => AreaSeries.normalize({ time: 1, value: NaN })).toThrow(/area row needs a finite "value"/);
  });
  it('autoscale range is the value', () => {
    const r = { time: 1, value: 7 };
    expect([AreaSeries.low(r), AreaSeries.high(r), AreaSeries.value(r)]).toEqual([7, 7, 7]);
  });
  it('withAlpha replaces alpha and leaves unknown colours alone', () => {
    expect(withAlpha('#0066CC', 0.5)).toBe('rgba(0, 102, 204, 0.5)');
    expect(withAlpha('rgb(1, 2, 3)', 0)).toBe('rgba(1, 2, 3, 0)');
    expect(withAlpha('tomato', 0.5)).toBe('tomato');
  });
  it('collectPoints folds a pixel column to its last value and marks gaps once', () => {
    const rows = [{ time: 1, value: 1 }, { time: 2, value: 2 }, { time: 3, value: 3 }, null, null, { time: 6, value: 6 }];
    const xs = [10.1, 10.6, 11.2, 12, 13, 14];
    const p = collectPoints({ rows, from: 0, to: 5, x: i => xs[i], y: v => v * 10 }, r => r.value);
    expect(p.n).toBe(4);
    expect(Array.from(p.xs.slice(0, 4)).filter((_, k) => k !== 2)).toEqual([10.1, 11.2, 14]);
    expect(Array.from(p.ys.slice(0, 4)).map(v => (Number.isNaN(v) ? 'gap' : v))).toEqual([20, 30, 'gap', 60]);
  });
});

describe('bar', () => {
  it('repairs a range that misses open/close, rejects missing fields', () => {
    expect(BarSeries.normalize({ time: 1, open: 5, high: 4, low: 6, close: 7 })).toEqual({ time: 1, open: 5, high: 7, low: 4, close: 7 });
    expect(BarSeries.normalize({ time: 1 })).toBeNull();
    expect(() => BarSeries.normalize({ time: 1, open: 1, high: 2, low: 0 })).toThrow(/"close"/);
  });
  it('autoscale uses low and high; colour follows direction', () => {
    const r = BarSeries.normalize({ time: 1, open: 5, high: 9, low: 3, close: 4 })!;
    expect([BarSeries.low(r), BarSeries.high(r), BarSeries.value(r)]).toEqual([3, 9, 4]);
    const colors = { up: 'U', down: 'D' } as never;
    expect(BarSeries.lastValueColor(r, { upColor: undefined, downColor: undefined, openVisible: true, thinBars: true } as never, colors)).toBe('D');
  });
  it('geometry: thin stem when narrow, whole pixels, ticks at least 1', () => {
    expect(barGeometry(6, 1, true).stem).toBe(1);
    expect(barGeometry(20, 1, true).stem).toBe(2);
    expect(barGeometry(6, 1, false).stem).toBe(2);
    expect(barGeometry(12, 2, true).stem).toBe(1);
    for (const sp of [3, 4, 7.5, 12, 30]) {
      const g = barGeometry(sp, 1, true);
      expect(Number.isInteger(g.stem) && Number.isInteger(g.tick)).toBe(true);
      expect(g.tick).toBeGreaterThanOrEqual(1);
      expect(g.stem + 2 * g.tick).toBeLessThanOrEqual(Math.max(sp, g.stem + 2));
    }
  });
});

describe('histogram', () => {
  it('keeps an optional colour, copies, validates', () => {
    expect(HistogramSeries.normalize({ time: 1, value: 3, color: '#123456' })).toEqual({ time: 1, value: 3, color: '#123456' });
    expect(HistogramSeries.normalize({ time: 1, value: 3 })).toEqual({ time: 1, value: 3 });
    expect(HistogramSeries.normalize({ time: 1 })).toBeNull();
    expect(() => HistogramSeries.normalize({ time: 1, value: Infinity })).toThrow(/"value"/);
    expect(() => HistogramSeries.normalize({ time: 1, value: 1, color: 5 })).toThrow(/"color"/);
  });
  it('low and high always include the base 0', () => {
    expect(HistogramSeries.low({ time: 1, value: 40 })).toBe(0);
    expect(HistogramSeries.high({ time: 1, value: 40 })).toBe(40);
    expect(HistogramSeries.low({ time: 1, value: -5 })).toBe(-5);
    expect(HistogramSeries.high({ time: 1, value: -5 })).toBe(0);
  });
  it('column width follows candle layout and folds when dense', () => {
    expect(histogramColumn(2, 1).columns).toBe(true);
    const c = histogramColumn(10, 1);
    expect(c.columns).toBe(false);
    expect(c.width).toBeGreaterThan(1);
    expect(c.width).toBeLessThan(10);
  });
});

describe('baseline', () => {
  it('validates and colours by side of the base', () => {
    expect(() => BaselineSeries.normalize({ time: 1, value: 'x' })).toThrow(/"value"/);
    const o = { baseValue: 10, upColor: 'U', downColor: 'D' } as never;
    expect(BaselineSeries.lastValueColor({ time: 1, value: 11 }, o, {} as never)).toBe('U');
    expect(BaselineSeries.lastValueColor({ time: 1, value: 9 }, o, {} as never)).toBe('D');
  });
  it('crossingX is exact and clamped', () => {
    expect(crossingX(0, 0, 10, 10, 5)).toBe(5);
    expect(crossingX(0, -10, 10, 30, 0)).toBe(2.5);
    expect(crossingX(4, 7, 8, 7, 7)).toBe(4);
    expect(crossingX(0, 0, 10, 10, 99)).toBe(10);
  });
  it('sideOf: smaller y is above; on the level keeps the previous side', () => {
    expect(sideOf(1, 5, 1)).toBe(0);
    expect(sideOf(9, 5, 0)).toBe(1);
    expect(sideOf(5, 5, 1)).toBe(1);
  });

  function trace(xs: number[], ys: number[], level: number, side: number, fill: boolean): string[] {
    const ops: string[] = [];
    traceSide({
      moveTo: (x, y) => ops.push(`M${x},${y}`),
      lineTo: (x, y) => ops.push(`L${x},${y}`),
      closePath: () => ops.push('Z'),
    }, xs, ys, xs.length, level, side, fill);
    return ops;
  }
  it('splits a crossing line exactly at the crossing, once per side', () => {
    // y 0 above level 10 (side 0), then y 20 below (side 1): the line meets 10 at x = 5.
    expect(trace([0, 10], [0, 20], 10, 0, false)).toEqual(['M0,0', 'L5,10']);
    expect(trace([0, 10], [0, 20], 10, 1, false)).toEqual(['M5,10', 'L10,20']);
  });
  it('closes each fill polygon along the level', () => {
    expect(trace([0, 10], [0, 20], 10, 0, true)).toEqual(['M0,10', 'L0,0', 'L5,10', 'L5,10', 'Z']);
    expect(trace([0, 10], [0, 20], 10, 1, true)).toEqual(['M5,10', 'L5,10', 'L10,20', 'L10,10', 'Z']);
  });
  it('a line entirely on one side draws nothing for the other', () => {
    expect(trace([0, 5, 10], [1, 2, 3], 10, 1, false)).toEqual([]);
    expect(trace([0, 5, 10], [1, 2, 3], 10, 0, false)).toEqual(['M0,1', 'L5,2', 'L10,3']);
  });
  it('gaps end a run; a touch of the level does not split', () => {
    const ops = trace([0, 1, 2, 3, 4], [1, NaN, 2, 10, 3], 10, 0, false);
    expect(ops).toEqual(['M0,1', 'M2,2', 'L3,10', 'L4,3']);
  });
  it('multiple crossings give one stroke run per visit', () => {
    const ops = trace([0, 10, 20, 30], [0, 20, 0, 20], 10, 0, false);
    expect(ops).toEqual(['M0,0', 'L5,10', 'M15,10', 'L20,0', 'L25,10']);
  });
});
