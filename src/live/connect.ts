// connectLive: history over REST, then a stream folded into bars and handed to `series.update()` once per animation
// frame. Reconnects with jittered backoff and backfills the gap, pauses while the tab is hidden or the browser is
// offline, loads older history at the left edge, and never throws into the host page (failures go to onStatus /
// onError). See ARCHITECTURE.md "Live data".

import type { AnySeriesDefinition, ChartApi, SeriesApi } from '../api';
import type { LogicalRange } from '../scales/time-scale';
import { BarBuilder, backoffMs } from './bars';
import { dedupe, INTERVAL_SECONDS, PROVIDERS, type LiveBar, type LiveInterval, type LiveProvider, type LiveTick } from './providers';

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
  onStatus?: (status: LiveStatus, info: { provider: string | null; symbol: string; interval: LiveInterval }) => void;
  onError?: (error: Error) => void;
  /** After history is loaded ('history') and after each frame's updates ('update'), with the bars that changed. */
  onBars?: (kind: 'history' | 'update', bars: readonly LiveBar[]) => void;
  /** Injection points (tests, other environments). Default: the browser's. */
  fetch?: typeof fetch;
  WebSocket?: typeof WebSocket;
  env?: Partial<LiveEnv>;
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
  let closeStream: (() => void) | null = null;
  let retry: unknown = null;
  let attempt = 0;
  let paused = false;
  let destroyed = false;
  let bars: LiveBar[] = [];
  let builder: BarBuilder | null = null;
  const pending = new Map<number, LiveBar>();
  let rafId = 0;
  let noOlder = false;
  let loadingOlder = false;

  const ohlc = (): boolean => { try { const t = series.seriesType(); return t === 'candlestick' || t === 'bar'; } catch { return true; } };
  const row = (b: LiveBar): Record<string, unknown> => (ohlc() ? { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close } : { time: b.time, value: b.close });
  const volRow = (b: LiveBar): Record<string, unknown> => ({ time: b.time, value: b.volume });

  function report(e: unknown): void {
    if (isAbort(e)) return;
    try { options.onError?.(toError(e)); } catch { /* the host's handler must not break the feed */ }
  }

  function setStatus(s: LiveStatus): void {
    if (s === status) return;
    status = s;
    try { options.onStatus?.(s, { provider: current ? current.id : null, symbol, interval }); } catch { /* ignore */ }
  }

  function stopNet(): void {
    if (closeStream) { const c = closeStream; closeStream = null; try { c(); } catch { /* ignore */ } }
    if (abort) { abort.abort(); abort = null; }
    if (retry !== null) { env.clearTimeout(retry); retry = null; }
  }

  function offline(): boolean { return env.window?.navigator?.onLine === false; }

  function scheduleRetry(g: number): void {
    if (destroyed || paused || g !== gen) return;
    const wait = backoffMs(attempt, env.random());
    attempt++;
    retry = env.setTimeout(() => { retry = null; if (g === gen) void start(); }, wait);
  }

  function deps(signal: AbortSignal) {
    return { fetch: fetchFn as typeof fetch, WebSocket: WS as typeof WebSocket, signal };
  }

  function setAll(list: LiveBar[]): void {
    bars = list;
    try {
      series.setData(list.map(row) as never);
      options.volumeSeries?.setData(list.map(volRow) as never);
    } catch (e) { report(e); }
  }

  /** History arrived: the first load sets the data; a reload (reconnect, wake) backfills from the last bar on. */
  function applyHistory(list: LiveBar[], reload: boolean): void {
    const last = bars.length ? bars[bars.length - 1].time : -Infinity;
    if (reload && bars.length && list.length && list[0].time <= last) {
      const fresh = list.filter(b => b.time >= last);
      for (const b of fresh) {
        try {
          series.update(row(b) as never);
          options.volumeSeries?.update(volRow(b) as never);
        } catch (e) { report(e); }
      }
      bars = dedupe(bars.concat(fresh));
    } else setAll(list);
    try { options.onBars?.('history', bars); } catch { /* ignore */ }
  }

  async function start(): Promise<void> {
    if (destroyed) return;
    const g = ++gen;
    stopNet();
    pending.clear();
    if (paused) return;
    if (!fetchFn || !WS) { setStatus('error'); report(new Error('Chartist Lite live: fetch and WebSocket are needed')); return; }
    const reload = bars.length > 0;
    setStatus(attempt > 0 || reload ? 'reconnecting' : 'connecting');
    let loaded: LiveBar[] | null = null;
    let provider: LiveProvider | null = null;
    const startAt = Math.max(0, current ? chain.indexOf(current) : 0);
    for (let k = 0; k < chain.length; k++) {
      const p = chain[(startAt + k) % chain.length];
      if (!p.intervals.includes(interval)) continue;
      const ac = new AbortController();
      abort = ac;
      try {
        const h = await p.history(symbol, interval, { limit: historyN }, deps(ac.signal));
        if (g !== gen) return;
        if (!h.length) throw new Error(`${p.id}: no bars for ${symbol} ${interval}`);
        loaded = h;
        provider = p;
        break;
      } catch (e) {
        if (g !== gen) return;
        report(e);
      }
    }
    abort = null;
    if (!loaded || !provider) {
      setStatus(offline() ? 'offline' : 'error');
      scheduleRetry(g);
      return;
    }
    if (current !== provider) { current = provider; noOlder = false; }
    applyHistory(loaded, reload);
    builder = new BarBuilder(INTERVAL_SECONDS[interval], bars[bars.length - 1] ?? null);
    try {
      closeStream = provider.subscribe(symbol, interval, {
        tick: t => { if (g === gen) onTick(t); },
        open: () => { if (g === gen) { attempt = 0; setStatus('live'); } },
        closed: reason => {
          if (g !== gen) return;
          closeStream = null;
          report(new Error(`${provider?.id} stream ${reason}`));
          setStatus(offline() ? 'offline' : 'reconnecting');
          scheduleRetry(g);
        },
      }, { fetch: fetchFn, WebSocket: WS });
    } catch (e) {
      report(e);
      setStatus('reconnecting');
      scheduleRetry(g);
    }
  }

  function onTick(t: LiveTick): void {
    if (!builder) return;
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
      if (b.time === last) bars[bars.length - 1] = b; else bars.push(b);
    }
    try { options.onBars?.('update', changed); } catch { /* ignore */ }
  }

  async function loadOlder(): Promise<number> {
    try {
      if (destroyed || loadingOlder || noOlder || !current || !current.canPageBack || !bars.length || !fetchFn || !WS) return 0;
      loadingOlder = true;
      const g = gen;
      const ac = new AbortController();
      const first = bars[0].time;
      let older: LiveBar[];
      try { older = await current.history(symbol, interval, { limit: historyN, before: first }, deps(ac.signal)); }
      finally { loadingOlder = false; }
      if (g !== gen || destroyed) return 0;
      const add = older.filter(b => b.time < first);
      if (!add.length) { noOlder = true; return 0; }
      setAll(dedupe(add.concat(bars)));
      try { options.onBars?.('history', bars); } catch { /* ignore */ }
      return add.length;
    } catch (e) {
      report(e);
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

  const restart = (): void => {
    bars = [];
    noOlder = false;
    attempt = 0;
    current = null;
    builder = null;
    paused = !!env.document?.hidden;
    void start();
  };

  return {
    status: () => status,
    provider: () => (current ? current.id : null),
    symbol: () => symbol,
    interval: () => interval,
    setInterval(i) {
      if (destroyed || !INTERVALS.includes(i) || i === interval) return;
      interval = i;
      restart();
    },
    setSymbol(s) {
      if (destroyed || typeof s !== 'string' || !s.trim() || s === symbol) return;
      symbol = s.trim();
      restart();
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
