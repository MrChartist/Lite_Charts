// Incremental indicators: feed live bars one at a time instead of recomputing the whole series.
//
//   const ema = createIndicator('ema', { period: 20 });      // 'sma' | 'ema' | 'rsi' take { period, source }
//   const history = ema.seed(rows);                          // optional: warm up on past bars, returns the batch output
//   lineSeries.update(ema.next(row));                        // O(1) per tick
//
//   createIndicator('macd', { fast, slow, signal, source })  // next() returns { macd, signal, histogram } points
//
// `next(row)`: a row with the same time as the last one REPLACES it (the forming bar ticking); a newer time
// appends. A row older than the last is ignored and returns `{ time }`; so does a time that cannot be read. The
// numbers equal the batch functions' on the same bars (same code underneath). One difference: a leading run of bars
// with no value cannot be back-filled from a future bar, so they are skipped until the first finite value (batch
// fills them with it); a gap after that behaves exactly as in batch. `reset()` forgets everything.

import { EmaCore } from './ema';
import { MacdCore } from './macd';
import type { MacdOptions, MacdResult } from './macd';
import { RsiCore } from './rsi';
import { SmaCore } from './sma';
import { emptyPoint, isNum, period as clampPeriod, pick } from './shared';
import type { IndicatorPoint, IndicatorRow, PriceSource, SourceOptions, StepCore } from './shared';
import { safeSeconds } from './time-util';

/** An incremental period never allocates more than this many bars of state. */
const MAX_PERIOD = 100_000;

export interface PeriodOptions extends SourceOptions {
  period?: number;
}

export interface Indicator<Out, Batch> {
  /** Feed one bar; returns the output for it. */
  next(row: IndicatorRow): Out;
  /** Forget all state, then feed `rows` in order; returns what the batch function would. */
  seed(rows: readonly IndicatorRow[]): Batch;
  reset(): void;
}

interface Engine<Out> {
  core: StepCore;
  out(row: IndicatorRow, value: number): Out;
  none(row: IndicatorRow): Out;
}

function build<Out, Batch>(make: () => Engine<Out>, source: PriceSource | undefined, collect: (outs: Out[]) => Batch): Indicator<Out, Batch> {
  let e = make();
  let hasLast = false;
  let lastSecs = NaN;
  let lastFinite = NaN;
  let prevFinite = NaN;
  let pushed = false;

  const reset = (): void => { e = make(); hasLast = false; lastSecs = NaN; lastFinite = NaN; prevFinite = NaN; pushed = false; };

  const next = (row: IndicatorRow): Out => {
    const secs = safeSeconds(row.time);
    if (!isNum(secs)) return e.none(row);
    let replace = false;
    if (hasLast) {
      if (secs < lastSecs) return e.none(row);
      replace = secs === lastSecs;
    }
    if (replace) {
      if (pushed) e.core.rollback();
      lastFinite = prevFinite;
    } else {
      prevFinite = lastFinite;
      lastSecs = secs;
      hasLast = true;
    }
    const x = pick(row, source);
    const good = isNum(x);
    if (good) lastFinite = x;
    if (Number.isNaN(lastFinite)) { pushed = false; return e.none(row); }
    e.core.mark();
    const v = e.core.push(lastFinite);
    pushed = true;
    return good ? e.out(row, v) : e.none(row);
  };

  return {
    next,
    reset,
    seed(rows) {
      reset();
      return collect(rows.map(next));
    },
  };
}

const single = (core: StepCore): Engine<IndicatorPoint> => ({
  core,
  out: (row, v) => (isNum(v) ? { time: row.time, value: v } : emptyPoint(row.time)),
  none: row => emptyPoint(row.time),
});

export interface MacdPoint {
  macd: IndicatorPoint;
  signal: IndicatorPoint;
  histogram: IndicatorPoint;
}

export function createIndicator(kind: 'sma' | 'ema' | 'rsi', options?: PeriodOptions): Indicator<IndicatorPoint, IndicatorPoint[]>;
export function createIndicator(kind: 'macd', options?: MacdOptions): Indicator<MacdPoint, MacdResult>;
export function createIndicator(kind: string, options: PeriodOptions & MacdOptions = {}): Indicator<any, any> {
  if (kind === 'macd') {
    const f = clampPeriod(options.fast, 12, MAX_PERIOD), s = clampPeriod(options.slow, 26, MAX_PERIOD), g = clampPeriod(options.signal, 9, MAX_PERIOD);
    return build<MacdPoint, MacdResult>(() => {
      const core = new MacdCore(f, s, g);
      const pt = (row: IndicatorRow, v: number): IndicatorPoint => (isNum(v) ? { time: row.time, value: v } : emptyPoint(row.time));
      return {
        core,
        out: row => ({ macd: pt(row, core.macd), signal: pt(row, core.signal), histogram: pt(row, core.histogram) }),
        none: row => ({ macd: emptyPoint(row.time), signal: emptyPoint(row.time), histogram: emptyPoint(row.time) }),
      };
    }, options.source, outs => ({ macd: outs.map(o => o.macd), signal: outs.map(o => o.signal), histogram: outs.map(o => o.histogram) }));
  }
  const p = clampPeriod(options.period, kind === 'rsi' ? 14 : 20, MAX_PERIOD);
  const make = kind === 'sma' ? () => new SmaCore(p) : kind === 'ema' ? () => new EmaCore(p) : kind === 'rsi' ? () => new RsiCore(p) : null;
  if (!make) throw new TypeError(`Chartist Lite: unknown indicator "${kind}"; use 'sma', 'ema', 'rsi' or 'macd'`);
  return build<IndicatorPoint, IndicatorPoint[]>(() => single(make()), options.source, outs => outs);
}
