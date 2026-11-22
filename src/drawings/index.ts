// Entry `@mrchartist/chartist-lite/drawings`: drawing tools on top of the chart's primitive and pointer hooks.
//
//   import { createDrawingTools, ALL_TOOLS } from '@mrchartist/chartist-lite/drawings';
//   const tools = createDrawingTools(chart, candles, { toolbar: true, tools: ALL_TOOLS });
//   tools.setTool('trend');
//
// `tools` defaults to BASIC_TOOLS (the first fifteen); pass ALL_TOOLS, or any subset of definitions, to choose what a
// page ships: a bundler leaves out the definitions nobody imports. Importing this entry touches no DOM; the toolbar is
// built only when `toolbar` is set.

export { createDrawingTools, drawingsFromJSON, drawingsToJSON, migrate, normalizeSpec, FORMAT, LIMITS, VERSION } from './controller';
export type { DrawingSpec, DrawingToolsController, DrawingToolsOptions, DrawingEvent } from './controller';
export { BASIC_TOOLS } from './tools/basic';
export { ALL_TOOLS } from './tools/all';
export { TOOLS, TOOL_GROUPS, TOOL_KEYS, groupsFor } from './tools';
export { GROUP_ORDER } from './contract';
export type {
  Anchor, AxisTag, BarAccess, BarRow, BuiltinToolId, Drawing, DrawingOptions, DrawingStyle, Proj, RenderCtx, ToolDefinition, ToolId, View,
} from './contract';
export type { ToolInfo } from './tools';
export { ICONS } from './toolbar';
export * as geometry from './geometry';
