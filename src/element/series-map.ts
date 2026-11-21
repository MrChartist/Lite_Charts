// Series type names used by the element and the React wrapper, mapped to the core's series definitions.
// Definitions are looked up by export name on the core entry, so a type that is not built yet is simply
// unavailable (`resolveSeriesDefinition` returns null) instead of breaking the build.

import * as core from '../index';
import type { AnySeriesDefinition } from '../api';

export type SeriesTypeName = 'candlestick' | 'line' | 'area' | 'bar' | 'histogram' | 'baseline';

/** Row shape each type reads: `ohlc` needs open/high/low/close, `value` needs one number. */
export type RowShape = 'ohlc' | 'value';

interface Entry { exportName: string; shape: RowShape }

export const SERIES_TYPES: Readonly<Record<SeriesTypeName, Entry>> = {
  candlestick: { exportName: 'CandlestickSeries', shape: 'ohlc' },
  line: { exportName: 'LineSeries', shape: 'value' },
  // Added to the core by another worker with the same definition contract. Looked up by name; null until present.
  area: { exportName: 'AreaSeries', shape: 'value' },
  bar: { exportName: 'BarSeries', shape: 'ohlc' },
  histogram: { exportName: 'HistogramSeries', shape: 'value' },
  baseline: { exportName: 'BaselineSeries', shape: 'value' },
};

export function isSeriesTypeName(value: unknown): value is SeriesTypeName {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SERIES_TYPES, value);
}

export function seriesShape(type: SeriesTypeName): RowShape {
  return SERIES_TYPES[type].shape;
}

/** The core definition for a type name, or null when this build of the core does not have it. */
export function resolveSeriesDefinition(type: SeriesTypeName): AnySeriesDefinition | null {
  const def = (core as unknown as Record<string, unknown>)[SERIES_TYPES[type].exportName];
  return def && typeof def === 'object' && typeof (def as AnySeriesDefinition).type === 'string' ? (def as AnySeriesDefinition) : null;
}
