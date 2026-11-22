// Catalog entries: levels and swing tools drawn on the price pane (previous-period levels, swings).
import { define, flt, int, select, line, dots, ZONES } from './catalog-kit';
import type { IndicatorSpec } from './catalog-kit';
import { pivotPoints, PIVOT_KINDS } from './pivot-points';
import { cpr } from './cpr';
import { previousHighLow } from './previous-high-low';
import { weeksHighLow } from './weeks-high-low';
import { pivotHighLow } from './pivot-high-low';
import { zigzag } from './zigzag';

const PERIODS = ['auto', 'day', 'week', 'month', 'year'];
const levelInputs = () => [select('period', 'Previous period', 'auto', PERIODS), select('zone', 'Day in zone', 'UTC', ZONES)];

export const OTHER: IndicatorSpec[] = [
  define({
    id: 'pivot-points', name: 'Pivot Points', shortName: 'Pivots', category: 'other', overlay: true,
    inputs: [select('kind', 'Kind', 'classic', PIVOT_KINDS), ...levelInputs()],
    outputs: [
      line('pp', 'Pivot'), line('r1', 'R1', 'down'), line('r2', 'R2', 'down'), line('r3', 'R3', 'down'), line('r4', 'R4', 'down'),
      line('s1', 'S1', 'up'), line('s2', 'S2', 'up'), line('s3', 'S3', 'up'), line('s4', 'S4', 'up'),
    ],
    run: (rows, v) => pivotPoints(rows, { kind: v.kind, period: v.period, zone: v.zone }),
  }),
  define({
    id: 'cpr', name: 'Central Pivot Range', shortName: 'CPR', category: 'other', overlay: true,
    inputs: levelInputs(), outputs: [line('top', 'Top', 'up'), line('pivot', 'Pivot'), line('bottom', 'Bottom', 'down')],
    run: (rows, v) => cpr(rows, { period: v.period, zone: v.zone }),
  }),
  define({
    id: 'previous-high-low', name: 'Previous Period High / Low', shortName: 'Prev HL', category: 'other', overlay: true,
    inputs: levelInputs(), outputs: [line('high', 'High', 'up'), line('low', 'Low', 'down'), line('close', 'Close', 'muted')],
    run: (rows, v) => previousHighLow(rows, { period: v.period, zone: v.zone }),
  }),
  define({
    id: 'weeks-high-low', name: '52-Week High / Low', shortName: '52W', category: 'other', overlay: true,
    inputs: [int('weeks', 'Weeks', 52, 1, 260)], outputs: [line('high', 'High', 'up'), line('low', 'Low', 'down')],
    run: (rows, v) => weeksHighLow(rows, { weeks: v.weeks }),
  }),
  define({
    id: 'pivot-high-low', name: 'Swing Highs and Lows', shortName: 'Swings', category: 'other', overlay: true,
    inputs: [int('left', 'Bars left', 10, 0, 200), int('right', 'Bars right', 10, 0, 200)],
    outputs: [dots('high', 'Swing high', 'down'), dots('low', 'Swing low', 'up')],
    run: (rows, v) => pivotHighLow(rows, { left: v.left, right: v.right }),
  }),
  define({
    id: 'zigzag', name: 'ZigZag', shortName: 'ZigZag', category: 'other', overlay: true,
    inputs: [flt('deviation', 'Minimum move %', 5, 0.1, 50, 0.1), int('legs', 'Bars each side', 10, 1, 500)], outputs: [line('value', 'ZigZag')],
    run: (rows, v) => ({ value: zigzag(rows, { deviation: v.deviation, legs: v.legs }) }),
  }),
];
