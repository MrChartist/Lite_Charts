import { describe, expect, it } from 'vitest';
import {
  RANGE_KEYS, addMonths, civilOfDay, daysInMonth, isLeapYear, logicalRangeFor, rangeStartDay, resolveRange, zoneMidnightSeconds,
} from '../plugins/extras/range';
import { daysFromCivil } from '../core/zone';

const day = (y: number, m: number, d: number): number => daysFromCivil(y, m, d);
const dayText = (n: number): string => { const c = civilOfDay(n); return `${c.year}-${String(c.month).padStart(2, '0')}-${String(c.day).padStart(2, '0')}`; };
const utc = (s: string): number => Date.parse(s) / 1000;

describe('calendar helpers', () => {
  it('knows leap years and month lengths', () => {
    expect([1900, 2000, 2023, 2024, 2100].map(isLeapYear)).toEqual([false, true, false, true, false]);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2023, 2)).toBe(28);
    expect([1, 3, 4, 6, 9, 11, 12].map(m => daysInMonth(2025, m))).toEqual([31, 31, 30, 30, 30, 30, 31]);
  });
  it('moves by months and clamps to the month end', () => {
    expect(addMonths({ year: 2024, month: 3, day: 31 }, -1)).toEqual({ year: 2024, month: 2, day: 29 });
    expect(addMonths({ year: 2023, month: 3, day: 31 }, -1)).toEqual({ year: 2023, month: 2, day: 28 });
    expect(addMonths({ year: 2024, month: 5, day: 31 }, -3)).toEqual({ year: 2024, month: 2, day: 29 });
    expect(addMonths({ year: 2024, month: 8, day: 31 }, -6)).toEqual({ year: 2024, month: 2, day: 29 });
    expect(addMonths({ year: 2024, month: 1, day: 31 }, 1)).toEqual({ year: 2024, month: 2, day: 29 });
    expect(addMonths({ year: 2024, month: 2, day: 29 }, -12)).toEqual({ year: 2023, month: 2, day: 28 });
    expect(addMonths({ year: 2024, month: 2, day: 29 }, -60)).toEqual({ year: 2019, month: 2, day: 28 });
    expect(addMonths({ year: 2024, month: 1, day: 15 }, -1)).toEqual({ year: 2023, month: 12, day: 15 });
    expect(addMonths({ year: 2024, month: 12, day: 15 }, 1)).toEqual({ year: 2025, month: 1, day: 15 });
  });
});

describe('range start day', () => {
  const last = day(2024, 3, 31);
  it('1D is the last day, 5D the last five calendar days', () => {
    expect(rangeStartDay('1D', last)).toBe(last);
    expect(dayText(rangeStartDay('5D', last) as number)).toBe('2024-03-27');
    expect(dayText(rangeStartDay('5D', day(2024, 3, 2)) as number)).toBe('2024-02-27');
  });
  it('month spans reach back to the same date, clamped at month ends (leap year aware)', () => {
    expect(dayText(rangeStartDay('1M', last) as number)).toBe('2024-02-29');
    expect(dayText(rangeStartDay('1M', day(2023, 3, 31)) as number)).toBe('2023-02-28');
    expect(dayText(rangeStartDay('3M', day(2024, 5, 31)) as number)).toBe('2024-02-29');
    expect(dayText(rangeStartDay('6M', day(2024, 8, 31)) as number)).toBe('2024-02-29');
    expect(dayText(rangeStartDay('1Y', day(2024, 2, 29)) as number)).toBe('2023-02-28');
    expect(dayText(rangeStartDay('5Y', day(2024, 2, 29)) as number)).toBe('2019-02-28');
    expect(dayText(rangeStartDay('1M', day(2024, 1, 15)) as number)).toBe('2023-12-15');
  });
  it('YTD starts on 1 January of the last day\'s year; All has no start', () => {
    expect(dayText(rangeStartDay('YTD', day(2024, 12, 31)) as number)).toBe('2024-01-01');
    expect(dayText(rangeStartDay('YTD', day(2024, 1, 1)) as number)).toBe('2024-01-01');
    expect(rangeStartDay('All', last)).toBeNull();
  });
  it('offers the nine keys', () => {
    expect([...RANGE_KEYS]).toEqual(['1D', '5D', '1M', '3M', '6M', 'YTD', '1Y', '5Y', 'All']);
  });
});

describe('zone midnight', () => {
  it('reads local midnight in the zone, across a DST change', () => {
    expect(zoneMidnightSeconds('UTC', day(2024, 3, 11))).toBe(utc('2024-03-11T00:00:00Z'));
    expect(zoneMidnightSeconds('America/New_York', day(2024, 3, 9))).toBe(utc('2024-03-09T05:00:00Z'));
    expect(zoneMidnightSeconds('America/New_York', day(2024, 3, 10))).toBe(utc('2024-03-10T05:00:00Z'));
    expect(zoneMidnightSeconds('America/New_York', day(2024, 3, 11))).toBe(utc('2024-03-11T04:00:00Z'));
    expect(zoneMidnightSeconds('Asia/Kolkata', day(2024, 3, 11))).toBe(utc('2024-03-10T18:30:00Z'));
    expect(zoneMidnightSeconds('Australia/Sydney', day(2024, 7, 1))).toBe(utc('2024-06-30T14:00:00Z'));
  });
});

describe('resolveRange', () => {
  const ny = 'America/New_York';
  it('1D on intraday data starts at local midnight of the last bar\'s day', () => {
    const first = utc('2024-01-02T14:30:00Z');
    const last = utc('2024-03-11T19:55:00Z'); // 15:55 EDT
    expect(resolveRange('1D', first, last, ny, false)).toEqual({ from: utc('2024-03-11T04:00:00Z'), to: last, clamped: false });
  });
  it('5D reads days in the zone, not in UTC', () => {
    // 2024-03-12 02:00 UTC is still 11 March 22:00 in New York.
    const last = utc('2024-03-12T02:00:00Z');
    const r = resolveRange('5D', utc('2024-01-01T00:00:00Z'), last, ny, false);
    expect(r.from).toBe(utc('2024-03-07T05:00:00Z'));
  });
  it('business-day data ignores the zone and counts dates', () => {
    const first = Date.UTC(2020, 0, 2) / 1000;
    const last = Date.UTC(2024, 2, 28) / 1000;
    expect(resolveRange('1M', first, last, 'Asia/Tokyo', true).from).toBe(Date.UTC(2024, 1, 28) / 1000);
    expect(resolveRange('YTD', first, last, 'America/New_York', true).from).toBe(Date.UTC(2024, 0, 1) / 1000);
  });
  it('data shorter than the span starts at the first bar and says so', () => {
    const first = Date.UTC(2024, 2, 1) / 1000;
    const last = Date.UTC(2024, 2, 20) / 1000;
    expect(resolveRange('3M', first, last, 'UTC', true)).toEqual({ from: first, to: last, clamped: true });
    expect(resolveRange('1Y', first, last, 'UTC', false).clamped).toBe(true);
  });
  it('a span that starts exactly on the first bar is not clamped; All is the whole data', () => {
    const first = Date.UTC(2024, 1, 29) / 1000;
    const last = Date.UTC(2024, 2, 31) / 1000;
    expect(resolveRange('1M', first, last, 'UTC', true)).toEqual({ from: first, to: last, clamped: false });
    expect(resolveRange('All', first, last, 'UTC', true)).toEqual({ from: first, to: last, clamped: false });
  });
});

describe('logicalRangeFor', () => {
  it('starts half a bar before the first bar and leaves air on the right', () => {
    expect(logicalRangeFor(10.2, 99, 2)).toEqual({ from: 10.5, to: 101 });
    expect(logicalRangeFor(-4, 99, 2)).toEqual({ from: -0.5, to: 101 });
  });
  it('never shows fewer than the minimum bars', () => {
    expect(logicalRangeFor(99, 99, 2)).toEqual({ from: 94.5, to: 101 });
    expect(logicalRangeFor(2, 3, 2, 5)).toEqual({ from: -0.5, to: 5 });
  });
});
