// Entry `@mrchartist/chartist-lite/live`: live market data for a series (optional; the core never imports it and
// makes no network requests). Importing it touches no DOM and opens nothing: a connection starts only when you call
// `connectLive`, and it goes from the visitor's browser straight to the chosen exchange's public API.
//
//   import { connectLive } from '@mrchartist/chartist-lite/live';
//   const live = connectLive(candles, { symbol: 'BTC-USD', interval: '1m', volumeSeries: volume, chart });

export { connectLive } from './connect';
export { LIVE_LIMITS } from './connect';
export type { LiveHandle, LiveInfo, LiveOptions, LiveStatus, LiveEnv, ProviderName } from './connect';
export { BarBuilder, backoffMs, plausibleBar, plausibleTick } from './bars';
export {
  binance, coinbase, kraken, LiveError, PROVIDERS, INTERVAL_SECONDS, binanceSymbol, krakenSymbols,
  parseBinanceKlines, parseBinanceMessage, parseCoinbaseCandles, parseCoinbaseMessage, parseKrakenMessage, parseKrakenOHLC,
} from './providers';
export type { HistoryRange, LiveBar, LiveInterval, LiveProvider, LiveTick, ProviderDeps, StreamHandlers } from './providers';
