// The chart-type registry for UIs: `CHART_TYPES` lists every look with the inputs a settings form needs, and
// `applyChartType(id, rows, options)` returns the series definition to give `chart.addSeries` plus the data and series
// options for it, so switching chart type is one call:
//
//   const { definition, data, options } = applyChartType('renko', bars, { brick: 0 });
//   const series = chart.addSeries(definition, options);
//   series.setData(data);
//
// Rows in are candlesticks (or `{ time, value }`, which the line looks accept). Rows are cleaned first (a row whose
// time cannot be read is dropped, an older time is dropped, a repeated time keeps the last row), so `setData` never
// throws on them. The transform types (`kind: 'transform'`) make one bar per brick, line, segment or column, dated by
// the source bar that completed it, so several can share a time. The irregular ones (`irregularTime: true`) get a
// definition with an ordinal time axis (`ordinalSeries`): the chart places them by row order, keeps every true time
// and labels the axis on the bricks (`brickTickText`). `calendarTime: true` keeps the old fallback instead: the
// plain definition and times spread to be unique (`spreadTimes`), counted in `info.shifted`.

import { heikinAshi } from '../indicators/heikin-ashi';
import { BarSeries } from '../series/bar';
import { BaselineSeries } from '../series/baseline';
import { AreaSeries } from '../series/area';
import { CandlestickSeries } from '../series/candlestick';
import { ColumnSeries } from '../series/column';
import type { SeriesDefinition } from '../series/definition';
import { HighLowSeries } from '../series/high-low';
import { HlcAreaSeries } from '../series/hlc-area';
import { HollowCandlestickSeries } from '../series/hollow-candlestick';
import { KagiSeries } from '../series/kagi';
import { LineSeries } from '../series/line';
import { PointFigureSeries } from '../series/point-figure';
import { StepLineSeries } from '../series/step-line';
import type { Time } from '../core/time';
import { kagi } from './kagi';
import { lineBreak } from './line-break';
import { pointFigure } from './point-figure';
import { rangeBars } from './range-bars';
import { renko } from './renko';
import { isNum, priceOf, timeOk, type PriceSource, type SizeSpec, type TransformRow } from './shared';
import { spreadTimes, timeNum } from './time-spread';
import { ordinalSeries } from './brick-axis';

export type ChartTypeId =
  | 'candles' | 'hollow' | 'bars' | 'highLow' | 'line' | 'stepLine' | 'area' | 'hlcArea' | 'baseline' | 'columns'
  | 'heikinAshi' | 'renko' | 'lineBreak' | 'kagi' | 'pointFigure' | 'rangeBars';

export interface ChartTypeInput {
  key: string;
  label: string;
  type: 'number' | 'boolean';
  default: number | boolean;
  min?: number;
  max?: number;
}

export interface ChartType {
  id: ChartTypeId;
  name: string;
  /** 'series': the rows are drawn as they are. 'transform': the rows are first turned into bricks, lines, segments or columns. */
  kind: 'series' | 'transform';
  /** One bar no longer means one source bar, so bars are not evenly spaced in time (a time axis should label bricks, not a calendar). */
  irregularTime: boolean;
  inputs: ChartTypeInput[];
}

const num = (key: string, label: string, def: number, min?: number, max?: number): ChartTypeInput => {
  const i: ChartTypeInput = { key, label, type: 'number', default: def };
  if (min !== undefined) i.min = min;
  if (max !== undefined) i.max = max;
  return i;
};

const series = (id: ChartTypeId, name: string, inputs: ChartTypeInput[] = []): ChartType => ({ id, name, kind: 'series', irregularTime: false, inputs });
const transform = (id: ChartTypeId, name: string, irregularTime: boolean, inputs: ChartTypeInput[] = []): ChartType => ({ id, name, kind: 'transform', irregularTime, inputs });

export const CHART_TYPES: readonly ChartType[] = [
  series('candles', 'Candles'),
  series('hollow', 'Hollow candles'),
  series('bars', 'Bars'),
  series('highLow', 'High-low'),
  series('line', 'Line'),
  series('stepLine', 'Step line'),
  series('area', 'Area'),
  series('hlcArea', 'HLC area'),
  series('baseline', 'Baseline', [num('base', 'Base price (0 = first close)', 0, 0)]),
  series('columns', 'Columns'),
  transform('heikinAshi', 'Heikin Ashi', false),
  transform('renko', 'Renko', true, [num('brick', 'Brick size (0 = automatic)', 0, 0)]),
  transform('lineBreak', 'Line break', true, [num('lines', 'Lines', 3, 1, 10)]),
  transform('kagi', 'Kagi', true, [num('reversal', 'Reversal (%)', 4, 0.1, 50)]),
  transform('pointFigure', 'Point & figure', true, [num('box', 'Box size (0 = automatic)', 0, 0), num('reversal', 'Reversal (boxes)', 3, 1, 9)]),
  transform('rangeBars', 'Range bars', true, [num('range', 'Range (0 = automatic)', 0, 0)]),
];

/** The registry entry for an id, or undefined. */
export function chartType(id: string): ChartType | undefined {
  for (const t of CHART_TYPES) if (t.id === id) return t;
  return undefined;
}

/**
 * Settings for `applyChartType`, keyed like the `inputs` above. A size of 0 (or none) means automatic. Sizes also take
 * `{ atr: period }` or `{ percent }`. `reversal` is a percentage for Kagi and a number of boxes for point and figure.
 */
export interface ChartTypeOptions {
  brick?: SizeSpec;
  box?: SizeSpec;
  range?: SizeSpec;
  reversal?: number | SizeSpec;
  lines?: number;
  /** Baseline: the base price; 0 or none takes the first close. */
  base?: number;
  /** The price a transform reads from each bar. Default 'close'. */
  source?: PriceSource;
  /** Extra series options, merged over the ones the chart type sets (e.g. `{ title: 'DEMO' }`). */
  series?: Record<string, unknown>;
  /**
   * Irregular types only. Default false: an ordinal definition, true times (the chart's axis labels the bricks). True:
   * the plain definition and times spread to be unique (`spreadTimes`), for a host that keeps a calendar axis.
   */
  calendarTime?: boolean;
}

export interface ChartTypeData {
  time: Time;
  [key: string]: unknown;
}

export interface ChartTypeInfo {
  /** Renko brick size used. */
  brick?: number;
  /** Point and figure box size used. */
  box?: number;
  /** Range bars range used. */
  range?: number;
  /** Kagi: the reversal (percent of the extreme, or a price amount when `reversalMode` is 'price'); point and figure: boxes. */
  reversal?: number;
  reversalMode?: 'percent' | 'price';
  /** Line break: lines used. */
  lines?: number;
  /**
   * Irregular types: rows whose time had to move off their source bar's time to stay unique. Always 0 on the default
   * ordinal axis (no time moves); counts the `spreadTimes` moves with `calendarTime: true`.
   */
  shifted?: number;
}

export interface AppliedChartType {
  /** Give to `chart.addSeries`. */
  definition: SeriesDefinition<any, any>;
  /** Give to `series.setData`. Transform rows also carry `sourceIndex` (index in the cleaned input) and `volume`. */
  data: ChartTypeData[];
  /** Give to `chart.addSeries` as its options. */
  options: Record<string, unknown>;
  info?: ChartTypeInfo;
}

/** Rows with a readable time, strictly ascending: unreadable dropped, older dropped, a repeated time keeps the last. */
export function cleanRows<T extends TransformRow>(rows: readonly T[]): T[] {
  let out: T[] | null = null;
  let prev = -Infinity;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const t = r && typeof r === 'object' && timeOk(r.time) ? timeNum(r.time) : NaN;
    if (t > prev) { if (out) out.push(r); prev = t; continue; }
    if (!out) out = rows.slice(0, i);
    if (t === prev && t === t) out[out.length - 1] = r;
  }
  return out ?? (rows as T[]);
}

const ws = (r: TransformRow): ChartTypeData => ({ time: r.time });

function mapRows(rows: readonly TransformRow[], f: (r: TransformRow) => ChartTypeData | null): ChartTypeData[] {
  const out: ChartTypeData[] = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) out[i] = f(rows[i]) ?? ws(rows[i]);
  return out;
}

const ohlc = (r: TransformRow): ChartTypeData | null =>
  isNum(r.open) && isNum(r.high) && isNum(r.low) && isNum(r.close) ? { time: r.time, open: r.open, high: r.high, low: r.low, close: r.close } : null;

function hlc(r: TransformRow): ChartTypeData | null {
  return isNum(r.high) && isNum(r.low) && isNum(r.close) ? { time: r.time, high: r.high, low: r.low, close: r.close } : null;
}

function valueRow(r: TransformRow): ChartTypeData | null {
  const v = priceOf(r, 'close');
  return v === v ? { time: r.time, value: v } : null;
}

function percentOf(spec: number | SizeSpec | undefined): SizeSpec | undefined {
  return typeof spec === 'number' ? (spec > 0 ? { percent: spec } : undefined) : spec;
}

function toBricks(rows: readonly { time: Time }[], extra: Partial<ChartTypeInfo>, calendar: boolean): { data: ChartTypeData[]; info: ChartTypeInfo } {
  if (!calendar) return { data: rows as ChartTypeData[], info: { ...extra, shifted: 0 } };
  const spread = spreadTimes(rows as readonly ChartTypeData[]);
  let shifted = 0;
  for (let i = 0; i < spread.length; i++) if (spread[i] !== (rows as readonly unknown[])[i]) shifted++;
  return { data: spread, info: { ...extra, shifted } };
}

/**
 * The series definition, data and options for chart type `id` over `rows`. Throws only for an id that is not in
 * `CHART_TYPES`; bad rows never throw.
 */
export function applyChartType(id: ChartTypeId, rows: readonly TransformRow[], options: ChartTypeOptions = {}): AppliedChartType {
  const type = chartType(id);
  if (!type) throw new TypeError(`Chartist Lite: unknown chart type "${String(id)}"; use one of CHART_TYPES' ids`);
  const clean = cleanRows(rows);
  const extra = options.series;
  const make = (definition: SeriesDefinition<any, any>, data: ChartTypeData[], own: Record<string, unknown> = {}, info?: ChartTypeInfo): AppliedChartType => {
    const res: AppliedChartType = { definition, data, options: extra ? { ...own, ...extra } : own };
    if (info) res.info = info;
    return res;
  };
  const source = options.source ?? 'close';
  const cal = !!options.calendarTime;
  const brick = (definition: SeriesDefinition<any, any>, rows: readonly { time: Time }[], extra: Partial<ChartTypeInfo>, own?: Record<string, unknown>): AppliedChartType => {
    const { data, info } = toBricks(rows, extra, cal);
    return make(cal ? definition : ordinalSeries(definition), data, own, info);
  };

  switch (id) {
    case 'candles': return make(CandlestickSeries, mapRows(clean, ohlc));
    case 'hollow': return make(HollowCandlestickSeries, mapRows(clean, ohlc));
    case 'bars': return make(BarSeries, mapRows(clean, ohlc));
    case 'highLow':
      return make(HighLowSeries, mapRows(clean, r => (isNum(r.high) && isNum(r.low)
        ? (isNum(r.open) && isNum(r.close) ? { time: r.time, high: r.high, low: r.low, open: r.open, close: r.close } : { time: r.time, high: r.high, low: r.low })
        : null)));
    case 'line': return make(LineSeries, mapRows(clean, valueRow));
    case 'stepLine': return make(StepLineSeries, mapRows(clean, valueRow));
    case 'area': return make(AreaSeries, mapRows(clean, valueRow));
    case 'hlcArea': return make(HlcAreaSeries, mapRows(clean, hlc));
    case 'baseline': {
      const data = mapRows(clean, valueRow);
      let base = options.base !== undefined && isNum(options.base) && options.base > 0 ? options.base : NaN;
      if (base !== base) { for (const d of data) if (typeof d.value === 'number') { base = d.value; break; } }
      return make(BaselineSeries, data, base === base ? { baseValue: base } : {});
    }
    case 'columns':
      return make(ColumnSeries, mapRows(clean, r => {
        const v = priceOf(r, 'close');
        if (v !== v) return null;
        return isNum(r.open) ? { time: r.time, value: v, up: v >= r.open } : { time: r.time, value: v };
      }));
    case 'heikinAshi': return make(CandlestickSeries, heikinAshi(clean) as ChartTypeData[]);
    case 'renko': {
      const res = renko(clean, { brick: options.brick, source });
      return brick(CandlestickSeries, res.rows, { brick: res.brick });
    }
    case 'lineBreak': {
      const res = lineBreak(clean, { lines: options.lines, source });
      return brick(CandlestickSeries, res.rows, { lines: res.lines });
    }
    case 'rangeBars': {
      const res = rangeBars(clean, { range: options.range, source });
      return brick(CandlestickSeries, res.rows, { range: res.range });
    }
    case 'kagi': {
      const res = kagi(clean, { reversal: percentOf(options.reversal), source });
      return brick(KagiSeries, res.rows, { reversal: res.reversal, reversalMode: res.mode });
    }
    case 'pointFigure': {
      const rev = typeof options.reversal === 'number' ? options.reversal : undefined;
      const res = pointFigure(clean, { box: options.box, reversal: rev, source });
      return brick(PointFigureSeries, res.rows, { box: res.box, reversal: res.reversal }, { box: res.box });
    }
  }
}
