// Series type names used by the element and the React wrapper, mapped to the core's six series definitions.
// Imported by name from their own files, so this module pulls in the series and nothing else of the entry.

import type { AnySeriesDefinition } from '../api';
import { AreaSeries } from '../series/area';
import { BarSeries } from '../series/bar';
import { BaselineSeries } from '../series/baseline';
import { CandlestickSeries } from '../series/candlestick';
import { HistogramSeries } from '../series/histogram';
import { LineSeries } from '../series/line';

export type SeriesTypeName = 'candlestick' | 'line' | 'area' | 'bar' | 'histogram' | 'baseline';

/** Row shape each type reads: `ohlc` needs open/high/low/close, `value` needs one number. */
export type RowShape = 'ohlc' | 'value';

interface Entry { exportName: string; shape: RowShape; def: AnySeriesDefinition }

export const SERIES_TYPES: Readonly<Record<SeriesTypeName, Entry>> = {
  candlestick: { exportName: 'CandlestickSeries', shape: 'ohlc', def: CandlestickSeries },
  line: { exportName: 'LineSeries', shape: 'value', def: LineSeries },
  area: { exportName: 'AreaSeries', shape: 'value', def: AreaSeries },
  bar: { exportName: 'BarSeries', shape: 'ohlc', def: BarSeries },
  histogram: { exportName: 'HistogramSeries', shape: 'value', def: HistogramSeries },
  baseline: { exportName: 'BaselineSeries', shape: 'value', def: BaselineSeries },
};

export function isSeriesTypeName(value: unknown): value is SeriesTypeName {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SERIES_TYPES, value);
}

export function seriesShape(type: SeriesTypeName): RowShape {
  return SERIES_TYPES[type].shape;
}

/** The core definition for a type name (null only for a name that is not a series type). */
export function resolveSeriesDefinition(type: SeriesTypeName): AnySeriesDefinition | null {
  return SERIES_TYPES[type]?.def ?? null;
}
