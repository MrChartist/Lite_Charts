// connectLive: history over REST, then a stream folded into bars and handed to `series.update()` once per animation
// frame. Reconnects with jittered backoff and backfills the gap, pauses while the tab is hidden or the browser is
// offline, loads older history at the left edge, and never throws into the host page (failures go to onStatus /
// onError). See ARCHITECTURE.md "Live data".
//
// Being a good citizen to the exchanges (review of 2026-11-22): the backoff only resets once a tick has arrived or the
// socket has stayed open 30 s (a server that accepts and drops at once is not retried every second); history is not
// reloaded when the last load is under 10 s old; three rounds in a row that fail permanently (a 4xx, an unknown or
// malformed symbol, no bars) stop with status 'error' until `retry()`; and no more than 30 starts happen in an hour.
// Every request times out after 10 s (then the next provider is tried), a socket must open within 10 s, and a stream
// that goes quiet for max(60 s, 3 intervals capped at 5 min) is reconnected. A generous bad-print guard (`guard`, see
// `plausibleTick` in bars.ts) drops only what cannot be a real print.

import type { AnySeriesDefinition, ChartApi, SeriesApi } from '../api';
import type { LogicalRange } from '../scales/time-scale';
import { BarBuilder, backoffMs, DEFAULT_GUARD, plausibleBar, plausibleTick, recentRange, type TickGuard } from './bars';
import { dedupe, INTERVAL_SECONDS, LiveError, PROVIDERS, type LiveBar, type LiveInterval, type LiveProvider, type LiveTick } from './providers';

type AnySeries = SeriesApi<AnySeriesDefinition>;

export type LiveStatus = 'connecting' | 'live' | 'reconnecting' | 'offline' | 'error';
export type ProviderName = 'coinbase' | 'binance' | 'kraken';

export interface LiveOptions {
  /** 'BTC-USD' (default), 'ETH-USD', 'SOL-USD' ... mapped per provider; unknown symbols pass through. */
  symbol?: string;
  interval?: LiveInterval;
  /** A built-in name (tried first, the others after it if its history fails) or your own provider (used alone). Default 'coinbase'. */
  provider?: ProviderName | LiveProvider;
  /** A histogram (or any single-value series) that gets each bar's volume. */
  volumeSeries?: AnySeries;
  /** With the chart, older history loads when the view reaches the left edge. */
  chart?: ChartApi;
  /** Bars loaded at start and per older page. Default 500. */
  history?: number;
  onStatus?: (status: LiveStatus, info: LiveInfo) => void;
  onError?: (error: Error) => void;
  /** After history is loaded ('history') and after each frame's updates ('update'), with the bars that changed. */
  onBars?: (kind: 'history' | 'update', bars: readonly LiveBar[]) => void;
  /**
   * The bad-print guard (see `plausibleTick`): `{ maxJump, futureSeconds }` to tune it, `false` to keep only the rules
   * that cannot drop a real print (finite, positive prices; no far-future time). Default `{ maxJump: 20, futureSeconds: 900 }`.
   */
  guard?: Partial<TickGuard> | false;
  /** Injection points (tests, other environments). Default: the browser's. */
  fetch?: typeof fetch;
  WebSocket?: typeof WebSocket;
  env?: Partial<LiveEnv>;
}

/** What is streaming: the provider really in use (after any fallback) and the currency it quotes in. */
export interface LiveInfo {
  /** Provider id ('coinbase'), or null before one answered. */
  provider: string | null;
  /** Provider name for people ('Coinbase'), or null. */
  providerLabel: string | null;
  /** The symbol asked for ('BTC-USD'). */
  symbol: string;
  /** The pair as the provider quotes it ('BTC-USDT' on Binance for 'BTC-USD'), or the symbol when unknown. */
  pair: string;
  /** Quote currency in use ('USD', 'USDT'), or null when unknown. */
  quote: string | null;
  interval: LiveInterval;
}

/** The browser parts connectLive uses, replaceable for tests. */
export interface LiveEnv {
  requestAnimationFrame(cb: () => void): number;
  cancelAnimationFrame(id: number): void;
  setTimeout(cb: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  random(): number;
  now(): number;
  /** For pausing while hidden; null: never pause. */
  document: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'> | null;
  /** For pausing while offline; null: never pause. */
  window: Pick<Window, 'addEventListener' | 'removeEventListener'> & { navigator?: { onLine?: boolean } } | null;
}

export interface LiveHandle {
  status(): LiveStatus;
  /** The provider in use (after fallback), or null. */
  provider(): string | null;
  symbol(): string;
  interval(): LiveInterval;
  setInterval(interval: LiveInterval): void;
  setSymbol(symbol: string): void;
  /** Provider, pair and quote currency in use (see `LiveInfo`). */
  info(): LiveInfo;
  /** Start again after status 'error' (permanent failures stop retrying until this is called). */
  retry(): void;
  /** Load one page of older history; resolves to the bars added (0 at the start of the data or without paging). */
  loadOlder(): Promise<number>;
  /** Stop: closes the stream, aborts requests, clears timers and listeners. */
  disconnect(): void;
}

const INTERVALS = Object.keys(INTERVAL_SECONDS) as LiveInterval[];

function defaultEnv(): LiveEnv {
  const g = globalThis as unknown as Window & typeof globalThis;
  const doc = typeof g.document !== 'undefined' ? g.document : null;
  const win = typeof g.window !== 'undefined' ? g.window : null;
  return {
    requestAnimationFrame: cb => (win ? win.requestAnimationFrame(() => cb()) : (g.setTimeout(cb, 16) as unknown as number)),
    cancelAnimationFrame: id => { if (win) win.cancelAnimationFrame(id); else g.clearTimeout(id); },
    setTimeout: (cb, ms) => g.setTimeout(cb, ms),
    clearTimeout: id => g.clearTimeout(id as number),
    random: () => Math.random(),
    now: () => Date.now(),
    document: doc,
    window: win,
  };
}

/** Limits (exported for tests and documentation). */
export const LIVE_LIMITS = {
  /** Each history request (and each older page) is abandoned after this long, and the next provider is tried. */
  fetchTimeoutMs: 10_000,
  /** A socket that has not opened by then is closed and retried. */
  openTimeoutMs: 10_000,
  /** The backoff resets only after a tick, or after the socket stayed open this long. */
  stableMs: 30_000,
  /** A reconnect within this long of the last history load subscribes again without reloading history. */
  historyReuseMs: 10_000,
  /** Rounds in a row that fail permanently before giving up with status 'error'. */
  permanentFailures: 3,
  /** Starts allowed per rolling hour; further ones wait. */
  startsPerHour: 30,
  /** A stream with no message for max(this, 3 intervals capped at `staleCapMs`) is reconnected. */
  staleMinMs: 60_000,
  staleCapMs: 300_000,
} as const;

const HOUR = 3_600_000;

const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)));
const isAbort = (e: unknown): boolean => (e as { name?: string } | null)?.name === 'AbortError';

export function connectLive(series: AnySeries, options: LiveOptions = {}): LiveHandle {
  const env: LiveEnv = { ...defaultEnv(), ...(options.env ?? {}) };
  const fetchFn = options.fetch ?? (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : undefined);
  const WS = options.WebSocket ?? (typeof WebSocket !== 'undefined' ? WebSocket : undefined);
  const historyN = Math.max(10, Math.min(5000, Math.floor(options.history ?? 500)));
  let symbol = options.symbol || 'BTC-USD';
  let interval: LiveInterval = INTERVALS.includes(options.interval as LiveInterval) ? options.interval as LiveInterval : '1m';

  // Provider chain: the chosen built-in first, then the others; a custom provider alone.
  const chosen = options.provider ?? 'coinbase';
  const chain: LiveProvider[] = typeof chosen === 'object'
    ? [chosen]
    : [PROVIDERS[chosen] ?? PROVIDERS.coinbase, ...Object.values(PROVIDERS).filter(p => p.id !== chosen)];

  let status: LiveStatus = 'connecting';
  let current: LiveProvider | null = null;
  let gen = 0;
  let abort: AbortController | null = null;
  let olderAbort: AbortController | null = null;
  let closeStream: (() => void) | null = null;
  let retryTimer: unknown = null;
  let openTimer: unknown = null;
  let stableTimer: unknown = null;
  let watchTimer: unknown = null;
  let attempt = 0;
  let permanentStreak = 0;
  let stopped = false;
  const starts: number[] = [];
  let lastHistoryAt = -Infinity;
  let lastMessageAt = 0;
  let paused = false;
  let destroyed = false;
  let bars: LiveBar[] = [];
  let builder: BarBuilder | null = null;
  const pending = new Map<number, LiveBar>();
  let rafId = 0;
  let noOlder = false;
  let loadingOlder = false;

  const guard: TickGuard | null = options.guard === false ? null : { ...DEFAULT_GUARD, ...(options.guard ?? {}) };
  const futureSlack = (): number => Math.max(guard?.futureSeconds ?? DEFAULT_GUARD.futureSeconds, 2 * seconds());
  let range = 0;
  const seconds = (): number => INTERVAL_SECONDS[interval];
  const nowSec = (): number => env.now() / 1000;
  const ohlc = (): boolean => { try { const t = series.seriesType(); return t === 'candlestick' || t === 'bar'; } catch { return true; } };
  const row = (b: LiveBar): Record<string, unknown> => (ohlc() ? { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close } : { time: b.time, value: b.close });
  const volRow = (b: LiveBar): Record<string, unknown> => ({ time: b.time, value: b.volume });

  function report(e: unknown): void {
    if (isAbort(e)) return;
    try { options.onError?.(toError(e)); } catch { /* the host's handler must not break the feed */ }
  }

  function info(): LiveInfo {
    let quote: string | null = null;
    try { quote = current?.quote?.(symbol) ?? null; } catch { quote = null; }
    const base = /^([A-Za-z0-9]+)[-/_]/.exec(symbol.trim());
    return {
      provider: current ? current.id : null,
      providerLabel: current ? current.label ?? current.id : null,
      symbol,
      pair: base && quote ? `${base[1].toUpperCase()}-${quote}` : symbol,
      quote,
      interval,
    };
  }

  function setStatus(s: LiveStatus, force = false): void {
    if (s === status && !force) return;
    status = s;
    try { options.onStatus?.(s, info()); } catch { /* ignore */ }
  }

  function clearTimer(t: unknown): null { if (t !== null) env.clearTimeout(t); return null; }

  function stopNet(): void {
    if (closeStream) { const c = closeStream; closeStream = null; try { c(); } catch { /* ignore */ } }
    if (abort) { abort.abort(); abort = null; }
    if (olderAbort) { olderAbort.abort(); olderAbort = null; }
    loadingOlder = false;
    retryTimer = clearTimer(retryTimer);
    openTimer = clearTimer(openTimer);
    stableTimer = clearTimer(stableTimer);
    watchTimer = clearTimer(watchTimer);
  }

  function offline(): boolean { return env.window?.navigator?.onLine === false; }

  function scheduleRetry(g: number): void {
    if (destroyed || paused || stopped || g !== gen) return;
    const wait = backoffMs(attempt, env.random());
    attempt++;
    retryTimer = env.setTimeout(() => { retryTimer = null; if (g === gen) void start(); }, wait);
  }

  /** `p`, rejected with a timeout error after `ms` (and `ac` aborted), whether or not the request honours the signal. */
  function timed<T>(p: Promise<T>, ac: AbortController, ms: number, what: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let done = false;
      const settle = (f: () => void): void => { if (done) return; done = true; env.clearTimeout(t); ac.signal.removeEventListener('abort', onAbort); f(); };
      // Aborted from outside (disconnect, restart, pause): settle at once even if the request ignores its signal.
      const onAbort = (): void => settle(() => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      const t = env.setTimeout(() => settle(() => { ac.abort(); reject(new LiveError(`${what} timed out after ${Math.round(ms / 1000)} s`)); }), ms);
      ac.signal.addEventListener('abort', onAbort);
      p.then(v => settle(() => resolve(v)), e => settle(() => reject(e)));
    });
  }

  function deps(signal: AbortSignal) {
    return { fetch: fetchFn as typeof fetch, WebSocket: WS as typeof WebSocket, signal };
  }

  /** History bars that pass the plausibility guard (a bar in the future or with a non-positive price is dropped). */
  function clean(list: LiveBar[]): LiveBar[] {
    const limit = nowSec() + futureSlack();
    return list.filter(b => plausibleBar(b, limit));
  }

  function setAll(list: LiveBar[]): void {
    bars = list;
    range = recentRange(bars);
    try {
      series.setData(list.map(row) as never);
      options.volumeSeries?.setData(list.map(volRow) as never);
    } catch (e) { report(e); }
  }

  /**
   * History arrived: the first load sets the data; a reload (reconnect, wake) backfills from the last bar on. Local bars
   * newer than the newest history bar (from a bad clock or a bad tick) are discarded, which needs a full reset.
   */
  function applyHistory(list: LiveBar[], reload: boolean): void {
    const last = bars.length ? bars[bars.length - 1].time : -Infinity;
    const newest = list[list.length - 1].time;
    if (reload && bars.length && list[0].time <= last && last <= newest) {
      const fresh = list.filter(b => b.time >= last);
      for (const b of fresh) {
        try {
          series.update(row(b) as never);
          options.volumeSeries?.update(volRow(b) as never);
        } catch (e) { report(e); }
      }
      bars = dedupe(bars.concat(fresh));
      range = recentRange(bars);
    } else if (reload && bars.length && last > newest) {
      setAll(dedupe(bars.filter(b => b.time < list[0].time).concat(list)));
    } else setAll(list);
    try { options.onBars?.('history', bars); } catch { /* ignore */ }
  }

  /** A stream failure (closed, never opened, gone quiet): close it and come back later. */
  function streamFailed(g: number, why: string): void {
    if (g !== gen) return;
    if (closeStream) { const c = closeStream; closeStream = null; try { c(); } catch { /* ignore */ } }
    openTimer = clearTimer(openTimer);
    stableTimer = clearTimer(stableTimer);
    watchTimer = clearTimer(watchTimer);
    report(new Error(`${current?.id ?? 'live'} stream ${why}`));
    setStatus(offline() ? 'offline' : 'reconnecting');
    scheduleRetry(g);
  }

  function staleMs(): number {
    return Math.max(LIVE_LIMITS.staleMinMs, Math.min(LIVE_LIMITS.staleCapMs, 3 * seconds() * 1000));
  }

  function watch(g: number): void {
    const limit = staleMs();
    watchTimer = env.setTimeout(() => {
      watchTimer = null;
      if (g !== gen) return;
      if (env.now() - lastMessageAt >= limit) streamFailed(g, `sent nothing for ${Math.round(limit / 1000)} s`);
      else watch(g);
    }, Math.max(1000, limit / 4));
  }

  async function start(): Promise<void> {
    if (destroyed) return;
    const g = ++gen;
    stopNet();
    pending.clear();
    if (paused || stopped) return;
    if (!fetchFn || !WS) { setStatus('error'); report(new Error('Chartist Lite live: fetch and WebSocket are needed')); return; }
    // At most `startsPerHour` starts in a rolling hour; a further one waits for the oldest to leave the window.
    const now = env.now();
    while (starts.length && now - starts[0] >= HOUR) starts.shift();
    if (starts.length >= LIVE_LIMITS.startsPerHour) {
      setStatus(offline() ? 'offline' : 'reconnecting');
      retryTimer = env.setTimeout(() => { retryTimer = null; if (g === gen) void start(); }, starts[0] + HOUR - now + 1);
      return;
    }
    starts.push(now);
    const reload = bars.length > 0;
    setStatus(attempt > 0 || reload ? 'reconnecting' : 'connecting');
    let provider: LiveProvider | null = null;
    if (reload && current && current.intervals.includes(interval) && now - lastHistoryAt < LIVE_LIMITS.historyReuseMs) {
      provider = current; // history is fresh: subscribe again without reloading it
    } else {
      let loaded: LiveBar[] | null = null;
      let allPermanent = true;
      const startAt = Math.max(0, current ? chain.indexOf(current) : 0);
      for (let k = 0; k < chain.length; k++) {
        const p = chain[(startAt + k) % chain.length];
        if (!p.intervals.includes(interval)) continue;
        const ac = new AbortController();
        abort = ac;
        try {
          const h = clean(await timed(p.history(symbol, interval, { limit: historyN }, deps(ac.signal)), ac, LIVE_LIMITS.fetchTimeoutMs, `${p.id} history`));
          if (g !== gen) return;
          if (!h.length) throw new LiveError(`${p.id}: no bars for ${symbol} ${interval}`, 0, true);
          loaded = h;
          provider = p;
          break;
        } catch (e) {
          if (g !== gen) return;
          if (!(e instanceof LiveError && e.permanent)) allPermanent = false;
          report(e);
        }
      }
      abort = null;
      if (!loaded || !provider) {
        permanentStreak = allPermanent ? permanentStreak + 1 : 0;
        if (permanentStreak >= LIVE_LIMITS.permanentFailures) {
          stopped = true;
          setStatus('error');
          report(new Error(`Chartist Lite live: ${symbol} ${interval} failed ${permanentStreak} times in a row on every provider; stopped (call retry() to try again)`));
          return;
        }
        setStatus(offline() ? 'offline' : 'error');
        scheduleRetry(g);
        return;
      }
      permanentStreak = 0;
      lastHistoryAt = env.now();
      if (current !== provider) { current = provider; noOlder = false; }
      applyHistory(loaded, reload);
    }
    builder = new BarBuilder(seconds(), bars[bars.length - 1] ?? null);
    const prov = provider;
    let ticked = false;
    const alive = (): void => { if (g === gen) lastMessageAt = env.now(); };
    try {
      closeStream = prov.subscribe(symbol, interval, {
        tick: t => {
          if (g !== gen) return;
          alive();
          if (!ticked) { ticked = true; attempt = 0; }
          onTick(t);
        },
        alive,
        open: () => {
          if (g !== gen) return;
          openTimer = clearTimer(openTimer);
          lastMessageAt = env.now();
          setStatus('live', true);
          stableTimer = clearTimer(stableTimer);
          stableTimer = env.setTimeout(() => { stableTimer = null; if (g === gen) attempt = 0; }, LIVE_LIMITS.stableMs);
          watchTimer = clearTimer(watchTimer);
          watch(g);
        },
        closed: reason => { if (g === gen) { closeStream = null; streamFailed(g, reason); } },
      }, { fetch: fetchFn, WebSocket: WS });
      if (g === gen && status !== 'live') {
        openTimer = env.setTimeout(() => { openTimer = null; streamFailed(g, `did not open within ${LIVE_LIMITS.openTimeoutMs / 1000} s`); }, LIVE_LIMITS.openTimeoutMs);
      }
    } catch (e) {
      report(e);
      setStatus('reconnecting');
      scheduleRetry(g);
    }
  }

  function onTick(t: LiveTick): void {
    if (!builder) return;
    const last = builder.last;
    if (!plausibleTick(t, nowSec(), seconds(), last ? last.close : null, range, guard, last ? last.time : -Infinity)) return;
    const b = builder.apply(t);
    if (!b) return;
    pending.set(b.time, b);
    // However fast ticks arrive, the chart is updated once per frame.
    if (!rafId) rafId = env.requestAnimationFrame(flush);
  }

  function flush(): void {
    rafId = 0;
    if (destroyed || pending.size === 0) return;
    const changed = [...pending.values()].sort((a, b) => a.time - b.time);
    pending.clear();
    for (const b of changed) {
      const last = bars.length ? bars[bars.length - 1].time : -Infinity;
      if (b.time < last) continue;
      try {
        series.update(row(b) as never);
        options.volumeSeries?.update(volRow(b) as never);
      } catch (e) { report(e); continue; }
      if (b.time === last) bars[bars.length - 1] = b; else { bars.push(b); range = recentRange(bars); }
    }
    try { options.onBars?.('update', changed); } catch { /* ignore */ }
  }

  async function loadOlder(): Promise<number> {
    const g0 = gen;
    try {
      if (destroyed || loadingOlder || noOlder || !current || !current.canPageBack || !bars.length || !fetchFn || !WS) return 0;
      loadingOlder = true;
      const g = gen;
      const ac = new AbortController();
      olderAbort = ac;
      const first = bars[0].time;
      let older: LiveBar[];
      try {
        older = clean(await timed(current.history(symbol, interval, { limit: historyN, before: first }, deps(ac.signal)), ac, LIVE_LIMITS.fetchTimeoutMs, `${current.id} older history`));
      } finally {
        if (olderAbort === ac) { olderAbort = null; loadingOlder = false; }
      }
      if (g !== gen || destroyed) return 0;
      const add = older.filter(b => b.time < first);
      if (!add.length) { noOlder = true; return 0; }
      setAll(dedupe(add.concat(bars)));
      try { options.onBars?.('history', bars); } catch { /* ignore */ }
      return add.length;
    } catch (e) {
      if (g0 === gen && !destroyed) report(e);
      return 0;
    }
  }

  // Pause while the tab is hidden or the browser is offline; catch up when back.
  const onVisibility = (): void => {
    if (!env.document) return;
    if (env.document.hidden) { paused = true; gen++; stopNet(); setStatus('offline'); }
    else if (paused && !offline()) { paused = false; attempt = 0; void start(); }
  };
  const onOffline = (): void => { paused = true; gen++; stopNet(); setStatus('offline'); };
  const onOnline = (): void => { if (env.document?.hidden) return; paused = false; attempt = 0; void start(); };
  env.document?.addEventListener('visibilitychange', onVisibility);
  env.window?.addEventListener('offline', onOffline);
  env.window?.addEventListener('online', onOnline);

  // Older history when the view reaches the left edge.
  const onRange = (r: LogicalRange | null): void => { if (r && r.from < 20) void loadOlder(); };
  try { options.chart?.timeScale().subscribeVisibleLogicalRangeChange(onRange); } catch (e) { report(e); }

  if (env.document?.hidden) { paused = true; setStatus('offline'); } else void start();

  /** A new symbol or interval: the old bars go (the chart shows its empty state until the new history arrives). */
  const restart = (): void => {
    gen++;
    stopNet();
    pending.clear();
    if (rafId) { env.cancelAnimationFrame(rafId); rafId = 0; }
    if (bars.length) setAll([]);
    bars = [];
    noOlder = false;
    attempt = 0;
    permanentStreak = 0;
    stopped = false;
    lastHistoryAt = -Infinity;
    current = null;
    builder = null;
    status = 'offline'; // so 'connecting' is reported again
    paused = !!env.document?.hidden;
    void start();
  };

  return {
    status: () => status,
    provider: () => (current ? current.id : null),
    info,
    symbol: () => symbol,
    interval: () => interval,
    setInterval(i) {
      if (destroyed || !INTERVALS.includes(i) || i === interval) return;
      interval = i;
      restart();
    },
    setSymbol(s) {
      if (destroyed || typeof s !== 'string' || !s.trim() || s.trim() === symbol) return;
      symbol = s.trim();
      restart();
    },
    retry() {
      if (destroyed) return;
      stopped = false;
      permanentStreak = 0;
      attempt = 0;
      starts.length = 0;
      paused = !!env.document?.hidden || offline();
      void start();
    },
    loadOlder,
    disconnect() {
      if (destroyed) return;
      destroyed = true;
      gen++;
      stopNet();
      if (rafId) { env.cancelAnimationFrame(rafId); rafId = 0; }
      pending.clear();
      env.document?.removeEventListener('visibilitychange', onVisibility);
      env.window?.removeEventListener('offline', onOffline);
      env.window?.removeEventListener('online', onOnline);
      try { options.chart?.timeScale().unsubscribeVisibleLogicalRangeChange(onRange); } catch { /* ignore */ }
      setStatus('offline');
    },
  };
}
