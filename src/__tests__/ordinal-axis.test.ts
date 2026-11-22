// The ordinal (brick) time axis: the time index in ordinal mode (rows by order, true times, one-to-one virtual
// times), the series model's rules for repeated times, and the brick label rule in the time-tick planner. Cases ported
// from the host engine's `timeAxisTicks.test.ts` ("irregular (brick) axes", 2026-10-18), plus brick-specific ones.

import { describe, expect, it } from 'vitest';
import { inferTimeKind, timeToSeconds, type TimeKind } from '../core/time';
import { TimeIndex } from '../core/time-index';
import { planTimeTicks, type TimeTick } from '../scales/time-ticks';
import { CandlestickSeries } from '../series/candlestick';
import { LineSeries } from '../series/line';
import { OFF, SeriesModel } from '../series/series-model';
import type { SeriesCommonOptions } from '../series/definition';
import { applyDelta, brickTickText, ordinalSeries } from '../transforms/brick-axis';
import { applyChartType } from '../transforms/chart-types';
import { createRenko, renko } from '../transforms/renko';
import { createLineBreak } from '../transforms/line-break';
import { createRangeBars } from '../transforms/range-bars';
import { zoneDayNumber, zoneMinuteOfDay } from '../core/zone';

const common: SeriesCommonOptions = { priceScaleId: 'right', visible: true, lastValueVisible: true, priceLineVisible: true, priceFormat: { precision: 2, minMove: 0.01 }, title: '' };
/** The host test's metric: 6.5 px a glyph. */
const measure = (text: string): number => text.length * 6.5;
const MIN = 60;
/** Seconds of an IST wall-clock time (India has no DST: a fixed +05:30). */
const ist = (y: number, m: number, d: number, h = 0, mi = 0): number => Date.UTC(y, m - 1, d, h, mi) / 1000 - 330 * MIN;

function index(times: number[], zone = 'UTC', business = false, ordinal = true): TimeIndex {
  const idx = new TimeIndex();
  idx.setZone(zone);
  idx.rebuild([{ times, count: times.length }], business, ordinal);
  return idx;
}

function plan(times: number[], o: { slotW: number; plotW: number; zone?: string; business?: boolean; irregular?: boolean; kind?: TimeKind; ordinal?: boolean }) {
  const idx = index(times, o.zone ?? 'Asia/Kolkata', o.business ?? false, o.ordinal ?? true);
  const ticks = planTimeTicks({
    cal: idx.cal, count: idx.count, from: 0, to: idx.count - 1, xOf: i => o.slotW / 2 + i * o.slotW, barSpacing: o.slotW,
    plotW: o.plotW, kind: o.kind ?? idx.kind, measure,
    starts: { day: idx.dayStarts, dayCount: idx.dayStartCount, month: idx.monthStarts, monthCount: idx.monthStartCount },
    tickText: o.irregular === false ? undefined : brickTickText,
  });
  return { idx, ticks };
}

function expectClean(ticks: TimeTick[], plotW: number, count: number): void {
  for (let i = 1; i < ticks.length; i++) {
    expect(ticks[i].textX - ticks[i].width / 2 - (ticks[i - 1].textX + ticks[i - 1].width / 2), `${ticks[i - 1].text} -> ${ticks[i].text}`).toBeGreaterThanOrEqual(12 - 1e-9);
  }
  for (const t of ticks) {
    expect(Number.isInteger(t.index) && t.index >= 0 && t.index < count, `${t.text} on a brick`).toBe(true);
    expect(t.textX - t.width / 2).toBeGreaterThanOrEqual(4 - 1e-9);
    expect(t.textX + t.width / 2).toBeLessThanOrEqual(plotW - 4 + 1e-9);
  }
}

describe('brick axis labels (ported from the host, 2026-10-18)', () => {
  // Renko-like bricks dated by their source bars: a run in 2010, then a ten-year gap, then 2020 and 2022.
  const bricks = [
    ist(2010, 6, 14, 9, 15), ist(2010, 6, 15, 9, 15), ist(2010, 9, 2, 9, 15),
    ist(2020, 8, 18, 9, 15), ist(2020, 8, 19, 9, 15), ist(2021, 1, 4, 9, 15),
    ist(2022, 3, 9, 9, 15), ist(2022, 3, 10, 9, 15),
  ];

  it('a year label names its month unless its brick is in January, so a jump reads as a jump', () => {
    const normal = plan(bricks, { slotW: 60, plotW: 480, irregular: false, kind: 'daily' }).ticks.filter(t => t.level === 4).map(t => t.text);
    const irregular = plan(bricks, { slotW: 60, plotW: 480, kind: 'daily' }).ticks.filter(t => t.level === 4).map(t => t.text);
    expect(normal).toEqual(['2010', '2020', '2021', '2022']);
    expect(irregular).toEqual(['Jun 2010', 'Aug 2020', '2021', 'Mar 2022']);
  });

  it('the ordinal index reads these bricks as daily (smallest gap) without being told', () => {
    expect(index(bricks, 'Asia/Kolkata').kind).toBe('daily');
    expect(plan(bricks, { slotW: 60, plotW: 480 }).ticks.filter(t => t.level === 4).map(t => t.text)).toEqual(['Jun 2010', 'Aug 2020', '2021', 'Mar 2022']);
  });

  it('labels stay on the bricks (no invented ticks) and never collide', () => {
    const { ticks } = plan(bricks, { slotW: 30, plotW: 240 });
    expect(ticks.length).toBeGreaterThan(0);
    expectClean(ticks, 240, bricks.length);
  });

  it('month labels add the day past the first week; other labels are unchanged', () => {
    expect(brickTickText(3, 'Mar', { year: 2022, month: 3, day: 17 }, {})).toBe('17 Mar');
    expect(brickTickText(3, 'Mar', { year: 2022, month: 3, day: 17 }, { dateOrder: 'month-day' })).toBe('Mar 17');
    expect(brickTickText(3, 'Mar', { year: 2022, month: 3, day: 3 }, {})).toBe('Mar');
    expect(brickTickText(3, 'Mar', { year: 2022, month: 3, day: 7 }, {})).toBe('Mar');
    expect(brickTickText(3, 'Mar', { year: 2022, month: 3, day: 8 }, {})).toBe('8 Mar');
    expect(brickTickText(3, '17 Mar', { year: 2022, month: 3, day: 17 }, {})).toBe('17 Mar');
    expect(brickTickText(4, '2021', { year: 2021, month: 1, day: 4 }, {})).toBe('2021');
    expect(brickTickText(4, '2021', { year: 2021, month: 1, day: 29 }, {})).toBe('2021');
    expect(brickTickText(4, '2021', { year: 2021, month: 2, day: 1 }, {})).toBe('Feb 2021');
    expect(brickTickText(1, '17', { year: 2022, month: 3, day: 17 }, {})).toBe('17');
    expect(brickTickText(1, '09:15', { year: 2022, month: 3, day: 17 }, {})).toBe('09:15');
    expect(brickTickText(2, '17 Mar', { year: 2022, month: 3, day: 17 }, {})).toBe('17 Mar');
  });

  it('a calendar chart is unchanged by the hook being absent', () => {
    const days: number[] = [];
    for (let t = Date.UTC(2025, 10, 3) / 1000; days.length < 80; t += 86400) if (![0, 6].includes(new Date(t * 1000).getUTCDay())) days.push(t);
    const a = plan(days, { slotW: 8, plotW: days.length * 8, ordinal: false, irregular: false, zone: 'UTC' }).ticks;
    const plainIdx = new TimeIndex();
    plainIdx.rebuild([{ times: days, count: days.length }], false);
    const b = planTimeTicks({ cal: plainIdx.cal, count: days.length, from: 0, to: days.length - 1, xOf: i => 4 + i * 8, barSpacing: 8, plotW: days.length * 8, kind: plainIdx.kind, measure, starts: { day: plainIdx.dayStarts, dayCount: plainIdx.dayStartCount, month: plainIdx.monthStarts, monthCount: plainIdx.monthStartCount } });
    expect(b).toEqual(a);
  });
});

describe('brick axis labels: brick-specific cases', () => {
  it('several bricks from one day: one label, on the first of them; the others are never boundaries', () => {
    const d = (m: number, day: number): number => Date.UTC(2024, m - 1, day) / 1000;
    const times = [d(2, 26), d(2, 27), d(3, 18), d(3, 18), d(3, 18), d(3, 18), d(3, 19), d(4, 2), d(4, 2), d(4, 22)];
    const { ticks } = plan(times, { slotW: 70, plotW: 700, zone: 'UTC', business: true });
    expectClean(ticks, 700, times.length);
    for (const t of ticks) expect(t.index === 0 || times[t.index] !== times[t.index - 1], `${t.text} on a repeated brick`).toBe(true);
    expect(ticks.map(t => t.text)).toEqual(['Feb 2024', '27', '18 Mar', '19', 'Apr', '22']);
  });

  it('two neighbouring bricks ten years apart: both labels name where they are', () => {
    const times = [Date.UTC(2012, 4, 10) / 1000, Date.UTC(2012, 4, 10) / 1000, Date.UTC(2012, 4, 10) / 1000, Date.UTC(2022, 10, 3) / 1000, Date.UTC(2022, 10, 3) / 1000];
    const { ticks } = plan(times, { slotW: 80, plotW: 400, zone: 'UTC', business: true });
    expect(ticks.map(t => [t.index, t.text])).toEqual([[0, 'May 2012'], [3, 'Nov 2022']]);
  });

  it('bricks spanning a DST change: clock labels are the zone\'s own wall clock on both sides', () => {
    const zone = 'America/New_York';
    // 30-minute bars around 8 March 2026 (clocks jump from 02:00 EST to 03:00 EDT), several bricks per bar.
    const times: number[] = [];
    for (const [day, utcOpen] of [[6, 14.5], [9, 13.5], [10, 13.5]] as const) {
      for (let k = 0; k < 13; k++) {
        const t = Date.UTC(2026, 2, day) / 1000 + utcOpen * 3600 + k * 1800;
        times.push(t);
        if (k % 3 === 0) times.push(t, t);
      }
    }
    const { idx, ticks } = plan(times, { slotW: 14, plotW: times.length * 14, zone });
    expect(idx.kind).toBe('intraday');
    expectClean(ticks, times.length * 14, times.length);
    const clock = (t: number): string => { const m = zoneMinuteOfDay(zone, t * 1000); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
    const clocks = ticks.filter(t => t.level === 1);
    expect(clocks.length).toBeGreaterThan(2);
    for (const t of clocks) expect(t.text).toBe(clock(times[t.index]));
    // Every session opens at 09:30 local, before and after the change.
    for (const day of [6, 9, 10]) expect(clock(Date.UTC(2026, 2, day) / 1000 + (day === 6 ? 14.5 : 13.5) * 3600)).toBe('09:30');
    // The first brick opens the chart with its session date (intraday), as on a calendar axis.
    expect(ticks.filter(t => t.level === 2).map(t => t.text)).toEqual(['6 Mar', '9 Mar', '10 Mar']);
    expect(ticks[0]).toMatchObject({ index: 0, text: '6 Mar' });
  });

  it('a single brick: one label that names its month and year', () => {
    const { ticks } = plan([Date.UTC(2024, 2, 18, 14, 30) / 1000], { slotW: 6, plotW: 600, zone: 'UTC' });
    expect(ticks.map(t => [t.index, t.text])).toEqual([[0, 'Mar 2024']]);
  });

  it('all bricks inside one day on intraday data: the date on the first, then clock times, all on bricks', () => {
    const base = Date.UTC(2026, 2, 18, 13, 31) / 1000;
    const times: number[] = [];
    for (let k = 0; k < 120; k++) { const t = base + k * 60 * (k % 4 === 0 ? 1 : 1); times.push(t); if (k % 5 === 0) times.push(t); }
    const { idx, ticks } = plan(times, { slotW: 6, plotW: times.length * 6, zone: 'UTC' });
    expect(idx.kind).toBe('intraday');
    expectClean(ticks, times.length * 6, times.length);
    expect(ticks[0]).toMatchObject({ index: 0, text: '18 Mar', level: 2 });
    for (const t of ticks.slice(1)) expect(t.text).toMatch(/^\d\d:\d\d$/);
  });

  it('business-day data: the calendar is read on UTC; a January brick keeps the bare year', () => {
    const iso = ['2019-08-14', '2019-08-14', '2019-08-27', '2019-11-20', '2020-01-02', '2020-01-02', '2020-03-23', '2020-03-23', '2020-03-24', '2021-06-02'];
    const times = iso.map(s => timeToSeconds(s));
    const { idx, ticks } = plan(times, { slotW: 90, plotW: 900, zone: 'Pacific/Auckland', business: true });
    expect(idx.displayZone()).toBe('UTC');
    expectClean(ticks, 900, times.length);
    expect(ticks.map(t => t.text)).toEqual(['Aug 2019', '27', '20 Nov', '2020', '23 Mar', '24', 'Jun 2021']);
  });

  it('sparser than a calendar axis: the longer texts keep fewer labels in the same room', () => {
    const times: number[] = [];
    for (let y = 2001; y <= 2024; y++) times.push(Date.UTC(y, (y * 5) % 12, 10 + (y % 15)) / 1000);
    const cal = plan(times, { slotW: 60, plotW: times.length * 60, zone: 'UTC', irregular: false }).ticks;
    const brk = plan(times, { slotW: 60, plotW: times.length * 60, zone: 'UTC' }).ticks;
    expect(cal).toHaveLength(24);
    expect(brk.length).toBeLessThan(cal.length);
    expectClean(brk, times.length * 60, times.length);
    for (const t of brk) if (t.level === 4) expect(t.text === String(new Date(times[t.index] * 1000).getUTCFullYear()) ? new Date(times[t.index] * 1000).getUTCMonth() === 0 : true).toBe(true);
  });
});

describe('ordinal time index', () => {
  const T = (d: number, h = 0): number => Date.UTC(2024, 0, d, h) / 1000;
  const times = [T(2), T(2), T(2), T(3), T(5), T(5), T(8), T(8), T(8), T(8)];

  it('keeps every row in order, repeats included; an exact time finds its first slot', () => {
    const idx = index(times);
    expect(idx.count).toBe(10);
    expect(idx.ordinal).toBe(true);
    expect(Array.from(idx.times.subarray(0, 10))).toEqual(times);
    expect(idx.indexOf(T(5))).toBe(4);
    expect(idx.lowerBound(T(8))).toBe(6);
    expect(idx.lowerBound(T(8), true)).toBe(10);
    expect(idx.minGap).toBe(86400);
    expect(idx.dayStartCount).toBe(4);
    expect(Array.from(idx.dayStarts.subarray(0, 4))).toEqual([0, 3, 4, 6]);
  });

  it('virtual times: one per slot, strictly increasing, inside [T, T + span); round trip exact', () => {
    const idx = index(times);
    const span = idx.span(() => 60);
    const step = (): number => span;
    const v = Array.from({ length: 10 }, (_, k) => idx.timeOf(k, step) as number);
    for (let k = 1; k < 10; k++) expect(v[k]).toBeGreaterThan(v[k - 1]);
    for (let k = 0; k < 10; k++) { expect(v[k]).toBeGreaterThanOrEqual(times[k]); expect(v[k]).toBeLessThan(times[k] + 86400); }
    expect(v[0]).toBe(times[0]);
    expect(v[1]).toBe(T(2) + 43200);
    expect(v[2]).toBe(T(2) + 57600);
    for (let l = -3; l <= 13; l += 0.25) expect(idx.logicalOf(idx.timeOf(l, step) as number, step)).toBeCloseTo(l, 9);
    // An exact repeated time is its first brick.
    expect(idx.logicalOf(T(8), step)).toBe(6);
    // A time between groups lands between their bricks, monotonic.
    const a = idx.logicalOf(T(4), step) as number;
    expect(a).toBeGreaterThan(3);
    expect(a).toBeLessThan(4);
  });

  it('virtual times of the bricks already there do not move when bricks are appended', () => {
    const idx = index(times);
    const before = Array.from({ length: 10 }, (_, k) => idx.timeOf(k, () => idx.span(() => 60)));
    idx.append(T(8));
    idx.append(T(9));
    idx.append(T(9));
    for (let k = 0; k < 10; k++) expect(idx.timeOf(k, () => idx.span(() => 60))).toBe(before[k]);
    expect(idx.logicalOf(before[8] as number, () => idx.span(() => 60))).toBeCloseTo(8, 9);
    idx.truncate(10);
    expect(idx.count).toBe(10);
    expect(idx.dayStartCount).toBe(4);
    expect(idx.timeOf(9, () => idx.span(() => 60))).toBe(before[9]);
  });

  it('calendar mode keeps the old interpolation exactly', () => {
    const cal = [T(2), T(3), T(4), T(8), T(9)];
    const idx = index(cal, 'UTC', false, false);
    const step = (): number => 86400;
    const legacyToL = (t: number): number => {
      const i = idx.lowerBound(t);
      if (i < cal.length && cal[i] === t) return i;
      if (i === 0) return (t - cal[0]) / step();
      if (i === cal.length) return cal.length - 1 + (t - cal[cal.length - 1]) / step();
      return i - 1 + (t - cal[i - 1]) / (cal[i] - cal[i - 1]);
    };
    const legacyToT = (l: number): number => {
      if (l <= 0) return cal[0] + l * step();
      if (l >= cal.length - 1) return cal[cal.length - 1] + (l - cal.length + 1) * step();
      const i = Math.floor(l);
      return cal[i] + (l - i) * (cal[i + 1] - cal[i]);
    };
    for (let t = T(1); t <= T(11); t += 3600 * 5) expect(idx.logicalOf(t, step)).toBeCloseTo(legacyToL(t), 12);
    for (let l = -2; l <= 6; l += 0.125) expect(idx.timeOf(l, step)).toBeCloseTo(legacyToT(l), 6);
  });

  it('kind from the smallest positive gap on an ordinal axis; repeats never read as intraday', () => {
    const daily = [T(2), T(2), T(2), T(2), T(3), T(10), T(10), T(30)];
    expect(inferTimeKind(daily, daily.length, true)).toBe('daily');
    expect(inferTimeKind(daily, daily.length)).not.toBe('intraday');
    expect(inferTimeKind([T(2, 9), T(2, 9), T(2, 10), T(9, 10)], 4, true)).toBe('intraday');
    expect(inferTimeKind([T(2), T(2)], 2, true)).toBe('daily');
  });
});

describe('series model on an ordinal axis', () => {
  const rows = (ts: number[]): { time: number; value: number }[] => ts.map((time, i) => ({ time, value: i }));

  it('repeated times only with dup; an aligned series must match the axis row for row', () => {
    const lead = new SeriesModel(LineSeries, { ...LineSeries.defaults, ...common } as never);
    expect(() => lead.setData(rows([1, 1, 2]))).toThrow(/ascending/);
    lead.setData(rows([1, 1, 2]), null, true);
    const idx = index(Array.from(lead.times.subarray(0, 3)));
    const other = new SeriesModel(LineSeries, { ...LineSeries.defaults, ...common } as never);
    expect(() => other.setData(rows([1, 2, 2]), null, true, idx)).toThrow(/row 1/);
    expect(other.count).toBe(0);
    other.setData(rows([1, 1]), null, true, idx);
    other.remap(idx);
    expect(Array.from(other.pos.subarray(0, 2))).toEqual([0, 1]);
    // A row the axis does not have yet is kept off the axis.
    other.update({ time: 2, value: 9 }, null, true, true, idx);
    other.update({ time: 3, value: 9 }, null, true, true, idx);
    other.remap(idx);
    expect(Array.from(other.pos.subarray(0, 4))).toEqual([0, 1, 2, OFF]);
    expect(() => other.update({ time: 3, value: 1 }, null, false, true, idx)).not.toThrow();
  });

  it('update: same time replaces unless append; pop removes from the end', () => {
    const m = new SeriesModel(CandlestickSeries, { ...CandlestickSeries.defaults, ...common } as never);
    m.setData([{ time: 5, open: 1, high: 2, low: 0, close: 1 }], null, true);
    expect(m.update({ time: 5, open: 1, high: 3, low: 0, close: 2 }, null, false, true).kind).toBe('replace');
    expect(m.update({ time: 5, open: 2, high: 3, low: 2, close: 3 }, null, true, true).kind).toBe('append');
    expect(m.count).toBe(2);
    expect(() => m.update({ time: 5, open: 2, high: 3, low: 2, close: 3 }, null, true, false)).toThrow(RangeError);
    m.pop(1);
    expect(m.count).toBe(1);
    expect(m.data()).toHaveLength(1);
    m.pop(5);
    expect(m.count).toBe(0);
    expect(m.businessDays).toBeNull();
  });
});

describe('incremental transforms on an ordinal series (applyDelta)', () => {
  function walk(n: number, seed: number): { time: number; open: number; high: number; low: number; close: number; volume: number }[] {
    let x = 100, s = seed;
    const rnd = (): number => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    return Array.from({ length: n }, (_, i) => {
      const o = x; x += (rnd() - 0.5) * 4; const c = x;
      return { time: 1_700_000_000 + i * 60, open: o, high: Math.max(o, c) + rnd(), low: Math.min(o, c) - rnd(), close: c, volume: 10 + Math.round(rnd() * 100) };
    });
  }
  /** A series stand-in that records rows the way the chart's ordinal series stores them. */
  function sink(): { rows: { time: number; close?: number; value?: number }[]; update(r: never, o?: { append?: boolean }): void; pop(n?: number): void } {
    const rows: { time: number }[] = [];
    return {
      rows,
      update(r: never, o?: { append?: boolean }) { const row = r as { time: number }; const last = rows[rows.length - 1]; if (last && last.time === row.time && !o?.append) rows[rows.length - 1] = row; else rows.push(row); },
      pop(n = 1) { rows.length = Math.max(0, rows.length - n); },
    };
  }

  for (const [name, make] of [
    ['renko', (h: never[]) => createRenko(h, { brick: 0.8 })],
    ['line break', (h: never[]) => createLineBreak(h, { lines: 3 })],
    ['range bars', (h: never[]) => createRangeBars(h, { range: 1 })],
  ] as const) {
    it(`${name}: ticks on the forming bar (rollbacks included) end where the batch transform ends`, () => {
      const bars = walk(400, 7);
      const inc = make(bars.slice(0, 300) as never[]);
      const main = sink();
      const vol = sink();
      applyDelta(main, { from: 0, rows: [...inc.rows], removed: 0 });
      applyDelta(vol, { from: 0, rows: [...inc.rows], removed: 0 }, b => ({ time: b.time, value: b.volume }));
      let removedSeen = 0;
      for (let i = 300; i < 400; i++) {
        const b = bars[i];
        // Three ticks on the forming bar, the middle one far away (it makes bricks the last tick takes back).
        for (const c of [b.open, b.close + (i % 2 ? 6 : -6), b.close]) {
          const d = inc.update({ ...b, close: c, high: Math.max(b.high, c), low: Math.min(b.low, c) });
          removedSeen += d.removed;
          applyDelta(main, d);
          applyDelta(vol, d, r => ({ time: r.time as number, value: r.volume }));
        }
      }
      expect(removedSeen).toBeGreaterThan(0);
      expect(main.rows).toEqual(inc.rows);
      expect(vol.rows.map(r => r.time)).toEqual(inc.rows.map(r => r.time));
      if (name !== 'line break') expect(inc.rows.some((r, i) => i > 0 && r.time === inc.rows[i - 1].time)).toBe(true);
    });
  }

  it('applyChartType hands an ordinal definition the chart can tell apart; ordinalSeries is cached', () => {
    const bars = walk(200, 3);
    const a = applyChartType('renko', bars, { brick: 0.5 });
    expect(a.definition.ordinal?.tickText).toBe(brickTickText);
    expect(a.definition).toBe(ordinalSeries(CandlestickSeries));
    expect(ordinalSeries(a.definition)).toBe(a.definition);
    expect(a.data).toEqual(renko(bars, { brick: 0.5 }).rows);
    expect(applyChartType('heikinAshi', bars).definition.ordinal).toBeUndefined();
    expect(zoneDayNumber('UTC', 0)).toBe(0);
  });
});
