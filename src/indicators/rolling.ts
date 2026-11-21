// Rolling-window maths shared by bollinger, donchian and stochastic. Inputs must be finite (callers clean them).

/**
 * Monotonic-deque sliding extreme. Per bar, the index of the extreme inside the trailing `span` bars (the LAST one on
 * ties), or -1 until the span has filled.
 */
export function slidingExtremeIndex(values: readonly number[], span: number, mode: 'max' | 'min'): number[] {
  const n = values.length;
  const out: number[] = new Array(n).fill(-1);
  const dq = new Array<number>(n);
  let head = 0, tail = 0;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    while (tail > head && (mode === 'max' ? values[dq[tail - 1]] <= v : values[dq[tail - 1]] >= v)) tail--;
    dq[tail++] = i;
    if (dq[head] <= i - span) head++;
    if (i >= span - 1) out[i] = dq[head];
  }
  return out;
}

/**
 * Rolling mean and population standard deviation (sliding Welford update). A flat window is exactly 0: whenever the
 * running M2 collapses against its recent peak (or every `period` bars) it is recomputed two-pass, so no cancellation
 * residue survives a volatility spike leaving the window. NaN until the window has filled.
 */
export function rollingMeanStd(values: readonly number[], period: number): { mean: number[]; std: number[] } {
  const n = values.length;
  const mean: number[] = new Array(n).fill(NaN);
  const std: number[] = new Array(n).fill(NaN);
  if (period < 1 || period > n) return { mean, std };
  let m = 0, m2 = 0, peak = 0;
  const exact = (end: number): void => {
    let s = 0;
    for (let j = end - period + 1; j <= end; j++) s += values[j];
    m = s / period;
    m2 = 0;
    for (let j = end - period + 1; j <= end; j++) m2 += (values[j] - m) ** 2;
    peak = m2;
  };
  const hiIdx = slidingExtremeIndex(values, period, 'max');
  const loIdx = slidingExtremeIndex(values, period, 'min');
  const flat = (i: number): boolean => {
    const hi = values[hiIdx[i]], lo = values[loIdx[i]];
    return hi - lo <= 1e-12 * Math.max(1, Math.abs(hi), Math.abs(lo));
  };
  exact(period - 1);
  mean[period - 1] = m; std[period - 1] = flat(period - 1) ? 0 : Math.sqrt(m2 / period);
  for (let i = period; i < n; i++) {
    const xo = values[i - period], xn = values[i];
    const oldMean = m;
    m = oldMean + (xn - xo) / period;
    m2 += (xn - xo) * (xn - m + xo - oldMean);
    if (m2 > peak) peak = m2;
    if ((i - (period - 1)) % period === 0 || m2 < 0 || m2 < 1e-4 * peak) exact(i);
    mean[i] = m; std[i] = flat(i) ? 0 : Math.sqrt(m2 / period);
  }
  return { mean, std };
}
