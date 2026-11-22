// Entry of the one-tag TERMINAL build (`dist/chartist-lite.terminal.iife.min.js`, global `ChartistLiteTerminal`):
// the widget with live data and drawing tools bundled, and `<chartist-terminal>` registered on load, so
//
//   <script src="chartist-lite.terminal.iife.min.js"></script>
//   <chartist-terminal live symbol="BTC-USD" drawings></chartist-terminal>
//
// is a working crypto terminal with no page code. `data-manual` on the script tag registers nothing (call
// `ChartistLiteTerminal.defineTerminalElement()`); `data-tag="my-terminal"` registers under another name.

import * as drawings from '../drawings/index';
import { connectLive } from '../live/connect';
import { createWidget as baseCreate } from './widget';
import { defineTerminalElement, setTerminalModules, terminalOptions } from './element';
import { defineChartistElement, setElementLive, setElementWidget } from '../element/index';
import type { Widget, WidgetOptions } from './types';

const bundled = { drawings, live: { connectLive } } as never;
setTerminalModules(bundled);

type Container = HTMLElement | string;
/** createWidget with live data and drawings already available. */
export function createWidget(container: Container, options: WidgetOptions = {}): Widget {
  return baseCreate(container, { ...options, modules: { ...(bundled as object), ...(options.modules ?? {}) } });
}

function autoDefine(): void {
  if (typeof document === 'undefined') return;
  const script = document.currentScript;
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

export { defineTerminalElement, setTerminalModules };
export * from './index';
