// The indicator registry the UI is built on: one `IndicatorSpec` per indicator (id, names, category, overlay or pane,
// declared inputs with ranges, drawn outputs, guide lines) and a uniform `compute(rows, params)` that clamps invalid
// params instead of throwing. Importing this file pulls every indicator in, which is the point for a UI; import a
// function from its own file (or the entry) to keep a bundle small.

import { TREND } from './catalog-trend';
import { MOMENTUM } from './catalog-momentum';
import { VOLATILITY } from './catalog-volatility';
import { VOLUME } from './catalog-volume';
import { OTHER } from './catalog-other';
import type { IndicatorSpec } from './catalog-kit';

export type {
  IndicatorCategory, IndicatorInput, IndicatorOutput, IndicatorParams, IndicatorResult, IndicatorSpec, InputValue,
} from './catalog-kit';
export { legendLabel, resolveParams } from './catalog-kit';

/** Every indicator, by category: trend, momentum, volatility, volume, other. */
export const INDICATORS: IndicatorSpec[] = [...TREND, ...MOMENTUM, ...VOLATILITY, ...VOLUME, ...OTHER];

const BY_ID = new Map(INDICATORS.map(s => [s.id, s]));

/** The spec with this id, or undefined. */
export function getIndicator(id: string): IndicatorSpec | undefined {
  return BY_ID.get(id);
}
