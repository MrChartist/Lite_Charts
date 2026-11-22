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
- **Input to URLs:** a symbol is mapped to the exchange's form and then checked against a strict pattern (letters and
  digits, with one dash or slash where the exchange uses one) and URL-encoded; anything else is refused before any
  request, so no symbol can reach another path or query parameter. Every request has a 10 s timeout and an
  AbortController.
- **Being a good citizen:** reconnects back off (1 s doubling to 30 s, reset only after a tick or 30 s open), history is
  not reloaded within 10 s of the last load, permanent failures (4xx, unknown symbol, no bars) stop after three rounds
  until the page calls `retry()`, and at most 30 starts happen per hour.
- **Bounded drawings:** `importJSON` and `persist` accept at most 4 million characters, 2000 drawings and 2000 points
  per freehand stroke; beyond that an `error` event says what was left out. Saved data that cannot be read is left
  untouched (never overwritten).
- **Strict Content-Security-Policy:** allow the provider hosts you use in `connect-src` (for example
  `connect-src https://api.exchange.coinbase.com wss://ws-feed.exchange.coinbase.com`).
- **Terms and rate limits:** the exchanges' own terms of use and rate limits apply to anyone who ships the live entry.
  Exchange terms for commercial or redistributed use: Needs verification, the embedder's responsibility.
- **Prices are indicative,** delayed or incomplete at times (a reconnect gap is backfilled; trades that arrive late for
  a closed bar are dropped), and are not advice. Binance quotes BTC in USDT, not USD.
