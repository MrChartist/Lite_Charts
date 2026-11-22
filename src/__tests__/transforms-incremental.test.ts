import { describe, expect, it } from 'vitest';
import { createLineBreak, createRangeBars, createRenko, lineBreak, rangeBars, renko } from '../transforms';
import type { BrickRow, IncrementalTransform, TransformRow } from '../transforms';
import { walk } from './transforms-data';

const N = 2000;
const HISTORY = 300;

/** A forming version of a bar: same time, a different close (and range), as live ticks produce before the bar closes. */
function provisional(r: TransformRow, k: number): TransformRow {
  const close = (r.close as number) * (1 + ((k % 7) - 3) * 0.004);
  return { ...r, close, high: Math.max(r.high as number, close), low: Math.min(r.low as number, close), volume: ((r.volume as number) * (k + 1)) / 5 };
}

interface Case {
  name: string;
  create: (rows: readonly TransformRow[]) => IncrementalTransform<BrickRow>;
  batch: (rows: readonly TransformRow[], size: number) => BrickRow[];
}

const cases: Case[] = [
  { name: 'renko', create: r => createRenko(r), batch: (r, size) => renko(r, { brick: size }).rows },
  { name: 'renko (percent brick)', create: r => createRenko(r, { brick: { percent: 0.4 } }), batch: (r, size) => renko(r, { brick: size }).rows },
  { name: 'lineBreak', create: r => createLineBreak(r, { lines: 3 }), batch: r => lineBreak(r, { lines: 3 }).rows },
  { name: 'lineBreak (2 lines)', create: r => createLineBreak(r, { lines: 2 }), batch: r => lineBreak(r, { lines: 2 }).rows },
  { name: 'rangeBars', create: r => createRangeBars(r), batch: (r, size) => rangeBars(r, { range: size }).rows },
  { name: 'rangeBars (ATR)', create: r => createRangeBars(r, { range: { atr: 14 } }), batch: (r, size) => rangeBars(r, { range: size }).rows },
];

describe('incremental equals batch on 2000 bars', () => {
  for (const c of cases) {
    it(`${c.name}: new bars and replaced forming bars, deltas rebuild the output`, () => {
      const rows = walk(N, 21);
      const inc = c.create(rows.slice(0, HISTORY));
      const mirror: BrickRow[] = inc.rows.slice();
      let checked = 0;
      for (let i = HISTORY; i < N; i++) {
        // Two forming versions of the bar, then its final version.
        for (const k of [i, i + 3]) {
          const d = inc.update(provisional(rows[i], k));
          mirror.length = d.from;
          mirror.push(...d.rows);
        }
        const d = inc.update(rows[i]);
        mirror.length = d.from;
        mirror.push(...d.rows);
        expect(d.from + d.rows.length).toBe(inc.rows.length);
        if (i % 211 === 0 || i === N - 1) {
          const want = c.batch(rows.slice(0, i + 1), inc.size);
          expect(inc.rows).toEqual(want);
          expect(mirror).toEqual(want);
          checked++;
        }
      }
      const all = c.batch(rows, inc.size);
      expect(all.length).toBeGreaterThan(20);
      expect(inc.rows).toEqual(all);
      expect(mirror).toEqual(all);
      expect(checked).toBeGreaterThan(5);
    });
  }

  it('the size is measured on the history once and fixed', () => {
    const rows = walk(N, 4);
    const inc = createRenko(rows.slice(0, 100));
    const size = inc.size;
    for (let i = 100; i < N; i++) inc.update(rows[i]);
    expect(inc.size).toBe(size);
    expect(inc.rows).toEqual(renko(rows, { brick: size }).rows);
  });

  it('feeding every bar one by one from nothing equals the batch', () => {
    const rows = walk(600, 5);
    for (const c of cases) {
      const inc = c.create([]);
      expect(inc.rows).toEqual([]);
      // With no history the size comes from nothing (automatic fallback); compare with the batch on the same size.
      for (const r of rows) inc.update(r);
      expect(inc.rows).toEqual(c.batch(rows, inc.size));
    }
  });

  it('an older bar is ignored; a replaced first bar re-bases the grid', () => {
    const rows = walk(50, 6);
    const inc = createRenko(rows.slice(0, 10), { brick: 0.5 });
    const before = inc.rows.slice();
    expect(inc.update({ ...rows[3], close: 1 })).toEqual({ from: before.length, rows: [], removed: 0 });
    expect(inc.rows).toEqual(before);

    const inc2 = createRenko([], { brick: 5 });
    inc2.update({ time: 1, close: 100 });
    inc2.update({ time: 1, close: 200 }); // the first bar replaced: the grid anchors at 200 now
    inc2.update({ time: 2, close: 211 });
    expect(inc2.rows.map(b => [b.open, b.close])).toEqual(renko([{ time: 1, close: 200 }, { time: 2, close: 211 }], { brick: 5 }).rows.map(b => [b.open, b.close]));
    expect(inc2.rows[0].open).toBe(200);
  });

  it('never throws on bad rows, and a bad replacement undoes the earlier version', () => {
    const inc = createRenko([{ time: 1, close: 100 }], { brick: 5 });
    expect(() => inc.update(null as never)).not.toThrow();
    expect(() => inc.update({ time: Number.NaN, close: 5 })).not.toThrow();
    expect(() => inc.update({ time: 7 })).not.toThrow();
    inc.update({ time: 8, close: 130 });
    expect(inc.rows.length).toBe(6);
    inc.update({ time: 8, close: Number.NaN }); // the tick turned into garbage: the bar's effect is gone
    expect(inc.rows.length).toBe(0);
  });
});
