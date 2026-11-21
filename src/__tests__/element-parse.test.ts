import { describe, expect, it } from 'vitest';
import {
  canonicalRows, parseBoolAttr, parseElementConfig, parseHeight, parseRows, parseTime, shapeRows, sortRows, splitCsv,
  timeKey, volumeRows,
} from '../element/parse';
import { isSeriesTypeName, resolveSeriesDefinition, seriesShape } from '../element/series-map';

const attrs = (o: Record<string, string>) => (n: string): string | null => (n in o ? o[n] : null);

describe('element attributes', () => {
  it('defaults', () => {
    const { config, issues } = parseElementConfig(attrs({}));
    expect(issues).toEqual([]);
    expect(config).toEqual({ type: 'candlestick', theme: 'auto', height: '360px', timeZone: null, volume: false, attribution: true, ariaLabel: null });
  });

  it('reads every attribute', () => {
    const { config, issues } = parseElementConfig(attrs({
      type: 'LINE', theme: 'dark', height: '50vh', 'time-zone': ' Asia/Kolkata ', volume: '', attribution: 'false', 'aria-label': 'Reliance daily price',
    }));
    expect(issues).toEqual([]);
    expect(config).toEqual({ type: 'line', theme: 'dark', height: '50vh', timeZone: 'Asia/Kolkata', volume: true, attribution: false, ariaLabel: 'Reliance daily price' });
  });

  it('keeps a default and reports an issue for a value it cannot use', () => {
    const { config, issues } = parseElementConfig(attrs({ type: 'pie', theme: 'blue', height: 'tall' }));
    expect(config.type).toBe('candlestick');
    expect(config.theme).toBe('auto');
    expect(config.height).toBe('360px');
    expect(issues).toHaveLength(3);
    expect(issues[0]).toContain('"pie"');
  });

  it('booleans', () => {
    expect(parseBoolAttr(null, false)).toBe(false);
    expect(parseBoolAttr(null, true)).toBe(true);
    expect(parseBoolAttr('', false)).toBe(true);
    expect(parseBoolAttr('true', false)).toBe(true);
    for (const w of ['false', '0', 'off', 'No', 'hidden']) expect(parseBoolAttr(w, true)).toBe(false);
  });

  it('height accepts a number or a CSS length only', () => {
    expect(parseHeight('360').height).toBe('360px');
    expect(parseHeight('24.5rem').height).toBe('24.5rem');
    expect(parseHeight('100%').height).toBe('100%');
    expect(parseHeight('360px; color:red').issue).toBeDefined();
    expect(parseHeight('360px; color:red').height).toBe('360px');
    expect(parseHeight(null).issue).toBeUndefined();
  });

  it('series type names', () => {
    expect(isSeriesTypeName('area')).toBe(true);
    expect(isSeriesTypeName('toString')).toBe(false);
    expect(seriesShape('bar')).toBe('ohlc');
    expect(seriesShape('histogram')).toBe('value');
    expect(resolveSeriesDefinition('candlestick')?.type).toBe('candlestick');
    expect(resolveSeriesDefinition('line')?.type).toBe('line');
    const area = resolveSeriesDefinition('area');
    if (area) expect(area.type).toBe('area');
  });
});

describe('times', () => {
  it('passes dates and seconds, reads ISO date-times as UTC, turns milliseconds into seconds', () => {
    expect(parseTime('2024-03-05')).toBe('2024-03-05');
    expect(parseTime(1700000000)).toBe(1700000000);
    expect(parseTime('1700000000')).toBe(1700000000);
    expect(parseTime(1700000000000)).toBe(1700000000);
    expect(parseTime('2024-03-05T09:15:00')).toBe(Date.UTC(2024, 2, 5, 9, 15) / 1000);
    expect(parseTime('2024-03-05 09:15')).toBe(Date.UTC(2024, 2, 5, 9, 15) / 1000);
    expect(parseTime('2024-03-05T09:15:00+05:30')).toBe(Date.UTC(2024, 2, 5, 3, 45) / 1000);
    const bd = { year: 2024, month: 3, day: 5 };
    expect(parseTime(bd)).toBe(bd);
  });

  it('names the row when a time cannot be read', () => {
    expect(() => parseTime('yesterday', 'row 4')).toThrow(/row 4: cannot read the time "yesterday"/);
    expect(() => parseTime(undefined, 'row 2')).toThrow(/row 2: missing time/);
  });

  it('timeKey orders mixed forms', () => {
    expect(timeKey('1970-01-02')).toBe(86400);
    expect(timeKey({ year: 1970, month: 1, day: 2 })).toBe(86400);
    expect(timeKey(5)).toBe(5);
  });
});

describe('CSV', () => {
  it('splits quotes, doubled quotes, CRLF, a BOM and other delimiters', () => {
    expect(splitCsv('﻿a,b\r\n1,"x,y"\r\n\r\n2,"say ""hi"""\r\n')).toEqual([['a', 'b'], ['1', 'x,y'], ['2', 'say "hi"']]);
    expect(splitCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(splitCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(splitCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(splitCsv('')).toEqual([]);
  });

  it('parses an OHLCV file with a header', () => {
    const rows = parseRows('time,open,high,low,close,volume\n2024-01-02,10,12,9,11,1000\n2024-01-03,11,13,10,12,1500\n');
    expect(rows).toEqual([
      { time: '2024-01-02', open: '10', high: '12', low: '9', close: '11', volume: '1000' },
      { time: '2024-01-03', open: '11', high: '13', low: '10', close: '12', volume: '1500' },
    ]);
    expect(shapeRows(rows, 'ohlc')[0]).toEqual({ time: '2024-01-02', open: 10, high: 12, low: 9, close: 11 });
    expect(volumeRows(rows)[1]).toEqual({ time: '2024-01-03', value: 1500 });
  });

  it('accepts header aliases in any case', () => {
    const rows = parseRows('Date,O,H,L,C,Vol\n2024-01-02,1,2,0.5,1.5,7');
    expect(shapeRows(rows, 'ohlc')[0]).toEqual({ time: '2024-01-02', open: 1, high: 2, low: 0.5, close: 1.5 });
  });

  it('parses time,value and uses close for a value type', () => {
    const rows = parseRows('time,value\n1700000000,10.5\n1700000060,\n');
    expect(shapeRows(rows, 'value')).toEqual([{ time: 1700000000, value: 10.5 }, { time: 1700000060 }]);
    expect(shapeRows(parseRows('time,close\n2024-01-02,5'), 'value')).toEqual([{ time: '2024-01-02', value: 5 }]);
  });

  it('says what is wrong', () => {
    expect(() => parseRows('open,close\n1,2')).toThrow(/header row with a time/);
    expect(() => shapeRows(parseRows('time,value\n2024-01-02,3'), 'ohlc', 'candlestick')).toThrow(/candlestick data needs open, high, low and close/);
    expect(() => shapeRows(parseRows('time,value\n2024-01-02,abc'), 'value')).toThrow(/row 1: value "abc" is not a number/);
  });

  it('a row of blanks is a whitespace row', () => {
    const rows = parseRows('time,open,high,low,close\n2024-01-02,,,,\n');
    expect(shapeRows(rows, 'ohlc')).toEqual([{ time: '2024-01-02' }]);
  });
});

describe('JSON rows', () => {
  it('takes an array, or an object holding data or rows', () => {
    const a = parseRows('[{"time":"2024-01-02","open":1,"high":2,"low":0,"close":1}]');
    expect(a).toHaveLength(1);
    expect(parseRows('{"data":[{"time":1700000000,"value":3}]}')).toEqual([{ time: 1700000000, value: 3 }]);
    expect(parseRows('{"rows":[{"time":1700000000,"value":3}]}')).toHaveLength(1);
    expect(parseRows('  ')).toEqual([]);
  });

  it('renames aliased keys and ignores prototype keys', () => {
    const rows = canonicalRows(JSON.parse('[{"Date":"2024-01-02","C":4,"__proto__":{"x":1},"extra":"kept"}]'));
    expect(rows[0].time).toBe('2024-01-02');
    expect(rows[0].close).toBe(4);
    expect(rows[0].extra).toBe('kept');
    expect(({} as { x?: number }).x).toBeUndefined();
  });

  it('plain-words errors', () => {
    expect(() => parseRows('[1,2]')).toThrow(/row 1 is not an object/);
    expect(() => parseRows('{"oops":1}')).toThrow(/array of rows/);
    expect(() => parseRows('[{"time":')).toThrow(/not valid JSON/);
  });
});

describe('sortRows', () => {
  it('returns the same array when sorted and a stable sorted copy otherwise', () => {
    const sorted = [{ time: 1 }, { time: 2 }];
    expect(sortRows(sorted)).toBe(sorted);
    const out = sortRows([{ time: 3, n: 'a' }, { time: 1, n: 'b' }, { time: 3, n: 'c' }]);
    expect(out.map(r => r.n)).toEqual(['b', 'a', 'c']);
  });
});
