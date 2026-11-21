import { describe, expect, it } from 'vitest';
import { layoutPanes, moveSeparator, paneAt, stretchForHeight } from '../chart/pane-layout';
import { createColumns, decimateColumns } from '../render/decimate';
import { TimeIndex } from '../core/time-index';
import { planTimeTicks } from '../scales/time-ticks';

describe('pane layout', () => {
  it('shares the height by stretch factor, separators between, whole px, nothing lost', () => {
    const b = layoutPanes([3, 1], 401, 1, 32);
    expect(b).toEqual([{ top: 0, height: 300 }, { top: 301, height: 100 }]);
    const three = layoutPanes([2, 1, 1], 500, 1, 32);
    expect(three.reduce((a, p) => a + p.height, 0) + 2).toBe(500);
    expect(three[1].top).toBe(three[0].height + 1);
    expect(three[2].top).toBe(three[1].top + three[1].height + 1);
  });

  it('lifts a tiny pane to the minimum when there is room', () => {
    const b = layoutPanes([100, 1], 300, 1, 40);
    expect(b[1].height).toBe(40);
    expect(b[0].height + b[1].height).toBe(299);
  });

  it('splits evenly when even the minimum does not fit; bad factors count as 1', () => {
    const b = layoutPanes([5, 1, 1], 60, 0, 32);
    expect(b.map(p => p.height).every(h => h >= 20)).toBe(true);
    expect(layoutPanes([NaN, -1], 101, 1, 0).map(p => p.height)).toEqual([50, 50]);
    expect(layoutPanes([], 100, 1, 0)).toEqual([]);
  });

  it('moving a separator trades height between its two panes, within the minimum', () => {
    expect(moveSeparator([300, 100], 0, 50, 32)).toEqual([350, 50]);
    expect(moveSeparator([300, 100], 0, 500, 32)).toEqual([368, 32]);
    expect(moveSeparator([300, 100, 100], 1, -1000, 32)).toEqual([300, 32, 168]);
    expect(moveSeparator([300, 100], 5, 10, 32)).toEqual([300, 100]);
  });

  it('finds the pane under a y; separators belong to none', () => {
    const b = layoutPanes([3, 1], 401, 1, 32);
    expect(paneAt(b, 0)).toBe(0);
    expect(paneAt(b, 299.9)).toBe(0);
    expect(paneAt(b, 300.5)).toBe(-1);
    expect(paneAt(b, 301)).toBe(1);
    expect(paneAt(b, 401)).toBe(-1);
  });

  it('a stretch factor for a wanted height', () => {
    const f = stretchForHeight([3, 1], 1, 150, 400);
    const b = layoutPanes([3, f], 401, 1, 0);
    expect(b[1].height).toBeGreaterThanOrEqual(149);
    expect(b[1].height).toBeLessThanOrEqual(151);
  });
});

describe('min/max decimation', () => {
  interface R { v: number }
  const access = { high: (r: R) => r.v, low: (r: R) => r.v };

  it('folds rows into device columns with first, high, low, last and a row count', () => {
    const rows: (R | null)[] = [{ v: 5 }, { v: 9 }, null, { v: 1 }, { v: 4 }, { v: 7 }];
    const xs = [0.2, 0.6, 0.9, 1.1, 1.5, 3.2];
    const c = decimateColumns(rows, 0, 5, i => xs[i], access, createColumns(1));
    expect(c.count).toBe(3);
    expect(Array.from(c.x.subarray(0, 3))).toEqual([0, 1, 3]);
    expect([c.first[0], c.high[0], c.low[0], c.last[0], c.rows[0]]).toEqual([5, 9, 5, 9, 2]);
    expect([c.first[1], c.high[1], c.low[1], c.last[1], c.rows[1]]).toEqual([1, 4, 1, 4, 2]);
    expect(c.rows[2]).toBe(1);
  });

  it('candle access keeps open of the first row and close of the last', () => {
    type C = { open: number; high: number; low: number; close: number };
    const rows: C[] = [{ open: 10, high: 12, low: 9, close: 11 }, { open: 11, high: 15, low: 8, close: 9 }];
    const c = decimateColumns(rows, 0, 1, () => 4.2, { high: r => r.high, low: r => r.low, first: r => r.open, last: r => r.close });
    expect([c.count, c.x[0], c.first[0], c.high[0], c.low[0], c.last[0]]).toEqual([1, 4, 10, 15, 8, 9]);
  });

  it('100k rows into 1000 columns, no allocation per row', () => {
    const rows = Array.from({ length: 100_000 }, (_, i) => ({ v: Math.sin(i / 50) * 10 + (i === 51_234 ? 100 : 0) }));
    const out = createColumns(100_000);
    const before = out.x;
    const c = decimateColumns(rows, 0, rows.length - 1, i => i / 100, access, out);
    expect(c.count).toBe(1000);
    expect(c.x).toBe(before);
    expect(Math.max(...Array.from(c.high.subarray(0, 1000)))).toBeGreaterThan(100); // the spike survives
  });
});

describe('time axis with boundary lists', () => {
  it('day and month start lists match the calendar; the planner gives the same ticks with or without them', () => {
    const times: number[] = [];
    let t = Date.UTC(2020, 0, 1) / 1000 + 9 * 3600;
    for (let d = 0; d < 400; d++) {
      for (let k = 0; k < 78; k++) times.push(t + k * 300);
      t += 86400;
    }
    const idx = new TimeIndex();
    idx.setZone('America/New_York');
    idx.rebuild([{ times, count: times.length }], false);
    expect(idx.dayStartCount).toBe(400);
    expect(idx.monthStarts[1]).toBe(idx.dayStarts[31]);
    for (let k = 1; k < idx.dayStartCount; k++) {
      const j = idx.dayStarts[k];
      expect(idx.cal.dayNum[j]).not.toBe(idx.cal.dayNum[j - 1]);
    }
    const base = {
      cal: idx.cal, count: idx.count, from: 0, to: idx.count - 1, xOf: (i: number) => (i + 0.5) * (1200 / idx.count),
      barSpacing: 1200 / idx.count, plotW: 1200, kind: idx.kind, measure: (s: string) => s.length * 7,
    };
    const plain = planTimeTicks(base);
    const fast = planTimeTicks({ ...base, starts: { day: idx.dayStarts, dayCount: idx.dayStartCount, month: idx.monthStarts, monthCount: idx.monthStartCount } });
    expect(fast).toEqual(plain);
    expect(fast.some(x => x.text === '2021')).toBe(true);
  });
});
