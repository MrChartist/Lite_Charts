# Security Policy

## Supported versions

Only the latest released version of Chartist Lite receives security fixes.

## Reporting a vulnerability

Please report security problems privately. Do not open a public issue.

Use the **"Report a vulnerability"** button on the repository's Security tab. This opens a private security advisory that only the maintainers can see.

## What to expect

Chartist Lite runs in the browser. A report should describe the input or steps that cause the problem, the version you used, and the browser you used.

## Network and data

- **The core makes no network requests and stores nothing.** Nor do the indicators, drawings (unless you opt in to
  `persist`, which writes to the visitor's own `localStorage`), React and plain element entries.
- **The optional live entry** (`lite-charts/live`, `chartist-lite-live.iife.min.js`, and the
  `chartist-lite.element-live.iife.min.js` element build) connects only when you call `connectLive` (or use
  `<chartist-chart live>`), and then the **visitor's browser connects directly** to the chosen exchange's public API:
  `api.exchange.coinbase.com` and `ws-feed.exchange.coinbase.com`; `data-api.binance.vision` and
  `data-stream.binance.vision`; `api.kraken.com` and `ws.kraken.com`. No API keys, no proxy, no server of ours, nothing
  stored. Requests carry no cookies (`credentials: 'omit'`); the exchange sees the visitor's IP address and the
  page's origin, as with any request the browser makes.
- **Strict Content-Security-Policy:** allow the provider hosts you use in `connect-src` (for example
  `connect-src https://api.exchange.coinbase.com wss://ws-feed.exchange.coinbase.com`).
- **Terms and rate limits:** the exchanges' own terms of use and rate limits apply to anyone who ships the live entry.
  Exchange terms for commercial or redistributed use: Needs verification, the embedder's responsibility.
- **Prices are indicative,** delayed or incomplete at times (a reconnect gap is backfilled; trades that arrive late for
  a closed bar are dropped), and are not advice. Binance quotes BTC in USDT, not USD.
