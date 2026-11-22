// Catalog entries: trend studies (moving averages, VWAP family, trend followers, channels around price).
import { define, flt, int, period, select, source, line, upper, lower, dots, ZONES } from './catalog-kit';
import type { IndicatorSpec } from './catalog-kit';
import type { IndicatorPoint, IndicatorRow, SourceOptions } from './shared';
import { MA_TYPES } from './series';
import { sma } from './sma';
import { ema } from './ema';
import { wma } from './wma';
import { hma } from './hma';
import { dema } from './dema';
import { tema } from './tema';
import { rma } from './rma';
import { vwma } from './vwma';
import { lsma } from './lsma';
import { alma } from './alma';
import { kama } from './kama';
import { mcginley } from './mcginley';
import { vwap } from './vwap';
import { vwapBands } from './vwap-bands';
import { anchoredVwap } from './anchored-vwap';
import { supertrend } from './supertrend';
import { parabolicSar } from './parabolic-sar';
import { ichimoku } from './ichimoku';
import { linRegChannel } from './lin-reg-channel';
import { envelope } from './envelope';

/** A plain moving average of one period over a price source. */
const average = (id: string, name: string, shortName: string, def: number, f: (rows: readonly IndicatorRow[], p: number, o: SourceOptions) => IndicatorPoint[]): IndicatorSpec =>
  define({
    id, name, shortName, category: 'trend', overlay: true,
    inputs: [period(def), source()], outputs: [line('value', shortName)],
    run: (rows, v) => ({ value: f(rows, v.period, { source: v.source }) }),
  });

export const TREND: IndicatorSpec[] = [
  average('sma', 'Simple Moving Average', 'SMA', 20, sma),
  average('ema', 'Exponential Moving Average', 'EMA', 20, ema),
  average('wma', 'Weighted Moving Average', 'WMA', 20, wma),
  average('hma', 'Hull Moving Average', 'HMA', 14, hma),
  average('dema', 'Double Exponential Moving Average', 'DEMA', 20, dema),
  average('tema', 'Triple Exponential Moving Average', 'TEMA', 20, tema),
  average('rma', 'Wilder Moving Average (SMMA)', 'RMA', 7, rma),
  average('vwma', 'Volume Weighted Moving Average', 'VWMA', 20, vwma),
  define({
    id: 'lsma', name: 'Least Squares Moving Average', shortName: 'LSMA', category: 'trend', overlay: true,
    inputs: [period(25), int('offset', 'Offset', 0, -100, 100), source()], outputs: [line('value', 'LSMA')],
    run: (rows, v) => ({ value: lsma(rows, v.period, { offset: v.offset, source: v.source }) }),
  }),
  define({
    id: 'alma', name: 'Arnaud Legoux Moving Average', shortName: 'ALMA', category: 'trend', overlay: true,
    inputs: [int('window', 'Window', 9), flt('offset', 'Offset', 0.85, 0, 1, 0.05), flt('sigma', 'Sigma', 6, 0.5, 50, 0.5), source()],
    outputs: [line('value', 'ALMA')],
    run: (rows, v) => ({ value: alma(rows, { window: v.window, offset: v.offset, sigma: v.sigma, source: v.source }) }),
  }),
  define({
    id: 'kama', name: 'Kaufman Adaptive Moving Average', shortName: 'KAMA', category: 'trend', overlay: true,
    inputs: [int('er', 'Efficiency period', 10), int('fast', 'Fast', 2, 1, 100), int('slow', 'Slow', 30, 2, 200), source()],
    outputs: [line('value', 'KAMA')],
    run: (rows, v) => ({ value: kama(rows, { er: v.er, fast: v.fast, slow: v.slow, source: v.source }) }),
  }),
  define({
    id: 'mcginley', name: 'McGinley Dynamic', shortName: 'MD', category: 'trend', overlay: true,
    inputs: [period(14), flt('k', 'Factor', 0.6, 0.05, 5, 0.05), source()], outputs: [line('value', 'McGinley')],
    run: (rows, v) => ({ value: mcginley(rows, { period: v.period, k: v.k, source: v.source }) }),
  }),
  define({
    id: 'envelope', name: 'Moving Average Envelope', shortName: 'Env', category: 'trend', overlay: true,
    inputs: [period(20), flt('percent', 'Percent', 10, 0.1, 50, 0.1), select('type', 'Average', 'sma', MA_TYPES), source()],
    outputs: [upper('upper', 'Upper'), line('middle', 'Middle', 'muted'), lower('lower', 'Lower')],
    run: (rows, v) => envelope(rows, { period: v.period, percent: v.percent, type: v.type, source: v.source }),
  }),
  define({
    id: 'linreg-channel', name: 'Linear Regression Channel', shortName: 'LRC', category: 'trend', overlay: true,
    inputs: [int('period', 'Period', 100, 2, 1000), flt('deviations', 'Deviations', 2, 0.1, 10, 0.1), source()],
    outputs: [upper('upper', 'Upper'), line('middle', 'Middle', 'muted'), lower('lower', 'Lower')],
    run: (rows, v) => linRegChannel(rows, { period: v.period, deviations: v.deviations, source: v.source }),
  }),
  define({
    id: 'ichimoku', name: 'Ichimoku Cloud', shortName: 'Ichimoku', category: 'trend', overlay: true,
    inputs: [int('tenkan', 'Conversion', 9), int('kijun', 'Base', 26), int('senkouB', 'Span B', 52)],
    outputs: [
      line('tenkan', 'Conversion'), line('kijun', 'Base', 1), line('chikou', 'Lagging', 'muted'),
      { key: 'senkouA', label: 'Span A', kind: 'band-upper', tone: 'up' }, { key: 'senkouB', label: 'Span B', kind: 'band-lower', tone: 'down' },
    ],
    run: (rows, v) => ichimoku(rows, { tenkan: v.tenkan, kijun: v.kijun, senkouB: v.senkouB }),
  }),
  define({
    id: 'parabolic-sar', name: 'Parabolic SAR', shortName: 'SAR', category: 'trend', overlay: true,
    inputs: [flt('step', 'Step', 0.02, 0.001, 0.5, 0.001), flt('max', 'Maximum', 0.2, 0.05, 1, 0.01)],
    outputs: [dots('up', 'Long', 'up'), dots('down', 'Short', 'down')],
    run: (rows, v) => { const s = parabolicSar(rows, { step: v.step, max: v.max }); return { up: s.up, down: s.down }; },
  }),
  define({
    id: 'supertrend', name: 'Supertrend', shortName: 'Supertrend', category: 'trend', overlay: true,
    inputs: [period(10), flt('multiplier', 'Multiplier', 3, 0.1, 20, 0.1)],
    outputs: [line('up', 'Up trend', 'up'), line('down', 'Down trend', 'down')],
    run: (rows, v) => { const s = supertrend(rows, { period: v.period, multiplier: v.multiplier }); return { up: s.up, down: s.down }; },
  }),
  define({
    id: 'vwap', name: 'Volume Weighted Average Price', shortName: 'VWAP', category: 'trend', overlay: true,
    inputs: [select('reset', 'Restart', 'day', ['day', 'none']), select('zone', 'Day in zone', 'UTC', ZONES), source('hlc3')],
    outputs: [line('value', 'VWAP')],
    run: (rows, v) => ({ value: vwap(rows, { reset: v.reset, zone: v.zone, source: v.source }) }),
  }),
  define({
    id: 'vwap-bands', name: 'VWAP with Bands', shortName: 'VWAP Bands', category: 'trend', overlay: true,
    inputs: [select('anchor', 'Restart', 'day', ['day', 'week', 'month', 'year', 'none']), select('zone', 'Day in zone', 'UTC', ZONES), flt('width', 'Band width', 1, 0.1, 5, 0.1), source('hlc3')],
    outputs: [line('vwap', 'VWAP'), upper('upper1', 'Upper 1'), lower('lower1', 'Lower 1'), upper('upper2', 'Upper 2'), lower('lower2', 'Lower 2')],
    run: (rows, v) => vwapBands(rows, { anchor: v.anchor, zone: v.zone, source: v.source, multipliers: [v.width, 2 * v.width, 3 * v.width] }),
  }),
  define({
    id: 'anchored-vwap', name: 'Anchored VWAP', shortName: 'AVWAP', category: 'trend', overlay: true,
    inputs: [int('anchorBars', 'Anchor (bars back)', 100, 0, 100000), flt('width', 'Band width', 1, 0.1, 5, 0.1), source('hlc3')],
    outputs: [line('vwap', 'AVWAP'), upper('upper1', 'Upper 1'), lower('lower1', 'Lower 1'), upper('upper2', 'Upper 2'), lower('lower2', 'Lower 2')],
    run: (rows, v) => anchoredVwap(rows, { from: rows.length ? rows[Math.max(0, rows.length - 1 - v.anchorBars)].time : undefined, source: v.source, multipliers: [v.width, 2 * v.width, 3 * v.width] }),
  }),
];
