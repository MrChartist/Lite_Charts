// The fast paths behind the frame budget must give the same answers as the plain ones.
import { describe, expect, it } from 'vitest';
import { CandlestickSeries, type CandlestickData, type CandlestickOptions } from '../series/candlestick';
import { LineSeries, type LineData, type LineOptions } from '../series/line';
import { SeriesModel } from '../series/series-model';
import type { SeriesCommonOptions } from '../series/definition';

const common: SeriesCommonOptions = { priceScaleId: 'right', visible: true, lastValueVisible: true, priceLineVisible: true, priceFormat: { precision: 2, minMove: 0.01 }, title: '' };

describe('cached extremes (autoscale)', () => {
  it('equal a brute-force scan for any range, after updates too', () => {
    const s = new SeriesModel<CandlestickData, CandlestickOptions>(CandlestickSeries, { ...CandlestickSeries.defaults, ...common });
    const rows = [];
    for (let i = 0; i < 1000; i++) {
      const c = 100 + Math.sin(i / 7) * 10;
      rows.push(i % 97 === 5 ? { time: i + 1 } : { time: i + 1, open: c, high: c + (i % 13), low: c - (i % 11), close: c + 1 });
    }
    s.setData(rows as never);
    const out = new Float64Array(2);
    const brute = (a: number, b: number): [number, number] => {
      let lo = Infinity, hi = -Infinity;
      for (let i = a; i <= b; i++) { const r = s.rows[i]; if (r) { lo = Math.min(lo, r.low); hi = Math.max(hi, r.high); } }
      return [lo, hi];
    };
    for (const [a, b] of [[0, 999], [3, 700], [128, 255], [130, 131], [500, 500]]) {
      s.extents(a, b, out);
      expect([out[0], out[1]]).toEqual(brute(a, b));
    }
    s.update({ time: 1000, open: 100, high: 500, low: -5, close: 100 });
    s.extents(0, 999, out);
    expect([out[0], out[1]]).toEqual([-5, 500]);
    expect(s.highs[999]).toBe(500);
    expect(s.vals[999]).toBe(100);
  });
});

describe('value blocks and typed arrays', () => {
  it('block min / max match the values; a block with a gap is NaN', () => {
    const s = new SeriesModel<LineData, LineOptions>(LineSeries, { ...LineSeries.defaults, ...common });
    const rows = [];
    for (let i = 0; i < 200; i++) rows.push(i === 70 ? { time: i + 1 } : { time: i + 1, value: Math.cos(i) * 5 });
    s.setData(rows as never);
    const vb = s.valueBlocks();
    for (let k = 0; k < Math.ceil(200 / vb.size); k++) {
      const seg = Array.from(s.vals.subarray(k * vb.size, Math.min(200, (k + 1) * vb.size)));
      if (seg.some(v => Number.isNaN(v))) expect(Number.isNaN(vb.min[k])).toBe(true);
      else { expect(vb.min[k]).toBe(Math.min(...seg)); expect(vb.max[k]).toBe(Math.max(...seg)); }
    }
    s.update({ time: 200, value: 99 });
    expect(s.valueBlocks().max[Math.floor(199 / vb.size)]).toBe(99);
  });

  it('the folded line covers the exact lowest and highest value (typed path with blocks)', () => {
    const n = 10000;
    const rows: LineData[] = [];
    const vals = new Float64Array(n);
    const slots = new Int32Array(n);
    for (let i = 0; i < n; i++) { const v = Math.sin(i / 30) * 10 + (i === 4321 ? 50 : 0); rows.push({ time: i, value: v }); vals[i] = v; slots[i] = i; }
    const s = new SeriesModel<LineData, LineOptions>(LineSeries, { ...LineSeries.defaults, ...common });
    s.setData(rows as never);
    const ys: number[] = [];
    const ctx = { lineTo: (_x: number, y: number) => ys.push(y), moveTo: (_x: number, y: number) => ys.push(y), beginPath() {}, stroke() {}, setLineDash() {} };
    const scope = {
      ctx, pixelRatio: 1, rows, from: 0, to: n - 1, x: (i: number) => i * 0.1, y: (p: number) => -p, barSpacing: 0.1,
      options: { ...LineSeries.defaults, ...common }, colors: { line: '#000' }, pane: { x: 0, y: 0, width: 1000, height: 100 },
      values: vals, slots, xOrigin: 0, xStep: 0.1, valueBlocks: s.valueBlocks(),
    };
    LineSeries.draw(scope as never);
    // y = -price: the highest value is the lowest y (the spike at row 4321 must survive the fold). A column whose range
    // is under one device pixel draws its middle, so extremes are exact to half a pixel.
    expect(Math.abs(Math.min(...ys) + Math.max(...Array.from(vals)))).toBeLessThanOrEqual(0.5);
    expect(Math.abs(Math.max(...ys) + Math.min(...Array.from(vals)))).toBeLessThanOrEqual(0.5);
    expect(ys.length).toBeLessThan(2 * 1000 + 10);
  });
});
