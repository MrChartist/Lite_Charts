// The chart lifecycle behind the React wrapper, with no React in it: create once, then apply each new set of props
// as the smallest change (options, series added or removed, rows replaced or appended). Testable in Node with a
// fake `createChart`.

import { createChart as realCreateChart } from '../index';
import type { AnySeriesDefinition, ChartApi, MouseEventHandler, MouseEventParams, SeriesApi } from '../api';
import type { ChartOptions, DeepPartial } from '../core/options';
import { resolveSeriesDefinition } from '../element/series-map';
import type { SeriesTypeName } from '../element/series-map';
import { isSeriesTypeName } from '../element/series-map';
import { deepEqual, diffData, planSeries, seriesKey } from './diff';

export type ChartOptionsInput = DeepPartial<ChartOptions> & { attribution?: boolean | DeepPartial<ChartOptions['attribution']> };

/** One input row: a time plus the fields of its series type (index signature `any` so interface-typed rows fit). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SeriesRow = { time: unknown; [field: string]: any };

export interface SeriesSpec {
  /** Keeps the series when the list is reordered; defaults to the position in the list. */
  id?: string;
  /** A type name, or a series definition from the core (`CandlestickSeries`). */
  type: SeriesTypeName | AnySeriesDefinition;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: readonly SeriesRow[];
  options?: Record<string, unknown>;
}

export interface ChartProps {
  options?: ChartOptionsInput;
  series?: readonly SeriesSpec[];
  onReady?: (chart: ChartApi) => void;
  onCrosshairMove?: (params: MouseEventParams) => void;
}

export interface ControllerDeps {
  createChart: (container: HTMLElement, options?: ChartOptionsInput) => ChartApi;
}

interface Live {
  spec: SeriesSpec;
  def: AnySeriesDefinition;
  api: SeriesApi<AnySeriesDefinition>;
}

function definitionOf(type: SeriesSpec['type']): AnySeriesDefinition {
  if (typeof type === 'string') {
    if (!isSeriesTypeName(type)) throw new TypeError(`Chartist Lite: unknown series type "${type}"`);
    const def = resolveSeriesDefinition(type);
    if (!def) throw new Error(`Chartist Lite: series type "${type}" is not available in this build`);
    return def;
  }
  return type;
}

export class ChartController {
  readonly chart: ChartApi;
  private live = new Map<string, Live>();
  private order: string[] = [];
  private options: ChartOptionsInput | undefined;
  private props: ChartProps;
  private destroyed = false;
  private readonly crosshair: MouseEventHandler;

  constructor(container: HTMLElement, props: ChartProps, deps: ControllerDeps = { createChart: realCreateChart }) {
    this.props = props;
    this.options = props.options;
    this.chart = deps.createChart(container, props.options);
    this.crosshair = (p): void => { this.props.onCrosshairMove?.(p); };
    this.chart.subscribeCrosshairMove(this.crosshair);
    this.syncSeries(props.series ?? []);
    // After the commit: under StrictMode the first chart is destroyed before this runs, and is never announced.
    void Promise.resolve().then(() => {
      if (!this.destroyed) this.props.onReady?.(this.chart);
    });
  }

  /** Apply the props of a new render. Cheap when nothing changed. */
  apply(props: ChartProps): void {
    if (this.destroyed) return;
    this.props = props;
    if (props.options !== this.options && !deepEqual(props.options, this.options)) {
      this.options = props.options;
      if (props.options) this.chart.applyOptions(props.options);
    }
    this.syncSeries(props.series ?? []);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.chart.unsubscribeCrosshairMove(this.crosshair);
    this.live.clear();
    this.chart.remove();
  }

  private syncSeries(specs: readonly SeriesSpec[]): void {
    const defs = specs.map(s => definitionOf(s.type));
    const keys = specs.map((s, i) => seriesKey(s.id, i));
    const prev = this.order.map(k => ({ key: k, type: (this.live.get(k) as Live).def }));
    const next = keys.map((k, i) => ({ key: k, type: defs[i] }));
    const plan = planSeries(prev, next);
    for (const key of plan.remove) {
      this.chart.removeSeries((this.live.get(key) as Live).api);
      this.live.delete(key);
    }
    keys.forEach((key, i) => {
      const spec = specs[i];
      const existing = this.live.get(key);
      if (!existing) {
        const api = this.chart.addSeries(defs[i], spec.options as never);
        if (spec.data && spec.data.length) api.setData(spec.data as never);
        this.live.set(key, { spec, def: defs[i], api });
        return;
      }
      if (spec.options !== existing.spec.options && !deepEqual(spec.options, existing.spec.options) && spec.options) {
        existing.api.applyOptions(spec.options as never);
      }
      const change = diffData(existing.spec.data, spec.data);
      if (change.kind === 'set') existing.api.setData((spec.data ?? []) as never);
      else if (change.kind === 'update') for (const row of change.rows) existing.api.update(row as never);
      existing.spec = spec;
    });
    this.order = keys;
  }
}
