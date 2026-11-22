// Catalog entries: volatility studies and price channels.
import { define, flt, int, period, source, line, upper, lower } from './catalog-kit';
import type { IndicatorSpec } from './catalog-kit';
import { bollinger } from './bollinger';
import { keltner } from './keltner';
import { donchian } from './donchian';
import { atr } from './atr';
import { bollingerBandwidth } from './bollinger-bandwidth';
import { percentB } from './percent-b';
import { standardDeviation } from './standard-deviation';
import { choppiness } from './choppiness';
import { massIndex } from './mass-index';
import { historicalVolatility } from './historical-volatility';
import { ulcerIndex } from './ulcer-index';
import { adr } from './adr';
import { adrPercent } from './adr-percent';

export const VOLATILITY: IndicatorSpec[] = [
  define({
    id: 'bollinger', name: 'Bollinger Bands', shortName: 'BB', category: 'volatility', overlay: true,
    inputs: [period(20), flt('mult', 'Deviations', 2, 0.1, 10, 0.1), source()],
    outputs: [upper('upper', 'Upper'), line('basis', 'Basis', 'muted'), lower('lower', 'Lower')],
    run: (rows, v) => bollinger(rows, { period: v.period, mult: v.mult, source: v.source }),
  }),
  define({
    id: 'keltner', name: 'Keltner Channels', shortName: 'KC', category: 'volatility', overlay: true,
    inputs: [period(20), flt('mult', 'Multiplier', 2, 0.1, 20, 0.1), int('atrPeriod', 'ATR period', 10)],
    outputs: [upper('upper', 'Upper'), line('middle', 'Middle', 'muted'), lower('lower', 'Lower')],
    run: (rows, v) => keltner(rows, { period: v.period, mult: v.mult, atrPeriod: v.atrPeriod }),
  }),
  define({
    id: 'donchian', name: 'Donchian Channels', shortName: 'DC', category: 'volatility', overlay: true,
    inputs: [period(20)],
    outputs: [upper('upper', 'Upper'), line('middle', 'Middle', 'muted'), lower('lower', 'Lower')],
    run: (rows, v) => donchian(rows, v.period),
  }),
  define({
    id: 'atr', name: 'Average True Range', shortName: 'ATR', category: 'volatility', overlay: false,
    inputs: [period(14)], outputs: [line('value', 'ATR')],
    run: (rows, v) => ({ value: atr(rows, v.period) }),
  }),
  define({
    id: 'bollinger-bandwidth', name: 'Bollinger Band Width', shortName: 'BBW', category: 'volatility', overlay: false,
    inputs: [period(20), flt('mult', 'Deviations', 2, 0.1, 10, 0.1), source()], outputs: [line('value', 'BBW')],
    run: (rows, v) => ({ value: bollingerBandwidth(rows, { period: v.period, mult: v.mult, source: v.source }) }),
  }),
  define({
    id: 'percent-b', name: 'Bollinger %B', shortName: '%B', category: 'volatility', overlay: false,
    inputs: [period(20), flt('mult', 'Deviations', 2, 0.1, 10, 0.1), source()], outputs: [line('value', '%B')], guides: [0, 1],
    run: (rows, v) => ({ value: percentB(rows, { period: v.period, mult: v.mult, source: v.source }) }),
  }),
  define({
    id: 'standard-deviation', name: 'Standard Deviation', shortName: 'StdDev', category: 'volatility', overlay: false,
    inputs: [period(20), source()], outputs: [line('value', 'StdDev')],
    run: (rows, v) => ({ value: standardDeviation(rows, v.period, { source: v.source }) }),
  }),
  define({
    id: 'choppiness', name: 'Choppiness Index', shortName: 'CHOP', category: 'volatility', overlay: false,
    inputs: [period(14)], outputs: [line('value', 'CHOP')], guides: [38.2, 61.8],
    run: (rows, v) => ({ value: choppiness(rows, v.period) }),
  }),
  define({
    id: 'mass-index', name: 'Mass Index', shortName: 'MI', category: 'volatility', overlay: false,
    inputs: [int('emaPeriod', 'EMA period', 9), int('sumPeriod', 'Sum period', 25)], outputs: [line('value', 'Mass Index')], guides: [26.5, 27],
    run: (rows, v) => ({ value: massIndex(rows, { emaPeriod: v.emaPeriod, sumPeriod: v.sumPeriod }) }),
  }),
  define({
    id: 'historical-volatility', name: 'Historical Volatility', shortName: 'HV', category: 'volatility', overlay: false,
    inputs: [period(10), int('annualisation', 'Periods per year', 252, 1, 366), source()], outputs: [line('value', 'HV')],
    run: (rows, v) => ({ value: historicalVolatility(rows, { period: v.period, annualisation: v.annualisation, source: v.source }) }),
  }),
  define({
    id: 'ulcer-index', name: 'Ulcer Index', shortName: 'UI', category: 'volatility', overlay: false,
    inputs: [period(14), source()], outputs: [line('value', 'Ulcer')],
    run: (rows, v) => ({ value: ulcerIndex(rows, v.period, { source: v.source }) }),
  }),
  define({
    id: 'adr', name: 'Average Daily Range', shortName: 'ADR', category: 'volatility', overlay: false,
    inputs: [period(14)], outputs: [line('value', 'ADR')],
    run: (rows, v) => ({ value: adr(rows, v.period) }),
  }),
  define({
    id: 'adr-percent', name: 'Average Daily Range %', shortName: 'ADR%', category: 'volatility', overlay: false,
    inputs: [period(14)], outputs: [line('value', 'ADR %')],
    run: (rows, v) => ({ value: adrPercent(rows, v.period) }),
  }),
];
