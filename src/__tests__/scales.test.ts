import { describe, expect, it } from 'vitest';
import { nextNiceStep, niceStep, priceTicks, stepDecimals } from '../scales/price-ticks';
import { PriceScaleModel, type PriceScaleOptions } from '../scales/price-scale';
import { TimeScaleModel } from '../scales/time-scale';

const opts = (mode: PriceScaleOptions['mode'], top = 0.1, bottom = 0.1): PriceScaleOptions => ({ mode, autoScale: true, scaleMargins: { top, bottom }, visible: true });

describe('nice steps', () => {
  it('walks the 1-2-5 ladder', () => {
    expect(niceStep(100, 10)).toBe(10);
    expect(niceStep(100, 7)).toBe(20);
    expect(nextNiceStep(0.1)).toBeCloseTo(0.2);
    expect(nextNiceStep(0.2)).toBeCloseTo(0.5);
    expect(nextNiceStep(5)).toBe(10);
    expect(stepDecimals(0.05)).toBe(2);
    expect(stepDecimals(250)).toBe(0);
  });
});

describe('price ticks', () => {
  it('linear: round multiples, gaps at least minGap', () => {
    const t = priceTicks({ pMin: 101.3, pMax: 148.9, priceH: 400, mode: 'linear', minGapPx: 30 });
    const prices = t.map(x => x.price);
    expect(prices[0]).toBeGreaterThanOrEqual(101.3);
    const step = prices[1] - prices[0];
    expect([1, 2, 5, 10, 20].some(s => Math.abs(step - s) < 1e-9)).toBe(true);
    expect((step / (148.9 - 101.3)) * 400).toBeGreaterThanOrEqual(30);
    for (const p of prices) expect(Math.abs(p / step - Math.round(p / step))).toBeLessThan(1e-9);
  });

  it('linear: never finer than the minimum move', () => {
    const t = priceTicks({ pMin: 10.001, pMax: 10.009, priceH: 600, mode: 'linear', minGapPx: 20, minStep: 0.01 });
    expect(t.length).toBeLessThanOrEqual(1);
  });

  it('log: one ladder per decade, the densest that fits', () => {
    const t = priceTicks({ pMin: 100, pMax: 900, priceH: 600, mode: 'log', minGapPx: 22 }).map(x => x.price);
    expect(t).toEqual([100, 200, 300, 400, 500, 600, 700, 800, 900]);
    const wide = priceTicks({ pMin: 1, pMax: 1_000_000, priceH: 150, mode: 'log', minGapPx: 22 }).map(x => x.price);
    expect(wide[0]).toBe(1);
    for (const p of wide) expect(Math.log10(p) % 1).toBeCloseTo(0);
  });

  it('percent: ticks on round percentages from the anchor, 0% included', () => {
    const t = priceTicks({ pMin: 90, pMax: 125, priceH: 400, mode: 'percent', minGapPx: 30, anchor: 100 });
    expect(t.some(x => x.pct === 0 && x.price === 100)).toBe(true);
    for (const x of t) expect(Math.abs((x.pct as number) % 5)).toBeLessThan(1e-9);
  });

  it('returns nothing for an empty or bad range', () => {
    expect(priceTicks({ pMin: 5, pMax: 5, priceH: 100, mode: 'linear', minGapPx: 20 })).toEqual([]);
    expect(priceTicks({ pMin: Number.NaN, pMax: 5, priceH: 100, mode: 'linear', minGapPx: 20 })).toEqual([]);
  });
});

describe('price scale', () => {
  it('linear: fits into the margins and round-trips', () => {
    const s = new PriceScaleModel('right', opts('linear'));
    s.height = 500;
    s.fit(100, 200);
    expect(s.priceToY(200)).toBeCloseTo(50);
    expect(s.priceToY(100)).toBeCloseTo(450);
    expect(s.yToPrice(s.priceToY(137.5))).toBeCloseTo(137.5);
  });

  it('log: equal ratios are equal distances; non-positive prices are not drawable', () => {
    const s = new PriceScaleModel('right', opts('log', 0, 0));
    s.height = 300;
    s.fit(10, 1000);
    expect(s.priceToY(10) - s.priceToY(100)).toBeCloseTo(s.priceToY(100) - s.priceToY(1000));
    expect(Number.isNaN(s.priceToY(0))).toBe(true);
    expect(s.yToPrice(s.priceToY(42))).toBeCloseTo(42);
  });

  it('percent: the base reads 0% and maps like price', () => {
    const s = new PriceScaleModel('right', opts('percent'));
    s.height = 400;
    s.base = 50;
    s.fit(45, 60);
    expect(s.toScale(55)).toBeCloseTo(10);
    expect(s.yToPrice(s.priceToY(51))).toBeCloseTo(51);
  });

  it('a flat range opens around the value; an overlay scale anchors to the bottom', () => {
    const s = new PriceScaleModel('right', opts('linear'));
    s.height = 200;
    s.fit(10, 10);
    expect(s.priceToY(10)).toBeCloseTo(100);
    const vol = new PriceScaleModel('volume', opts('linear', 0.8, 0));
    vol.height = 500;
    vol.fit(0, 1000);
    expect(vol.priceToY(0)).toBeCloseTo(500);
    expect(vol.priceToY(1000)).toBeCloseTo(400);
  });

  it('stretch and shift', () => {
    const s = new PriceScaleModel('right', opts('linear', 0, 0));
    s.height = 100;
    s.fit(0, 100);
    s.scaleBy(2);
    expect(s.min).toBeCloseTo(-50);
    expect(s.max).toBeCloseTo(150);
    s.shiftBy(50);
    expect(s.min).toBeCloseTo(50);
  });
});

describe('time scale (visible-range maths)', () => {
  const make = (count = 1000, width = 800): TimeScaleModel => {
    const t = new TimeScaleModel({ barSpacing: 8, minBarSpacing: 0.5, maxBarSpacing: 64, rightOffset: 2 });
    t.width = width;
    t.count = count;
    return t;
  };

  it('starts at the live edge with the default spacing', () => {
    const t = make();
    const r = t.visibleLogicalRange();
    expect(r?.to).toBe(1001);
    expect(r?.from).toBe(1001 - 100 + 1);
    expect(t.indexToX(999)).toBeCloseTo(800 - 2.5 * 8);
  });

  it('set/get visible logical range round-trips', () => {
    const t = make();
    t.setVisibleLogicalRange({ from: 100, to: 299 });
    expect(t.barSpacing).toBeCloseTo(4);
    const r = t.visibleLogicalRange();
    expect(r?.from).toBeCloseTo(100);
    expect(r?.to).toBeCloseTo(299);
    expect(t.indexToX(100)).toBeCloseTo(2);
    expect(t.xToIndex(t.indexToX(123.4))).toBeCloseTo(123.4);
  });

  it('zoom keeps the bar under the anchor still', () => {
    const t = make();
    const x = 333;
    const i = t.xToIndex(x);
    t.zoom(x, 1.7);
    expect(t.barSpacing).toBeCloseTo(8 * 1.7);
    expect(t.xToIndex(x)).toBeCloseTo(i);
  });

  it('pan moves by pixels; limits keep bars on screen', () => {
    const t = make();
    t.pan(80);
    expect(t.rightOffset).toBeCloseTo(-8);
    t.pan(1e9);
    expect(t.rightIndex()).toBeCloseTo(1);
    t.pan(-1e9);
    const r = t.visibleLogicalRange();
    expect(r?.from).toBeLessThanOrEqual(998);
  });

  it('spacing stays within limits; fitContent clamps to the minimum', () => {
    const t = make(100_000);
    t.fitContent();
    expect(t.barSpacing).toBe(0.5);
    t.zoom(400, 1e6);
    expect(t.barSpacing).toBe(64);
  });

  it('a new bar moves a live view along and leaves a scrolled-back view still', () => {
    const live = make();
    live.count++;
    live.onAppend(1);
    expect(live.rightIndex()).toBe(1002);
    const back = make();
    back.pan(400);
    const before = back.visibleLogicalRange();
    back.count++;
    back.onAppend(1);
    expect(back.visibleLogicalRange()).toEqual(before);
  });

  it('visible bars are clipped to the data', () => {
    const t = make(50);
    const b = t.visibleBars();
    expect(b).toEqual({ from: 0, to: 49 });
  });
});
