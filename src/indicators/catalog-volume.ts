// Catalog entries: volume studies.
import { define, line } from './catalog-kit';
import type { IndicatorSpec } from './catalog-kit';
import { obv } from './obv';

export const VOLUME: IndicatorSpec[] = [
  define({
    id: 'obv', name: 'On Balance Volume', shortName: 'OBV', category: 'volume', overlay: false,
    inputs: [], outputs: [line('value', 'OBV')],
    run: rows => ({ value: obv(rows) }),
  }),
];
