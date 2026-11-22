// Pivot points from the previous completed period.
//
//   pivotPoints(rows, { kind = 'classic', period = 'auto', zone = 'UTC' }?)
//     -> { pp, r1, r2, r3, r4, s1, s2, s3, s4 }
//
// Floor-trader levels from the high H, low L and last close C of the previous period, held flat on every bar of the
// current one (no look-ahead: a bar never reads its own period). Kinds:
//   classic    PP = (H+L+C)/3, R1 = 2PP-L, S1 = 2PP-H, R2 = PP+(H-L), S2 = PP-(H-L), R3 = 2PP+(H-2L), S3 = 2PP-(2H-L)
//   fibonacci  PP as classic; R/S 1..3 = PP +/- 0.382, 0.618, 1.000 x (H-L)
//   woodie     PP = (H+L+2C)/4; R1 = 2PP-L, S1 = 2PP-H, R2/S2 = PP +/- (H-L), R3 = H+2(PP-L), S3 = L-2(H-PP), R4/S4 = R3/S3 +/- (H-L)
//   camarilla  PP as classic; R/S 1..4 = C +/- 1.1 (H-L) / 12, 6, 4, 2
// `r4` / `s4` exist for woodie and camarilla only. `period` is 'auto' (see `LevelOptions`), 'day', 'week', 'month' or
// 'year'; `zone` defines a day for numeric times. No value until one period has completed. Needs candlestick rows.

import { levelInput } from './levels';
import type { LevelOptions } from './levels';
import { stepped } from './period';
import type { Hlc3 } from './period';
import { points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';
import { nanArray } from './series';

export type PivotKind = 'classic' | 'fibonacci' | 'woodie' | 'camarilla';
export const PIVOT_KINDS: PivotKind[] = ['classic', 'fibonacci', 'woodie', 'camarilla'];

export interface PivotPointsOptions extends LevelOptions {
  kind?: PivotKind;
}

export type PivotLevelKey = 'pp' | 'r1' | 'r2' | 'r3' | 'r4' | 's1' | 's2' | 's3' | 's4';
export type PivotPointsResult = Record<PivotLevelKey, IndicatorPoint[]>;
const KEYS: PivotLevelKey[] = ['pp', 'r1', 'r2', 'r3', 'r4', 's1', 's2', 's3', 's4'];

function levelsFor(kind: string, h: Hlc3): Partial<Record<PivotLevelKey, number>> {
  const { high: H, low: L, close: C } = h;
  const range = H - L;
  switch (kind) {
    case 'fibonacci': {
      const pp = (H + L + C) / 3;
      return { pp, r1: pp + 0.382 * range, r2: pp + 0.618 * range, r3: pp + range, s1: pp - 0.382 * range, s2: pp - 0.618 * range, s3: pp - range };
    }
    case 'woodie': {
      const pp = (H + L + 2 * C) / 4;
      const r3 = H + 2 * (pp - L), s3 = L - 2 * (H - pp);
      return { pp, r1: 2 * pp - L, r2: pp + range, r3, r4: r3 + range, s1: 2 * pp - H, s2: pp - range, s3, s4: s3 - range };
    }
    case 'camarilla': {
      const pp = (H + L + C) / 3;
      const k = range * 1.1;
      return { pp, r1: C + k / 12, r2: C + k / 6, r3: C + k / 4, r4: C + k / 2, s1: C - k / 12, s2: C - k / 6, s3: C - k / 4, s4: C - k / 2 };
    }
    default: {
      const pp = (H + L + C) / 3;
      return { pp, r1: 2 * pp - L, r2: pp + range, r3: 2 * pp + (H - 2 * L), s1: 2 * pp - H, s2: pp - range, s3: 2 * pp - (2 * H - L) };
    }
  }
}

export function pivotPoints(rows: readonly IndicatorRow[], options: PivotPointsOptions = {}): PivotPointsResult {
  const n = rows.length;
  const kind = (PIVOT_KINDS as string[]).includes(options.kind ?? '') ? (options.kind as PivotKind) : 'classic';
  const { keys, hi, lo, cl } = levelInput(rows, options);
  const per = stepped(keys, hi, lo, cl, h => levelsFor(kind, h));
  const out = {} as PivotPointsResult;
  for (const k of KEYS) {
    const a = nanArray(n);
    for (let i = 0; i < n; i++) { const v = per[i]; if (v && v[k] !== undefined) a[i] = v[k] as number; }
    out[k] = points(rows, a, null);
  }
  return out;
}
