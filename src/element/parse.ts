// Pure parsing for the element: attributes, CSV and JSON rows. No DOM, so it runs (and is tested) in Node.

import type { ThemeName } from '../core/options';
import { isSeriesTypeName, seriesShape } from './series-map';
import type { RowShape, SeriesTypeName } from './series-map';

export type Row = Record<string, unknown> & { time: unknown };

export interface ElementConfig {
  type: SeriesTypeName;
  theme: ThemeName;
  /** A CSS length, already validated. */
  height: string;
  /** null leaves the chart default (UTC). */
  timeZone: string | null;
  volume: boolean;
  attribution: boolean;
  ariaLabel: string | null;
}

export const DEFAULT_HEIGHT = '360px';
const LENGTH_RE = /^\d+(?:\.\d+)?(?:px|vh|svh|dvh|em|rem|%)?$/;
const FALSE_WORDS = new Set(['false', '0', 'off', 'no', 'hidden']);

/** Boolean attribute: absent = fallback, empty or any word except false/0/off/no/hidden = true. */
export function parseBoolAttr(value: string | null, fallback: boolean): boolean {
  if (value === null) return fallback;
  return !FALSE_WORDS.has(value.trim().toLowerCase());
}

export function parseHeight(value: string | null): { height: string; issue?: string } {
  if (value === null || value.trim() === '') return { height: DEFAULT_HEIGHT };
  const v = value.trim();
  if (!LENGTH_RE.test(v)) return { height: DEFAULT_HEIGHT, issue: `height "${value}" is not a number or a CSS length such as 360, 50vh or 24rem` };
  return { height: /^\d+(?:\.\d+)?$/.test(v) ? `${v}px` : v };
}

/** Read the element's settings from its attributes. `issues` lists values that were ignored, in plain words. */
export function parseElementConfig(get: (name: string) => string | null): { config: ElementConfig; issues: string[] } {
  const issues: string[] = [];
  const rawType = get('type');
  let type: SeriesTypeName = 'candlestick';
  if (rawType !== null && rawType.trim() !== '') {
    const t = rawType.trim().toLowerCase();
    if (isSeriesTypeName(t)) type = t;
    else issues.push(`type "${rawType}" is not one of candlestick, line, area, bar, histogram, baseline`);
  }
  const rawTheme = get('theme');
  let theme: ThemeName = 'auto';
  if (rawTheme !== null && rawTheme.trim() !== '') {
    const t = rawTheme.trim().toLowerCase();
    if (t === 'light' || t === 'dark' || t === 'auto') theme = t;
    else issues.push(`theme "${rawTheme}" is not light, dark or auto`);
  }
  const h = parseHeight(get('height'));
  if (h.issue) issues.push(h.issue);
  const tz = get('time-zone');
  return {
    config: {
      type, theme, height: h.height,
      timeZone: tz !== null && tz.trim() !== '' ? tz.trim() : null,
      volume: parseBoolAttr(get('volume'), false),
      attribution: parseBoolAttr(get('attribution'), true),
      ariaLabel: get('aria-label'),
    },
    issues,
  };
}

// ── rows ──

const ALIASES: Readonly<Record<string, string>> = {
  time: 'time', date: 'time', datetime: 'time', timestamp: 'time', t: 'time',
  open: 'open', o: 'open', high: 'high', h: 'high', low: 'low', l: 'low', close: 'close', c: 'close',
  volume: 'volume', vol: 'volume', v: 'volume', value: 'value',
};

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;
const NUMBER_RE = /^-?\d+(?:\.\d+)?$/;

/** A time as the chart takes it: UNIX seconds, 'YYYY-MM-DD', or a business-day object (passed through). */
export function parseTime(value: unknown, where = 'row'): unknown {
  if (typeof value === 'number') return value > 1e11 ? Math.floor(value / 1000) : value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') throw new TypeError(`Chartist Lite: ${where}: missing time`);
  const s = value.trim();
  if (DATE_ONLY_RE.test(s)) return s;
  if (NUMBER_RE.test(s)) return parseTime(Number(s), where);
  const ms = Date.parse(DATE_TIME_RE.test(s) ? `${s.replace(' ', 'T')}Z` : s);
  if (Number.isNaN(ms)) throw new TypeError(`Chartist Lite: ${where}: cannot read the time "${value}"; use YYYY-MM-DD, an ISO date and time, or UNIX seconds`);
  return Math.floor(ms / 1000);
}

/** Seconds for sorting (date strings read as UTC midnight). */
export function timeKey(time: unknown): number {
  if (typeof time === 'number') return time;
  if (typeof time === 'string') return Date.parse(`${time}T00:00:00Z`) / 1000;
  const b = time as { year: number; month: number; day: number };
  return Date.UTC(b.year, b.month - 1, b.day) / 1000;
}

function parseNumber(cell: unknown, field: string, where: string): number | undefined {
  if (cell === undefined || cell === null) return undefined;
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : undefined;
  const s = String(cell).trim();
  if (s === '') return undefined;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new TypeError(`Chartist Lite: ${where}: ${field} "${s}" is not a number`);
  return n;
}

/** Split CSV text into records. Quoted fields, doubled quotes, comma, semicolon or tab delimiters, CRLF, BOM. */
export function splitCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const firstLine = src.slice(0, Math.max(0, src.search(/\r|\n/)) || src.length);
  const delim = [',', ';', '\t'].reduce((best, d) => (firstLine.split(d).length > firstLine.split(best).length ? d : best), ',');
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let any = false;
  const endRow = (): void => {
    row.push(cell);
    if (row.length > 1 || row[0].trim() !== '') out.push(row);
    row = []; cell = ''; any = false;
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') { quoted = true; any = true; }
    else if (ch === delim) { row.push(cell); cell = ''; any = true; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      endRow();
    } else { cell += ch; any = true; }
  }
  if (any || cell !== '' || row.length) endRow();
  return out;
}

function canonicalizeKeys(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(raw)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const canon = ALIASES[key.trim().toLowerCase()] ?? key;
    if (!(canon in out) || canon === key) out[canon] = raw[key];
  }
  return out;
}

/** Rows from an array of objects (JSON, or the `.data` property): keys are renamed to the canonical names, times parsed. */
export function canonicalRows(input: unknown): Row[] {
  if (!Array.isArray(input)) throw new TypeError('Chartist Lite: data must be an array of rows');
  return input.map((item, i) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError(`Chartist Lite: row ${i + 1} is not an object`);
    const r = canonicalizeKeys(item as Record<string, unknown>);
    r.time = parseTime(r.time, `row ${i + 1}`);
    return r as Row;
  });
}

function rowsFromCsv(text: string): Row[] {
  const records = splitCsv(text);
  if (records.length === 0) return [];
  const header = records[0].map(h => ALIASES[h.trim().toLowerCase()] ?? h.trim().toLowerCase());
  if (!header.includes('time')) throw new TypeError('Chartist Lite: the CSV needs a header row with a time (or date) column, for example time,open,high,low,close,volume');
  const out: Row[] = [];
  for (let r = 1; r < records.length; r++) {
    const rec = records[r];
    const obj: Record<string, unknown> = {};
    header.forEach((name, c) => {
      const cell = rec[c];
      if (cell !== undefined && cell.trim() !== '') obj[name] = cell.trim();
    });
    obj.time = parseTime(obj.time, `CSV line ${r + 1}`);
    out.push(obj as Row);
  }
  return out;
}

/** Rows from a fetched or inline text: JSON (an array, or an object holding `data` or `rows`) or CSV. */
export function parseRows(text: string): Row[] {
  const trimmed = text.replace(/^﻿/, '').trim();
  if (trimmed === '') return [];
  if (trimmed[0] === '[' || trimmed[0] === '{') {
    let json: unknown;
    try { json = JSON.parse(trimmed); } catch (e) { throw new SyntaxError(`Chartist Lite: the data is not valid JSON (${(e as Error).message})`); }
    if (!Array.isArray(json) && json && typeof json === 'object') {
      const o = json as Record<string, unknown>;
      json = Array.isArray(o.data) ? o.data : o.rows;
    }
    return canonicalRows(json);
  }
  return rowsFromCsv(trimmed);
}

/** Sorted by time (stable). Returns the same array when it already is. */
export function sortRows<T extends { time: unknown }>(rows: T[]): T[] {
  let sorted = true;
  for (let i = 1; i < rows.length && sorted; i++) if (timeKey(rows[i].time) < timeKey(rows[i - 1].time)) sorted = false;
  if (sorted) return rows;
  return rows.map((row, i) => ({ row, i, k: timeKey(row.time) })).sort((a, b) => a.k - b.k || a.i - b.i).map(x => x.row);
}

/** Rows in the shape a series type reads. A row with no usable numbers becomes a whitespace row `{ time }`. */
export function shapeRows(rows: readonly Row[], shape: RowShape, type?: SeriesTypeName): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const where = `row ${i + 1}`;
    if (shape === 'value') {
      const v = parseNumber(r.value ?? r.close, 'value', where);
      out.push(v === undefined ? { time: r.time } : { time: r.time, value: v });
    } else {
      const o = parseNumber(r.open, 'open', where);
      const h = parseNumber(r.high, 'high', where);
      const l = parseNumber(r.low, 'low', where);
      const c = parseNumber(r.close, 'close', where);
      if (o === undefined && h === undefined && l === undefined && c === undefined && r.value === undefined) {
        out.push({ time: r.time });
      } else if (o === undefined || h === undefined || l === undefined || c === undefined) {
        throw new TypeError(`Chartist Lite: ${where}: ${type ?? 'this'} data needs open, high, low and close; use type="line" for a single value per row`);
      } else out.push({ time: r.time, open: o, high: h, low: l, close: c });
    }
  }
  return out;
}

/** Shape rows for a named type. */
export function shapeRowsForType(rows: readonly Row[], type: SeriesTypeName): Record<string, unknown>[] {
  return shapeRows(rows, seriesShape(type), type);
}

/** Volume column as histogram rows; rows without a volume are whitespace. */
export function volumeRows(rows: readonly Row[]): Record<string, unknown>[] {
  return rows.map((r, i) => {
    const v = parseNumber(r.volume, 'volume', `row ${i + 1}`);
    return v === undefined ? { time: r.time } : { time: r.time, value: v };
  });
}
