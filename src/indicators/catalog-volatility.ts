// Catalog entries: volatility studies and price channels.
import { define, flt, period, source, line, upper, lower } from './catalog-kit';
import type { IndicatorSpec } from './catalog-kit';
import { bollinger } from './bollinger';
import { donchian } from './donchian';
import { atr } from './atr';

export const VOLATILITY: IndicatorSpec[] = [
  define({
    id: 'bollinger', name: 'Bollinger Bands', shortName: 'BB', category: 'volatility', overlay: true,
    inputs: [period(20), flt('mult', 'Deviations', 2, 0.1, 10, 0.1), source()],
    outputs: [upper('upper', 'Upper'), line('basis', 'Basis', 'muted'), lower('lower', 'Lower')],
    run: (rows, v) => bollinger(rows, { period: v.period, mult: v.mult, source: v.source }),
  }),
  define({
    id: 'donchian', name: 'Donchian Channels', shortName: 'DC', category: 'volatility', overlay: true,
    inputs: [period(20)],
    outputs: [upper('upper', 'Upper'), line('middle', 'Middle', 'muted'), lower('lower', 'Lower')],
    run: (rows, v) => donchian(rows, v.period),
  }),
  define({
    id: 'atr', name: 'Average True Range', shortName: 'ATR', category: 'volatility', overlay: false,
    inputs: [period(14)], outputs: [line('value', 'ATR')],
    run: (rows, v) => ({ value: atr(rows, v.period) }),
  }),
];
