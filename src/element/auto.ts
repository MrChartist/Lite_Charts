// Entry of the one-tag build (`dist/chartist-lite.element.iife.min.js`, global `ChartistLiteElement`): loading the
// script registers `<chartist-chart>`. Not part of the package entries, so nothing registers on a normal import.
//
//   <script src="chartist-lite.element.iife.min.js"></script>                      registers <chartist-chart>
//   <script src="..." data-tag="price-chart"></script>                             registers <price-chart> instead
//   <script src="..." data-manual></script>                                        registers nothing; call ChartistLiteElement.defineChartistElement()

import { defineChartistElement } from './index';

function autoDefine(): void {
  if (typeof document === 'undefined') return;
  const script = document.currentScript;
  if (script && script.hasAttribute('data-manual')) return;
  defineChartistElement(script?.getAttribute('data-tag') || 'chartist-chart');
}

autoDefine();

export { defineChartistElement };
export { parseRows, parseElementConfig } from './index';
