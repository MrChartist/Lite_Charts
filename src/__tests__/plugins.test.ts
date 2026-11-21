import { describe, expect, it } from 'vitest';
import { createPriceLine, mergePriceLineOptions, type PriceLineOptions } from '../plugins/price-line';
import { dashPattern } from '../plugins/price-line';
import {
  StackCursor, createSeriesMarkers, findRow, prepareMarkers, rowExtent, type SeriesMarker,
} from '../plugins/markers';
import type { ChartPrimitive } from '../plugins/primitive';
import { lightTheme } from '../core/theme';

const base: PriceLineOptions = { price: 10, lineWidth: 1, lineStyle: 'dashed', title: '', axisLabelVisible: true };

describe('price line options', () => {
  it('merges and validates', () => {
    expect(mergePriceLineOptions(base, { price: 12, title: 'T' })).toMatchObject({ price: 12, title: 'T', lineStyle: 'dashed' });
    expect(() => mergePriceLineOptions(base, { price: NaN })).toThrow(/"price"/);
    expect(() => mergePriceLineOptions(base, { lineWidth: 0 })).toThrow(/"lineWidth"/);
    expect(() => mergePriceLineOptions(base, { lineStyle: 'wavy' as never })).toThrow(/"lineStyle"/);
    expect(base.price).toBe(10);
  });
  it('dash patterns are in whole device px and empty for solid', () => {
    expect(dashPattern('solid', 1)).toEqual([]);
    expect(dashPattern('dashed', 2).every(Number.isInteger)).toBe(true);
    expect(dashPattern('dotted', 1)).toEqual([1, 3]);
  });
  it('attaches one primitive, updates through the handle, removes once', () => {
    const attached: ChartPrimitive[] = [];
    const detached: ChartPrimitive[] = [];
    const h = createPriceLine({ attachPrimitive: p => attached.push(p), detachPrimitive: p => detached.push(p) }, { price: 5, color: '#123456' });
    expect(attached).toHaveLength(1);
    expect(h.options()).toMatchObject({ price: 5, color: '#123456', lineStyle: 'dashed', axisLabelVisible: true });
    let updates = 0;
    attached[0].attached?.({ requestUpdate: () => { updates++; }, series: null });
    h.applyOptions({ price: 6 });
    expect(updates).toBe(1);
    expect(attached[0].priceAxisLabels?.(lightTheme)).toEqual([{ price: 6, color: '#123456' }]);
    h.applyOptions({ axisLabelVisible: false });
    expect(attached[0].priceAxisLabels?.(lightTheme)).toEqual([]);
    h.remove();
    h.remove();
    expect(detached).toEqual([attached[0]]);
  });
  it('rejects a missing price', () => {
    expect(() => createPriceLine({ attachPrimitive() {}, detachPrimitive() {} }, {} as never)).toThrow(/price/);
  });
});

describe('markers', () => {
  const m = (time: number, extra: Partial<SeriesMarker> = {}): SeriesMarker => ({ time, position: 'aboveBar', shape: 'circle', ...extra });
  it('validates fields and sorts stably by time', () => {
    const p = prepareMarkers([m(30, { text: 'c' }), m(10, { text: 'a' }), m(10, { text: 'b' })]);
    expect(p.map(x => x.m.text)).toEqual(['a', 'b', 'c']);
    expect(() => prepareMarkers([m(1, { position: 'left' as never })])).toThrow(/"position"/);
    expect(() => prepareMarkers([m(1, { shape: 'star' as never })])).toThrow(/"shape"/);
    expect(() => prepareMarkers([m(1, { size: 9 })])).toThrow(/"size"/);
    expect(() => prepareMarkers([m(NaN)])).toThrow(/time/);
  });
  it('cuts long text and scales size', () => {
    const [p] = prepareMarkers([m(1, { text: 'x'.repeat(40), size: 2 })]);
    expect(p.text.length).toBe(16);
    expect(p.text.endsWith('…')).toBe(true);
    expect(p.size).toBe(20);
  });
  it('stacks above the bar outward without overlap', () => {
    const c = new StackCursor();
    c.reset(100, 140); // bar from y 100 (high) to 140 (low)
    c.place('aboveBar', 10, 0, 4);
    expect(c.shapeY).toBe(91); // 100 - 4 - 5
    c.place('aboveBar', 10, 14, 4);
    expect(c.shapeY).toBe(77); // previous top 86, minus gap, minus half
    expect(c.textY).toBe(65); // above the shape: 72 - 7
    c.place('aboveBar', 10, 0, 4);
    expect(c.shapeY).toBe(49); // text block ends at 58; 58 - 4 - 5
  });
  it('stacks below the bar and never enters it', () => {
    const c = new StackCursor();
    c.reset(140, 100); // order of the arguments does not matter
    c.place('belowBar', 10, 14, 4);
    expect(c.shapeY).toBe(149);
    expect(c.textY).toBe(161); // 154 + 7
    c.place('belowBar', 10, 0, 4);
    expect(c.shapeY).toBe(177); // text block ends at 168, then gap 4 and half the shape
  });
  it('above and below stacks are independent; in-bar fans out from the middle', () => {
    const c = new StackCursor();
    c.reset(0, 20);
    c.place('aboveBar', 10, 0, 2);
    c.place('belowBar', 10, 0, 2);
    expect(c.shapeY).toBe(27);
    c.reset(0, 20);
    const ys: number[] = [];
    for (let i = 0; i < 3; i++) { c.place('inBar', 8, 0, 2); ys.push(c.shapeY); }
    expect(ys).toEqual([10, 0, 20]);
  });
  it('a marker never overlaps the bar: shape edge stays outside high/low', () => {
    const c = new StackCursor();
    for (const size of [6, 10, 40]) {
      c.reset(50, 80);
      c.place('aboveBar', size, 0, 3);
      expect(c.shapeY + size / 2).toBeLessThanOrEqual(50);
      c.reset(50, 80);
      c.place('belowBar', size, 0, 3);
      expect(c.shapeY - size / 2).toBeGreaterThanOrEqual(80);
    }
  });
  it('finds rows by time and reads their extent', () => {
    const rows = [{ time: 10 }, { time: 20 }, { time: '1970-01-01' }].slice(0, 2);
    expect(findRow(rows, 20)).toBe(1);
    expect(findRow(rows, 15)).toBe(-1);
    expect(rowExtent({ open: 1, high: 9, low: 0, close: 2 })).toEqual([0, 9]);
    expect(rowExtent({ value: 4 })).toEqual([4, 4]);
    expect(rowExtent({})).toBeNull();
  });
  it('handle: setMarkers, markers copy, remove once', () => {
    const attached: ChartPrimitive[] = [];
    let detached = 0;
    const h = createSeriesMarkers({ data: () => [], attachPrimitive: p => attached.push(p), detachPrimitive: () => { detached++; } }, [m(2), m(1)]);
    expect(h.markers().map(x => x.time)).toEqual([1, 2]);
    let updates = 0;
    attached[0].attached?.({ requestUpdate: () => { updates++; }, series: null });
    h.setMarkers([m(5)]);
    expect(updates).toBe(1);
    expect(h.markers()).toHaveLength(1);
    expect(() => h.setMarkers([m(1, { shape: 'x' as never })])).toThrow();
    expect(h.markers()).toHaveLength(1);
    h.remove(); h.remove();
    expect(detached).toBe(1);
  });
});
