import { describe, expect, it } from 'vitest';
import * as T from '../transforms';
import { heikinAshi as indicatorHeikin } from '../indicators';
import type { TransformRow } from '../transforms';
import { walk } from './transforms-data';

const bar = (time: number, close: number, volume = 10, spread = 0): TransformRow =>
  ({ time, open: close, high: close + spread, low: close - spread, close, volume });
const closes = (cs: number[], volume = 10): TransformRow[] => cs.map((c, i) => bar(1000 + i * 60, c, volume));

describe('heikinAshi', () => {
  it('is the indicators entry\'s function', () => {
    expect(T.heikinAshi).toBe(indicatorHeikin);
  });
});

describe('renko', () => {
  it('hand vector: grid anchored at the floored first close, two-brick reversal', () => {
    const r = T.renko(closes([100, 112, 125, 108, 85]), { brick: 10 });
    expect(r.brick).toBe(10);
    expect(r.rows.map(b => [b.open, b.close, b.sourceIndex])).toEqual([[100, 110, 1], [110, 120, 2], [110, 100, 4], [100, 90, 4]]);
    // The first brick of a bar takes the volume since the previous brick: bars 0 and 1 for brick 0, bar 2 for brick 1,
    // bars 3 and 4 for brick 2, nothing more for brick 3.
    expect(r.rows.map(b => b.volume)).toEqual([20, 10, 20, 0]);
    expect(r.rows[0]).toMatchObject({ time: 1060, high: 110, low: 100 });
    expect(r.rows[2]).toMatchObject({ high: 110, low: 100 });
  });
  it('hand vector: a first close below one brick never starts a brick from 0', () => {
    const r = T.renko(closes([4, 9, 12, 21, 32]), { brick: 10 });
    expect(r.rows.map(b => [b.open, b.close])).toEqual([[10, 20], [20, 30]]);
  });
  it('a close on a grid line in floating point stays on it', () => {
    const r = T.renko(closes([0.3, 0.4]), { brick: 0.1 });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].open).toBeCloseTo(0.3, 12);
  });
  it('a brick larger than every move gives no bricks, and says which brick was used', () => {
    const r = T.renko(closes([100, 101, 99]), { brick: 50 });
    expect(r.rows).toEqual([]);
    expect(r.brick).toBe(50);
  });
  it('bricks are all one size and contiguous (continuation opens at the last close, reversal at the last open)', () => {
    const { rows, brick } = T.renko(walk(2000), { brick: 0.8 });
    expect(rows.length).toBeGreaterThan(100);
    for (let i = 0; i < rows.length; i++) {
      const b = rows[i];
      expect(b.high - b.low).toBeCloseTo(brick, 9);
      expect(Math.abs(b.close - b.open)).toBeCloseTo(brick, 9);
      if (i === 0) continue;
      const p = rows[i - 1];
      const sameWay = (b.close > b.open) === (p.close > p.open);
      expect(b.open).toBe(sameWay ? p.close : p.open);
      expect(b.sourceIndex).toBeGreaterThanOrEqual(p.sourceIndex);
    }
  });
  it('volume is conserved: the bricks plus what is still pending equal the bars read', () => {
    const rows = walk(500);
    const { rows: bricks } = T.renko(rows, { brick: 1 });
    const upToLast = rows.slice(0, bricks[bricks.length - 1].sourceIndex + 1).reduce((a, r) => a + (r.volume as number), 0);
    expect(bricks.reduce((a, b) => a + b.volume, 0)).toBe(upToLast);
  });
  it('automatic brick: ATR(14) at the last completed bar to two figures, else the 60-boxes rule', () => {
    const flat = Array.from({ length: 30 }, (_, i) => ({ time: i, open: 100, high: 101, low: 99, close: 100, volume: 1 }));
    expect(T.renko(flat).brick).toBe(2);
    expect(T.renko(flat, { brick: { atr: 14 } }).brick).toBe(2);
    expect(T.renko(flat, { brick: { atr: 14, multiplier: 1.5 } }).brick).toBe(3);
    expect(T.renko(flat, { brick: { percent: 1 } }).brick).toBe(1);
    // too few bars for ATR(14): about 60 boxes across 100..160 = 1
    const few = [bar(1, 100), bar(2, 160)].map(r => ({ ...r, high: r.close, low: r.close }));
    expect(T.renko(few).brick).toBe(1);
    // an unusable size is automatic too
    expect(T.renko(flat, { brick: 0 }).brick).toBe(2);
    expect(T.renko(flat, { brick: Number.NaN }).brick).toBe(2);
    expect(T.renko(flat, { brick: -3 }).brick).toBe(2);
  });
  it('reads the chosen source', () => {
    const rows: TransformRow[] = [
      { time: 1, open: 100, high: 130, low: 100, close: 101 },
      { time: 2, open: 100, high: 150, low: 100, close: 102 },
    ];
    expect(T.renko(rows, { brick: 10 }).rows).toHaveLength(0);
    expect(T.renko(rows, { brick: 10, source: 'high' }).rows.map(b => b.close)).toEqual([140, 150]);
  });
  it('is deterministic', () => {
    const rows = walk(800);
    expect(T.renko(rows, { brick: 0.5 })).toEqual(T.renko(rows, { brick: 0.5 }));
  });
});

describe('lineBreak', () => {
  it('hand vector: 100>105, 105>110, 110>115, then 99 breaks the last three lines: 110>99', () => {
    const r = T.lineBreak(closes([100, 105, 110, 115, 99]));
    expect(r.lines).toBe(3);
    expect(r.rows.map(b => [b.open, b.close])).toEqual([[100, 105], [105, 110], [110, 115], [110, 99]]);
    expect(r.rows[3]).toMatchObject({ open: 110, close: 99, high: 110, low: 99, sourceIndex: 4 });
  });
  it('a close inside the last three lines forms no line', () => {
    const r = T.lineBreak(closes([100, 105, 110, 115, 108]));
    expect(r.rows).toHaveLength(3);
  });
  it('one-line break reverses on a close below the last line\'s open, not below its close', () => {
    expect(T.lineBreak(closes([100, 105, 104]), { lines: 1 }).rows.map(b => [b.open, b.close])).toEqual([[100, 105]]);
    expect(T.lineBreak(closes([100, 105, 99]), { lines: 1 }).rows.map(b => [b.open, b.close])).toEqual([[100, 105], [100, 99]]);
  });
  it('reversal rule holds over 2000 bars: reversals beat the window extreme, continuations beat the last close', () => {
    for (const lines of [1, 2, 3, 4]) {
      const { rows } = T.lineBreak(walk(2000, 3), { lines });
      expect(rows.length).toBeGreaterThan(50);
      for (let i = 1; i < rows.length; i++) {
        const b = rows[i];
        const p = rows[i - 1];
        const up = b.close >= b.open;
        const pUp = p.close >= p.open;
        const win = rows.slice(Math.max(0, i - lines), i);
        if (up === pUp) {
          expect(b.open).toBe(p.close);
          expect(up ? b.close > p.close : b.close < p.close).toBe(true);
        } else if (up) {
          expect(b.open).toBe(p.open);
          expect(b.close).toBeGreaterThan(Math.max(...win.map(l => l.high)));
        } else {
          expect(b.open).toBe(p.open);
          expect(b.close).toBeLessThan(Math.min(...win.map(l => l.low)));
        }
      }
    }
  });
  it('lines is clamped to a whole number from 1 to 100', () => {
    expect(T.lineBreak([], { lines: 0 }).lines).toBe(1);
    expect(T.lineBreak([], { lines: 2.9 }).lines).toBe(2);
    expect(T.lineBreak([], { lines: 1e9 }).lines).toBe(100);
    expect(T.lineBreak([], { lines: Number.NaN }).lines).toBe(3);
  });
});

describe('kagi', () => {
  const ex = closes([100, 110, 104, 112, 100, 108, 115, 109]);
  it('hand vector: the segments of the host README example, 4% reversal', () => {
    const r = T.kagi(ex);
    expect(r.mode).toBe('percent');
    expect(r.reversal).toBe(4);
    expect(r.rows.map(s => [s.open, s.close])).toEqual([[100, 110], [110, 104], [104, 112], [112, 100], [100, 115], [115, 109]]);
    expect(r.rows.map(s => s.sourceIndex)).toEqual([1, 2, 3, 4, 6, 7]);
  });
  it('hand vector: yang until 112>100 falls through the 104 waist, thick again at the 112 shoulder', () => {
    const rows = T.kagi(ex).rows;
    expect(rows.map(s => [s.startYang, s.endYang, s.flipAt])).toEqual([
      [true, true, null], [true, true, null], [true, true, null], [true, false, 104], [false, true, 112], [true, true, null],
    ]);
  });
  it('a price reversal amount works the same way', () => {
    const r = T.kagi(ex, { reversal: 5 });
    expect(r.mode).toBe('price');
    expect(r.reversal).toBe(5);
    expect(r.rows.map(s => [s.open, s.close])).toEqual([[100, 110], [110, 104], [104, 112], [112, 100], [100, 115], [115, 109]]);
    // 7: 104 is not a reversal, so 100>110 goes on to 112; 112>100; 100>115 (109 is not a reversal)
    expect(T.kagi(ex, { reversal: 7 }).rows.map(s => [s.open, s.close])).toEqual([[100, 112], [112, 100], [100, 115]]);
  });
  it('ATR and percent reversals are measured, a bad one is the 4% default', () => {
    const flat = Array.from({ length: 30 }, (_, i) => ({ time: i, open: 100, high: 101, low: 99, close: 100 + (i % 2) * 3, volume: 1 }));
    expect(T.kagi(flat, { reversal: { percent: 2 } })).toMatchObject({ mode: 'percent', reversal: 2 });
    expect(T.kagi(flat, { reversal: { atr: 14 } }).mode).toBe('price');
    expect(T.kagi(flat, { reversal: 0 })).toMatchObject({ mode: 'percent', reversal: 4 });
    expect(T.kagi(flat, { reversal: { percent: -1 } })).toMatchObject({ mode: 'percent', reversal: 4 });
  });
  it('segments alternate, join end to start, and reverse by at least the reversal off the extreme', () => {
    const { rows } = T.kagi(walk(2000, 5), { reversal: { percent: 1 } });
    expect(rows.length).toBeGreaterThan(20);
    for (let i = 1; i < rows.length; i++) {
      const p = rows[i - 1];
      const s = rows[i];
      expect(s.open).toBe(p.close);
      expect(s.close > s.open).not.toBe(p.close > p.open);
      expect(Math.abs(s.close - s.open)).toBeGreaterThanOrEqual(p.close * 0.01 - 1e-9);
    }
  });
  it('times are strictly ascending (a segment is dated by the bar that last moved it)', () => {
    const { rows } = T.kagi(walk(1000, 9), { reversal: { percent: 0.8 } });
    for (let i = 1; i < rows.length; i++) expect(rows[i].time as number).toBeGreaterThan(rows[i - 1].time as number);
  });
});

describe('pointFigure', () => {
  it('hand vector: X 10..13, O 12..8 (one box in from the top), X 9..12', () => {
    const r = T.pointFigure(closes([10, 11, 12, 13, 11, 9, 8, 12]), { box: 1 });
    expect(r.box).toBe(1);
    expect(r.reversal).toBe(3);
    expect(r.rows.map(c => [c.up, c.low, c.high, c.open, c.close, c.sourceIndex])).toEqual([
      [true, 10, 13, 10, 13, 3], [false, 8, 12, 12, 8, 6], [true, 9, 12, 9, 12, 7],
    ]);
  });
  it('rounds to boxes and scales levels back to prices', () => {
    const r = T.pointFigure(closes([10, 10.4, 11.9, 12.1, 15.2]), { box: 0.5 });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ up: true, low: 10, high: 15 });
  });
  it('columns alternate; each reversal is at least the reversal in boxes and starts one box in', () => {
    for (const reversal of [1, 3, 5]) {
      const { rows, box } = T.pointFigure(walk(2000, 11), { box: 0.5, reversal });
      expect(rows.length).toBeGreaterThan(10);
      for (let i = 1; i < rows.length; i++) {
        const p = rows[i - 1];
        const c = rows[i];
        expect(c.up).not.toBe(p.up);
        if (c.up) {
          expect(c.low).toBeCloseTo(p.low + box, 9);
          expect(c.high).toBeGreaterThanOrEqual(p.low + reversal * box - 1e-9);
        } else {
          expect(c.high).toBeCloseTo(p.high - box, 9);
          expect(c.low).toBeLessThanOrEqual(p.high - reversal * box + 1e-9);
        }
      }
    }
  });
  it('a flat series is one column; the reversal and box are reported', () => {
    const r = T.pointFigure(closes([5, 5, 5]), { box: 1, reversal: 99 });
    expect(r.reversal).toBe(20);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ low: 5, high: 5, up: true });
  });
  it('automatic box is the 60-boxes rule', () => {
    const rows = [{ time: 1, close: 100, high: 160, low: 100 }, { time: 2, close: 130, high: 130, low: 130 }];
    expect(T.pointFigure(rows).box).toBe(1);
  });
});

describe('rangeBars', () => {
  it('hand vector with volume credited to the first bar a trade makes', () => {
    const r = T.rangeBars(closes([100, 103, 106, 112, 101]), { range: 5 });
    expect(r.range).toBe(5);
    expect(r.rows.map(b => [b.open, b.close, b.high, b.low, b.sourceIndex, b.volume])).toEqual([
      [100, 105, 105, 100, 2, 30], [105, 110, 110, 105, 3, 10], [110, 105, 110, 105, 4, 10],
    ]);
  });
  it('every bar spans exactly the range and starts at the previous close', () => {
    const { rows, range } = T.rangeBars(walk(2000, 2), { range: { atr: 14 } });
    expect(rows.length).toBeGreaterThan(100);
    expect(range).toBeGreaterThan(0);
    for (let i = 0; i < rows.length; i++) {
      expect(rows[i].high - rows[i].low).toBeCloseTo(range, 9);
      if (i > 0) expect(rows[i].open).toBe(rows[i - 1].close);
    }
  });
});

describe('spreadTimes', () => {
  it('moves a repeated time forward one second, keeps rows that need no move', () => {
    const rows = [{ time: 10 }, { time: 10 }, { time: 10 }, { time: 20 }, { time: 11.5 }];
    const out = T.spreadTimes(rows);
    expect(out.map(r => r.time)).toEqual([10, 11, 12, 20, 21]);
    expect(out[0]).toBe(rows[0]);
    expect(out[3]).toBe(rows[3]);
    expect(rows[1].time).toBe(10);
  });
  it('keeps the kind of time: business-day strings and objects move a day', () => {
    expect(T.spreadTimes([{ time: '2024-02-28' }, { time: '2024-02-28' }, { time: '2024-02-28' }, { time: '2024-03-01' }]).map(r => r.time))
      .toEqual(['2024-02-28', '2024-02-29', '2024-03-01', '2024-03-02']);
    expect(T.spreadTimes([{ time: { year: 2023, month: 12, day: 31 } }, { time: { year: 2023, month: 12, day: 31 } }]).map(r => r.time))
      .toEqual([{ year: 2023, month: 12, day: 31 }, { year: 2024, month: 1, day: 1 }]);
  });
  it('starts after `previous`, drops rows whose time cannot be read', () => {
    const out = T.spreadTimes([{ time: 5 }, { time: Number.NaN }, { time: 6 }], 5);
    expect(out.map(r => r.time)).toEqual([6, 7]);
  });
  it('renko of 2000 bars spread is strictly ascending in the same kind', () => {
    const { rows } = T.renko(walk(2000), { brick: 0.2 });
    expect(new Set(rows.map(r => r.time)).size).toBeLessThan(rows.length);
    const out = T.spreadTimes(rows);
    expect(out).toHaveLength(rows.length);
    for (let i = 1; i < out.length; i++) expect(out[i].time as number).toBeGreaterThan(out[i - 1].time as number);
  });
});

describe('bad input never throws', () => {
  const bad: unknown[] = [
    null, undefined, 5, 'x', {}, { time: 1 }, { time: Number.NaN, close: 5 }, { time: 'nope', close: 5 }, { time: 2, close: Number.NaN },
    { time: 3, close: Infinity }, { time: 4, close: '7' }, { time: 5, value: 9 }, { time: { year: 2020 }, close: 3 },
  ];
  const rows = [...walk(30), ...(bad as TransformRow[]), ...walk(30, 8)];
  it('every transform returns finite rows', () => {
    const outs = [
      T.renko(rows, { brick: 1 }).rows, T.renko(rows).rows, T.lineBreak(rows).rows, T.kagi(rows).rows, T.pointFigure(rows).rows,
      T.rangeBars(rows).rows, T.rangeBars(rows, { range: { percent: 1 } }).rows,
    ];
    for (const out of outs) {
      for (const b of out) {
        expect([b.open, b.high, b.low, b.close, b.volume].every(Number.isFinite)).toBe(true);
        expect(Number.isInteger(b.sourceIndex)).toBe(true);
      }
    }
  });
  it('empty, tiny and single-row input', () => {
    for (const r of [[], [bar(1, 5)], [bar(1, 5), bar(2, 5)]]) {
      expect(() => { T.renko(r); T.lineBreak(r); T.kagi(r); T.pointFigure(r); T.rangeBars(r); T.kagi(r, { reversal: { atr: 14 } }); }).not.toThrow();
    }
    expect(T.renko([]).rows).toEqual([]);
    expect(T.lineBreak([bar(1, 5)]).rows).toEqual([]);
    expect(T.kagi([bar(1, 5)]).rows).toEqual([]);
    expect(T.pointFigure([bar(1, 5)]).rows).toHaveLength(1);
    expect(T.rangeBars([bar(1, 5)]).rows).toEqual([]);
  });
  it('a bad size is automatic, not an error', () => {
    const r = walk(100);
    for (const brick of [0, -1, Number.NaN, Infinity, { atr: Number.NaN }, { percent: 0 }, { atr: 0 }] as T.SizeSpec[]) {
      const res = T.renko(r, { brick });
      expect(res.brick).toBeGreaterThan(0);
      expect(Number.isFinite(res.brick)).toBe(true);
    }
  });
  it('a brick far smaller than the moves stops at the row limit instead of running away', () => {
    const t0 = Date.now();
    const r = T.renko([bar(1, 100), bar(2, 200)], { brick: 1e-9 });
    expect(r.rows.length).toBe(100_000);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(T.renko([bar(1, 1e20), bar(2, 2e20)], { brick: 1 }).rows).toEqual([]);
    expect(T.rangeBars([bar(1, 100), bar(2, 1e20)], { range: 1 }).rows.length).toBeLessThanOrEqual(100_000);
  });
});
