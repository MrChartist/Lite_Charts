import { describe, expect, it } from 'vitest';
import { MAX_TAIL_UPDATES, deepEqual, diffData, planSeries, seriesKey } from '../react/diff';

const bar = (t: number, c = t) => ({ time: t, open: c, high: c + 1, low: c - 1, close: c });
const bars = (n: number) => Array.from({ length: n }, (_, i) => bar(i + 1));

describe('deepEqual', () => {
  it('compares plain objects and arrays by value', () => {
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(deepEqual(NaN, NaN)).toBe(true);
    expect(deepEqual(undefined, undefined)).toBe(true);
    expect(deepEqual({}, [])).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
  });

  it('functions and class instances compare by reference', () => {
    const f = () => 1;
    expect(deepEqual({ f }, { f })).toBe(true);
    expect(deepEqual({ f }, { f: () => 1 })).toBe(false);
    expect(deepEqual(new Date(1), new Date(1))).toBe(false);
  });
});

describe('diffData', () => {
  it('same reference, or a copy with equal rows: nothing to do', () => {
    const a = bars(10);
    expect(diffData(a, a)).toEqual({ kind: 'same' });
    expect(diffData(a, a.map(r => ({ ...r })))).toEqual({ kind: 'same' });
    expect(diffData(undefined, undefined)).toEqual({ kind: 'same' });
    expect(diffData([], undefined)).toEqual({ kind: 'same' });
  });

  it('first data is a set', () => {
    expect(diffData(undefined, bars(3)).kind).toBe('set');
    expect(diffData([], bars(3)).kind).toBe('set');
  });

  it('a changed last bar is one update', () => {
    const a = bars(10);
    const b = a.slice(0, 9).concat(bar(10, 99));
    const d = diffData(a, b);
    expect(d).toEqual({ kind: 'update', rows: [bar(10, 99)] });
  });

  it('appended bars are updates starting at the old last bar', () => {
    const a = bars(10);
    const b = [...a.slice(0, 9), bar(10, 50), bar(11), bar(12)];
    const d = diffData(a, b);
    expect(d.kind).toBe('update');
    if (d.kind === 'update') expect(d.rows.map(r => r.time)).toEqual([10, 11, 12]);
  });

  it('a change before the last bar, a shorter array, a replaced last time or a long append is a set', () => {
    const a = bars(10);
    expect(diffData(a, [bar(1, 77), ...a.slice(1)]).kind).toBe('set');
    expect(diffData(a, a.slice(0, 9)).kind).toBe('set');
    expect(diffData(a, [...a.slice(0, 9), bar(11)]).kind).toBe('set');
    expect(diffData(a, [...a, ...Array.from({ length: MAX_TAIL_UPDATES + 1 }, (_, i) => bar(100 + i))]).kind).toBe('set');
    expect(diffData(a, [...a, ...Array.from({ length: MAX_TAIL_UPDATES }, (_, i) => bar(100 + i))]).kind).toBe('update');
  });

  it('business-day objects compare by value', () => {
    const d = (day: number) => ({ time: { year: 2024, month: 1, day }, value: day });
    expect(diffData([d(1), d(2)], [d(1), d(2)])).toEqual({ kind: 'same' });
    expect(diffData([d(1), d(2)], [d(1), d(2), d(3)]).kind).toBe('update');
  });
});

describe('planSeries', () => {
  const T1 = { t: 1 };
  const T2 = { t: 2 };
  it('keeps, adds and removes by key', () => {
    const plan = planSeries(
      [{ key: 'a', type: T1 }, { key: 'b', type: T1 }],
      [{ key: 'b', type: T1 }, { key: 'c', type: T2 }],
    );
    expect(plan).toEqual({ add: ['c'], remove: ['a'], keep: ['b'] });
  });

  it('a changed type is a remove plus an add', () => {
    const plan = planSeries([{ key: 'a', type: T1 }], [{ key: 'a', type: T2 }]);
    expect(plan).toEqual({ add: ['a'], remove: ['a'], keep: [] });
  });

  it('series keys use the id, else the position', () => {
    expect(seriesKey('sma', 3)).toBe('id:sma');
    expect(seriesKey(undefined, 3)).toBe('#3');
    expect(seriesKey('', 0)).toBe('#0');
  });
});
