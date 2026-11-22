// Public types of the widget entry. Types only (no runtime), so the pure modules and tests can share them.

import type { ChartApi } from '../api';
import type { IndicatorSpec } from '../indicators/catalog';
import type { ToolDefinition } from '../drawings/contract';
import type { WidgetStrings } from './strings';

export type { IndicatorSpec };

/** One price bar as the widget keeps it: UNIX seconds and the five numbers (volume optional). */
export interface WidgetBar { time: number; open: number; high: number; low: number; close: number; volume?: number }

/** Rows the host may give: times as UNIX seconds, 'YYYY-MM-DD' or ISO text; `value` rows become flat bars. */
export type WidgetRowInput = { time: number | string; open?: number; high?: number; low?: number; close?: number; value?: number; volume?: number };

export interface SymbolInfo { symbol: string; description?: string; exchange?: string }

export interface BarsRequest { symbol: string; interval: string; from?: number; to?: number; limit?: number }

/** A data source of your own. Times are UNIX seconds. */
export interface WidgetFeed {
  getBars(request: BarsRequest): Promise<readonly WidgetRowInput[]>;
  /** Live updates of the forming bar (same time replaces, newer appends). Returns an unsubscribe function. */
  subscribeBars?(request: { symbol: string; interval: string }, onBar: (bar: WidgetRowInput) => void): () => void;
  searchSymbols?(query: string): Promise<readonly SymbolInfo[]>;
  /** Intervals the feed can serve (default: the widget's `intervals`). */
  intervals?: readonly string[];
}

/** A chart type as the widget offers it (from `CHART_TYPES` of the transforms entry, or the built-in five). */
export interface ChartTypeInfo { id: string; name: string; kind: 'series' | 'transform' }

/** An indicator on the chart, as the API reports it. */
export interface IndicatorHandle {
  readonly uid: string;
  readonly id: string;
  readonly name: string;
  params(): Record<string, number | string | boolean>;
  setParams(params: Record<string, unknown>): void;
  setVisible(visible: boolean): void;
  visible(): boolean;
  /** 'overlay' draws on the price pane; 'pane' in a pane of its own. */
  setPlacement(placement: 'overlay' | 'pane'): void;
  placement(): 'overlay' | 'pane';
  setOutputStyle(key: string, style: Partial<OutputStyle>): void;
  remove(): void;
}

export interface OutputStyle { color: string; width: 1 | 2 | 3 | 4; visible: boolean }

export interface IndicatorState {
  id: string;
  params: Record<string, number | string | boolean>;
  visible: boolean;
  placement: 'overlay' | 'pane';
  styles: Record<string, Partial<OutputStyle>>;
}

export type ToolbarPart =
  | 'symbol' | 'intervals' | 'chartType' | 'indicators' | 'compare' | 'alerts' | 'draw' | 'undo' | 'screenshot'
  | 'fullscreen' | 'theme' | 'settings' | 'ranges' | 'goto' | 'clock' | 'scale' | 'status';

export interface WidgetDrawingsOptions {
  /** 'all' (default: `ALL_TOOLS` of the drawings module), 'basic' (`BASIC_TOOLS`) or tool definitions of your own. */
  tools?: 'basic' | 'all' | readonly ToolDefinition[];
  /** Open the drawing bar at start. Default false. */
  open?: boolean;
  /** Saved drawings JSON (`exportJSON` of the drawing tools) to restore. */
  saved?: string;
}

/** Modules the widget can use when given (or loaded on demand through `load`). */
export interface WidgetModules {
  drawings?: { createDrawingTools: (...args: never[]) => unknown; ALL_TOOLS?: readonly ToolDefinition[]; BASIC_TOOLS?: readonly ToolDefinition[] };
  live?: { connectLive: (...args: never[]) => unknown };
  extras?: Record<string, unknown>;
  transforms?: { CHART_TYPES?: readonly ChartTypeInfo[]; applyChartType?: (...args: never[]) => unknown };
}

export interface WidgetSettings {
  grid: boolean;
  vertGrid: boolean;
  crosshair: 'normal' | 'magnet' | 'hidden';
  scaleMode: 'linear' | 'log' | 'percent';
  autoScale: boolean;
  volume: boolean;
  sessionBreaks: boolean;
  tooltip: 'off' | 'floating' | 'tracking' | 'magnifier';
  watermark: boolean;
}

export interface WidgetOptions {
  symbol?: string | SymbolInfo;
  interval?: string;
  /** Interval keys offered (the first five show as keys; the rest in the menu). */
  intervals?: readonly string[];
  chartType?: string;
  theme?: 'light' | 'dark' | 'auto';
  timeZone?: string;
  data?: readonly WidgetRowInput[];
  feed?: WidgetFeed;
  /** Real crypto from public exchange APIs (needs the live module): `true` starts on BTC-USD. */
  live?: boolean | { provider?: string | object; symbol?: string };
  indicators?: readonly (string | ({ id: string } & Partial<Omit<IndicatorState, 'id'>>))[];
  /**
   * Drawing tools: true (the drawing bar open at start), saved drawings JSON to restore, or `{ tools, open, saved }`:
   * `tools` is 'all' (default, every built-in tool), 'basic' (the first fifteen) or your own list of definitions.
   * Needs the drawings module (given or loaded); it is loaded the first time drawing is turned on.
   */
  drawings?: boolean | string | WidgetDrawingsOptions;
  /** Parts of the chrome on (true) or off (false). */
  toolbar?: Partial<Record<ToolbarPart, boolean>>;
  /** Opt-in: keep the workspace in localStorage under `key` (versioned). Nothing is stored without it. */
  persist?: { key: string; storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> };
  /** Every visible word. */
  strings?: Partial<WidgetStrings>;
  /** Modules handed in directly. */
  modules?: WidgetModules;
  /** Dynamic importers, called only when the part is first needed (a page that never draws never loads drawings). */
  load?: { [K in keyof WidgetModules]?: () => Promise<WidgetModules[K]> };
  /** Indicator registry (default: the catalog of the indicators entry). */
  catalog?: readonly IndicatorSpec[];
  settings?: Partial<WidgetSettings>;
  /** Watermark text (default: symbol and interval) when the watermark is on. */
  watermark?: string;
  /** Height of the widget in CSS px when the container has none. Default: fill the container. */
  height?: number;
  /** Options passed to the chart (fonts, colours, localization). */
  chartOptions?: Record<string, unknown>;
}

export type WidgetEvent = 'symbol' | 'interval' | 'chartType' | 'indicators' | 'theme' | 'ready' | 'error' | 'status' | 'change';

export interface Widget {
  readonly chart: ChartApi;
  readonly element: HTMLElement;
  setSymbol(symbol: string | SymbolInfo): Promise<void>;
  setInterval(interval: string): Promise<void>;
  setChartType(id: string): void;
  addIndicator(id: string, params?: Record<string, unknown>, state?: Partial<Omit<IndicatorState, 'id' | 'params'>>): IndicatorHandle;
  removeIndicator(handle: IndicatorHandle | string): void;
  indicators(): IndicatorHandle[];
  setTheme(theme: 'light' | 'dark' | 'auto'): void;
  setRange(span: string): Promise<void>;
  setData(rows: readonly WidgetRowInput[]): void;
  save(): WorkspaceJSON;
  load(json: WorkspaceJSON | string): Promise<void>;
  on(event: WidgetEvent, fn: (detail: unknown) => void): () => void;
  /** Download a PNG of the chart with its legend; resolves to the blob. */
  screenshot(download?: boolean): Promise<Blob | null>;
  destroy(): void;
}

export interface WorkspaceJSON {
  format: 'chartist-lite-workspace';
  version: number;
  symbol: SymbolInfo;
  interval: string;
  chartType: string;
  theme: 'light' | 'dark' | 'auto';
  timeZone: string;
  indicators: IndicatorState[];
  compare: string[];
  settings: WidgetSettings;
  drawings: string | null;
  /** The drawing bar is open (saved with the workspace; absent in older saves: open when there are drawings). */
  drawingsOpen?: boolean;
  /** "Hide drawings" (the eye on the rail) is on. Absent in older saves (off). */
  drawingsHidden?: boolean;
}
