// Entry of the one-tag LIVE build (`dist/chartist-lite.element-live.iife.min.js`, global `ChartistLiteElement`): the
// element plus the live connector, so `<chartist-chart live symbol="BTC-USD">` streams with no JavaScript. The plain
// element build stays without it (and without any network code). The register module is imported before the one that
// defines the element, so the connector is in place when existing tags upgrade.
export { liveRegistered } from './live-register';
export * from './auto';
