// The common input of the previous-period studies (pivot points, CPR, previous high / low).

import { ANCHORS, autoAnchor, daysOf, periodKey, secondsOf } from './period';
import type { Anchor } from './period';
import { rawCol } from './cols';
import type { IndicatorRow } from './shared';
import { safeZone } from './time-util';

export interface LevelOptions {
  /** The period the levels come from. 'auto' (default) follows the bar spacing: intraday bars use the previous day,
   *  daily bars the previous week, weekly bars the previous month, monthly bars the previous year. */
  period?: 'auto' | Anchor;
  /** IANA zone that defines a day. Default 'UTC'. */
  zone?: string;
}

export interface LevelInput {
  keys: number[];
  hi: number[];
  lo: number[];
  cl: number[];
}

export function levelInput(rows: readonly IndicatorRow[], o: LevelOptions): LevelInput {
  const secs = secondsOf(rows);
  const days = daysOf(rows, safeZone(o.zone ?? 'UTC'), secs);
  const anchor: Anchor = o.period && (ANCHORS as string[]).includes(o.period) ? (o.period as Anchor) : autoAnchor(secs, days);
  return {
    keys: days.map(d => periodKey(anchor, d)),
    hi: rawCol(rows, r => r.high as number), lo: rawCol(rows, r => r.low as number), cl: rawCol(rows, r => r.close as number),
  };
}
