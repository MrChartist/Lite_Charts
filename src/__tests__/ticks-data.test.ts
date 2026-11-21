import { describe, expect, it } from 'vitest';
import { formatPercent, formatPrice, formatStamp, MINUS_SIGN, withMinus } from '../core/format';
import { timeToSeconds } from '../core/time';
import { TimeIndex } from '../core/time-index';
import { planTimeTicks } from '../scales/time-ticks';
import { CandlestickSeries, type CandlestickData, type CandlestickOptions } from '../series/candlestick';
import { LineSeries, type LineData, type LineOptions } from '../series/line';
import { SeriesModel } from '../series/series-model';
import type { SeriesCommonOptions } from '../series/definition';

const common: SeriesCommonOptions = { priceScaleId: 'right', visible: true, lastValueVisible: true, priceLineVisible: true, priceFormat: { precision: 2, minMove: 0.01 }, title: '' };
const measure = (text: string): number => text.length * 7;

function weekdays(fromIso: string, count: number): number[] {
  const out: number[] = [];
  let t = timeToSeconds(fromIso);
  while (out.length < count) {
    const wd = new Date(t * 1000).getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(t);
    t += 86400;
  }
  return out;
}

function plan(times: number[], zone: string, business: boolean, plotW: number, from = 0, to = times.length - 1) {
  const idx = new TimeIndex();
  idx.setZone(zone);
  idx.rebuild([{ times, count: times.length }], business);
  const spacing = plotW / (to - from + 1);
  const ticks = planTimeTicks({
    cal: idx.cal, count: idx.count, from, to, xOf: i => (i - from + 0.5) * spacing, barSpacing: spacing,
    plotW, kind: idx.kind, measure,
  });
  return { idx, ticks };
}

describe('time axis ticks', () => {
  it('daily: the year label sits on the first bar of the year; labels never overlap or leave the plot', () => {
    const times = weekdays('2025-10-01', 160);
    const { idx, ticks } = plan(times, 'UTC', true, 900);
    const year = ticks.find(t => t.text === '2026');
    expect(year).toBeDefined();
    const i = year?.index as number;
    expect(idx.cal.year[i]).toBe(2026);
    expect(idx.cal.year[i - 1]).toBe(2025);
    expect(idx.cal.day[i]).toBe(1); // 1 Jan 2026 is a Thursday
    for (let k = 1; k < ticks.length; k++) {
      expect(ticks[k].textX - ticks[k].width / 2).toBeGreaterThanOrEqual(ticks[k - 1].textX + ticks[k - 1].width / 2 + 12 - 1e-9);
    }
    for (const t of ticks) {
      expect(t.textX - t.width / 2).toBeGreaterThanOrEqual(0);
      expect(t.textX + t.width / 2).toBeLessThanOrEqual(900);
    }
    expect(ticks.some(t => t.text === 'Nov')).toBe(true);
  });

  it('a weekend moves a day tick to the next real bar', () => {
    // 15 Nov 2025 is a Saturday: the "15th" tick lands on Monday the 17th.
    const times = weekdays('2025-11-03', 15);
    const { idx, ticks } = plan(times, 'UTC', true, 900);
    const days = ticks.filter(t => t.level === 1).map(t => idx.cal.day[t.index]);
    expect(days).toContain(17);
    expect(days).not.toContain(15);
  });

  it('intraday Asia/Kolkata: each session opens with its date at 09:15', () => {
    const times: number[] = [];
    for (const day of ['2026-03-09', '2026-03-10']) {
      const open = timeToSeconds(day) - 330 * 60 + (9 * 60 + 15) * 60; // 09:15 IST
      for (let k = 0; k < 75; k++) times.push(open + k * 300);
    }
    const { idx, ticks } = plan(times, 'Asia/Kolkata', false, 1000);
    const second = ticks.find(t => t.index === 75);
    expect(second?.text).toBe('10 Mar');
    expect(idx.cal.minute[75]).toBe(555);
    expect(ticks.filter(t => t.level === 1).every(t => /^\d\d:\d\d$/.test(t.text))).toBe(true);
  });

  it('intraday New York across the DST change: clock labels stay on the exchange clock', () => {
    const times: number[] = [];
    for (const [day, offH] of [['2026-03-06', 5], ['2026-03-09', 4]] as const) {
      const open = timeToSeconds(day) + offH * 3600 + 570 * 60; // 09:30 local
      for (let k = 0; k < 78; k++) times.push(open + k * 300);
    }
    const { ticks } = plan(times, 'America/New_York', false, 1200);
    const clocks = ticks.filter(t => t.level === 1).map(t => t.text);
    expect(clocks.length).toBeGreaterThan(2);
    for (const c of clocks) {
      const [h, m] = c.split(':').map(Number);
      expect(h * 60 + m).toBeGreaterThanOrEqual(570);
      expect(h * 60 + m).toBeLessThan(960);
    }
    expect(ticks.find(t => t.index === 78)?.text).toBe('9 Mar');
  });
});

describe('number and time text', () => {
  it('true minus, no grouping, signed percent', () => {
    expect(formatPrice(-1234567.891, 2)).toBe(`${MINUS_SIGN}1234567.89`);
    expect(formatPrice(1234567.891, 2)).toBe('1234567.89');
    expect(formatPrice(-0.001, 2)).toBe('0.00');
    expect(withMinus('-5')).toBe(`${MINUS_SIGN}5`);
    expect(formatPercent(1.5, 2)).toBe('+1.50%');
    expect(formatPercent(-2, 2)).toBe(`${MINUS_SIGN}2.00%`);
    expect(formatPercent(-0.001, 2)).toBe('0.00%');
  });

  it('crosshair stamps per granularity', () => {
    const f = { year: 2026, month: 9, day: 29, minute: 615, weekday: 2 };
    expect(formatStamp(f, 'intraday')).toBe('Tue 29 Sep 2026 10:15');
    expect(formatStamp(f, 'daily')).toBe('Tue 29 Sep 2026');
    expect(formatStamp(f, 'monthly')).toBe('Sep 2026');
    expect(formatStamp(f, 'intraday', { hours12: true, dateOrder: 'month-day' })).toBe('Tue Sep 29 2026 10:15 AM');
  });
});

describe('series data', () => {
  const candles = (): SeriesModel<CandlestickData, CandlestickOptions> => new SeriesModel(CandlestickSeries, { ...CandlestickSeries.defaults, ...common });

  it('setData validates order and keeps whitespace as gaps', () => {
    const s = candles();
    s.setData([
      { time: '2026-01-02', open: 1, high: 2, low: 0.5, close: 1.5 },
      { time: '2026-01-05' },
      { time: '2026-01-06', open: 1.5, high: 1.6, low: 1.1, close: 1.2 },
    ]);
    expect(s.count).toBe(3);
    expect(s.rows[1]).toBeNull();
    expect(s.lastRow()?.close).toBe(1.2);
    expect(() => s.setData([{ time: 2 }, { time: 1 }])).toThrow(/ascending/);
    expect(() => s.setData([{ time: 1 }, { time: 1 }])).toThrow(/ascending/);
    expect(() => s.setData([{ time: 1, open: 1, high: 1, low: 1 }])).toThrow(/close/);
    expect(() => s.setData([{ time: '2026-01-02' }, { time: 1_800_000_000 }])).toThrow(/mixes/);
  });

  it('repairs a range that does not contain its open and close; copies the time', () => {
    const s = candles();
    const day = { year: 2026, month: 1, day: 2 };
    s.setData([{ time: day, open: 10, high: 9, low: 11, close: 10.5 }]);
    const r = s.rows[0] as CandlestickData;
    expect([r.low, r.high]).toEqual([9, 11]);
    expect(r.time).not.toBe(day);
    expect(r.time).toEqual(day);
  });

  it('update replaces the last bar or appends a newer one; older bars are refused', () => {
    const s = new SeriesModel<LineData, LineOptions>(LineSeries, { ...LineSeries.defaults, ...common });
    s.setData([{ time: 100, value: 1 }, { time: 200, value: 2 }]);
    expect(s.update({ time: 200, value: 3 })).toEqual({ kind: 'replace', t: 200 });
    expect((s.rows[1] as LineData).value).toBe(3);
    for (let i = 0; i < 40; i++) s.update({ time: 300 + i * 100, value: i });
    expect(s.count).toBe(42);
    expect(() => s.update({ time: 150, value: 1 })).toThrow(/older/);
  });

  it('row ranges and slot lookups by binary search', () => {
    const s = new SeriesModel<LineData, LineOptions>(LineSeries, { ...LineSeries.defaults, ...common });
    s.setData([{ time: 10, value: 1 }, { time: 30, value: 2 }, { time: 50, value: 3 }]);
    const idx = new TimeIndex();
    idx.rebuild([{ times: [10, 20, 30, 40, 50], count: 5 }], false);
    s.remap(idx);
    expect(Array.from(s.pos.subarray(0, 3))).toEqual([0, 2, 4]);
    expect(s.rowRange(1, 3)).toEqual({ from: 1, to: 1 });
    expect(s.rowRange(1, 1)).toBeNull();
    expect(s.rowAtSlot(4)).toBe(2);
    expect(s.rowAtSlot(3)).toBe(-1);
  });
});
