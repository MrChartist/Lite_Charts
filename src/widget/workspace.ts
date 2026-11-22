// The workspace as JSON: what `save()` returns and `load()` / `persist` read. Versioned; older versions are migrated,
// anything malformed is dropped field by field (a bad saved state never breaks a page). Pure.

import type { IndicatorSpec } from '../indicators/catalog';
import type { IndicatorState, OutputStyle, SymbolInfo, WidgetSettings, WorkspaceJSON } from './types';
import { normalizeInterval } from './intervals';

export const WORKSPACE_FORMAT = 'chartist-lite-workspace';
export const WORKSPACE_VERSION = 2;

export function defaultSettings(): WidgetSettings {
  return { grid: true, vertGrid: false, crosshair: 'normal', scaleMode: 'linear', autoScale: true, volume: true, sessionBreaks: false, tooltip: 'off', watermark: false };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const oneOf = <T extends string>(v: unknown, list: readonly T[], def: T): T => (list.includes(v as T) ? (v as T) : def);

/** Indicator params checked against the spec's inputs: unknown keys dropped, values clamped; issues say what changed. */
export function validateParams(spec: Pick<IndicatorSpec, 'inputs'>, raw: unknown): { params: Record<string, number | string | boolean>; issues: string[] } {
  const given = isObj(raw) ? raw : {};
  const params: Record<string, number | string | boolean> = {};
  const issues: string[] = [];
  for (const input of spec.inputs) {
    const v = given[input.key];
    let out: number | string | boolean = input.default;
    if (v === undefined) { params[input.key] = out; continue; }
    if (input.type === 'bool') {
      if (typeof v === 'boolean') out = v; else issues.push(`${input.label}: expected on or off`);
    } else if (input.type === 'select' || input.type === 'source') {
      if (typeof v === 'string' && (input.options ?? []).includes(v)) out = v; else issues.push(`${input.label}: not one of the choices`);
    } else {
      const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
      if (!Number.isFinite(n)) issues.push(`${input.label}: not a number`);
      else {
        let x = input.type === 'int' ? Math.round(n) : n;
        if (input.type === 'int' && x !== n) issues.push(`${input.label}: rounded to ${x}`);
        if (input.min !== undefined && x < input.min) { x = input.min; issues.push(`${input.label}: at least ${input.min}`); }
        if (input.max !== undefined && x > input.max) { x = input.max; issues.push(`${input.label}: at most ${input.max}`); }
        out = x;
      }
    }
    params[input.key] = out;
  }
  for (const k of Object.keys(given)) if (!spec.inputs.some(i => i.key === k)) issues.push(`${k}: unknown input`);
  return { params, issues };
}

function normalizeStyle(v: unknown): Partial<OutputStyle> {
  if (!isObj(v)) return {};
  const s: Partial<OutputStyle> = {};
  if (typeof v.color === 'string' && v.color.length < 64) s.color = v.color;
  if (v.width === 1 || v.width === 2 || v.width === 3 || v.width === 4) s.width = v.width;
  if (typeof v.visible === 'boolean') s.visible = v.visible;
  return s;
}

/** One saved indicator, or null when its id is unknown to `catalog`. */
export function normalizeIndicator(v: unknown, catalog: readonly IndicatorSpec[]): IndicatorState | null {
  if (!isObj(v) || typeof v.id !== 'string') return null;
  const spec = catalog.find(s => s.id === v.id);
  if (!spec) return null;
  const styles: Record<string, Partial<OutputStyle>> = {};
  if (isObj(v.styles)) for (const o of spec.outputs) if (v.styles[o.key]) styles[o.key] = normalizeStyle(v.styles[o.key]);
  return {
    id: spec.id,
    params: validateParams(spec, v.params).params,
    visible: v.visible !== false,
    placement: v.placement === 'overlay' || v.placement === 'pane' ? v.placement : spec.overlay ? 'overlay' : 'pane',
    styles,
  };
}

/**
 * Version 1 (the first preview) kept `studies: [{ name, inputs }]`, `type` for the chart type, `dark: boolean` and a
 * plain symbol string. Bring it to version 2.
 */
export function migrateWorkspace(raw: unknown): Record<string, unknown> | null {
  if (!isObj(raw)) return null;
  if (raw.format !== undefined && raw.format !== WORKSPACE_FORMAT) return null;
  const v = typeof raw.version === 'number' ? raw.version : 1;
  if (v > WORKSPACE_VERSION) return null;
  if (v >= 2) return raw;
  const studies = Array.isArray(raw.studies) ? raw.studies : [];
  return {
    format: WORKSPACE_FORMAT,
    version: 2,
    symbol: typeof raw.symbol === 'string' ? { symbol: raw.symbol } : raw.symbol,
    interval: raw.interval,
    chartType: raw.type ?? raw.chartType,
    theme: raw.dark === true ? 'dark' : raw.dark === false ? 'light' : raw.theme,
    timeZone: raw.timeZone,
    indicators: studies.map(s => (isObj(s) ? { id: String(s.name ?? '').toLowerCase(), params: s.inputs, visible: s.hidden !== true } : null)),
    compare: raw.compare,
    settings: raw.settings,
    drawings: raw.drawings,
  };
}

/** Read any saved workspace (object or JSON text) into a complete one, or null when it is not a workspace. */
export function readWorkspace(input: unknown, catalog: readonly IndicatorSpec[], base: WorkspaceJSON): WorkspaceJSON | null {
  let raw = input;
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { return null; } }
  const m = migrateWorkspace(raw);
  if (!m) return null;
  const sym = isObj(m.symbol) && typeof m.symbol.symbol === 'string' && m.symbol.symbol ? m.symbol as unknown as SymbolInfo : base.symbol;
  const settings = { ...base.settings };
  if (isObj(m.settings)) {
    const s = m.settings;
    const d = defaultSettings();
    for (const k of ['grid', 'vertGrid', 'autoScale', 'volume', 'sessionBreaks', 'watermark'] as const) if (typeof s[k] === 'boolean') settings[k] = s[k] as boolean;
    settings.crosshair = oneOf(s.crosshair, ['normal', 'magnet', 'hidden'] as const, d.crosshair);
    settings.scaleMode = oneOf(s.scaleMode, ['linear', 'log', 'percent'] as const, d.scaleMode);
    settings.tooltip = oneOf(s.tooltip, ['off', 'floating', 'tracking', 'magnifier'] as const, d.tooltip);
  }
  return {
    format: WORKSPACE_FORMAT,
    version: WORKSPACE_VERSION,
    symbol: { symbol: String(sym.symbol).slice(0, 64), ...(typeof sym.description === 'string' ? { description: sym.description.slice(0, 120) } : {}), ...(typeof sym.exchange === 'string' ? { exchange: sym.exchange.slice(0, 40) } : {}) },
    interval: (typeof m.interval === 'string' && normalizeInterval(m.interval)) || base.interval,
    chartType: typeof m.chartType === 'string' && m.chartType ? m.chartType : base.chartType,
    theme: oneOf(m.theme, ['light', 'dark', 'auto'] as const, base.theme),
    timeZone: typeof m.timeZone === 'string' && m.timeZone ? m.timeZone : base.timeZone,
    indicators: Array.isArray(m.indicators) ? m.indicators.map(i => normalizeIndicator(i, catalog)).filter((x): x is IndicatorState => !!x).slice(0, 32) : [],
    compare: Array.isArray(m.compare) ? m.compare.filter((x): x is string => typeof x === 'string').slice(0, 8) : [],
    settings,
    drawings: typeof m.drawings === 'string' ? m.drawings : null,
    ...(typeof m.drawingsOpen === 'boolean' ? { drawingsOpen: m.drawingsOpen } : {}),
  };
}
