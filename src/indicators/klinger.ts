// Klinger volume oscillator.
//
//   klinger(rows, { fast = 34, slow = 55, signal = 13 }?) -> { kvo, signal }
//
// Signed volume sv = +volume when the typical price (high + low + close) / 3 rose or held, -volume when it fell;
// kvo = EMA(sv, fast) - EMA(sv, slow); signal = EMA(kvo, signal). First kvo on bar `slow`, signal `signal - 1` bars later. A
// bad bar breaks the EMAs (they seed again). Needs candlestick rows with volume. Guide: 0.

import { rawCol } from './cols';
import { points } from './shared';
import type { IndicatorPoint, IndicatorRow } from './shared';
import { emaN, len, nanArray } from './series';

export interface KlingerOptions {
  fast?: number;
  slow?: number;
  signal?: number;
}

export interface KlingerResult {
  kvo: IndicatorPoint[];
  signal: IndicatorPoint[];
}

export function klinger(rows: readonly IndicatorRow[], options: KlingerOptions = {}): KlingerResult {
  const h = rawCol(rows, r => r.high as number), l = rawCol(rows, r => r.low as number), c = rawCol(rows, r => r.close as number), v = rawCol(rows, r => r.volume as number);
  const sv = nanArray(c.length);
  for (let i = 1; i < c.length; i++) {
    const change = (h[i] + l[i] + c[i]) / 3 - (h[i - 1] + l[i - 1] + c[i - 1]) / 3;
    if (Number.isFinite(change) && Number.isFinite(v[i])) sv[i] = change >= 0 ? v[i] : -v[i];
  }
  const f = emaN(sv, len(options.fast, 34)), s = emaN(sv, len(options.slow, 55));
  const kvo = f.map((x, i) => x - s[i]);
  return { kvo: points(rows, kvo, null), signal: points(rows, emaN(kvo, len(options.signal, 13)), null) };
}
