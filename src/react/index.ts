// React wrapper. React is an optional peer dependency and this file imports nothing from it (the package boundary
// test allows no foreign imports), so the component is built from the React you pass in, once:
//
//   import * as React from 'react';
//   import { createChartistReact } from 'lite-charts/react';
//   export const { ChartistChart, useChartist } = createChartistReact(React);
//
// No JSX is used here, so no JSX build step is needed. The chart is created once per mount; new props are applied
// in place (see ChartController). Server rendering gives an empty sized div; the chart starts in an effect.

import type { ChartApi, MouseEventParams } from '../api';
import { ChartController } from './controller';
import type { ChartOptionsInput, ChartProps, SeriesSpec } from './controller';

export { ChartController } from './controller';
export type { ChartProps, SeriesSpec, SeriesRow, ChartOptionsInput, ControllerDeps } from './controller';
export { deepEqual, diffData, planSeries, seriesKey, MAX_TAIL_UPDATES } from './diff';
export type { DataChange, SeriesPlan, KeyedSeries } from './diff';
export type { SeriesTypeName } from '../element/series-map';

/** The part of React this wrapper uses. `import * as React from 'react'` satisfies it (React 18 and 19). */
export interface ReactLike<E = unknown> {
  createElement(type: string, props: Record<string, unknown> | null, ...children: never[]): E;
  useRef<T>(initial: T): { current: T };
  useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  useState<S>(initial: S): [S, (value: S) => void];
}

export interface ChartistChartProps extends ChartProps {
  className?: string;
  /** Inline style of the container. The default is `{ position: 'relative', width: '100%' }` plus `height`. */
  style?: Record<string, string | number | undefined>;
  /** Height in CSS px (number) or any CSS length (string). Default 360. Ignored if `style.height` is set. */
  height?: number | string;
  /** Accessible name of the chart (same as `options.ariaLabel`). */
  ariaLabel?: string;
}

export interface UseChartistResult {
  /** Give this to the container: `<div ref={containerRef} />`. */
  containerRef: { current: HTMLElement | null };
  /** The chart API once created (null on the server and for the first render). */
  chart: ChartApi | null;
}

export interface ChartistReact<E> {
  ChartistChart: (props: ChartistChartProps) => E;
  useChartist: (props: ChartProps) => UseChartistResult;
}

export const DEFAULT_REACT_HEIGHT = 360;

function mergeAriaLabel(options: ChartOptionsInput | undefined, ariaLabel: string | undefined): ChartOptionsInput | undefined {
  return ariaLabel === undefined ? options : { ...options, ariaLabel };
}

/** Build the component and the hook from your React. Call it once, at module level. */
export function createChartistReact<E>(React: ReactLike<E>): ChartistReact<E> {
  function useChartist(props: ChartProps): UseChartistResult {
    const containerRef = React.useRef<HTMLElement | null>(null);
    const controllerRef = React.useRef<ChartController | null>(null);
    const latest = React.useRef(props);
    latest.current = props;
    const [chart, setChart] = React.useState<ChartApi | null>(null);

    // Create on mount, remove on unmount. StrictMode runs this twice (create, remove, create): each pass is complete.
    React.useEffect(() => {
      const el = containerRef.current;
      if (!el) return undefined;
      const controller = new ChartController(el, latest.current);
      controllerRef.current = controller;
      setChart(controller.chart);
      return (): void => {
        controller.destroy();
        if (controllerRef.current === controller) controllerRef.current = null;
      };
    }, []);

    // After every render: apply what changed (a no-op when nothing did).
    React.useEffect(() => {
      controllerRef.current?.apply(props);
    });

    return { containerRef, chart };
  }

  function ChartistChart(props: ChartistChartProps): E {
    const { className, style, height, ariaLabel, options, series, onReady, onCrosshairMove } = props;
    const { containerRef } = useChartist({ options: mergeAriaLabel(options, ariaLabel), series, onReady, onCrosshairMove });
    const css = { position: 'relative', width: '100%', height: height ?? DEFAULT_REACT_HEIGHT, ...style };
    return React.createElement('div', { ref: containerRef, className, style: css });
  }

  return { ChartistChart, useChartist };
}

export type { MouseEventParams };
export type { SeriesSpec as ChartistSeries };
