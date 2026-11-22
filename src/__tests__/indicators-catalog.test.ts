import { describe, expect, it } from 'vitest';
import { INDICATORS, getIndicator, legendLabel } from '../indicators/catalog';
import * as entry from '../indicators/index';
import type { IndicatorRow } from '../indicators/index';

/** Deterministic candles: seeded walk with volume, one bar per day. */
function series(n: number, seed = 7): IndicatorRow[] {
  let s = seed >>> 0;
  const rand = (): number => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const out: IndicatorRow[] = [];
  let close = 100;
  for (let i = 0; i < n; i++) {
    const open = close;
    close = Math.max(1, open * (1 + (rand() - 0.49) * 0.03));
    out.push({ time: 1_700_000_000 + i * 86_400, open, high: Math.max(open, close) * (1 + rand() * 0.01), low: Math.min(open, close) * (1 - rand() * 0.01), close, volume: Math.floor(1000 + rand() * 5000) });
  }
  return out;
}

const ROWS = series(300);
/** Studies that legitimately have no value on 300 daily bars with default settings (a longer history, or intraday bars). */
const NEEDS_LONGER = new Set(['weeks-high-low', 'opening-range']);

describe('indicator catalog', () => {
  it('is importable on its own and lists every indicator', () => {
    expect(INDICATORS.length).toBeGreaterThanOrEqual(85);
    expect(entry.INDICATORS).toBe(INDICATORS);
    expect(entry.getIndicator).toBe(getIndicator);
    expect(entry.legendLabel).toBe(legendLabel);
  });

  it('has unique ids, valid categories, outputs and inputs', () => {
    const ids = INDICATORS.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of INDICATORS) {
      expect(s.id, s.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(s.name.length, s.id).toBeGreaterThan(2);
      expect(s.shortName.length, s.id).toBeGreaterThan(0);
      expect(['trend', 'momentum', 'volatility', 'volume', 'other']).toContain(s.category);
      expect(typeof s.overlay).toBe('boolean');
      expect(s.outputs.length, s.id).toBeGreaterThan(0);
      expect(new Set(s.outputs.map(o => o.key)).size, `${s.id} output keys`).toBe(s.outputs.length);
      expect(new Set(s.inputs.map(i => i.key)).size, `${s.id} input keys`).toBe(s.inputs.length);
      expect(s.outputs.filter(o => o.kind === 'band-upper').length, `${s.id} bands`).toBe(s.outputs.filter(o => o.kind === 'band-lower').length);
      for (const o of s.outputs) expect(['line', 'histogram', 'band-upper', 'band-lower', 'markers']).toContain(o.kind);
      if (!s.overlay) expect(s.outputs.some(o => o.kind === 'line' || o.kind === 'histogram'), s.id).toBe(true);
    }
  });

  it('keeps every input default within its range and its options', () => {
    for (const s of INDICATORS) {
      for (const i of s.inputs) {
        expect(['int', 'float', 'source', 'bool', 'select']).toContain(i.type);
        if (i.type === 'int' || i.type === 'float') {
          expect(typeof i.default, `${s.id}.${i.key}`).toBe('number');
          if (i.min !== undefined) expect(i.default as number, `${s.id}.${i.key} min`).toBeGreaterThanOrEqual(i.min);
          if (i.max !== undefined) expect(i.default as number, `${s.id}.${i.key} max`).toBeLessThanOrEqual(i.max);
          if (i.min !== undefined && i.max !== undefined) expect(i.min, `${s.id}.${i.key}`).toBeLessThan(i.max);
          if (i.type === 'int') expect(Number.isInteger(i.default), `${s.id}.${i.key} int`).toBe(true);
        } else if (i.type === 'bool') {
          expect(typeof i.default).toBe('boolean');
        } else {
          expect(i.options && i.options.length, `${s.id}.${i.key} options`).toBeGreaterThan(0);
          expect(i.options, `${s.id}.${i.key}`).toContain(i.default);
        }
      }
    }
  });

  it('computes every spec with its defaults on 300 bars: aligned, finite, never throwing', () => {
    for (const s of INDICATORS) {
      const defaults = Object.fromEntries(s.inputs.map(i => [i.key, i.default]));
      for (const params of [undefined, {}, defaults]) {
        const out = s.compute(ROWS, params);
        let any = false;
        for (const o of s.outputs) {
          const a = out[o.key];
          expect(Array.isArray(a), `${s.id}.${o.key}`).toBe(true);
          expect(a.length, `${s.id}.${o.key} length`).toBe(ROWS.length);
          a.forEach((p, i) => {
            expect(p.time, `${s.id}.${o.key} time`).toBe(ROWS[i].time);
            if (p.value !== undefined) { any = true; expect(Number.isFinite(p.value), `${s.id}.${o.key} finite`).toBe(true); }
          });
        }
        if (!NEEDS_LONGER.has(s.id)) expect(any, `${s.id} draws something`).toBe(true);
      }
    }
  });

  it('computes the same numbers as the function it wraps', () => {
    const rsiSpec = getIndicator('rsi')!;
    expect(rsiSpec.compute(ROWS, { period: 9 }).value).toEqual(entry.rsi(ROWS, 9));
    const bb = getIndicator('bollinger')!.compute(ROWS, { period: 10, mult: 1.5 });
    const direct = entry.bollinger(ROWS, { period: 10, mult: 1.5 });
    expect(bb.upper).toEqual(direct.upper);
    expect(bb.basis).toEqual(direct.basis);
    expect(getIndicator('macd')!.compute(ROWS, { fast: 5, slow: 13, signal: 4 }).histogram).toEqual(entry.macd(ROWS, { fast: 5, slow: 13, signal: 4 }).histogram);
    expect(getIndicator('hma')!.compute(ROWS, { period: 21, source: 'hl2' }).value).toEqual(entry.hma(ROWS, 21, { source: 'hl2' }));
    expect(getIndicator('pivot-points')!.compute(ROWS, { kind: 'fibonacci', period: 'week' }).r2).toEqual(entry.pivotPoints(ROWS, { kind: 'fibonacci', period: 'week' }).r2);
    // the anchored VWAP anchors `anchorBars` bars back from the last bar
    const av = getIndicator('anchored-vwap')!.compute(ROWS, { anchorBars: 50 }).vwap;
    expect(av.findIndex(p => p.value !== undefined)).toBe(249);
    expect(av).toEqual(entry.anchoredVwap(ROWS, { from: ROWS[249].time }).vwap);
  });

  it('clamps invalid params instead of throwing', () => {
    const junk: unknown[] = [NaN, Infinity, -Infinity, -5, 0, 1e12, 'abc', '', null, undefined, {}, [], true, 2.7, '14'];
    for (const s of INDICATORS) {
      for (const bad of junk) {
        const params = Object.fromEntries(s.inputs.map(i => [i.key, bad]));
        let out: Record<string, unknown[]> = {};
        expect(() => { out = s.compute(ROWS, params as never); }, `${s.id} with ${String(bad)}`).not.toThrow();
        for (const o of s.outputs) expect(out[o.key].length).toBe(ROWS.length);
      }
    }
    // a numeric string is a number, a fractional int is floored, a huge window is capped
    expect(getIndicator('sma')!.compute(ROWS, { period: '5' }).value).toEqual(entry.sma(ROWS, 5));
    expect(getIndicator('sma')!.compute(ROWS, { period: 5.9 }).value).toEqual(entry.sma(ROWS, 5));
    expect(getIndicator('sma')!.compute(ROWS, { period: -3 }).value).toEqual(entry.sma(ROWS, 1));
    expect(getIndicator('sma')!.compute(ROWS, { period: 1e9 }).value).toEqual(entry.sma(ROWS, 500));
    expect(getIndicator('sma')!.compute(ROWS, { source: 'nonsense' }).value).toEqual(entry.sma(ROWS, 20));
  });

  it('never throws and keeps the length on empty and garbage rows', () => {
    const garbage = [{ time: 1, close: 'x' }, { time: 'bad', high: NaN }, null, undefined, 5, {}] as unknown as IndicatorRow[];
    for (const s of INDICATORS) {
      for (const rows of [[], ROWS.slice(0, 1), ROWS.slice(0, 2), garbage]) {
        let out: Record<string, unknown[]> = {};
        expect(() => { out = s.compute(rows); }, s.id).not.toThrow();
        for (const o of s.outputs) expect(out[o.key].length, `${s.id} ${rows.length}`).toBe(rows.length);
      }
    }
    expect(() => getIndicator('rsi')!.compute(null as never)).not.toThrow();
  });

  it('the opening range draws on intraday bars from its defaults (09:15 IST)', () => {
    // 5-minute bars from 03:45 UTC (09:15 IST), 75 per day, three days
    const rows = series(225, 3).map((r, i) => ({ ...r, time: Date.UTC(2026, 0, 5, 3, 45) / 1000 + Math.floor(i / 75) * 86_400 + (i % 75) * 300 }));
    const out = getIndicator('opening-range')!.compute(rows);
    expect(out.high.findIndex(p => p.value !== undefined)).toBe(2); // the third bar completes 09:15 to 09:30
    expect(out.high[2].value).toBe(Math.max(...rows.slice(0, 3).map(r => r.high as number)));
    expect(out.high[75].value).toBeUndefined(); // the next session's first bar is inside its range
    expect(out.low[77].value).toBe(Math.min(...rows.slice(75, 78).map(r => r.low as number)));
  });

  it('looks specs up by id', () => {
    expect(getIndicator('rsi')?.name).toBe('Relative Strength Index');
    expect(getIndicator('nope')).toBeUndefined();
    expect(getIndicator('constructor')).toBeUndefined();
  });

  it('writes legends', () => {
    expect(legendLabel(getIndicator('rsi')!, { period: 14 })).toBe('RSI 14');
    expect(legendLabel(getIndicator('rsi')!)).toBe('RSI 14');
    expect(legendLabel(getIndicator('bollinger')!, { period: 20, mult: 2 })).toBe('BB 20 2');
    expect(legendLabel(getIndicator('bollinger')!, { period: 10, mult: 1.5, source: 'hl2' })).toBe('BB 10 1.5 hl2');
    expect(legendLabel(getIndicator('macd')!, { fast: 12, slow: 26, signal: 9 })).toBe('MACD 12 26 9');
    expect(legendLabel(getIndicator('envelope')!, { period: 20, percent: 10, type: 'ema' })).toBe('Env 20 10 ema');
    expect(legendLabel(getIndicator('obv')!)).toBe('OBV');
    expect(legendLabel(getIndicator('sma')!, { period: -3 })).toBe('SMA 1');
  });
});
