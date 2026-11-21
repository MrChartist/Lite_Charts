import { describe, expect, it } from 'vitest';
import { civilKeyFromDays, daysFromCivil, weekdayOfDay, zoneDayNumber, zoneMinuteOfDay, zoneOffsetMs } from '../core/zone';
import { inferTimeKind, timeToSeconds } from '../core/time';
import { TimeIndex, mapToUnion } from '../core/time-index';

const HOUR = 3_600_000;

function intlOffset(tz: string, ms: number): number {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
  const v: Record<string, number> = {};
  for (const p of f.formatToParts(ms)) if (p.type !== 'literal') v[p.type] = Number(p.value);
  return Date.UTC(v.year, v.month - 1, v.day, v.hour, v.minute, v.second) - ms;
}

describe('zone offsets', () => {
  it('Asia/Kolkata is +05:30 all year', () => {
    for (const d of ['2026-01-15T00:00:00Z', '2026-07-15T12:00:00Z', '1999-03-30T23:59:00Z']) {
      expect(zoneOffsetMs('Asia/Kolkata', Date.parse(d))).toBe(330 * 60_000);
    }
  });

  it('America/New_York switches on the DST hours (2026: 8 Mar and 1 Nov)', () => {
    const springUtc = Date.UTC(2026, 2, 8, 7); // 02:00 EST -> 03:00 EDT
    expect(zoneOffsetMs('America/New_York', springUtc - 1)).toBe(-5 * HOUR);
    expect(zoneOffsetMs('America/New_York', springUtc)).toBe(-4 * HOUR);
    const fallUtc = Date.UTC(2026, 10, 1, 6); // 02:00 EDT -> 01:00 EST
    expect(zoneOffsetMs('America/New_York', fallUtc - 1)).toBe(-4 * HOUR);
    expect(zoneOffsetMs('America/New_York', fallUtc)).toBe(-5 * HOUR);
  });

  it('equals Intl hour by hour over a year (New York, London, Sydney)', () => {
    for (const tz of ['America/New_York', 'Europe/London', 'Australia/Sydney']) {
      const start = Date.UTC(2025, 0, 1);
      for (let h = 0; h < 366 * 24; h += 1) {
        const ms = start + h * HOUR + 17 * 60_000;
        expect(zoneOffsetMs(tz, ms)).toBe(intlOffset(tz, ms));
      }
    }
  });

  it('reads calendar day and minute in the zone', () => {
    const ms = Date.UTC(2026, 2, 9, 3, 45); // 09:15 IST, 23:45 EDT the day before
    expect(zoneMinuteOfDay('Asia/Kolkata', ms)).toBe(9 * 60 + 15);
    expect(civilKeyFromDays(zoneDayNumber('Asia/Kolkata', ms))).toBe(20260309);
    expect(zoneMinuteOfDay('America/New_York', ms)).toBe(23 * 60 + 45);
    expect(civilKeyFromDays(zoneDayNumber('America/New_York', ms))).toBe(20260308);
    expect(zoneOffsetMs('UTC', ms)).toBe(0);
  });

  it('civil day maths round-trips and knows weekdays', () => {
    for (const [y, m, d] of [[1970, 1, 1], [2000, 2, 29], [2026, 11, 21], [1899, 12, 31]]) {
      expect(civilKeyFromDays(daysFromCivil(y, m, d))).toBe(y * 10000 + m * 100 + d);
    }
    expect(weekdayOfDay(daysFromCivil(2026, 11, 21))).toBe(6); // Saturday
    expect(weekdayOfDay(0)).toBe(4); // Thursday
  });
});

describe('time values', () => {
  it('accepts seconds, YYYY-MM-DD and business-day objects', () => {
    expect(timeToSeconds(1_700_000_000)).toBe(1_700_000_000);
    expect(timeToSeconds('2026-03-09')).toBe(Date.UTC(2026, 2, 9) / 1000);
    expect(timeToSeconds({ year: 2026, month: 3, day: 9 })).toBe(Date.UTC(2026, 2, 9) / 1000);
  });

  it('rejects anything else in plain words', () => {
    expect(() => timeToSeconds('09/03/2026')).toThrow(/YYYY-MM-DD/);
    expect(() => timeToSeconds(Number.NaN)).toThrow(/finite/);
    expect(() => timeToSeconds({ year: 2026, month: 13, day: 1 })).toThrow(/invalid business day/);
  });

  it('infers the bar granularity from the median gap', () => {
    const mk = (step: number, n = 50, skipWeekends = false): Float64Array => {
      const a: number[] = [];
      let t = Date.UTC(2026, 0, 5) / 1000;
      while (a.length < n) {
        const wd = new Date(t * 1000).getUTCDay();
        if (!skipWeekends || (wd !== 0 && wd !== 6)) a.push(t);
        t += step;
      }
      return Float64Array.from(a);
    };
    expect(inferTimeKind(mk(300), 50)).toBe('intraday');
    expect(inferTimeKind(mk(86400, 50, true), 50)).toBe('daily');
    expect(inferTimeKind(mk(7 * 86400), 50)).toBe('weekly');
    expect(inferTimeKind(mk(30 * 86400), 50)).toBe('monthly');
    expect(inferTimeKind(mk(365 * 86400), 20)).toBe('yearly');
  });
});

describe('time index (shared axis)', () => {
  it('merges series times into distinct slots and maps each series onto them', () => {
    const a = Float64Array.from([10, 20, 30, 40]);
    const b = Float64Array.from([20, 25, 40, 50]);
    const idx = new TimeIndex();
    idx.rebuild([{ times: a, count: 4 }, { times: b, count: 4 }], false);
    expect(Array.from(idx.times.subarray(0, idx.count))).toEqual([10, 20, 25, 30, 40, 50]);
    const pos = new Int32Array(4);
    mapToUnion(idx, b, 4, pos);
    expect(Array.from(pos)).toEqual([1, 2, 4, 5]);
    expect(idx.indexOf(25)).toBe(2);
    expect(idx.indexOf(26)).toBe(-1);
    expect(idx.lowerBound(26)).toBe(3);
  });

  it('appends in O(1) and grows past its first capacity', () => {
    const idx = new TimeIndex();
    idx.rebuild([], false);
    for (let i = 0; i < 100; i++) expect(idx.append(1_000 + i * 60)).toBe(i);
    expect(idx.count).toBe(100);
    expect(idx.kind).toBe('intraday');
    expect(idx.indexOf(1_000 + 99 * 60)).toBe(99);
  });

  it('reads the calendar in the display zone, DST-safe (New York 09:30 either side of the change)', () => {
    const idx = new TimeIndex();
    idx.setZone('America/New_York');
    const before = Date.UTC(2026, 2, 6, 14, 30) / 1000; // Fri 09:30 EST
    const after = Date.UTC(2026, 2, 9, 13, 30) / 1000; // Mon 09:30 EDT
    idx.rebuild([{ times: [before, after], count: 2 }], false);
    expect(idx.cal.minute[0]).toBe(570);
    expect(idx.cal.minute[1]).toBe(570);
    expect(idx.cal.day[1]).toBe(9);
    idx.setZone('Asia/Kolkata');
    expect(idx.cal.minute[0]).toBe(20 * 60); // 20:00 IST
  });

  it('business days ignore the display zone', () => {
    const idx = new TimeIndex();
    idx.setZone('America/Los_Angeles');
    idx.rebuild([{ times: [timeToSeconds('2026-03-09')], count: 1 }], true);
    expect(idx.cal.day[0]).toBe(9);
    expect(idx.cal.minute[0]).toBe(0);
  });
});
