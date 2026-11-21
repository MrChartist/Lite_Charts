// Pure helpers for the React wrapper: decide what changed between two renders, so the chart is updated in place
// and never rebuilt for a new data array. No DOM, no React.

/** Plain-object and array deep equality (numbers by `Object.is`; functions and class instances by reference). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const pa = Object.getPrototypeOf(a);
  if ((pa !== Object.prototype && pa !== null) || Object.getPrototypeOf(b) !== pa) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

export type DataChange<R> =
  /** Nothing to do. */
  | { kind: 'same' }
  /** Same rows up to the old last bar: send these rows (the old last bar, then newer ones) to `update`. */
  | { kind: 'update'; rows: readonly R[] }
  /** Anything else: `setData` with the new array. */
  | { kind: 'set' };

/** A burst of appended bars larger than this is sent as one `setData`. */
export const MAX_TAIL_UPDATES = 64;

/**
 * Compare the previous and next rows of one series. A new array with the same rows is `same`; the last bar changed
 * and/or a few bars appended is `update`; a change anywhere earlier, a shorter array or a long append is `set`.
 */
export function diffData<R extends { time: unknown }>(prev: readonly R[] | undefined, next: readonly R[] | undefined): DataChange<R> {
  const a = prev ?? [];
  const b = next ?? [];
  if (a === b) return { kind: 'same' };
  if (a.length === 0) return b.length === 0 ? { kind: 'same' } : { kind: 'set' };
  if (b.length < a.length || b.length - a.length > MAX_TAIL_UPDATES) return { kind: 'set' };
  const last = a.length - 1;
  for (let i = 0; i < last; i++) if (a[i] !== b[i] && !deepEqual(a[i], b[i])) return { kind: 'set' };
  if (b.length === a.length && (a[last] === b[last] || deepEqual(a[last], b[last]))) return { kind: 'same' };
  // The last old bar must keep its time, or `update` would append instead of replace.
  if (!deepEqual(a[last].time, b[last].time)) return { kind: 'set' };
  return { kind: 'update', rows: b.slice(last) };
}

export interface KeyedSeries { key: string; type: unknown }

export interface SeriesPlan {
  /** Keys to add, in the order given. */
  add: string[];
  /** Keys to remove. */
  remove: string[];
  /** Keys that stay (same key and type). */
  keep: string[];
}

/** Which series to add, remove or keep, by key; a changed type is a remove plus an add. */
export function planSeries(prev: readonly KeyedSeries[], next: readonly KeyedSeries[]): SeriesPlan {
  const before = new Map(prev.map(s => [s.key, s.type]));
  const after = new Map(next.map(s => [s.key, s.type]));
  const plan: SeriesPlan = { add: [], remove: [], keep: [] };
  for (const [key, type] of before) if (!after.has(key) || after.get(key) !== type) plan.remove.push(key);
  for (const [key, type] of after) {
    if (before.has(key) && before.get(key) === type) plan.keep.push(key);
    else plan.add.push(key);
  }
  return plan;
}

/** The key of series `index`: its `id` when given, else its position. */
export function seriesKey(id: string | undefined, index: number): string {
  return id !== undefined && id !== '' ? `id:${id}` : `#${index}`;
}
