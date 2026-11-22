// Catalog entries: momentum oscillators, each in a pane of its own.
import { define, int, period, source, line, hist } from './catalog-kit';
import type { IndicatorSpec } from './catalog-kit';
import { rsi } from './rsi';
import { macd } from './macd';
import { stochastic } from './stochastic';

export const MOMENTUM: IndicatorSpec[] = [
  define({
    id: 'rsi', name: 'Relative Strength Index', shortName: 'RSI', category: 'momentum', overlay: false,
    inputs: [period(14), source()], outputs: [line('value', 'RSI')], guides: [30, 70],
    run: (rows, v) => ({ value: rsi(rows, v.period, { source: v.source }) }),
  }),
  define({
    id: 'macd', name: 'MACD', shortName: 'MACD', category: 'momentum', overlay: false,
    inputs: [int('fast', 'Fast', 12), int('slow', 'Slow', 26), int('signal', 'Signal', 9), source()],
    outputs: [hist('histogram', 'Histogram'), line('macd', 'MACD'), line('signal', 'Signal', 1)], guides: [0],
    run: (rows, v) => macd(rows, { fast: v.fast, slow: v.slow, signal: v.signal, source: v.source }),
  }),
  define({
    id: 'stochastic', name: 'Stochastic Oscillator', shortName: 'Stoch', category: 'momentum', overlay: false,
    inputs: [int('kPeriod', '%K period', 14), int('dPeriod', '%D period', 3)],
    outputs: [line('k', '%K'), line('d', '%D', 1)], guides: [20, 80],
    run: (rows, v) => stochastic(rows, { kPeriod: v.kPeriod, dPeriod: v.dPeriod }),
  }),
];
