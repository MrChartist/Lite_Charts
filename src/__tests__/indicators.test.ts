import { describe, expect, it } from 'vitest';
import {
  aggregate, atr, bollinger, createIndicator, donchian, ema, heikinAshi, macd, obv, rsi, sma, stochastic, supertrend, vwap, wma,
} from '../indicators/index';
import type { IndicatorPoint, IndicatorRow } from '../indicators/index';

const t = (i: number): number => 1_700_000_000 + i * 86_400;
const closes = (cs: number[]): IndicatorRow[] => cs.map((c, i) => ({ time: t(i), close: c }));
const bars = (hlc: [number, number, number][], volume?: number[]): IndicatorRow[] =>
  hlc.map(([high, low, close], i) => ({ time: t(i), open: close, high, low, close, volume: volume ? volume[i] : undefined }));
const vals = (pts: IndicatorPoint[]): (number | null)[] => pts.map(p => (p.value === undefined ? null : p.value));
const near = (a: (number | null)[], b: (number | null)[], eps = 1e-9): void => {
  expect(a.length).toBe(b.length);
  a.forEach((v, i) => (v === null || b[i] === null ? expect(v).toBe(b[i]) : expect(Math.abs(v - (b[i] as number))).toBeLessThanOrEqual(eps)));
};
const firstValue = (pts: IndicatorPoint[]): number => pts.findIndex(p => p.value !== undefined);

/** Deterministic candles: seeded walk, 5-minute bars over several New York days (instants), with volume. */
function series(n: number, seed = 7, stepSeconds = 86_400, start = 1_700_000_000): IndicatorRow[] {
  let s = seed >>> 0;
  const rand = (): number => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const out: IndicatorRow[] = [];
  let close = 100;
  for (let i = 0; i < n; i++) {
    const open = close;
    close = Math.max(1, open * (1 + (rand() - 0.49) * 0.03));
    const high = Math.max(open, close) * (1 + rand() * 0.01);
    const low = Math.min(open, close) * (1 - rand() * 0.01);
    out.push({ time: start + i * stepSeconds, open, high, low, close, volume: Math.floor(1000 + rand() * 5000) });
  }
  return out;
}

describe('hand-checked vectors', () => {
  it('sma', () => {
    expect(vals(sma(closes([1, 2, 3, 4, 5]), 3))).toEqual([null, null, 2, 3, 4]);
  });
  it('ema (SMA seed, k = 2 / (p + 1))', () => {
    near(vals(ema(closes([1, 2, 3, 5, 4]), 3)), [null, null, 2, 3.5, 3.75]);
  });
  it('wma', () => {
    near(vals(wma(closes([1, 2, 3, 4]), 3)), [null, null, 14 / 6, 20 / 6]);
  });
  it('rsi (Wilder)', () => {
    near(vals(rsi(closes([1, 2, 3, 2, 3]), 2)), [null, null, 100, 50, 75]);
    expect(vals(rsi(closes([5, 5, 5, 5]), 2))).toEqual([null, null, 50, 50]);
    expect(vals(rsi(closes([4, 3, 2, 1]), 2))).toEqual([null, null, 0, 0]);
  });
  it('bollinger (population deviation)', () => {
    const b = bollinger(closes([1, 2, 3, 4]), { period: 3, mult: 2 });
    const sd = Math.sqrt(2 / 3);
    near(vals(b.basis), [null, null, 2, 3]);
    near(vals(b.upper), [null, null, 2 + 2 * sd, 3 + 2 * sd]);
    near(vals(b.lower), [null, null, 2 - 2 * sd, 3 - 2 * sd]);
    expect(vals(bollinger(closes([7, 7, 7, 7]), { period: 3 }).upper)).toEqual([null, null, 7, 7]);
  });
  it('donchian', () => {
    const d = donchian(bars([[10, 8, 9], [12, 9, 11], [11, 7, 10], [9, 8, 9]]), 2);
    expect(vals(d.upper)).toEqual([null, 12, 12, 11]);
    expect(vals(d.lower)).toEqual([null, 8, 7, 7]);
    expect(vals(d.middle)).toEqual([null, 10, 9.5, 9]);
  });
  it('atr (Wilder, first true range is high - low)', () => {
    near(vals(atr(bars([[10, 8, 9], [12, 9, 11], [11, 9, 10]]), 2)), [null, 2.5, 2.25]);
  });
  it('obv', () => {
    const rows = bars([[10, 10, 10], [11, 11, 11], [10.5, 10.5, 10.5], [10.5, 10.5, 10.5], [12, 12, 12]], [100, 200, 150, 50, 300]);
    expect(vals(obv(rows))).toEqual([0, 200, 50, 50, 350]);
  });
  it('stochastic', () => {
    const s = stochastic(bars([[10, 8, 9], [11, 9, 10], [12, 10, 11], [13, 11, 12]]), { kPeriod: 3, dPeriod: 2 });
    expect(vals(s.k)).toEqual([null, null, 75, 75]);
    expect(vals(s.d)).toEqual([null, null, null, 75]);
    expect(vals(stochastic(bars([[5, 5, 5], [5, 5, 5]]), { kPeriod: 2, dPeriod: 1 }).k)).toEqual([null, 50]);
  });
  it('macd', () => {
    const m = macd(closes([1, 2, 3, 4, 5, 6]), { fast: 2, slow: 3, signal: 2 });
    near(vals(m.macd), [null, null, 0.5, 0.5, 0.5, 0.5]);
    near(vals(m.signal), [null, null, null, 0.5, 0.5, 0.5]);
    near(vals(m.histogram), [null, null, null, 0, 0, 0]);
  });
  it('supertrend', () => {
    const s = supertrend(bars([[10, 9, 9.5], [11, 10, 10.5], [12, 11, 11.5]]), { period: 1, multiplier: 1 });
    near(vals(s.line), [10.5, 10.5, 10]);
    expect(s.direction).toEqual([-1, -1, 1]);
    expect(vals(s.down)).toEqual([10.5, 10.5, null]);
    expect(vals(s.up)).toEqual([null, null, 10]);
  });
  it('heikinAshi', () => {
    const rows: IndicatorRow[] = [
      { time: t(0), open: 10, high: 12, low: 9, close: 11 },
      { time: t(1), open: 11, high: 13, low: 10, close: 12 },
    ];
    const h = heikinAshi(rows);
    expect(h[0]).toEqual({ time: t(0), open: 10.5, high: 12, low: 9, close: 10.5 });
    // close = (11 + 13 + 10 + 12) / 4 = 11.5, open = (10.5 + 10.5) / 2 = 10.5
    expect(h[1]).toEqual({ time: t(1), open: 10.5, high: 13, low: 10, close: 11.5 });
  });
  it('vwap resets on the calendar day of the zone', () => {
    // 2026-01-05 21:00 UTC and 2026-01-06 02:00 UTC are the same day in New York (16:00 and 21:00 on the 5th),
    // but different days in UTC.
    const a = Date.UTC(2026, 0, 5, 21) / 1000;
    const b = Date.UTC(2026, 0, 6, 2) / 1000;
    const rows: IndicatorRow[] = [
      { time: a, high: 10, low: 10, close: 10, volume: 100 },
      { time: b, high: 20, low: 20, close: 20, volume: 100 },
    ];
    expect(vals(vwap(rows, { zone: 'America/New_York' }))).toEqual([10, 15]);
    expect(vals(vwap(rows, { zone: 'UTC' }))).toEqual([10, 20]);
    expect(vals(vwap(rows, { reset: 'none' }))).toEqual([10, 15]);
  });
  it('aggregate: every n bars, and calendar day / week / month', () => {
    const rows = series(6).map((r, i) => ({ ...r, time: t(i) }));
    const a = aggregate(rows, { every: 3 });
    expect(a).toHaveLength(2);
    expect(a[0]).toEqual({
      time: t(0), open: rows[0].open, high: Math.max(...rows.slice(0, 3).map(r => r.high as number)),
      low: Math.min(...rows.slice(0, 3).map(r => r.low as number)), close: rows[2].close,
      volume: (rows[0].volume as number) + (rows[1].volume as number) + (rows[2].volume as number),
    });
    // Business days: Mon 2026-01-05 .. Fri 09, Mon 12, then Feb 2.
    const days = ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09', '2026-01-12', '2026-02-02'];
    const daily: IndicatorRow[] = days.map((d, i) => ({ time: d, open: 10 + i, high: 20 + i, low: 5 + i, close: 11 + i, volume: 1 }));
    const w = aggregate(daily, 'week');
    expect(w.map(b => b.time)).toEqual(['2026-01-05', '2026-01-12', '2026-02-02']);
    expect(w[0]).toEqual({ time: '2026-01-05', open: 10, high: 24, low: 5, close: 15, volume: 5 });
    expect(aggregate(daily, 'month').map(b => [b.time, b.volume])).toEqual([['2026-01-05', 6], ['2026-02-02', 1]]);
    expect(aggregate(daily, 'day')).toHaveLength(7);
  });
  it('aggregate reads instants in the zone (intraday into days)', () => {
    // New York 2026-01-05 15:55 and 2026-01-05 21:30 (next UTC day) are one New York day.
    const rows: IndicatorRow[] = [
      { time: Date.UTC(2026, 0, 5, 20, 55) / 1000, open: 1, high: 2, low: 1, close: 2, volume: 1 },
      { time: Date.UTC(2026, 0, 6, 2, 30) / 1000, open: 2, high: 3, low: 2, close: 3, volume: 1 },
      { time: Date.UTC(2026, 0, 6, 15) / 1000, open: 3, high: 4, low: 3, close: 4, volume: 1 },
    ];
    expect(aggregate(rows, 'day', 'America/New_York')).toHaveLength(2);
    expect(aggregate(rows, 'day', 'UTC')).toHaveLength(2);
    expect(aggregate(rows, 'day', 'Asia/Kolkata')).toHaveLength(1); // 02:25, 08:00 and 20:30 on the 6th
    expect(aggregate(rows, 'day', 'America/New_York')[0].close).toBe(3);
    expect(aggregate(rows, 'day', 'UTC')[0].close).toBe(2);
  });
});

describe('source option and value rows', () => {
  const rows: IndicatorRow[] = [
    { time: t(0), open: 1, high: 4, low: 0, close: 3 },
    { time: t(1), open: 2, high: 6, low: 2, close: 5 },
  ];
  it('reads the chosen price from candlesticks', () => {
    expect(vals(sma(rows, 1, { source: 'open' }))).toEqual([1, 2]);
    expect(vals(sma(rows, 1, { source: 'high' }))).toEqual([4, 6]);
    expect(vals(sma(rows, 1, { source: 'low' }))).toEqual([0, 2]);
    expect(vals(sma(rows, 1, { source: 'hl2' }))).toEqual([2, 4]);
    expect(vals(sma(rows, 1, { source: 'hlc3' }))).toEqual([7 / 3, 13 / 3]);
    expect(vals(sma(rows, 1, { source: 'ohlc4' }))).toEqual([2, 15 / 4]);
    expect(vals(sma(rows, 1))).toEqual([3, 5]);
  });
  it('takes { time, value } rows, and the output is another indicator input', () => {
    const v = [1, 2, 3, 4, 5, 6].map((value, i) => ({ time: t(i), value }));
    expect(vals(sma(v, 2))).toEqual([null, 1.5, 2.5, 3.5, 4.5, 5.5]);
    expect(vals(sma(sma(v, 2) as IndicatorRow[], 2))).toEqual([null, 1.5, 2, 3, 4, 5]); // the leading gap is back-filled with the first value
  });
  it('keeps the time exactly as given (string, object, seconds)', () => {
    const r = [{ time: '2026-01-05', close: 1 }, { time: { year: 2026, month: 1, day: 6 }, close: 2 }];
    expect(sma(r, 1).map(p => p.time)).toEqual(['2026-01-05', { year: 2026, month: 1, day: 6 }]);
  });
});

describe('warm-up lengths', () => {
  const rows = series(80);
  it('every output is aligned 1:1 and starts where documented', () => {
    expect(sma(rows, 10)).toHaveLength(80);
    expect(firstValue(sma(rows, 10))).toBe(9);
    expect(firstValue(ema(rows, 10))).toBe(9);
    expect(firstValue(wma(rows, 10))).toBe(9);
    expect(firstValue(rsi(rows, 14))).toBe(14);
    expect(firstValue(atr(rows, 14))).toBe(13);
    expect(firstValue(bollinger(rows, { period: 20 }).basis)).toBe(19);
    expect(firstValue(donchian(rows, 20).upper)).toBe(19);
    const m = macd(rows);
    expect(firstValue(m.macd)).toBe(25);
    expect(firstValue(m.signal)).toBe(33);
    expect(firstValue(m.histogram)).toBe(33);
    const s = stochastic(rows);
    expect(firstValue(s.k)).toBe(13);
    expect(firstValue(s.d)).toBe(15);
    expect(firstValue(supertrend(rows, { period: 10 }).line)).toBe(9);
    expect(firstValue(obv(rows))).toBe(0);
    expect(firstValue(vwap(rows))).toBe(0);
  });
  it('warm-up rows are { time } only', () => {
    const p = sma(rows, 10)[0];
    expect(Object.keys(p)).toEqual(['time']);
  });
  it('a period longer than the series gives only { time } rows', () => {
    expect(vals(sma(closes([1, 2]), 5))).toEqual([null, null]);
    expect(vals(rsi(closes([1, 2]), 14))).toEqual([null, null]);
    expect(vals(macd(closes([1, 2, 3])).macd)).toEqual([null, null, null]);
  });
});

describe('bad input never throws', () => {
  it('a NaN bar is a { time } row and the series carries on from the last finite value', () => {
    expect(vals(sma(closes([1, 2, NaN, 4, 5]), 2))).toEqual([null, 1.5, null, 3, 4.5]);
    expect(vals(ema(closes([1, 2, Infinity, 4, 5]), 2))[2]).toBeNull();
    // The bad bar carries 3 forward (k = 2/3): 2.5 -> 3*k + 2.5*(1-k), then 5*k + that*(1-k).
    const e3 = 3 * (2 / 3) + 2.5 * (1 / 3);
    near(vals(ema(closes([1, 2, 3, NaN, 5]), 2)), [null, 1.5, 2.5, null, 5 * (2 / 3) + e3 * (1 / 3)]);
  });
  it('a leading gap is back-filled for the maths and shows no value', () => {
    expect(vals(sma(closes([NaN, 2, 4]), 2))).toEqual([null, 2, 3]);
  });
  it('missing fields, empty input, odd periods, bad times', () => {
    const junk = [{ time: t(0) }, { time: t(1), close: 'x' as unknown as number }, { time: t(2), high: NaN, low: 1, close: 2 }] as IndicatorRow[];
    for (const fn of [sma, ema, wma, rsi, atr, donchian, obv, stochastic, bollinger, macd, supertrend, vwap, heikinAshi] as ((r: IndicatorRow[]) => unknown)[]) {
      expect(() => fn(junk)).not.toThrow();
      expect(() => fn([])).not.toThrow();
    }
    expect(vals(sma(closes([1, 2, 3]), 0))).toEqual([1, 2, 3]);
    expect(vals(sma(closes([1, 2, 3]), NaN))).toEqual([1, 2, 3]);
    expect(vals(sma(closes([1, 2, 3]), 2.9))).toEqual([null, 1.5, 2.5]);
    expect(vals(sma(closes([1, 2, 3]), -4))).toEqual([1, 2, 3]);
    expect(sma(closes([1, 2, 3]), 1e12)).toHaveLength(3);
    expect(() => vwap([{ time: 'nope', close: 1, volume: 1 }])).not.toThrow();
    expect(() => aggregate([{ time: 'nope', open: 1, high: 1, low: 1, close: 1 }, null as unknown as IndicatorRow], 'day')).not.toThrow();
    expect(aggregate([], { every: 3 })).toEqual([]);
    expect(() => vwap([{ time: t(0), high: 1, low: 1, close: 1, volume: 1 }], { zone: 'Not/AZone' })).not.toThrow();
  });
  it('an OHLC row with a bad leg is { time } in atr / stochastic / supertrend / donchian / heikinAshi / obv', () => {
    const rows = series(40);
    rows[20] = { ...rows[20], high: NaN };
    expect(atr(rows, 5)[20].value).toBeUndefined();
    expect(atr(rows, 5)[21].value).toBeDefined();
    expect(stochastic(rows).k[20].value).toBeUndefined();
    expect(supertrend(rows).line[20].value).toBeUndefined();
    expect(supertrend(rows).direction[20] === 1 || supertrend(rows).direction[20] === -1).toBe(true);
    expect(donchian(rows, 5).upper[20].value).toBeUndefined();
    expect(heikinAshi(rows)[20]).toEqual({ time: rows[20].time });
    expect(heikinAshi(rows)[21].close).toBeDefined();
    const o = series(10);
    o[4] = { ...o[4], close: NaN };
    expect(obv(o)[4].value).toBeUndefined();
    expect(obv(o)[5].value).toBeDefined();
  });
  it('a bad bar does not move later values of the other bars', () => {
    const rows = series(60);
    const bad = rows.map((r, i) => (i === 30 ? { ...r, close: NaN } : r));
    // Bars before the gap are untouched.
    near(vals(rsi(bad, 14)).slice(0, 30), vals(rsi(rows, 14)).slice(0, 30), 0);
    expect(rsi(bad, 14)[31].value).toBeDefined();
  });
});

describe('incremental equals batch (500 bars)', () => {
  const rows = series(500, 11);
  const eq = (a: IndicatorPoint[], b: IndicatorPoint[]): void => {
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i].time).toBe(b[i].time);
      if (a[i].value === undefined || b[i].value === undefined) expect(a[i].value).toBe(b[i].value);
      else expect(Math.abs((a[i].value as number) - (b[i].value as number))).toBeLessThan(1e-12);
    }
  };
  for (const kind of ['sma', 'ema', 'rsi'] as const) {
    it(`${kind}: next() bar by bar, and with the last bar replaced several times first`, () => {
      const batch = { sma, ema, rsi }[kind](rows, 14);
      const inc = createIndicator(kind, { period: 14 });
      const out: IndicatorPoint[] = [];
      for (const r of rows) {
        // The forming bar ticks to wrong prices first, then settles on its final value.
        inc.next({ ...r, close: (r.close as number) * 1.05 });
        inc.next({ ...r, close: (r.close as number) * 0.9 });
        out.push(inc.next(r));
      }
      eq(out, batch);
    });
    it(`${kind}: seed() equals the batch, then next() continues it`, () => {
      const inc = createIndicator(kind, { period: 14 });
      const head = inc.seed(rows.slice(0, 300));
      const tail = rows.slice(300).map(r => inc.next(r));
      eq([...head, ...tail], { sma, ema, rsi }[kind](rows, 14));
    });
  }
  it('macd', () => {
    const batch = macd(rows, { fast: 5, slow: 13, signal: 4 });
    const inc = createIndicator('macd', { fast: 5, slow: 13, signal: 4 });
    const m: IndicatorPoint[] = [], s: IndicatorPoint[] = [], h: IndicatorPoint[] = [];
    for (const r of rows) {
      inc.next({ ...r, close: (r.close as number) + 3 });
      const o = inc.next(r);
      m.push(o.macd); s.push(o.signal); h.push(o.histogram);
    }
    eq(m, batch.macd); eq(s, batch.signal); eq(h, batch.histogram);
    const seeded = createIndicator('macd', { fast: 5, slow: 13, signal: 4 }).seed(rows);
    eq(seeded.macd, batch.macd); eq(seeded.histogram, batch.histogram);
  });
  it('a replaced bar after a gap rolls back to the right state', () => {
    const inc = createIndicator('sma', { period: 3 });
    const rs = closes([1, 2, 3, 4]);
    rs.forEach(r => inc.next(r));
    inc.next({ time: t(3), close: 40 });
    expect(inc.next({ time: t(3), close: 7 }).value).toBe((2 + 3 + 7) / 3);
    expect(inc.next({ time: t(4), close: 10 }).value).toBe((3 + 7 + 10) / 3);
  });
  it('ignores an older bar and an unreadable time; skips a leading gap', () => {
    const inc = createIndicator('sma', { period: 2 });
    expect(inc.next({ time: t(0), close: NaN })).toEqual({ time: t(0) });
    expect(inc.next({ time: t(1), close: 4 })).toEqual({ time: t(1) });
    expect(inc.next({ time: t(2), close: 6 })).toEqual({ time: t(2), value: 5 });
    expect(inc.next({ time: t(0), close: 100 })).toEqual({ time: t(0) });
    expect(inc.next({ time: 'bad', close: 100 })).toEqual({ time: 'bad' });
    expect(inc.next({ time: t(3), close: NaN })).toEqual({ time: t(3) });
    expect(inc.next({ time: t(4), close: 8 }).value).toBe(7);
    inc.reset();
    expect(inc.next({ time: t(0), close: 1 })).toEqual({ time: t(0) });
  });
  it('rejects an unknown kind in plain words', () => {
    expect(() => (createIndicator as (k: string) => unknown)('wat')).toThrow(/Chartist Lite: unknown indicator/);
  });
});
