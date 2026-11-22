// Chartist Lite: a small canvas financial chart with no runtime dependencies.
// Importing this module touches no DOM: everything starts at `createChart`.

import type { ChartApi } from './api';
import { Chart } from './chart/chart';
import type { ChartOptions, DeepPartial } from './core/options';

export const version = '0.1.0';

/**
 * Create a chart inside `container` (an element or its id). The chart fills the container and follows its size
 * unless `autoSize: false` and a `width`/`height` are given.
 */
export function createChart(
  container: HTMLElement | string,
  options?: DeepPartial<ChartOptions> & { attribution?: boolean | DeepPartial<ChartOptions['attribution']> },
): ChartApi {
  let el: HTMLElement | null;
  if (typeof container === 'string') {
    el = typeof document === 'undefined' ? null : document.getElementById(container);
    if (!el) throw new Error(`Chartist Lite: no element with id "${container}"`);
  } else el = container;
  if (!el || typeof el.appendChild !== 'function') throw new TypeError('Chartist Lite: createChart needs a container element');
  return new Chart(el, options as DeepPartial<ChartOptions>);
}

export { CandlestickSeries } from './series/candlestick';
export type { CandlestickData, CandlestickOptions } from './series/candlestick';
export { LineSeries } from './series/line';
export type { LineData, LineOptions, LineStyle } from './series/line';
export { AreaSeries } from './series/area';
export type { AreaData, AreaOptions } from './series/area';
export { BarSeries } from './series/bar';
export type { BarData, BarOptions } from './series/bar';
export { HistogramSeries } from './series/histogram';
export type { HistogramData, HistogramOptions } from './series/histogram';
export { BaselineSeries } from './series/baseline';
export type { BaselineData, BaselineOptions } from './series/baseline';
export { createPriceLine } from './plugins/price-line';
export type { PriceLineOptions, PriceLineHandle, PriceLineStyle } from './plugins/price-line';
export { createSeriesMarkers } from './plugins/markers';
export type { SeriesMarker, SeriesMarkersHandle, MarkerPosition, MarkerShape } from './plugins/markers';

export { lightTheme, darkTheme } from './core/theme';
export { formatPrice, formatPercent, MINUS_SIGN } from './core/format';
export { crispCoord, deviceWidth, hairline } from './render/pixel';
export { decimateColumns, createColumns } from './render/decimate';
export type { ColumnAccess, Columns } from './render/decimate';

export type {
  ChartApi, SeriesApi, TimeScaleApi, PriceScaleApi, MouseEventParams, MouseEventHandler, TimeRange, Point,
  AnySeriesDefinition, LogicalRangeChangeHandler, PaneApi, ChartPointerEvent, ChartPointerHandler,
} from './api';
export type {
  ChartOptions, DeepPartial, LocalizationOptions, CrosshairOptions, InteractionOptions, ChartTimeScaleOptions,
  AttributionOptions, ThemeName,
} from './core/options';
export type { ThemeColors } from './core/theme';
export type { Time, BusinessDay } from './core/time';
export type { SpanInput } from './core/span';
export type { PriceScaleOptions, PriceScaleMode, ScaleMargins } from './scales/price-scale';
export type { LogicalRange } from './scales/time-scale';
export type {
  SeriesDefinition, SeriesDrawScope, SeriesCommonOptions, PriceFormat, RowBase, WhitespaceData, DeviceRect,
  RowOf, OptionsOf, InputOf,
} from './series/definition';
export type { ChartPrimitive, PrimitiveDrawScope, PrimitiveHost, PriceAxisLabel, CssRect } from './plugins/primitive';
