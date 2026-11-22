// Custom series examples: importable definitions that prove the series contract and serve as templates.
//   import { StackedAreaSeries } from '@mrchartist/chartist-lite/extras';
//   chart.addSeries(StackedAreaSeries, { title: 'Mix' });

export { StackedAreaSeries } from './stacked-area';
export type { StackedAreaData, StackedAreaOptions } from './stacked-area';
export { HeatmapSeries, peakPrice } from './heatmap';
export type { HeatmapData, HeatmapOptions } from './heatmap';
export { RoundedCandlesSeries, cornerRadius } from './rounded-candles';
export type { RoundedCandlesOptions } from './rounded-candles';
export { WhiskerBoxSeries, boxWidth } from './whisker-box';
export type { WhiskerBoxData, WhiskerBoxOptions } from './whisker-box';
export { seriesPalette } from './palette';
