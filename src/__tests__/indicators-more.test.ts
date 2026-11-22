import { describe, expect, it } from 'vitest';
import * as I from '../indicators/index';
import type { IndicatorPoint, IndicatorRow } from '../indicators/index';

const t = (i: number): number => 1_700_000_000 + i * 86_400;
const closes = (cs: number[]): IndicatorRow[] => cs.map((c, i) => ({ time: t(i), close: c }));
const bars = (hlc: [number, number, number][], volume?: number[]): IndicatorRow[] =>
  hlc.map(([high, low, close], i) => ({ time: t(i), open: close, high, low, close, volume: volume ? volume[i] : undefined }));
const vals = (pts: IndicatorPoint[]): (number | null)[] => pts.map(p => (p.value === undefined ? null : p.value));
const near = (a: (number | null)[], b: (number | null)[], eps = 1e-9): void => {
  expect(a.length).toBe(b.length);
  a.forEach((v, i) => (v === null || b[i] === null ? expect(v).toBe(b[i]) : expect(Math.abs(v - (b[i] as number))).toBeLessThanOrEqual(eps)));
};
const first = (pts: IndicatorPoint[]): number => pts.findIndex(p => p.value !== undefined);

/** Deterministic candles: seeded walk with volume, one bar per day. */
function series(n: number, seed = 7, stepSeconds = 86_400, start = 1_700_000_000): IndicatorRow[] {
  let s = seed >>> 0;
  const rand = (): number => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const out: IndicatorRow[] = [];
  let close = 100;
  for (let i = 0; i < n; i++) {
    const open = close;
    close = Math.max(1, open * (1 + (rand() - 0.49) * 0.03));
    const high = Math.max(open, close) * (1 + rand() * 0.01);
    const low = Math.min(open, close) * (1 - rand() * 0.01);
    out.push({ time: start + i * stepSeconds, open, high, low, close, volume: Math.floor(1000 + rand() * 5000) });
  }
  return out;
}

describe('hand-checked vectors', () => {
  it('momentum and rate of change', () => {
    expect(vals(I.momentum(closes([1, 3, 6, 10]), 2))).toEqual([null, null, 5, 7]);
    near(vals(I.roc(closes([100, 110, 121]), 1)), [null, 10, 10]);
    expect(vals(I.roc(closes([0, 5, 6]), 1))).toEqual([null, null, 20]);
  });
  it('williams %R', () => {
    const b = bars([[10, 8, 9], [12, 9, 11], [11, 7, 10]]);
    near(vals(I.williamsR(b, 2)), [null, -25, -40]);
    expect(vals(I.williamsR(bars([[5, 5, 5], [5, 5, 5]]), 2))).toEqual([null, -50]);
  });
  it('cmo', () => {
    near(vals(I.cmo(closes([1, 2, 3, 2]), 2)), [null, null, 100, 0]);
  });
  it('aroon and the oscillator', () => {
    const b = bars([[5, 4, 4.5], [6, 5, 5.5], [7, 6, 6.5], [6, 5, 5.5]]);
    const a = I.aroon(b, 2);
    expect(vals(a.up)).toEqual([null, null, 100, 50]);
    expect(vals(a.down)).toEqual([null, null, 0, 100]);
    expect(vals(I.aroonOscillator(b, 2))).toEqual([null, null, 100, -50]);
  });
  it('mfi', () => {
    const b = bars([[1, 1, 1], [2, 2, 2], [1, 1, 1], [3, 3, 3]], [10, 10, 10, 10]);
    expect(vals(I.mfi(b, 1))).toEqual([null, 100, 0, 100]);
    expect(vals(I.mfi(bars([[2, 2, 2], [2, 2, 2], [2, 2, 2]], [5, 5, 5]), 2))).toEqual([null, null, 50]);
  });
  it('cci of a flat window is 0 and of a ramp is bounded', () => {
    expect(vals(I.cci(bars([[5, 5, 5], [5, 5, 5], [5, 5, 5]]), 3))).toEqual([null, null, 0]);
    // tp 1, 2, 3 over 3 bars: mean 2, mean deviation 2/3, cci = (3 - 2) / (0.015 * 2/3) = 100
    near(vals(I.cci(bars([[1, 1, 1], [2, 2, 2], [3, 3, 3]]), 3)), [null, null, 100], 1e-9);
  });
  it('chaikin money flow and the accumulation / distribution line', () => {
    // close at the high: money flow multiplier +1; at the low: -1; mid: 0
    const b = bars([[10, 0, 10], [10, 0, 0], [10, 0, 5]], [100, 50, 70]);
    expect(vals(I.adLine(b))).toEqual([100, 50, 50]);
    near(vals(I.cmf(b, 2)), [null, 50 / 150, -50 / 120]);
  });
  it('force index, net volume, price volume trend, nvi / pvi', () => {
    const b = closes([10, 11, 11, 10]).map((r, i) => ({ ...r, volume: [5, 5, 3, 4][i] }));
    near(vals(I.forceIndex(b, 1)), [null, 5, 0, -4]);
    expect(vals(I.netVolume(b))).toEqual([null, 5, 0, -4]);
    near(vals(I.priceVolumeTrend(b)), [null, 0.1 * 5, 0.5, 0.5 - (1 / 11) * 4]);
    expect(vals(I.negativeVolumeIndex(b, 100))).toEqual([100, 100, 100, 100]);
    expect(vals(I.positiveVolumeIndex(b, 100))[3]).toBeCloseTo(100 - 100 / 11, 12); // volume rose on the last bar (4 > 3): -1/11 of the index
    expect(vals(I.positiveVolumeIndex(b, 100)).slice(0, 3)).toEqual([100, 100, 100]);
  });
  it('percent b and bollinger bandwidth on a symmetric window', () => {
    // 1 2 3: mean 2, population sd sqrt(2/3); %B of the last = (3 - (2 - 2sd)) / (4 sd)
    const sd = Math.sqrt(2 / 3);
    near(vals(I.percentB(closes([1, 2, 3]), { period: 3 })), [null, null, (3 - (2 - 2 * sd)) / (4 * sd)]);
    near(vals(I.bollingerBandwidth(closes([1, 2, 3]), { period: 3 })), [null, null, ((4 * sd) / 2) * 100]);
    expect(vals(I.percentB(closes([4, 4, 4]), { period: 3 }))).toEqual([null, null, null]);
  });
  it('standard deviation and average daily range', () => {
    near(vals(I.standardDeviation(closes([1, 2, 3]), 3)), [null, null, Math.sqrt(2 / 3)]);
    near(vals(I.adr(bars([[3, 1, 2], [5, 2, 4]]), 2)), [null, 2.5]);
    near(vals(I.adrPercent(bars([[3, 1, 2], [5, 2, 4]]), 2)), [null, 100 * ((3 + 2.5) / 2 - 1)]);
  });
  it('wilder average, hull and the exponential family on constants and small inputs', () => {
    near(vals(I.rma(closes([1, 2, 3, 4]), 2)), [null, 1.5, 2.25, 3.125]);
    for (const f of [I.hma, I.dema, I.tema, I.rma, I.vwma, I.lsma]) {
      const flat = closes([5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5]).map(r => ({ ...r, volume: 1 }));
      const v = vals((f as (r: IndicatorRow[], p: number) => IndicatorPoint[])(flat, 3)).filter(x => x !== null);
      expect(v.length).toBeGreaterThan(0);
      v.forEach(x => expect(x).toBeCloseTo(5, 12));
    }
    // vwma weights by volume: (1*1 + 3*3) / 4
    expect(vals(I.vwma(closes([1, 3]).map((r, i) => ({ ...r, volume: [1, 3][i] })), 2))).toEqual([null, 2.5]);
    // lsma of a straight line continues the line; offset 1 reads one bar back
    near(vals(I.lsma(closes([1, 2, 3, 4, 5]), 3)), [null, null, 3, 4, 5]);
    near(vals(I.lsma(closes([1, 2, 3, 4, 5]), 3, { offset: 1 })), [null, null, 2, 3, 4]);
  });
  it('mcginley, kama and alma stay on a flat series', () => {
    const flat = closes(new Array(30).fill(7));
    for (const out of [I.mcginley(flat), I.kama(flat), I.alma(flat)]) {
      const v = vals(out).filter(x => x !== null);
      expect(v.length).toBeGreaterThan(0);
      v.forEach(x => expect(x).toBeCloseTo(7, 12));
    }
  });
  it('ichimoku: displacement forward for the cloud and back for the lagging close', () => {
    const rows = series(120);
    const k = I.ichimoku(rows, { tenkan: 3, kijun: 5, senkouB: 8 });
    // d = kijun - 1 = 4; senkouA at bar i is (tenkan + kijun)/2 computed on bar i - 4
    const ten = vals(k.tenkan), kij = vals(k.kijun), sa = vals(k.senkouA);
    for (let i = 20; i < 40; i++) expect(sa[i]).toBeCloseTo(((ten[i - 4] as number) + (kij[i - 4] as number)) / 2, 12);
    // chikou on bar i is the close 4 bars later; none on the last 4
    expect(vals(k.chikou)[10]).toBe(rows[14].close);
    expect(vals(k.chikou).slice(-4)).toEqual([null, null, null, null]);
    expect(I.ichimokuFuture(rows, { tenkan: 3, kijun: 5, senkouB: 8 }).length).toBe(4);
  });
  it('parabolic sar: the first dot is on bar 1 and an up trend keeps dots below the lows', () => {
    const up = bars(Array.from({ length: 12 }, (_, i) => [10 + i * 2 + 1, 10 + i * 2 - 1, 10 + i * 2] as [number, number, number]));
    const s = I.parabolicSar(up);
    expect(first(s.line)).toBe(1);
    expect(s.direction.slice(1).every(d => d === 1)).toBe(true);
    s.up.forEach((p, i) => { if (p.value !== undefined) expect(p.value).toBeLessThan(up[i].low as number); });
    expect(s.down.every(p => p.value === undefined)).toBe(true);
  });
  it('linear regression channel on a line has zero width', () => {
    const c = I.linRegChannel(closes([1, 2, 3, 4, 5, 6]), { period: 4, deviations: 2 });
    near(vals(c.middle), [null, null, null, 4, 5, 6], 1e-12);
    near(vals(c.upper), vals(c.middle), 1e-12);
  });
  it('envelope', () => {
    const e = I.envelope(closes([10, 10, 10]), { period: 2, percent: 10 });
    near(vals(e.upper), [null, 11, 11]);
    near(vals(e.lower), [null, 9, 9]);
  });
  it('keltner: ema +/- mult * atr', () => {
    const b = bars([[11, 9, 10], [12, 10, 11], [13, 11, 12], [14, 12, 13]]);
    const k = I.keltner(b, { period: 2, mult: 2, atrPeriod: 2 });
    // ema(2) of 10,11,12,13: 10.5, 11.5, 12.5; atr(2): tr 2, 2, 2, 2 -> 2
    near(vals(k.middle), [null, 10.5, 11.5, 12.5]);
    near(vals(k.upper), [null, 14.5, 15.5, 16.5]);
    near(vals(k.lower), [null, 6.5, 7.5, 8.5]);
  });
  it('previous-period levels: pivot points, cpr and previous high / low', () => {
    const d = 86_400;
    const day = (n: number, hlc: [number, number, number][]): IndicatorRow[] => hlc.map(([high, low, close], i) => ({ time: n * d + i * 3600, open: close, high, low, close, volume: 10 }));
    const rows = [...day(0, [[12, 9, 11], [11, 8, 10]]), ...day(1, [[20, 1, 5], [20, 1, 5]])];
    const p = I.pivotPoints(rows, { period: 'day' });
    // previous day: H 12, L 8, C 10 -> PP 10, R1 12, S1 8, R2 14, S2 6, R3 16, S3 4
    expect(vals(p.pp)).toEqual([null, null, 10, 10]);
    expect(vals(p.r1)[2]).toBe(12); expect(vals(p.s1)[2]).toBe(8);
    expect(vals(p.r2)[3]).toBe(14); expect(vals(p.s2)[3]).toBe(6);
    expect(vals(p.r3)[2]).toBe(16); expect(vals(p.s3)[2]).toBe(4);
    expect(vals(p.r4)).toEqual([null, null, null, null]);
    expect(vals(I.pivotPoints(rows, { period: 'day', kind: 'woodie' }).r4)[2]).not.toBeNull();
    const rows2 = [...day(0, [[12, 6, 12]]), ...day(1, [[1, 1, 1]])];
    const c = I.cpr(rows2, { period: 'day' });
    expect(vals(c.top)).toEqual([null, 11]); expect(vals(c.pivot)).toEqual([null, 10]); expect(vals(c.bottom)).toEqual([null, 9]);
    const h = I.previousHighLow(rows, { period: 'day' });
    expect(vals(h.high)).toEqual([null, null, 12, 12]); expect(vals(h.low)[3]).toBe(8); expect(vals(h.close)[2]).toBe(10);
  });
  it('anchored vwap and vwap bands', () => {
    const rows: IndicatorRow[] = [10, 20, 30].map((p, i) => ({ time: t(i), open: p, high: p, low: p, close: p, volume: [1, 1, 3][i] }));
    const a = I.anchoredVwap(rows, { from: t(1) });
    expect(vals(a.vwap)).toEqual([null, 20, 27.5]);
    // volume-weighted deviation of 20 (weight 1) and 30 (weight 3): mean 27.5, variance (400 + 3 * 900) / 4 - 27.5^2 = 18.75
    const sd = Math.sqrt(18.75);
    near(vals(a.upper1), [null, 20, 27.5 + sd]);
    near(vals(a.lower2), [null, 20, 27.5 - 2 * sd]);
    expect(I.anchoredVwap(rows, { from: t(99) }).vwap.every(p => p.value === undefined)).toBe(true);
    expect(I.anchoredVwap(rows).vwap.every(p => p.value === undefined)).toBe(true);
    const b = I.vwapBands(rows, { anchor: 'none' });
    near(vals(b.vwap), [10, 15, 24]);
    const c = I.vwapBands(rows, { anchor: 'day' });
    expect(vals(c.vwap)).toEqual([10, 20, 30]);
    expect(vals(c.upper3)).toEqual([10, 20, 30]);
  });
  it('52-week high / low needs the history', () => {
    const rows = series(400);
    const w = I.weeksHighLow(rows, { weeks: 52 });
    expect(first(w.high)).toBe(363);
    const hi = Math.max(...rows.slice(0, 364).map(r => r.high as number));
    expect(vals(w.high)[363]).toBe(hi);
    expect(first(I.weeksHighLow(rows, { weeks: 1 }).high)).toBe(6);
  });
  it('swing highs and lows, zigzag', () => {
    const b = bars([[1, 0, 0.5], [2, 1, 1.5], [5, 2, 3], [3, 1, 2], [2, 0, 1], [3, 1, 2], [4, 2, 3]]);
    const p = I.pivotHighLow(b, { left: 2, right: 2 });
    expect(vals(p.high)).toEqual([null, null, 5, null, null, null, null]);
    expect(vals(p.low)).toEqual([null, null, null, null, 0, null, null]);
    const wave = Array.from({ length: 60 }, (_, i) => 100 + 20 * Math.sin(i / 4));
    const z = I.zigzag(closes(wave).map((r, i) => ({ ...r, high: wave[i] + 1, low: wave[i] - 1 })), { deviation: 10, legs: 3 });
    expect(z.filter(x => x.value !== undefined).length).toBeGreaterThan(30);
  });
  it('squeeze flags a quiet stretch, then a release', () => {
    const quiet = Array.from({ length: 50 }, (_, i) => ({ time: t(i), open: 100, high: 100.2, low: 99.8, close: 100 + (i % 2 ? 0.05 : -0.05), volume: 1 }));
    const loud = Array.from({ length: 30 }, (_, i) => ({ time: t(50 + i), open: 100, high: 100 + 5 * (i + 1), low: 100 - 5 * (i + 1), close: 100 + (i % 2 ? 5 : -5) * (i + 1), volume: 1 }));
    const s = I.squeeze([...quiet, ...loud]);
    expect(vals(s.on).slice(25, 50).every(v => v === 0)).toBe(true);
    expect(vals(s.off).some(v => v === 0)).toBe(true);
  });
  it('relative volume on daily bars divides by the mean of the previous bars', () => {
    const rows = closes([1, 1, 1, 1, 1, 1]).map((r, i) => ({ ...r, volume: [10, 10, 10, 30, 10, 0][i] }));
    expect(vals(I.relativeVolume(rows, { period: 3 }))).toEqual([null, null, null, 3, 0.6, 0]);
  });
  it('volume with a moving average', () => {
    const rows = closes([1, 1, 1, 1]).map((r, i) => ({ ...r, volume: [1, 2, 3, 4][i] }));
    const v = I.volumeMa(rows, 2);
    expect(vals(v.volume)).toEqual([1, 2, 3, 4]);
    expect(vals(v.ma)).toEqual([null, 1.5, 2.5, 3.5]);
  });
  it('adx on a one-way trend reads a strong +DI', () => {
    const up = bars(Array.from({ length: 60 }, (_, i) => [10 + i + 1, 10 + i - 1, 10 + i] as [number, number, number]));
    const a = I.adx(up, 5);
    const v = vals(a.adx)[59] as number, p = vals(a.plusDI)[59] as number, m = vals(a.minusDI)[59] as number;
    expect(p).toBeGreaterThan(m);
    expect(m).toBe(0);
    expect(v).toBeCloseTo(100, 6);
  });
  it('bollinger bandwidth, fisher and elder ray bounds', () => {
    const rows = series(200);
    for (const x of vals(I.elderRay(rows).bull)) if (x !== null) expect(Number.isFinite(x)).toBe(true);
    for (const x of vals(I.fisher(rows).fisher)) if (x !== null) expect(Math.abs(x)).toBeLessThan(10);
    for (const x of vals(I.connorsRsi(rows, { rankPeriod: 20 }))) if (x !== null) expect(x >= 0 && x <= 100).toBe(true);
    for (const x of vals(I.ultimateOscillator(rows))) if (x !== null) expect(x >= 0 && x <= 100).toBe(true);
    for (const x of vals(I.williamsR(rows))) if (x !== null) expect(x >= -100 && x <= 0).toBe(true);
    for (const x of vals(I.stochRsi(rows).k)) if (x !== null) expect(x >= -1e-9 && x <= 100 + 1e-9).toBe(true);
  });
});

describe('warm-up: the first bar with a value, as the header of each file states', () => {
  const R = series(260);
  const cases: [string, IndicatorPoint[], number][] = [
    ['hma 14', I.hma(R, 14), 16],
    ['dema 20', I.dema(R, 20), 38],
    ['tema 20', I.tema(R, 20), 57],
    ['rma 7', I.rma(R, 7), 6],
    ['vwma 20', I.vwma(R, 20), 19],
    ['lsma 25', I.lsma(R, 25), 24],
    ['alma 9', I.alma(R), 8],
    ['kama 10', I.kama(R), 10],
    ['mcginley 14', I.mcginley(R), 13],
    ['envelope sma 20', I.envelope(R).middle, 19],
    ['keltner', I.keltner(R).upper, 19],
    ['ichimoku tenkan', I.ichimoku(R).tenkan, 8],
    ['ichimoku kijun', I.ichimoku(R).kijun, 25],
    ['ichimoku senkouA', I.ichimoku(R).senkouA, 50],
    ['ichimoku senkouB', I.ichimoku(R).senkouB, 76],
    ['parabolic sar', I.parabolicSar(R).line, 1],
    ['linreg 100', I.linRegChannel(R).middle, 99],
    ['cci 14', I.cci(R), 13],
    ['williams 14', I.williamsR(R), 13],
    ['roc 14', I.roc(R), 14],
    ['momentum 10', I.momentum(R), 10],
    ['cmo 14', I.cmo(R), 14],
    ['dpo 20', I.dpo(R), 30],
    ['trix 18', I.trix(R), 52],
    ['tsi', I.tsi(R).tsi, 37],
    ['tsi signal', I.tsi(R).signal, 49],
    ['ppo', I.ppo(R).ppo, 25],
    ['ppo signal', I.ppo(R).signal, 33],
    ['stochRsi raw/k', I.stochRsi(R).k, 29],
    ['stochRsi d', I.stochRsi(R).d, 31],
    ['awesome', I.awesomeOscillator(R), 33],
    ['kst', I.kst(R).kst, 44],
    ['kst signal', I.kst(R).signal, 52],
    ['coppock', I.coppock(R), 23],
    ['connors', I.connorsRsi(R), 101],
    ['fisher', I.fisher(R).fisher, 8],
    ['fisher trigger', I.fisher(R).trigger, 9],
    ['ultimate', I.ultimateOscillator(R), 28],
    ['rvi', I.rvi(R).rvi, 12],
    ['rvi signal', I.rvi(R).signal, 15],
    ['smi', I.smi(R).smi, 13],
    ['smi signal', I.smi(R).signal, 15],
    ['elder 13', I.elderRay(R).bull, 12],
    ['aroon 25', I.aroon(R).up, 25],
    ['aroon osc 14', I.aroonOscillator(R), 14],
    ['vortex 14', I.vortex(R).plus, 14],
    ['adx di', I.adx(R).plusDI, 14],
    ['adx', I.adx(R).adx, 27],
    ['kdj k', I.kdj(R).k, 15],
    ['kdj d', I.kdj(R).d, 17],
    ['ewo', I.elliottWaveOscillator(R), 33],
    ['bop 14', I.balanceOfPower(R), 13],
    ['squeeze momentum', I.squeeze(R).momentum, 38],
    ['bbw', I.bollingerBandwidth(R), 19],
    ['percentB', I.percentB(R), 19],
    ['stddev', I.standardDeviation(R), 19],
    ['chop 14', I.choppiness(R), 13],
    ['mass index', I.massIndex(R), 40],
    ['historical vol 10', I.historicalVolatility(R), 10],
    ['ulcer 14', I.ulcerIndex(R), 26],
    ['adr 14', I.adr(R), 13],
    ['adr% 14', I.adrPercent(R), 13],
    ['mfi 14', I.mfi(R), 14],
    ['cmf 20', I.cmf(R), 19],
    ['ad line', I.adLine(R), 0],
    ['chaikin osc', I.chaikinOscillator(R), 9],
    ['force 13', I.forceIndex(R), 13],
    ['eom 14', I.easeOfMovement(R), 14],
    ['vroc 14', I.volumeRoc(R), 14],
    ['klinger', I.klinger(R).kvo, 55],
    ['klinger signal', I.klinger(R).signal, 67],
    ['volume ma 20', I.volumeMa(R).ma, 19],
    ['rvol 10', I.relativeVolume(R), 10],
    ['pvt', I.priceVolumeTrend(R), 1],
    ['nvi', I.negativeVolumeIndex(R), 0],
    ['net volume', I.netVolume(R), 1],
  ];
  it.each(cases)('%s', (_name, pts, expected) => {
    expect(pts.length).toBe(R.length);
    expect(first(pts)).toBe(expected);
  });
});

describe('input hygiene of the added studies', () => {
  it('a bad bar is `{ time }` and the next bars carry on', () => {
    const rows = series(80);
    const bad = rows.map((r, i) => (i === 40 ? { ...r, close: NaN } : r));
    for (const f of [I.hma, I.dema, I.roc, I.cmo, I.dpo, I.momentum] as ((r: IndicatorRow[], p: number) => IndicatorPoint[])[]) {
      const out = f(bad, 5);
      expect(out[40].value, f.name).toBeUndefined();
      expect(out[41].value !== undefined || f === I.momentum || f === I.roc).toBe(true);
    }
  });
  it('windows are made integers of at least 1 and never throw', () => {
    const rows = series(30);
    expect(() => I.hma(rows, 0)).not.toThrow();
    expect(() => I.cci(rows, -3)).not.toThrow();
    expect(() => I.adx(rows, 1e9)).not.toThrow();
    expect(I.adx(rows, 1e9).adx.length).toBe(30);
    expect(I.kst(rows).kst.length).toBe(30);
    expect(vals(I.rma(rows, 1.9)).filter(x => x !== null).length).toBe(30);
  });
  it('studies that need volume give no value without it, studies that do not still draw', () => {
    const noVol = series(40).map(({ volume: _v, ...r }) => r);
    expect(vals(I.vwma(noVol, 5)).every(x => x === null)).toBe(true);
    expect(vals(I.mfi(noVol, 5)).filter(x => x !== null).length).toBe(35); // volume counts as 0: 50
    expect(vals(I.hma(noVol, 5)).filter(x => x !== null).length).toBeGreaterThan(30);
  });
  it('time-based studies survive times they cannot read', () => {
    const rows = series(40).map((r, i) => (i % 7 === 0 ? { ...r, time: 'nonsense' } : r)) as IndicatorRow[];
    expect(() => I.pivotPoints(rows)).not.toThrow();
    expect(() => I.vwapBands(rows)).not.toThrow();
    expect(() => I.weeksHighLow(rows)).not.toThrow();
    expect(() => I.relativeVolume(rows, { zone: 'No/Such_Zone' })).not.toThrow();
    expect(I.vwapBands(rows).vwap.length).toBe(40);
  });
});
