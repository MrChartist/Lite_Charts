// Entry `lite-charts/extras` (script-tag global `ChartistLiteExtras`): optional plugins that sit on the
// chart's public hooks (primitives, pointer handlers, crosshair and range subscriptions). Every export is a small
// function that returns a handle (`applyOptions`, `remove` / `destroy`); nothing is created until it is called.

export { createTooltip, describeBar, describeChange, placeFloating, placeTracking } from './tooltip';
export type { TooltipHandle, TooltipOptions, TooltipMode, TooltipInfo, TooltipEntry, BarText, TooltipChange } from './tooltip';

export { createWatermark, createImageWatermark, placeBlock, fitFontSize } from './watermark';
export type { WatermarkHandle, WatermarkOptions, WatermarkPosition, ImageWatermarkHandle, ImageWatermarkOptions } from './watermark';

export { createGoToRealtimeButton, newestBarHidden } from './realtime-button';
export type { GoToRealtimeHandle, GoToRealtimeOptions } from './realtime-button';

export { createRangeSwitcher, nextIndex, switcherColors } from './range-switcher';
export type { RangeSwitcherHandle, RangeSwitcherOptions, RangeChange } from './range-switcher';
export {
  RANGE_KEYS, addMonths, civilOfDay, daysInMonth, isLeapYear, logicalRangeFor, rangeStartDay, resolveRange, zoneMidnightSeconds,
} from './range';
export type { RangeKey, ResolvedRange, Civil } from './range';

export { createPriceAlerts, crossings, snapPrice, nearestLine, alertsToJSON, alertsFromJSON, layoutAlertChips } from './alerts';
export type { PriceAlertsHandle, PriceAlertsOptions, PriceAlert, AlertTrigger, PlacedChip } from './alerts';

export { createCompare, percentChange, rebaseFactor, firstVisibleRef, scaleRows, percentText } from './compare';
export type { CompareHandle, CompareOptions, CompareAddOptions, CompareLine, CompareRow } from './compare';

export { createReplay, tickReplay, startIndexAt, stepIndex, REPLAY_SPEEDS } from './replay';
export type { ReplayHandle, ReplayOptions, ReplayInfo, ReplaySpeed } from './replay';

export { createBands, createPartialPriceLine, createSessionBreaks, createVerticalLine, pairEdges, bandExtent, dayStarts, isIntraday, chipLeft } from './bands';
export type {
  BandsHandle, BandsOptions, BandRow, PartialPriceLineHandle, PartialPriceLineOptions, SessionBreaksHandle, SessionBreaksOptions,
  VerticalLineHandle, VerticalLineOptions,
} from './bands';

export { StackedAreaSeries, HeatmapSeries, RoundedCandlesSeries, WhiskerBoxSeries, seriesPalette } from './series';
export type {
  StackedAreaData, StackedAreaOptions, HeatmapData, HeatmapOptions, RoundedCandlesOptions, WhiskerBoxData, WhiskerBoxOptions,
} from './series';

export { accentFor, contrastRatio } from './common';
export type { Removable } from './common';
