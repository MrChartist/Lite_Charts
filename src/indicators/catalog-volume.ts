// Catalog entries: volume studies.
import { define, int, period, select, line, hist, ZONES, flt } from './catalog-kit';
import type { IndicatorSpec } from './catalog-kit';
import { obv } from './obv';
import { mfi } from './mfi';
import { cmf } from './cmf';
import { adLine } from './ad-line';
import { chaikinOscillator } from './chaikin-oscillator';
import { forceIndex } from './force-index';
import { easeOfMovement } from './ease-of-movement';
import { volumeRoc } from './volume-roc';
import { klinger } from './klinger';
import { relativeVolume } from './relative-volume';
import { priceVolumeTrend } from './pvt';
import { negativeVolumeIndex } from './nvi';
import { positiveVolumeIndex } from './pvi';
import { netVolume } from './net-volume';
import { volumeMa } from './volume-ma';

export const VOLUME: IndicatorSpec[] = [
  define({
    id: 'obv', name: 'On Balance Volume', shortName: 'OBV', category: 'volume', overlay: false,
    inputs: [], outputs: [line('value', 'OBV')],
    run: rows => ({ value: obv(rows) }),
  }),
  define({
    id: 'mfi', name: 'Money Flow Index', shortName: 'MFI', category: 'volume', overlay: false,
    inputs: [period(14)], outputs: [line('value', 'MFI')], guides: [20, 80],
    run: (rows, v) => ({ value: mfi(rows, v.period) }),
  }),
  define({
    id: 'cmf', name: 'Chaikin Money Flow', shortName: 'CMF', category: 'volume', overlay: false,
    inputs: [period(20)], outputs: [line('value', 'CMF')], guides: [0],
    run: (rows, v) => ({ value: cmf(rows, v.period) }),
  }),
  define({
    id: 'ad-line', name: 'Accumulation / Distribution', shortName: 'A/D', category: 'volume', overlay: false,
    inputs: [], outputs: [line('value', 'A/D')],
    run: rows => ({ value: adLine(rows) }),
  }),
  define({
    id: 'chaikin-oscillator', name: 'Chaikin Oscillator', shortName: 'ChaikinOsc', category: 'volume', overlay: false,
    inputs: [int('fast', 'Fast', 3), int('slow', 'Slow', 10)], outputs: [line('value', 'Chaikin Osc')], guides: [0],
    run: (rows, v) => ({ value: chaikinOscillator(rows, { fast: v.fast, slow: v.slow }) }),
  }),
  define({
    id: 'force-index', name: 'Force Index', shortName: 'FI', category: 'volume', overlay: false,
    inputs: [period(13)], outputs: [line('value', 'Force Index')], guides: [0],
    run: (rows, v) => ({ value: forceIndex(rows, v.period) }),
  }),
  define({
    id: 'ease-of-movement', name: 'Ease of Movement', shortName: 'EOM', category: 'volume', overlay: false,
    inputs: [period(14)], outputs: [line('value', 'EOM')], guides: [0],
    run: (rows, v) => ({ value: easeOfMovement(rows, v.period) }),
  }),
  define({
    id: 'volume-roc', name: 'Volume Rate of Change', shortName: 'VROC', category: 'volume', overlay: false,
    inputs: [period(14)], outputs: [line('value', 'VROC')], guides: [0],
    run: (rows, v) => ({ value: volumeRoc(rows, v.period) }),
  }),
  define({
    id: 'klinger', name: 'Klinger Volume Oscillator', shortName: 'KVO', category: 'volume', overlay: false,
    inputs: [int('fast', 'Fast', 34), int('slow', 'Slow', 55), int('signal', 'Signal', 13)],
    outputs: [line('kvo', 'KVO'), line('signal', 'Signal', 1)], guides: [0],
    run: (rows, v) => klinger(rows, { fast: v.fast, slow: v.slow, signal: v.signal }),
  }),
  define({
    id: 'relative-volume', name: 'Relative Volume', shortName: 'RVOL', category: 'volume', overlay: false,
    inputs: [period(10), select('mode', 'Mode', 'cumulative', ['cumulative', 'regular']), select('zone', 'Day in zone', 'UTC', ZONES)],
    outputs: [line('value', 'RVOL')], guides: [1],
    run: (rows, v) => ({ value: relativeVolume(rows, { period: v.period, mode: v.mode, zone: v.zone }) }),
  }),
  define({
    id: 'pvt', name: 'Price Volume Trend', shortName: 'PVT', category: 'volume', overlay: false,
    inputs: [], outputs: [line('value', 'PVT')],
    run: rows => ({ value: priceVolumeTrend(rows) }),
  }),
  define({
    id: 'nvi', name: 'Negative Volume Index', shortName: 'NVI', category: 'volume', overlay: false,
    inputs: [flt('start', 'Start value', 1000, 1, 1000000, 1)], outputs: [line('value', 'NVI')],
    run: (rows, v) => ({ value: negativeVolumeIndex(rows, v.start) }),
  }),
  define({
    id: 'pvi', name: 'Positive Volume Index', shortName: 'PVI', category: 'volume', overlay: false,
    inputs: [flt('start', 'Start value', 1000, 1, 1000000, 1)], outputs: [line('value', 'PVI')],
    run: (rows, v) => ({ value: positiveVolumeIndex(rows, v.start) }),
  }),
  define({
    id: 'net-volume', name: 'Net Volume', shortName: 'Net Vol', category: 'volume', overlay: false,
    inputs: [], outputs: [hist('value', 'Net volume')], guides: [0],
    run: rows => ({ value: netVolume(rows) }),
  }),
  define({
    id: 'volume-ma', name: 'Volume with Moving Average', shortName: 'Vol MA', category: 'volume', overlay: false,
    inputs: [period(20)], outputs: [hist('volume', 'Volume', 'muted'), line('ma', 'Average')],
    run: (rows, v) => volumeMa(rows, v.period),
  }),
];
