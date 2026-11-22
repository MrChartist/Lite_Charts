// Chart types the widget offers. With the transforms entry (`CHART_TYPES` + `applyChartType`) every type it knows is
// offered; without it, the five core series. `resolveChartType` turns raw bars into a series definition, its data and
// its options either way.

import { AreaSeries } from '../series/area';
import { BarSeries } from '../series/bar';
import { BaselineSeries } from '../series/baseline';
import { CandlestickSeries } from '../series/candlestick';
import { LineSeries } from '../series/line';
import type { AnySeriesDefinition } from '../api';
import type { ChartTypeInfo, WidgetBar } from './types';

export const CORE_CHART_TYPES: readonly ChartTypeInfo[] = [
  { id: 'candles', name: 'Candles', kind: 'series' },
  { id: 'bars', name: 'Bars', kind: 'series' },
  { id: 'line', name: 'Line', kind: 'series' },
  { id: 'area', name: 'Area', kind: 'series' },
  { id: 'baseline', name: 'Baseline', kind: 'series' },
];

/** Icon for a chart type id (known ids get their glyph; others a candle). */
export function chartTypeIcon(id: string): string {
  const k = id.toLowerCase().replace(/[^a-z]/g, '');
  if (k.includes('hollow')) return 'hollow';
  if (k.includes('heikin')) return 'heikin';
  if (k.includes('renko')) return 'renko';
  if (k.includes('kagi')) return 'kagi';
  if (k.includes('point') || k === 'pnf') return 'pnf';
  if (k.includes('break')) return 'linebreak';
  if (k.includes('range')) return 'range';
  if (k.includes('step')) return 'step';
  if (k.includes('hlc')) return 'hlc';
  if (k.includes('column')) return 'columns';
  if (k.includes('baseline')) return 'baseline';
  if (k.includes('area')) return 'area';
  if (k.includes('line')) return 'line';
  if (k.includes('bar') || k === 'ohlc') return 'bars';
  return 'candles';
}

type Apply = (id: string, rows: readonly WidgetBar[], options?: Record<string, unknown>) => { definition: AnySeriesDefinition; data: readonly unknown[]; options?: Record<string, unknown> };

export interface TransformsLike { CHART_TYPES?: readonly ChartTypeInfo[]; applyChartType?: unknown }

/** The list to offer. */
export function chartTypeList(t: TransformsLike | null | undefined): readonly ChartTypeInfo[] {
  const list = t && Array.isArray(t.CHART_TYPES) ? t.CHART_TYPES.filter(x => x && typeof x.id === 'string' && typeof x.name === 'string') : [];
  return list.length ? list : CORE_CHART_TYPES;
}

function core(id: string, rows: readonly WidgetBar[]): { definition: AnySeriesDefinition; data: readonly unknown[]; options?: Record<string, unknown> } {
  const value = (): unknown[] => rows.map(r => ({ time: r.time, value: r.close }));
  switch (id) {
    case 'bars': return { definition: BarSeries, data: rows };
    case 'line': return { definition: LineSeries, data: value() };
    case 'area': return { definition: AreaSeries, data: value() };
    case 'baseline': {
      const base = rows.length ? rows[Math.max(0, rows.length - 200)].close : 0;
      return { definition: BaselineSeries, data: value(), options: { baseValue: base } };
    }
    default: return { definition: CandlestickSeries, data: rows };
  }
}

/** Series definition, data and options for chart type `id` (falls back to candles when the type is unknown or fails). */
export function resolveChartType(id: string, rows: readonly WidgetBar[], t: TransformsLike | null | undefined): { definition: AnySeriesDefinition; data: readonly unknown[]; options?: Record<string, unknown>; transformed: boolean } {
  const apply = t && typeof t.applyChartType === 'function' ? t.applyChartType as Apply : null;
  if (apply && chartTypeList(t).some(c => c.id === id)) {
    try {
      const r = apply(id, rows, {});
      if (r && r.definition && Array.isArray(r.data)) return { ...r, transformed: (chartTypeList(t).find(c => c.id === id)?.kind ?? 'series') === 'transform' };
    } catch { /* fall through to the core types */ }
  }
  return { ...core(CORE_CHART_TYPES.some(c => c.id === id) ? id : 'candles', rows), transformed: false };
}
