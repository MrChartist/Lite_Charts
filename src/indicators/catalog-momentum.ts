// Catalog entries: momentum oscillators, each in a pane of its own.
import { define, flt, int, period, source, line, hist, dots } from './catalog-kit';
import type { IndicatorSpec } from './catalog-kit';
import { rsi } from './rsi';
import { macd } from './macd';
import { stochastic } from './stochastic';
import { cci } from './cci';
import { williamsR } from './williams-r';
import { roc } from './roc';
import { momentum } from './momentum';
import { stochRsi } from './stoch-rsi';
import { tsi } from './tsi';
import { trix } from './trix';
import { ppo } from './ppo';
import { cmo } from './cmo';
import { dpo } from './dpo';
import { awesomeOscillator } from './awesome-oscillator';
import { kst } from './kst';
import { coppock } from './coppock';
import { connorsRsi } from './connors-rsi';
import { fisher } from './fisher';
import { ultimateOscillator } from './ultimate-oscillator';
import { rvi } from './rvi';
import { smi } from './smi';
import { elderRay } from './elder-ray';
import { aroon } from './aroon';
import { aroonOscillator } from './aroon-oscillator';
import { vortex } from './vortex';
import { adx } from './adx';
import { kdj } from './kdj';
import { elliottWaveOscillator } from './elliott-wave-oscillator';
import { balanceOfPower } from './balance-of-power';
import { squeeze } from './squeeze';

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
  define({
    id: 'stoch-rsi', name: 'Stochastic RSI', shortName: 'StochRSI', category: 'momentum', overlay: false,
    inputs: [int('rsiPeriod', 'RSI period', 14), int('stochPeriod', 'Stochastic period', 14), int('kSmooth', '%K smoothing', 3), int('dSmooth', '%D smoothing', 3), source()],
    outputs: [line('k', '%K'), line('d', '%D', 1)], guides: [20, 80],
    run: (rows, v) => stochRsi(rows, { rsiPeriod: v.rsiPeriod, stochPeriod: v.stochPeriod, kSmooth: v.kSmooth, dSmooth: v.dSmooth, source: v.source }),
  }),
  define({
    id: 'kdj', name: 'KDJ', shortName: 'KDJ', category: 'momentum', overlay: false,
    inputs: [int('period', 'Period', 14), int('kSmooth', 'K smoothing', 3), int('dSmooth', 'D smoothing', 3)],
    outputs: [line('k', 'K'), line('d', 'D', 1), line('j', 'J', 2)], guides: [20, 80],
    run: (rows, v) => kdj(rows, { period: v.period, kSmooth: v.kSmooth, dSmooth: v.dSmooth }),
  }),
  define({
    id: 'cci', name: 'Commodity Channel Index', shortName: 'CCI', category: 'momentum', overlay: false,
    inputs: [period(14)], outputs: [line('value', 'CCI')], guides: [-100, 100],
    run: (rows, v) => ({ value: cci(rows, v.period) }),
  }),
  define({
    id: 'williams-r', name: 'Williams %R', shortName: '%R', category: 'momentum', overlay: false,
    inputs: [period(14)], outputs: [line('value', '%R')], guides: [-80, -20],
    run: (rows, v) => ({ value: williamsR(rows, v.period) }),
  }),
  define({
    id: 'roc', name: 'Rate of Change', shortName: 'ROC', category: 'momentum', overlay: false,
    inputs: [period(14), source()], outputs: [line('value', 'ROC')], guides: [0],
    run: (rows, v) => ({ value: roc(rows, v.period, { source: v.source }) }),
  }),
  define({
    id: 'momentum', name: 'Momentum', shortName: 'Mom', category: 'momentum', overlay: false,
    inputs: [period(10), source()], outputs: [line('value', 'Momentum')], guides: [0],
    run: (rows, v) => ({ value: momentum(rows, v.period, { source: v.source }) }),
  }),
  define({
    id: 'cmo', name: 'Chande Momentum Oscillator', shortName: 'CMO', category: 'momentum', overlay: false,
    inputs: [period(14), source()], outputs: [line('value', 'CMO')], guides: [-50, 50],
    run: (rows, v) => ({ value: cmo(rows, v.period, { source: v.source }) }),
  }),
  define({
    id: 'tsi', name: 'True Strength Index', shortName: 'TSI', category: 'momentum', overlay: false,
    inputs: [int('long', 'Long', 25), int('short', 'Short', 13), int('signal', 'Signal', 13), source()],
    outputs: [line('tsi', 'TSI'), line('signal', 'Signal', 1)], guides: [0],
    run: (rows, v) => tsi(rows, { long: v.long, short: v.short, signal: v.signal, source: v.source }),
  }),
  define({
    id: 'trix', name: 'TRIX', shortName: 'TRIX', category: 'momentum', overlay: false,
    inputs: [period(18), source()], outputs: [line('value', 'TRIX')], guides: [0],
    run: (rows, v) => ({ value: trix(rows, v.period, { source: v.source }) }),
  }),
  define({
    id: 'ppo', name: 'Percentage Price Oscillator', shortName: 'PPO', category: 'momentum', overlay: false,
    inputs: [int('fast', 'Fast', 12), int('slow', 'Slow', 26), int('signal', 'Signal', 9), source()],
    outputs: [hist('histogram', 'Histogram'), line('ppo', 'PPO'), line('signal', 'Signal', 1)], guides: [0],
    run: (rows, v) => ppo(rows, { fast: v.fast, slow: v.slow, signal: v.signal, source: v.source }),
  }),
  define({
    id: 'dpo', name: 'Detrended Price Oscillator', shortName: 'DPO', category: 'momentum', overlay: false,
    inputs: [period(20), source()], outputs: [line('value', 'DPO')], guides: [0],
    run: (rows, v) => ({ value: dpo(rows, v.period, { source: v.source }) }),
  }),
  define({
    id: 'awesome-oscillator', name: 'Awesome Oscillator', shortName: 'AO', category: 'momentum', overlay: false,
    inputs: [int('fast', 'Fast', 5), int('slow', 'Slow', 34)], outputs: [hist('value', 'AO')], guides: [0],
    run: (rows, v) => ({ value: awesomeOscillator(rows, { fast: v.fast, slow: v.slow }) }),
  }),
  define({
    id: 'kst', name: 'Know Sure Thing', shortName: 'KST', category: 'momentum', overlay: false,
    inputs: [source()], outputs: [line('kst', 'KST'), line('signal', 'Signal', 1)], guides: [0],
    run: (rows, v) => kst(rows, { source: v.source }),
  }),
  define({
    id: 'coppock', name: 'Coppock Curve', shortName: 'Coppock', category: 'momentum', overlay: false,
    inputs: [int('rocLong', 'Long ROC', 14), int('rocShort', 'Short ROC', 11), int('wma', 'WMA', 10), source()],
    outputs: [line('value', 'Coppock')], guides: [0],
    run: (rows, v) => ({ value: coppock(rows, { rocLong: v.rocLong, rocShort: v.rocShort, wma: v.wma, source: v.source }) }),
  }),
  define({
    id: 'connors-rsi', name: 'Connors RSI', shortName: 'CRSI', category: 'momentum', overlay: false,
    inputs: [int('rsiPeriod', 'RSI period', 3), int('streakPeriod', 'Streak period', 2), int('rankPeriod', 'Rank period', 100), source()],
    outputs: [line('value', 'CRSI')], guides: [10, 90],
    run: (rows, v) => ({ value: connorsRsi(rows, { rsiPeriod: v.rsiPeriod, streakPeriod: v.streakPeriod, rankPeriod: v.rankPeriod, source: v.source }) }),
  }),
  define({
    id: 'fisher', name: 'Fisher Transform', shortName: 'Fisher', category: 'momentum', overlay: false,
    inputs: [period(9)], outputs: [line('fisher', 'Fisher'), line('trigger', 'Trigger', 1)], guides: [0],
    run: (rows, v) => fisher(rows, v.period),
  }),
  define({
    id: 'ultimate-oscillator', name: 'Ultimate Oscillator', shortName: 'UO', category: 'momentum', overlay: false,
    inputs: [int('p1', 'Short', 7), int('p2', 'Middle', 14), int('p3', 'Long', 28)], outputs: [line('value', 'UO')], guides: [30, 70],
    run: (rows, v) => ({ value: ultimateOscillator(rows, { p1: v.p1, p2: v.p2, p3: v.p3 }) }),
  }),
  define({
    id: 'rvi', name: 'Relative Vigor Index', shortName: 'RVI', category: 'momentum', overlay: false,
    inputs: [period(10)], outputs: [line('rvi', 'RVI'), line('signal', 'Signal', 1)], guides: [0],
    run: (rows, v) => rvi(rows, v.period),
  }),
  define({
    id: 'smi', name: 'Stochastic Momentum Index', shortName: 'SMI', category: 'momentum', overlay: false,
    inputs: [int('kPeriod', '%K period', 10), int('dPeriod', '%D period', 3), int('emaPeriod', 'Signal', 3)],
    outputs: [line('smi', 'SMI'), line('signal', 'Signal', 1)], guides: [-40, 40],
    run: (rows, v) => smi(rows, { kPeriod: v.kPeriod, dPeriod: v.dPeriod, emaPeriod: v.emaPeriod }),
  }),
  define({
    id: 'elder-ray', name: 'Elder Ray', shortName: 'Elder', category: 'momentum', overlay: false,
    inputs: [period(13)], outputs: [hist('bull', 'Bull power', 'up'), hist('bear', 'Bear power', 'down')], guides: [0],
    run: (rows, v) => elderRay(rows, v.period),
  }),
  define({
    id: 'aroon', name: 'Aroon', shortName: 'Aroon', category: 'momentum', overlay: false,
    inputs: [period(25)], outputs: [line('up', 'Up', 'up'), line('down', 'Down', 'down')], guides: [30, 70],
    run: (rows, v) => aroon(rows, v.period),
  }),
  define({
    id: 'aroon-oscillator', name: 'Aroon Oscillator', shortName: 'Aroon Osc', category: 'momentum', overlay: false,
    inputs: [period(14)], outputs: [line('value', 'Aroon Osc')], guides: [0],
    run: (rows, v) => ({ value: aroonOscillator(rows, v.period) }),
  }),
  define({
    id: 'vortex', name: 'Vortex Indicator', shortName: 'VI', category: 'momentum', overlay: false,
    inputs: [period(14)], outputs: [line('plus', 'VI+', 'up'), line('minus', 'VI-', 'down')], guides: [1],
    run: (rows, v) => vortex(rows, v.period),
  }),
  define({
    id: 'adx', name: 'Average Directional Index', shortName: 'ADX', category: 'momentum', overlay: false,
    inputs: [period(14)], outputs: [line('adx', 'ADX'), line('plusDI', '+DI', 'up'), line('minusDI', '-DI', 'down')], guides: [25],
    run: (rows, v) => adx(rows, v.period),
  }),
  define({
    id: 'elliott-wave-oscillator', name: 'Elliott Wave Oscillator', shortName: 'EWO', category: 'momentum', overlay: false,
    inputs: [int('fast', 'Fast', 5), int('slow', 'Slow', 34), source()], outputs: [hist('value', 'EWO')], guides: [0],
    run: (rows, v) => ({ value: elliottWaveOscillator(rows, { fast: v.fast, slow: v.slow, source: v.source }) }),
  }),
  define({
    id: 'balance-of-power', name: 'Balance of Power', shortName: 'BoP', category: 'momentum', overlay: false,
    inputs: [int('smooth', 'Smoothing', 14)], outputs: [line('value', 'BoP')], guides: [0],
    run: (rows, v) => ({ value: balanceOfPower(rows, v.smooth) }),
  }),
  define({
    id: 'squeeze', name: 'Squeeze Momentum', shortName: 'Squeeze', category: 'momentum', overlay: false,
    inputs: [int('bbPeriod', 'Bollinger period', 20), flt('bbMult', 'Bollinger deviations', 2, 0.1, 10), int('kcPeriod', 'Keltner period', 20), flt('kcMult', 'Keltner multiplier', 1.5, 0.1, 10)],
    outputs: [hist('momentum', 'Momentum'), dots('on', 'Squeeze on', 'down'), dots('off', 'Squeeze off', 'up')], guides: [0],
    run: (rows, v) => squeeze(rows, { bbPeriod: v.bbPeriod, bbMult: v.bbMult, kcPeriod: v.kcPeriod, kcMult: v.kcMult }),
  }),
];
