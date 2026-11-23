// Entry of the one-tag TERMINAL build (`dist/chartist-lite.terminal.iife.min.js`, global `ChartistLiteTerminal`):
// the widget with live data and drawing tools bundled, and `<chartist-terminal>` registered on load, so
//
//   <script src="chartist-lite.terminal.iife.min.js"></script>
//   <chartist-terminal live symbol="BTC-USD" drawings></chartist-terminal>
//
// is a working crypto terminal with no page code. `data-manual` on the script tag registers nothing (call
// `ChartistLiteTerminal.defineTerminalElement()`); `data-tag="my-terminal"` registers under another name.
//
// The extras (price alerts, tooltips, watermark, replay, session breaks) are not bundled: the first time something
// needs them, `chartist-lite-extras.iife.min.js` is loaded from the folder of this script (see `extrasUrl`).

import * as drawings from '../drawings/index';
import { connectLive } from '../live/connect';
import { createWidget as baseCreate } from './widget';
import { defineTerminalElement, setTerminalLoad, setTerminalModules, terminalOptions } from './element';
import { defineChartistElement, setElementLive, setElementWidget } from '../element/index';
import type { Widget, WidgetOptions } from './types';

const bundled = { drawings, live: { connectLive } } as never;
setTerminalModules(bundled);

// ── the extras, loaded on first use ──
export const EXTRAS_FILE = 'chartist-lite-extras.iife.min.js';
const TERMINAL_FILE = /chartist-lite\.terminal\.iife(\.min)?\.js(\?|#|$)/;
/** This script's tag, captured while it runs (`currentScript` is only set then); null when injected as a module or late. */
function runningScript(): HTMLScriptElement | null {
  if (typeof document === 'undefined') return null;
  const s = document.currentScript;
  return s && (s as HTMLScriptElement).tagName === 'SCRIPT' ? s as HTMLScriptElement : null;
}
const ownScript = runningScript();
let assetBase: string | null = null;
let pending: Promise<unknown> | null = null;

/** Where the extras file is: `setAssetBase(url)` wins, then `data-extras` on this script tag, then this script's folder. */
export function setAssetBase(url: string | null): void { assetBase = url; }

/**
 * The terminal's script tag: the one running when it loaded, else the first script whose file name is the terminal's,
 * else one that carries `data-extras` (a renamed file loaded as a module, say).
 */
function terminalScript(): HTMLScriptElement | null {
  if (ownScript) return ownScript;
  if (typeof document === 'undefined') return null;
  const all = Array.from(document.scripts);
  return all.find(s => TERMINAL_FILE.test(s.src)) ?? all.find(s => s.hasAttribute('data-extras')) ?? null;
}

/**
 * The extras file's URL: `setAssetBase(url)` (a folder) first; then the terminal tag's `data-extras` (a file URL, or
 * "off" to never load them); then the terminal file's own folder. Null when it cannot be known (the terminal was
 * injected in a way that leaves no script tag to read and nothing was set) or turned off.
 */
export function extrasUrl(): string | null {
  const base = typeof document !== 'undefined' ? document.baseURI : undefined;
  try {
    if (assetBase) return new URL(EXTRAS_FILE, new URL(assetBase.endsWith('/') ? assetBase : `${assetBase}/`, base)).href;
    const tag = terminalScript();
    const attr = tag?.getAttribute('data-extras');
    if (attr === 'off') return null;
    if (attr) return new URL(attr, base).href;
    if (tag?.src) return new URL(EXTRAS_FILE, tag.src).href;
  } catch { /* a malformed URL: unknown */ }
  return null;
}

/**
 * Load the extras once, however many widgets ask at the same time: one script element with `src` (no eval, no inline
 * code, so a strict CSP that allows this origin for the terminal allows it too), the terminal tag's `nonce` copied,
 * `data-extras-integrity` passed on with `crossorigin="anonymous"`. A failure is not remembered: the next use tries
 * again.
 */
export function loadExtras(): Promise<unknown> {
  const g = globalThis as { ChartistLiteExtras?: unknown };
  if (g.ChartistLiteExtras) return Promise.resolve(g.ChartistLiteExtras);
  if (pending) return pending;
  const url = extrasUrl();
  if (!url || typeof document === 'undefined') {
    const off = terminalScript()?.getAttribute('data-extras') === 'off';
    const e = new Error(off ? 'Chartist Lite: the extras are turned off (data-extras="off")' : `Chartist Lite: where ${EXTRAS_FILE} is cannot be told from this page: add data-extras="…/${EXTRAS_FILE}" to the terminal's script tag, or call ChartistLiteTerminal.setAssetBase(folderUrl)`);
    (e as Error & { code?: string }).code = off ? 'extras-off' : 'extras-url';
    return Promise.reject(e);
  }
  const p = new Promise<unknown>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = url;
    el.async = true;
    const tag = terminalScript();
    const nonce = tag?.nonce || tag?.getAttribute('nonce');
    if (nonce) el.nonce = nonce;
    const integrity = tag?.getAttribute('data-extras-integrity');
    if (integrity) { el.integrity = integrity; el.crossOrigin = 'anonymous'; }
    el.setAttribute('data-chartist-extras', '');
    el.onload = () => {
      if (g.ChartistLiteExtras) resolve(g.ChartistLiteExtras);
      else { el.remove(); reject(new Error(`Chartist Lite: ${url} did not define ChartistLiteExtras`)); }
    };
    el.onerror = () => { el.remove(); reject(new Error(`Chartist Lite: could not load ${url}`)); };
    (document.head || document.documentElement).appendChild(el);
  });
  pending = p;
  // A failure is forgotten, so the next use retries.
  p.catch(() => { if (pending === p) pending = null; });
  return p;
}
const bundledLoad = { extras: loadExtras } as WidgetOptions['load'];
setTerminalLoad(bundledLoad);

type Container = HTMLElement | string;
/** createWidget with live data and drawings available, and the extras loaded on first use (`load.extras` wins). */
export function createWidget(container: Container, options: WidgetOptions = {}): Widget {
  return baseCreate(container, { ...options, modules: { ...(bundled as object), ...(options.modules ?? {}) }, load: { ...bundledLoad, ...(options.load ?? {}) } });
}

function autoDefine(): void {
  if (typeof document === 'undefined') return;
  const script = ownScript;
  if (script && script.hasAttribute('data-manual')) return;
  defineTerminalElement(script?.getAttribute('data-tag') || 'chartist-terminal');
  // <chartist-chart widget ...> is the same workspace (and plain <chartist-chart> still works).
  setElementWidget((frame, get, has) => createWidget(frame, { ...terminalOptions(get, has), height: undefined }) as never);
  // This build carries the live connector, so a plain <chartist-chart live> must stream too, whichever build's
  // copy of the element registers the tag first.
  setElementLive(connectLive as never);
  defineChartistElement('chartist-chart');
}
autoDefine();

export { defineTerminalElement, setTerminalModules, setTerminalLoad };
export * from './index';
