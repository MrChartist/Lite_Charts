// Relative volume.
//
//   relativeVolume(rows, { period = 10, mode = 'cumulative', zone = 'UTC' }?) -> IndicatorPoint[]
//
// How busy a bar is against recent history.
//  - Intraday rows (two neighbouring bars on one calendar day in `zone`): sessions are calendar days in the zone and bars are
//    matched across days by minute of day. 'cumulative' (default) divides the volume traded since the session open up to
//    this bar by the average of the same cumulative figure at the same minute over the previous `period` sessions;
//    'regular' divides this bar's volume by the average volume of the bar at the same minute. The current session is never
//    part of its own baseline. Sessions that cannot answer (opened after / ended before that minute, or no bar at that exact
//    minute in 'regular') are skipped, up to 4 x `period` sessions back; fewer than `period` usable sessions gives no value.
//  - Daily and higher rows: volume / the mean volume of the PREVIOUS `period` bars (this bar excluded); first value on bar
//    `period`.
// A baseline of 0 has no value. Numeric times are read in `zone`. Needs rows with volume.

import { rawCol } from './cols';
import { daysOf, isIntraday, secondsOf } from './period';
import { points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';
import { len, nanArray } from './series';
import { safeZone } from './time-util';
import { zoneMinuteOfDay } from '../core/zone';

export interface RelativeVolumeOptions {
  period?: number;
  mode?: 'cumulative' | 'regular';
  zone?: string;
}

interface Session { indices: number[]; minutes: number[]; volumes: number[]; cumulative: number[] }

function lastAtOrBefore(sorted: readonly number[], t: number): number {
  let lo = 0, hi = sorted.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

const ratio = (value: number, baseline: number): number => (baseline > 0 ? value / baseline : NaN);

export function relativeVolume(rows: readonly IndicatorRow[], options: RelativeVolumeOptions = {}): IndicatorPoint[] {
  const n = rows.length;
  const length = len(options.period, 10);
  const mode = options.mode === 'regular' ? 'regular' : 'cumulative';
  const zone = safeZone(options.zone ?? 'UTC');
  const secs = secondsOf(rows), days = daysOf(rows, zone, secs);
  const vol = rawCol(rows, r => r.volume as number);
  const out = nanArray(n);
  if (n && !isIntraday(days)) {
    let sum = 0, bad = 0;
    for (let i = 0; i < n; i++) {
      const baseline = i >= length && bad === 0 ? sum / length : NaN;
      const value = vol[i];
      if (Number.isFinite(vol[i])) sum += vol[i]; else bad++;
      if (i >= length) { if (Number.isFinite(vol[i - length])) sum -= vol[i - length]; else bad--; }
      if (Number.isFinite(value)) out[i] = ratio(value, baseline);
    }
    return points(rows, out, null);
  }
  const sessions: Session[] = [];
  let key = NaN, cur: Session | null = null;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(days[i])) continue;
    if (cur === null || days[i] !== key) { cur = { indices: [], minutes: [], volumes: [], cumulative: [] }; sessions.push(cur); key = days[i]; }
    const v = Number.isFinite(vol[i]) ? vol[i] : NaN;
    const prev = cur.cumulative.length ? cur.cumulative[cur.cumulative.length - 1] : 0;
    cur.indices.push(i);
    cur.minutes.push(typeof rows[i].time === 'number' ? zoneMinuteOfDay(zone, secs[i] * 1000) : 0);
    cur.volumes.push(v);
    cur.cumulative.push(prev + (Number.isNaN(v) ? 0 : v));
  }
  const maxWalk = 4 * length;
  const at = (s: Session, t: number): number => {
    if (mode === 'cumulative') {
      if (!s.minutes.length || s.minutes[0] > t || s.minutes[s.minutes.length - 1] < t) return NaN;
      const pos = lastAtOrBefore(s.minutes, t);
      return pos < 0 ? NaN : s.cumulative[pos];
    }
    const pos = lastAtOrBefore(s.minutes, t);
    return pos < 0 || s.minutes[pos] !== t ? NaN : s.volumes[pos];
  };
  sessions.forEach((s, si) => {
    for (let k = 0; k < s.minutes.length; k++) {
      const t = s.minutes[k];
      const value = mode === 'cumulative' ? s.cumulative[k] : s.volumes[k];
      let total = 0, used = 0;
      for (let back = 1; back <= maxWalk && si - back >= 0 && used < length; back++) {
        const v = at(sessions[si - back], t);
        if (Number.isNaN(v)) continue;
        total += v;
        used++;
      }
      if (!Number.isNaN(value) && used === length) out[s.indices[k]] = ratio(value, total / length);
    }
  });
  return points(rows, out, null);
}
