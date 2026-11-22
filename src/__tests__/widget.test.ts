import { describe, expect, it } from 'vitest';
import { localMidnight, parseSpan, spanFirstIndex, spanStart, spanStartDay } from '../core/span';
import { daysFromCivil } from '../core/zone';
import { collapseBar, KEEP, useSheets } from '../widget/layout';
import { barsForSpan, intervalForSpan, intervalFromDigits, intervalSeconds, nearestInterval, normalizeInterval, sortIntervals, toLiveInterval } from '../widget/intervals';
import { defaultSettings, migrateWorkspace, readWorkspace, validateParams, WORKSPACE_FORMAT, WORKSPACE_VERSION } from '../widget/workspace';
import { formatValue, offsetLabel, toBars } from '../widget/widget';
import { terminalOptions } from '../widget/element';
import { demoBars } from '../widget/demo';
import { INDICATORS, getIndicator } from '../indicators/catalog';
import type { WorkspaceJSON } from '../widget/types';

const utc = (y: number, m: number, d: number, h = 0, mi = 0): number => Date.UTC(y, m - 1, d, h, mi) / 1000;
const iso = (s: number): string => new Date(s * 1000).toISOString().slice(0, 16);

describe('span maths (core/span.ts)', () => {
  it('parses keys and objects', () => {
    expect(parseSpan('1D')).toEqual({ unit: 'D', n: 1 });
    expect(parseSpan('ytd')).toEqual({ unit: 'YTD', n: 1 });
    expect(parseSpan('All')).toEqual({ unit: 'ALL', n: 1 });
    expect(parseSpan({ days: 10 })).toEqual({ unit: 'D', n: 10 });
    expect(parseSpan({ months: 2.2 })).toEqual({ unit: 'M', n: 3 });
    expect(parseSpan('0D')).toBeNull();
    expect(parseSpan('2Q')).toBeNull();
  });

  it('month spans clamp to the month end (31 Mar back one month is 29 Feb in a leap year)', () => {
    const last = utc(2024, 3, 31, 15);
    expect(iso(spanStart(parseSpan('1M')!, last, 'UTC'))).toBe('2024-02-29T00:00');
    expect(iso(spanStart(parseSpan('1M')!, utc(2023, 3, 31, 15), 'UTC'))).toBe('2023-02-28T00:00');
    expect(iso(spanStart(parseSpan('3M')!, last, 'UTC'))).toBe('2023-12-31T00:00');
    expect(iso(spanStart(parseSpan('1Y')!, utc(2024, 2, 29), 'UTC'))).toBe('2023-02-28T00:00');
    expect(iso(spanStart(parseSpan('5Y')!, last, 'UTC'))).toBe('2019-03-31T00:00');
  });

  it('YTD starts on 1 January of the last bar\'s LOCAL year, across a year change and in other zones', () => {
    expect(iso(spanStart(parseSpan('YTD')!, utc(2026, 1, 2, 10), 'UTC'))).toBe('2026-01-01T00:00');
    // 03:00 UTC on 1 Jan 2026 is still 31 Dec 2025 in New York: YTD is the whole of 2025 there.
    expect(iso(spanStart(parseSpan('YTD')!, utc(2026, 1, 1, 3), 'America/New_York'))).toBe('2025-01-01T05:00');
    // ...and already 2026 in Kolkata (UTC+5:30): midnight local is 18:30 UTC the day before.
    expect(iso(spanStart(parseSpan('YTD')!, utc(2026, 1, 1, 3), 'Asia/Kolkata'))).toBe('2025-12-31T18:30');
    expect(iso(spanStart(parseSpan('YTD')!, utc(2026, 1, 1, 3), 'Australia/Sydney'))).toBe('2025-12-31T13:00');
  });

  it('local midnight is DST safe', () => {
    // New York, 10 Mar 2024 (spring forward at 02:00): midnight is still EST (UTC-5).
    expect(iso(localMidnight('America/New_York', daysFromCivil(2024, 3, 10)))).toBe('2024-03-10T05:00');
    expect(iso(localMidnight('America/New_York', daysFromCivil(2024, 3, 11)))).toBe('2024-03-11T04:00');
    // A change AT midnight (Santiago, 8 Sep 2024: 00:00 does not exist): the first instant of the day is 01:00 local.
    const t = localMidnight('America/Santiago', daysFromCivil(2024, 9, 8));
    expect(t).toBeGreaterThan(utc(2024, 9, 8, 3, 59));
  });

  it('spanStartDay agrees with the extras range maths signature (calendar days for D)', () => {
    const day = daysFromCivil(2025, 6, 15);
    expect(spanStartDay(parseSpan('1D')!, day)).toBe(day);
    expect(spanStartDay(parseSpan('5D')!, day)).toBe(day - 4);
    expect(spanStartDay(parseSpan('YTD')!, day)).toBe(daysFromCivil(2025, 1, 1));
    expect(spanStartDay(parseSpan('All')!, day)).toBeNull();
  });

  it('first index: nD counts sessions in the data (weekends are not days), others by calendar', () => {
    // Daily bars Mon-Fri for three weeks.
    const times: number[] = [];
    for (let d = 1; d <= 21; d++) { const t = utc(2024, 7, d); const wd = new Date(t * 1000).getUTCDay(); if (wd !== 0 && wd !== 6) times.push(t); }
    expect(spanFirstIndex(parseSpan('5D')!, times, times.length, 'UTC')).toBe(times.length - 5);
    expect(spanFirstIndex(parseSpan('1D')!, times, times.length, 'UTC')).toBe(times.length - 1);
    expect(spanFirstIndex(parseSpan('All')!, times, times.length, 'UTC')).toBe(0);
    // 1W back from Fri 19 Jul is Fri 12 Jul.
    expect(iso(times[spanFirstIndex(parseSpan('1W')!, times, times.length, 'UTC')])).toBe('2024-07-12T00:00');
    // Intraday: 1D is the last local session.
    const intraday = [utc(2024, 7, 1, 13, 30), utc(2024, 7, 1, 19), utc(2024, 7, 2, 13, 30), utc(2024, 7, 2, 15), utc(2024, 7, 2, 19)];
    expect(spanFirstIndex(parseSpan('1D')!, intraday, 5, 'America/New_York')).toBe(2);
  });
});

describe('intervals', () => {
  it('normalizes text and digits', () => {
    expect(normalizeInterval('1d')).toBe('1D');
    expect(normalizeInterval('4H')).toBe('4h');
    expect(normalizeInterval('60')).toBe('1h');
    expect(normalizeInterval('240')).toBe('4h');
    expect(normalizeInterval('1440')).toBe('1D');
    expect(normalizeInterval('15')).toBe('15m');
    expect(normalizeInterval('x')).toBeNull();
    expect(intervalFromDigits('5')).toBe('5m');
    expect(intervalSeconds('1W')).toBe(604800);
    expect(sortIntervals(['1D', '1m', '1h', 'bad'])).toEqual(['1m', '1h', '1D']);
    expect(toLiveInterval('1D')).toBe('1d');
  });
  it('range keys pick a fitting interval from what is offered', () => {
    const all = ['1m', '5m', '15m', '1h', '4h', '1D', '1W'];
    expect(intervalForSpan('1D', all)).toBe('5m');
    expect(intervalForSpan('5Y', all)).toBe('1W');
    expect(intervalForSpan('3M', ['1m', '5m', '15m', '1h', '6h', '1D'])).toBe('6h');
    expect(nearestInterval('4h', ['1h', '1D'])).toBe('1h');
    expect(barsForSpan('1M', '1h', utc(2025, 1, 1))).toBeGreaterThan(30 * 24);
    expect(barsForSpan('All', '1D', 0)).toBe(5000);
  });
});

describe('responsive collapse', () => {
  const items = [
    { id: 'symbol', width: 120, priority: KEEP },
    { id: 'intervals', width: 200, priority: 90 },
    { id: 'indicators', width: 100, priority: 88 },
    { id: 'undo', width: 30, priority: 30 },
    { id: 'redo', width: 30, priority: 29 },
    { id: 'theme', width: 30, priority: 35 },
  ];
  it('keeps everything when it fits', () => {
    expect(collapseBar(items, 1000, 30)).toEqual({ visible: items.map(i => i.id), overflow: [] });
  });
  it('drops the lowest priority first and reserves room for More', () => {
    const r = collapseBar(items, 500, 30);
    expect(r.overflow).toEqual(['undo', 'redo']);
    expect(r.visible).toEqual(['symbol', 'intervals', 'indicators', 'theme']);
  });
  it('never drops KEEP items, keeps order', () => {
    const r = collapseBar(items, 100, 30);
    expect(r.visible).toEqual(['symbol']);
    expect(r.overflow).toEqual(['intervals', 'indicators', 'undo', 'redo', 'theme']);
  });
  it('sheets on phones and narrow touch screens', () => {
    expect(useSheets(390, false)).toBe(true);
    expect(useSheets(700, true)).toBe(true);
    expect(useSheets(700, false)).toBe(false);
  });
});

describe('indicator params', () => {
  const rsi = getIndicator('rsi')!;
  it('fills defaults, clamps, rounds and reports', () => {
    expect(validateParams(rsi, {}).params.period).toBe(14);
    const r = validateParams(rsi, { period: 2.6, nope: 1 });
    expect(r.params.period).toBe(3);
    expect(r.issues.join(' ')).toMatch(/rounded/);
    expect(r.issues.join(' ')).toMatch(/unknown/);
    expect(validateParams(rsi, { period: -5 }).params.period).toBe(rsi.inputs.find(i => i.key === 'period')!.min);
    expect(validateParams(rsi, { period: 'abc' }).params.period).toBe(14);
    expect(validateParams(rsi, { period: '21' }).params.period).toBe(21);
  });
  it('choices must be one of the options', () => {
    const spec = INDICATORS.find(s => s.inputs.some(i => i.type === 'source'))!;
    const src = spec.inputs.find(i => i.type === 'source')!;
    expect(validateParams(spec, { [src.key]: 'nonsense' }).params[src.key]).toBe(src.default);
    expect(validateParams(spec, { [src.key]: 'hl2' }).params[src.key]).toBe('hl2');
  });
  it('every catalog spec validates its own defaults without issues', () => {
    for (const s of INDICATORS) {
      const defaults = Object.fromEntries(s.inputs.map(i => [i.key, i.default]));
      expect(validateParams(s, defaults).issues).toEqual([]);
    }
  });
});

describe('workspace', () => {
  const base: WorkspaceJSON = {
    format: WORKSPACE_FORMAT, version: WORKSPACE_VERSION, symbol: { symbol: 'BTC-USD', description: 'Bitcoin' }, interval: '1h', chartType: 'candles',
    theme: 'light', timeZone: 'UTC', indicators: [], compare: [], settings: defaultSettings(), drawings: null,
  };
  it('round trips', () => {
    const ws: WorkspaceJSON = { ...base, interval: '15m', chartType: 'heikinAshi', theme: 'dark', timeZone: 'Asia/Kolkata', compare: ['ETH-USD'], drawings: '{"x":1}',
      indicators: [{ id: 'rsi', params: { period: 21 }, visible: false, placement: 'pane', styles: { rsi: { color: '#0066CC', width: 3 } } }],
      settings: { ...defaultSettings(), grid: false, scaleMode: 'log', tooltip: 'tracking' } };
    const back = readWorkspace(JSON.stringify(ws), INDICATORS, base)!;
    expect(back.interval).toBe('15m');
    expect(back.indicators[0].params.period).toBe(21);
    expect(back.indicators[0].visible).toBe(false);
    expect(back.settings).toEqual(ws.settings);
    expect(back.drawings).toBe('{"x":1}');
    expect(readWorkspace(back, INDICATORS, base)).toEqual(back);
  });
  it('migrates version 1 (studies, type, dark, plain symbol)', () => {
    const v1 = { version: 1, symbol: 'ETH-USD', type: 'line', dark: true, interval: '1d', studies: [{ name: 'RSI', inputs: { period: 9 } }, { name: 'gone' }] };
    const m = migrateWorkspace(v1)!;
    expect(m.version).toBe(2);
    const ws = readWorkspace(v1, INDICATORS, base)!;
    expect(ws.symbol.symbol).toBe('ETH-USD');
    expect(ws.chartType).toBe('line');
    expect(ws.theme).toBe('dark');
    expect(ws.interval).toBe('1D');
    expect(ws.indicators.map(i => [i.id, i.params.period])).toEqual([['rsi', 9]]);
  });
  it('refuses what is not a workspace or is from the future; drops bad fields', () => {
    expect(readWorkspace('not json', INDICATORS, base)).toBeNull();
    expect(readWorkspace({ format: 'other' }, INDICATORS, base)).toBeNull();
    expect(readWorkspace({ format: WORKSPACE_FORMAT, version: 99 }, INDICATORS, base)).toBeNull();
    const ws = readWorkspace({ format: WORKSPACE_FORMAT, version: 2, theme: 'purple', interval: 'x', settings: { crosshair: 'laser', grid: 'yes' } }, INDICATORS, base)!;
    expect(ws.theme).toBe('light');
    expect(ws.interval).toBe('1h');
    expect(ws.settings.crosshair).toBe('normal');
    expect(ws.settings.grid).toBe(true);
  });
});

describe('widget helpers', () => {
  it('rows into bars: seconds, milliseconds, dates; sorted and unique; value rows', () => {
    const bars = toBars([{ time: '2024-01-03', close: 3 }, { time: 1704153600000, open: 1, high: 2, low: 0.5, close: 1.5 }, { time: '2024-01-03', value: 4 }, { time: 'bad', close: 1 }]);
    expect(bars.map(b => b.time)).toEqual([1704153600, 1704240000]);
    expect(bars[1]).toMatchObject({ open: 4, high: 4, low: 4, close: 4 });
  });
  it('numbers: no grouping, true minus', () => {
    expect(formatValue(64231.5)).toBe('64231.50');
    expect(formatValue(-0.0123)).toBe('−0.0123');
    expect(offsetLabel(-4 * 3600000)).toBe('UTC−4');
    expect(offsetLabel(19800000)).toBe('UTC+5:30');
    expect(offsetLabel(0)).toBe('UTC');
  });
  it('element attributes into options', () => {
    const attrs: Record<string, string> = { symbol: 'ETH-USD', interval: '15m', indicators: 'rsi, bollinger', theme: 'dark', live: '', 'toolbar-off': 'compare,clock', height: '500' };
    const o = terminalOptions(n => attrs[n] ?? null, n => n in attrs);
    expect(o.live).toEqual({ symbol: 'ETH-USD' });
    expect(o.indicators).toEqual(['rsi', 'bollinger']);
    expect(o.toolbar).toEqual({ compare: false, clock: false });
    expect(o.height).toBe(500);
    expect(o.theme).toBe('dark');
  });
  it('demo bars are deterministic, aligned and sane', () => {
    const a = demoBars('BTC-USD', '1h', 50, utc(2025, 1, 1, 10, 30));
    expect(a).toEqual(demoBars('BTC-USD', '1h', 50, utc(2025, 1, 1, 10, 30)));
    expect(a[a.length - 1].time).toBe(utc(2025, 1, 1, 10));
    expect(a.every(b => b.low <= Math.min(b.open, b.close) && b.high >= Math.max(b.open, b.close))).toBe(true);
  });
});
