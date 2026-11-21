// Chart options, their defaults and the deep merge used by `applyOptions`.

import type { ThemeColors } from './theme';
import type { DateOrder } from './format';
import type { Time } from './time';
import type { PriceScaleOptions } from '../scales/price-scale';
import type { TimeScaleOptions } from '../scales/time-scale';

export type ThemeName = 'light' | 'dark' | 'auto';

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (...args: never[]) => unknown ? T[K]
    : T[K] extends readonly unknown[] ? T[K]
      : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export interface LocalizationOptions {
  /** Replaces the price text everywhere (axis, last value, crosshair). */
  priceFormatter?: (price: number) => string;
  /** Replaces the crosshair's time stamp. Receives the bar's time as given in the data. */
  timeFormatter?: (time: Time) => string;
  /** 12-hour clock on the axis and crosshair. Default false (24-hour). */
  hours12: boolean;
  /** "29 Sep" ('day-month', default) or "Sep 29" ('month-day'). */
  dateOrder: DateOrder;
  /** Text shown centred in a chart that has no data yet. Default 'No data'; '' shows nothing. */
  noDataText: string;
}

export interface CrosshairOptions {
  /** 'normal' follows the pointer; 'magnet' snaps the horizontal line to the first series' value; 'hidden'. */
  mode: 'normal' | 'magnet' | 'hidden';
  /** Axis tags under the crosshair lines. */
  labels: boolean;
}

export interface InteractionOptions {
  /**
   * Wheel and trackpad. `'auto'` (default): a plain vertical wheel zooms only when the chart has focus (clicked or
   * tabbed into) or the page cannot scroll that way, so a chart never traps page scrolling; ctrl/cmd + wheel (and a
   * trackpad pinch) always zooms; a horizontal wheel pans. `true`: a vertical wheel always zooms. `'modifier'`: only
   * ctrl/cmd + wheel zooms. `false`: the chart ignores the wheel. Zoom is anchored at the pointer.
   */
  wheelZoom: boolean | 'auto' | 'modifier';
  /** Mouse, pen and one-finger drag pans; a drag on the price axis stretches the price scale. */
  dragPan: boolean;
  /** Two-finger pinch zoom. */
  pinchZoom: boolean;
  /** A fast drag keeps gliding after release (off under prefers-reduced-motion). */
  kinetic: boolean;
  /** Arrows pan, + and - zoom, Home and End jump, when the chart has focus. */
  keyboard: boolean;
  /** Double-click resets the view and turns autoscale back on. */
  doubleClickReset: boolean;
}

export interface ChartTimeScaleOptions extends TimeScaleOptions {
  visible: boolean;
  /**
   * IANA zone the axis and crosshair read instants in, e.g. 'America/New_York', 'Asia/Kolkata', 'local'.
   * Default 'UTC'. Business-day data (YYYY-MM-DD) are dates and ignore it.
   */
  timeZone: string;
}

export interface AttributionOptions {
  visible: boolean;
  /**
   * 'axis-corner' (default): the empty cell under the price axis, beside the time axis, so it never covers data; it
   * falls back to the top pane's bottom-left corner when no price axis is drawn. The others are corners of the top pane.
   */
  position: 'axis-corner' | 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';
}

export interface ChartOptions {
  /** CSS px; ignored while `autoSize` is on. */
  width: number;
  height: number;
  /** Follow the container's size (ResizeObserver). */
  autoSize: boolean;
  theme: ThemeName;
  /** Overrides applied over the built-in theme (light and dark alike). */
  colors: Partial<ThemeColors>;
  fontFamily: string;
  /** CSS px; never below 12. */
  fontSize: number;
  grid: { vertLines: boolean; horzLines: boolean };
  crosshair: CrosshairOptions;
  timeScale: ChartTimeScaleOptions;
  rightPriceScale: PriceScaleOptions;
  /** The left axis of the top pane; shown only while a series uses `priceScaleId: 'left'`. */
  leftPriceScale: PriceScaleOptions;
  localization: LocalizationOptions;
  interaction: InteractionOptions;
  attribution: AttributionOptions;
  /**
   * The built-in legend at the top-left of each pane: each titled series' name and the hovered bar's values (the last
   * bar when nothing is hovered). Shown for panes that have a series with a `title`. `legend: false` hides it.
   */
  legend: { visible: boolean };
  /** Accessible name of the chart. */
  ariaLabel: string;
  /** Spoken help for keyboard users (the chart's accessible description). */
  ariaDescription: string;
}

export const SYSTEM_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
export const MIN_FONT_SIZE = 12;

export function defaultChartOptions(): ChartOptions {
  return {
    width: 0,
    height: 0,
    autoSize: true,
    theme: 'light',
    colors: {},
    fontFamily: SYSTEM_FONT,
    fontSize: 12,
    grid: { vertLines: false, horzLines: true },
    crosshair: { mode: 'normal', labels: true },
    timeScale: { barSpacing: 8, minBarSpacing: 0.5, maxBarSpacing: 64, rightOffset: 2, visible: true, timeZone: 'UTC' },
    rightPriceScale: { mode: 'linear', autoScale: true, scaleMargins: { top: 0.1, bottom: 0.1 }, visible: true },
    leftPriceScale: { mode: 'linear', autoScale: true, scaleMargins: { top: 0.1, bottom: 0.1 }, visible: true },
    localization: { hours12: false, dateOrder: 'day-month', noDataText: 'No data' },
    interaction: { wheelZoom: 'auto', dragPan: true, pinchZoom: true, kinetic: true, keyboard: true, doubleClickReset: true },
    attribution: { visible: true, position: 'axis-corner' },
    legend: { visible: true },
    ariaLabel: 'Price chart',
    ariaDescription: 'Left and right arrows pan, plus and minus zoom, Home and End jump to the first and last bar. '
      + 'Press Enter to inspect bars one at a time with the arrow keys; Escape stops.',
  };
}

/** A plain object from any realm (an iframe's `{}` has another `Object.prototype`, whose own prototype is null). */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === null || Object.getPrototypeOf(proto) === null;
}

/** Merge `patch` into `target` in place (plain objects recurse; anything else replaces). Returns target. */
export function mergeInto<T extends object>(target: T, patch: unknown): T {
  if (!isPlainObject(patch)) return target;
  const t = target as Record<string, unknown>;
  for (const key of Object.keys(patch)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const v = patch[key];
    if (v === undefined) continue;
    // A number that is NaN or infinite is ignored and the previous value kept.
    if (typeof v === 'number' && !Number.isFinite(v)) continue;
    if (isPlainObject(v) && isPlainObject(t[key])) mergeInto(t[key] as object, v);
    else t[key] = isPlainObject(v) ? mergeInto({}, v) : v;
  }
  return target;
}

/** CSS `touch-action` for the chart: the browser keeps every gesture the chart does not handle. */
export function touchActionFor(o: Pick<InteractionOptions, 'dragPan' | 'pinchZoom'>): string {
  if (o.dragPan && o.pinchZoom) return 'pan-y';
  if (o.dragPan) return 'pan-y pinch-zoom';
  if (o.pinchZoom) return 'pan-x pan-y';
  return 'auto';
}
