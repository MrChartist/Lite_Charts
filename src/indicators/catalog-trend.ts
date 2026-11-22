// Catalog entries: trend and overlay studies (moving averages, channels, levels, trend followers).
import { define, period, select, source, line, ZONES } from './catalog-kit';
import type { IndicatorSpec } from './catalog-kit';
import { sma } from './sma';
import { ema } from './ema';
import { wma } from './wma';
import { vwap } from './vwap';
import { supertrend } from './supertrend';

export const TREND: IndicatorSpec[] = [
  define({
    id: 'sma', name: 'Simple Moving Average', shortName: 'SMA', category: 'trend', overlay: true,
    inputs: [period(20), source()], outputs: [line('value', 'SMA')],
    run: (rows, v) => ({ value: sma(rows, v.period, { source: v.source }) }),
  }),
  define({
    id: 'ema', name: 'Exponential Moving Average', shortName: 'EMA', category: 'trend', overlay: true,
    inputs: [period(20), source()], outputs: [line('value', 'EMA')],
    run: (rows, v) => ({ value: ema(rows, v.period, { source: v.source }) }),
  }),
  define({
    id: 'wma', name: 'Weighted Moving Average', shortName: 'WMA', category: 'trend', overlay: true,
    inputs: [period(20), source()], outputs: [line('value', 'WMA')],
    run: (rows, v) => ({ value: wma(rows, v.period, { source: v.source }) }),
  }),
  define({
    id: 'vwap', name: 'Volume Weighted Average Price', shortName: 'VWAP', category: 'trend', overlay: true,
    inputs: [select('reset', 'Restart', 'day', ['day', 'none']), select('zone', 'Day in zone', 'UTC', ZONES), source('hlc3')],
    outputs: [line('value', 'VWAP')],
    run: (rows, v) => ({ value: vwap(rows, { reset: v.reset, zone: v.zone, source: v.source }) }),
  }),
  define({
    id: 'supertrend', name: 'Supertrend', shortName: 'Supertrend', category: 'trend', overlay: true,
    inputs: [period(10), { key: 'multiplier', label: 'Multiplier', type: 'float', default: 3, min: 0.1, max: 20, step: 0.1 }],
    outputs: [line('up', 'Up trend', 'up'), line('down', 'Down trend', 'down')],
    run: (rows, v) => { const s = supertrend(rows, { period: v.period, multiplier: v.multiplier }); return { up: s.up, down: s.down }; },
  }),
];
