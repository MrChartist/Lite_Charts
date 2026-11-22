// The registry's types and the small builders every catalog-*.ts file uses. No indicator is imported here.
//
// A spec is data plus one `compute(rows, params)` that adapts the indicator's own signature to a uniform params object.
// `compute` never throws: every param is clamped to its declared range (an unusable value takes the default), and any
// failure inside an indicator gives an aligned set of `{ time }` rows. Every output array has one row per input row.

import type { Time } from '../core/time';
import type { IndicatorPoint, IndicatorRow } from './shared';

export type IndicatorCategory = 'trend' | 'momentum' | 'volatility' | 'volume' | 'other';
export type InputValue = number | string | boolean;
export type IndicatorParams = Record<string, InputValue | undefined>;

export interface IndicatorInput {
  key: string;
  label: string;
  type: 'int' | 'float' | 'source' | 'bool' | 'select';
  default: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
}

/**
 * How one output is drawn. `tone` is a colour role: 'line' is the accent, 'up' / 'down' the rising and falling colours,
 * 'muted' a quiet neutral (bands, guides), a number picks further accents (1 is the second accent, 2 the third...).
 * A 'histogram' is drawn as bars: tone 'line' (the default) colours each bar by its sign ('up' at or above zero, 'down'
 * below), any other tone is one colour. 'band-upper' and 'band-lower' are the two edges of one band, paired in list order
 * (the first upper with the first lower, and so on); 'markers' are isolated values drawn as dots, not joined.
 */
export interface IndicatorOutput {
  key: string;
  label: string;
  kind: 'line' | 'histogram' | 'band-upper' | 'band-lower' | 'markers';
  tone?: 'line' | 'up' | 'down' | 'muted' | number;
}

export type IndicatorResult = Record<string, { time: Time; value?: number }[]>;

export interface IndicatorSpec {
  id: string;
  name: string;
  shortName: string;
  category: IndicatorCategory;
  /** Drawn on the price pane (true) or in a pane of its own (false). */
  overlay: boolean;
  inputs: IndicatorInput[];
  outputs: IndicatorOutput[];
  /** Horizontal reference lines for an oscillator pane (e.g. 30 and 70 for RSI). */
  guides?: number[];
  compute(rows: readonly IndicatorRow[], params?: IndicatorParams): IndicatorResult;
}

/** The values `run` reads: every input present, clamped, of the declared type. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Resolved = Record<string, any>;

interface Def extends Omit<IndicatorSpec, 'compute'> {
  /** An object of output arrays by key (an indicator's own result object is fine). */
  run(rows: readonly IndicatorRow[], v: Resolved): object;
}

export const SOURCES = ['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4'];

export const ZONES = ['UTC', 'America/New_York', 'America/Chicago', 'Europe/London', 'Europe/Berlin', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Hong_Kong', 'Asia/Tokyo', 'Australia/Sydney'];

const num = (x: unknown): number => (typeof x === 'number' ? x : typeof x === 'string' && x.trim() !== '' ? Number(x) : NaN);

/** One param made safe against its input declaration. */
export function resolveInput(input: IndicatorInput, raw: unknown): InputValue {
  switch (input.type) {
    case 'bool': return typeof raw === 'boolean' ? raw : raw === 'true' ? true : raw === 'false' ? false : (input.default as boolean);
    case 'select':
    case 'source': return typeof raw === 'string' && (input.options ?? []).includes(raw) ? raw : (input.default as string);
    default: {
      let v = num(raw);
      if (!Number.isFinite(v)) v = input.default as number;
      if (input.type === 'int') v = Math.floor(v);
      if (input.min !== undefined && v < input.min) v = input.min;
      if (input.max !== undefined && v > input.max) v = input.max;
      return v;
    }
  }
}

export function resolveParams(spec: Pick<IndicatorSpec, 'inputs'>, params: IndicatorParams | undefined): Resolved {
  const out: Resolved = {};
  for (const input of spec.inputs) out[input.key] = resolveInput(input, params ? params[input.key] : undefined);
  return out;
}

const fmt = (n: number): string => String(Math.round(n * 1e6) / 1e6);

/** "RSI 14", "BB 20 2", "MACD 12 26 9": the short name, then the numbers (and any choice) the indicator is set to. */
export function legendLabel(spec: Pick<IndicatorSpec, 'shortName' | 'inputs'>, params?: IndicatorParams): string {
  const v = resolveParams(spec, params);
  const parts = [spec.shortName];
  for (const input of spec.inputs) {
    const x = v[input.key];
    if (input.type === 'int' || input.type === 'float') parts.push(fmt(x as number));
    else if (input.type === 'select') parts.push(String(x));
    else if (input.type === 'source' && x !== input.default) parts.push(String(x));
  }
  return parts.join(' ');
}

const blank = (rows: readonly IndicatorRow[]): IndicatorPoint[] => rows.map(r => ({ time: r ? r.time : (undefined as unknown as Time) }));

export function define(d: Def): IndicatorSpec {
  const { run, ...rest } = d;
  const spec: IndicatorSpec = {
    ...rest,
    compute(rows, params) {
      const list = Array.isArray(rows) ? rows : [];
      let got: Record<string, IndicatorPoint[]> = {};
      try {
        got = (run(list, resolveParams(spec, params)) ?? {}) as Record<string, IndicatorPoint[]>;
      } catch {
        got = {};
      }
      const out: IndicatorResult = {};
      for (const o of spec.outputs) {
        const a = got[o.key];
        out[o.key] = Array.isArray(a) && a.length === list.length ? a : blank(list);
      }
      return out;
    },
  };
  return spec;
}

// Builders for the common inputs and outputs.
export const int = (key: string, label: string, def: number, min = 1, max = 500, step = 1): IndicatorInput => ({ key, label, type: 'int', default: def, min, max, step });
export const flt = (key: string, label: string, def: number, min: number, max: number, step = 0.1): IndicatorInput => ({ key, label, type: 'float', default: def, min, max, step });
export const period = (def: number, label = 'Period', key = 'period', max = 500): IndicatorInput => int(key, label, def, 1, max);
export const source = (def = 'close'): IndicatorInput => ({ key: 'source', label: 'Source', type: 'source', default: def, options: SOURCES });
export const select = (key: string, label: string, def: string, options: string[]): IndicatorInput => ({ key, label, type: 'select', default: def, options });
export const bool = (key: string, label: string, def: boolean): IndicatorInput => ({ key, label, type: 'bool', default: def });
export const line = (key: string, label: string, tone: IndicatorOutput['tone'] = 'line'): IndicatorOutput => ({ key, label, kind: 'line', tone });
export const hist = (key: string, label: string, tone: IndicatorOutput['tone'] = 'line'): IndicatorOutput => ({ key, label, kind: 'histogram', tone });
export const upper = (key: string, label: string): IndicatorOutput => ({ key, label, kind: 'band-upper', tone: 'muted' });
export const lower = (key: string, label: string): IndicatorOutput => ({ key, label, kind: 'band-lower', tone: 'muted' });
export const dots = (key: string, label: string, tone: IndicatorOutput['tone'] = 'line'): IndicatorOutput => ({ key, label, kind: 'markers', tone });
