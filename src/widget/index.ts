// Entry `lite-charts/widget`: a complete chart workspace in one call (top bar, drawing rail, range bar, indicators,
// chart types, screenshot, full screen, settings), and the `<chartist-terminal>` element.
//
//   import { createWidget } from 'lite-charts/widget';
//   const w = createWidget(el, { data: rows, symbol: 'ACME', indicators: ['rsi'] });
//
// Importing this entry touches no DOM. It brings the core, the indicator catalog and the chart types; drawings, live
// data and the extras load only when handed in (`modules`) or first needed (`load: { drawings: () => import(...) }`).

export { createWidget, toBars, toBar, formatValue, offsetLabel, RANGE_KEYS, DEFAULT_INTERVALS } from './widget';
export { defineTerminalElement, setTerminalModules } from './element';
export { DEFAULT_STRINGS } from './strings';
export type { WidgetStrings } from './strings';
export { collapseBar, useSheets } from './layout';
export type { BarItem } from './layout';
export { readWorkspace, migrateWorkspace, validateParams, defaultSettings, WORKSPACE_FORMAT, WORKSPACE_VERSION } from './workspace';
export { normalizeInterval, intervalSeconds, intervalForSpan, barsForSpan, intervalFromDigits, nearestInterval } from './intervals';
export { CORE_CHART_TYPES, chartTypeList } from './chart-types';
export { CRYPTO_SYMBOLS, demoBars } from './demo';
export { WIDGET_ICONS } from './icons';
export type {
  Widget, WidgetOptions, WidgetEvent, WidgetFeed, WidgetModules, WidgetSettings, WidgetBar, WidgetRowInput, SymbolInfo,
  BarsRequest, ChartTypeInfo, IndicatorHandle, IndicatorState, OutputStyle, ToolbarPart, WorkspaceJSON, WidgetDrawingsOptions,
} from './types';
