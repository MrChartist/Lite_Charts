// Regression tests for the independent review of 2026-11-21 (pure parts; the DOM parts are checked in the browser
// scripts). Each block names its finding.
import { describe, expect, it } from 'vitest';
import { wheelAction } from '../chart/input';
import { resolvePriceFormat } from '../core/format';
import { isPlainObject, mergeInto, touchActionFor } from '../core/options';
import { timeToSeconds } from '../core/time';
import { zoneOffsetMs } from '../core/zone';
import { priceTicks } from '../scales/price-ticks';
import { PriceScaleModel } from '../scales/price-scale';
import { TimeScaleModel } from '../scales/time-scale';
import { LineSeries, type LineData, type LineOptions } from '../series/line';
import { SeriesModel } from '../series/series-model';
import type { SeriesCommonOptions } from '../series/definition';

const common: SeriesCommonOptions = { priceScaleId: 'right', visible: true, lastValueVisible: true, priceLineVisible: true, priceFormat: { precision: 2, minMove: 0.01 }, title: '' };

function intlOffset(tz: string, ms: number): number {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
  const v: Record<string, number> = {};
  for (const p of f.formatToParts(ms)) if (p.type !== 'literal') v[p.type] = Number(p.value);
  return Date.UTC(v.year, v.month - 1, v.day, v.hour, v.minute, v.second) - Math.floor(ms / 1000) * 1000;
}

describe('16: zone changes off the whole hour', () => {
  for (const tz of ['America/St_Johns', 'Australia/Lord_Howe']) {
    it(`${tz} equals Intl every 10 minutes over a year`, () => {
      const start = Date.UTC(2025, 0, 1);
      for (let m = 0; m < 366 * 24 * 60; m += 10) {
        const ms = start + m * 60_000 + 7_000;
        expect(zoneOffsetMs(tz, ms)).toBe(intlOffset(tz, ms));
      }
    });
  }

  it('St John\'s switches at 02:00 local (05:30 UTC) on 9 Mar 2025, to the minute', () => {
    const change = Date.UTC(2025, 2, 9, 5, 30);
    expect(zoneOffsetMs('America/St_Johns', change - 60_000)).toBe(-(3 * 60 + 30) * 60_000);
    expect(zoneOffsetMs('America/St_Johns', change)).toBe(-(2 * 60 + 30) * 60_000);
  });
});

describe('22: impossible business days', () => {
  it('rejects 2024-02-31 and 2023-02-29, accepts 2024-02-29', () => {
    expect(() => timeToSeconds('2024-02-31')).toThrow(/not a real date/);
    expect(() => timeToSeconds({ year: 2023, month: 2, day: 29 })).toThrow(TypeError);
    expect(timeToSeconds('2024-02-29')).toBe(Date.UTC(2024, 1, 29) / 1000);
  });
});

describe('17: option merging', () => {
  it('ignores NaN and Infinity, keeping the previous value', () => {
    const o = { a: 1, b: { c: 2 } };
    mergeInto(o, { a: Number.NaN, b: { c: Number.POSITIVE_INFINITY } });
    expect(o).toEqual({ a: 1, b: { c: 2 } });
    mergeInto(o, { a: 3 });
    expect(o.a).toBe(3);
  });

  it('accepts plain objects from another realm (prototype with a null prototype)', () => {
    const foreignProto = Object.create(null) as object;
    const foreign = Object.create(foreignProto) as Record<string, unknown>;
    foreign.c = 5;
    expect(isPlainObject(foreign)).toBe(true);
    expect(isPlainObject(new Date(0))).toBe(false);
    expect(isPlainObject([])).toBe(false);
    const o = { b: { c: 2, d: 1 } };
    mergeInto(o, { b: foreign });
    expect(o.b).toEqual({ c: 5, d: 1 });
  });
});

describe('20: touch-action follows the gesture options', () => {
  it('keeps every gesture the chart does not handle', () => {
    expect(touchActionFor({ dragPan: true, pinchZoom: true })).toBe('pan-y');
    expect(touchActionFor({ dragPan: true, pinchZoom: false })).toBe('pan-y pinch-zoom');
    expect(touchActionFor({ dragPan: false, pinchZoom: true })).toBe('pan-x pan-y');
    expect(touchActionFor({ dragPan: false, pinchZoom: false })).toBe('auto');
  });
});

describe('10: price format from minMove', () => {
  it('derives the precision from minMove alone, minMove from precision alone', () => {
    expect(resolvePriceFormat({ minMove: 0.25 })).toEqual({ precision: 2, minMove: 0.25 });
    expect(resolvePriceFormat({ minMove: 5 })).toEqual({ precision: 0, minMove: 5 });
    expect(resolvePriceFormat({ minMove: 0.0005 })).toEqual({ precision: 4, minMove: 0.0005 });
    expect(resolvePriceFormat({ precision: 3 })).toEqual({ precision: 3, minMove: 0.001 });
    expect(resolvePriceFormat({ precision: 1, minMove: 0.5 })).toEqual({ precision: 1, minMove: 0.5 });
    expect(resolvePriceFormat({ precision: Number.NaN, minMove: -1 })).toEqual({ precision: 2, minMove: 0.01 });
  });

  it('the axis never ticks finer than minMove', () => {
    const t = priceTicks({ pMin: 100, pMax: 101, priceH: 600, mode: 'linear', minGapPx: 20, minStep: 0.25 });
    for (let i = 1; i < t.length; i++) expect(t[i].price - t[i - 1].price).toBeGreaterThanOrEqual(0.25 - 1e-9);
  });
});

describe('14 and 15: flat tiny prices, percent with a negative base', () => {
  const opts = { mode: 'linear' as const, autoScale: true, scaleMargins: { top: 0, bottom: 0 }, visible: true };

  it('a flat tiny price opens relative to itself', () => {
    const s = new PriceScaleModel('right', { ...opts });
    s.height = 100;
    s.fit(0.00012, 0.00012);
    expect(s.max - s.min).toBeCloseTo(0.0000024, 10);
    const z = new PriceScaleModel('right', { ...opts });
    z.height = 100;
    z.fit(0, 0);
    expect([z.min, z.max]).toEqual([-1, 1]);
  });

  it('percent divides by |base|: a rise from a negative base reads positive', () => {
    const s = new PriceScaleModel('right', { ...opts, mode: 'percent' });
    s.base = -50;
    expect(s.toScale(-25)).toBeCloseTo(50);
    expect(s.toScale(-75)).toBeCloseTo(-50);
    expect(s.fromScale(s.toScale(-40))).toBeCloseTo(-40);
    const t = priceTicks({ pMin: -75, pMax: -25, priceH: 400, mode: 'percent', minGapPx: 30, anchor: -50 });
    expect(t.find(x => x.pct === 0)?.price).toBe(-50);
    for (const x of t) expect(s.toScale(x.price)).toBeCloseTo(x.pct as number);
  });
});

describe('12: a shorter series while scrolled back', () => {
  it('returns to the live edge when little would be left on screen', () => {
    const t = new TimeScaleModel({ barSpacing: 8, minBarSpacing: 0.5, maxBarSpacing: 64, rightOffset: 2 });
    t.width = 800;
    t.count = 1000;
    t.pan(8 * 600); // 600 bars back
    t.count = 300;
    expect(t.onShrink(1000)).toBe(true);
    expect(t.rightOffset).toBe(2);
    const live = new TimeScaleModel({ barSpacing: 8, minBarSpacing: 0.5, maxBarSpacing: 64, rightOffset: 2 });
    live.width = 800;
    live.count = 290;
    expect(live.onShrink(300)).toBe(false);
  });
});

describe('6: wheel', () => {
  const v = { dx: 0, dy: 100, modifier: false };
  it("'auto' zooms on a plain wheel only with focus or when the page cannot scroll", () => {
    expect(wheelAction('auto', v, false, true)).toBe('none');
    expect(wheelAction('auto', v, true, true)).toBe('zoom');
    expect(wheelAction('auto', v, false, false)).toBe('zoom');
  });
  it('ctrl/cmd always zooms, horizontal pans, false ignores everything', () => {
    expect(wheelAction('auto', { ...v, modifier: true }, false, true)).toBe('zoom');
    expect(wheelAction('modifier', { ...v, modifier: true }, false, true)).toBe('zoom');
    expect(wheelAction('modifier', v, true, false)).toBe('none');
    expect(wheelAction(true, v, false, true)).toBe('zoom');
    expect(wheelAction('auto', { dx: 80, dy: 5, modifier: false }, false, true)).toBe('pan');
    expect(wheelAction(false, { ...v, modifier: true }, true, false)).toBe('none');
  });
});

describe('3 and 13: series data', () => {
  const make = (): SeriesModel<LineData, LineOptions> => new SeriesModel(LineSeries, { ...LineSeries.defaults, ...common });

  it('a call with the wrong kind of time changes nothing', () => {
    const s = make();
    s.setData([{ time: 100, value: 1 }, { time: 200, value: 2 }]);
    expect(() => s.setData([{ time: '2026-01-02', value: 1 }], false)).toThrow(/timestamps/);
    expect(s.count).toBe(2);
    expect(s.businessDays).toBe(false);
    expect(() => s.update({ time: '2026-01-02', value: 1 }, false)).toThrow(TypeError);
    expect(s.count).toBe(2);
    s.setData([{ time: 300, value: 3 }], false);
    expect(s.count).toBe(1);
  });

  it('data() is cached until the next change, whitespace left out', () => {
    const s = make();
    s.setData([{ time: 1, value: 1 }, { time: 2 }, { time: 3, value: 3 }]);
    const a = s.data();
    expect(a.map(r => r.value)).toEqual([1, 3]);
    expect(s.data()).toBe(a);
    s.update({ time: 4, value: 4 });
    expect(s.data()).not.toBe(a);
    expect(s.data().length).toBe(3);
  });
});
