import { describe, expect, it } from 'vitest';
import { alertsFromJSON, alertsToJSON, crossings, layoutAlertChips, nearestLine, snapPrice, type PriceAlert } from '../plugins/extras/alerts';
import { firstVisibleRef, percentChange, percentText, rebaseFactor, scaleRows } from '../plugins/extras/compare';
import { startIndexAt, stepIndex, tickReplay, BASE_BAR_MS } from '../plugins/extras/replay';
import { describeBar, describeChange, placeFloating, placeTracking } from '../plugins/extras/tooltip';
import { bandExtent, chipLeft, dayStarts, isIntraday, pairEdges } from '../plugins/extras/bands';
import { fitFontSize, placeBlock } from '../plugins/extras/watermark';
import { newestBarHidden } from '../plugins/extras/realtime-button';
import { nextIndex, switcherColors } from '../plugins/extras/range-switcher';
import { accentFor, contrastRatio, seriesPalette } from '../plugins/extras/common';
import { darkTheme, lightTheme } from '../core/theme';

const fmt = (v: number): string => v.toFixed(2);

describe('alert crossings', () => {
  const lv = [{ id: 'a', price: 100 }, { id: 'b', price: 110 }, { id: 'c', price: 90 }];
  it('fires upward and downward crossings', () => {
    expect(crossings(95, 105, lv)).toEqual([{ id: 'a', direction: 'up' }]);
    expect(crossings(105, 95, lv)).toEqual([{ id: 'a', direction: 'down' }]);
  });
  it('a gap that jumps over several levels fires them all, in the order the price meets them', () => {
    expect(crossings(85, 120, lv)).toEqual([{ id: 'c', direction: 'up' }, { id: 'a', direction: 'up' }, { id: 'b', direction: 'up' }]);
    expect(crossings(120, 85, lv)).toEqual([{ id: 'b', direction: 'down' }, { id: 'a', direction: 'down' }, { id: 'c', direction: 'down' }]);
  });
  it('arriving exactly on a level counts; leaving a level it stood on does not', () => {
    expect(crossings(99, 100, lv)).toEqual([{ id: 'a', direction: 'up' }]);
    expect(crossings(101, 100, lv)).toEqual([{ id: 'a', direction: 'down' }]);
    expect(crossings(100, 101, lv)).toEqual([]);
    expect(crossings(100, 99, lv)).toEqual([]);
  });
  it('no move, no first price and bad numbers fire nothing', () => {
    expect(crossings(100, 100, lv)).toEqual([]);
    expect(crossings(null, 120, lv)).toEqual([]);
    expect(crossings(95, NaN, lv)).toEqual([]);
    expect(crossings(NaN, 105, lv)).toEqual([]);
    expect(crossings(95, 99.99, lv)).toEqual([]);
  });
  it('a price that touches a level and turns back fires once on the touch', () => {
    expect(crossings(98, 100, lv)).toHaveLength(1);
    expect(crossings(100, 98, lv)).toHaveLength(0);
  });
});

describe('alert helpers', () => {
  it('snaps a price to the minimum move and the precision', () => {
    expect(snapPrice(101.2349, 0.01, 2)).toBe(101.23);
    expect(snapPrice(101.236, 0.05, 2)).toBe(101.25);
    expect(snapPrice(101.2, 1, 0)).toBe(101);
    expect(snapPrice(0.1 + 0.2, 0.01, 2)).toBe(0.3);
  });
  it('finds the nearest line within the tolerance', () => {
    const lines = [{ id: 'a', y: 100 }, { id: 'b', y: 108 }];
    expect(nearestLine(lines, 103, 5)).toBe('a');
    expect(nearestLine(lines, 105, 5)).toBe('b');
    expect(nearestLine(lines, 150, 5)).toBeNull();
    expect(nearestLine([], 1, 5)).toBeNull();
  });
  it('round-trips through JSON and rejects bad input with a named reason', () => {
    const alerts: PriceAlert[] = [{ id: 'a1', price: 101.5, triggered: false }, { id: 'a2', price: 99, triggered: true }];
    const text = alertsToJSON(alerts);
    expect(alertsFromJSON(text)).toEqual(alerts);
    expect(alertsFromJSON(JSON.parse(text))).toEqual(alerts);
    expect(() => alertsFromJSON('not json')).toThrow(/valid JSON/);
    expect(() => alertsFromJSON('{}')).toThrow(/format/);
    expect(() => alertsFromJSON({ format: 'chartist-lite-alerts', version: 2, alerts: [] })).toThrow(/version/);
    expect(() => alertsFromJSON({ format: 'chartist-lite-alerts', version: 1, alerts: [{ id: 'a', price: 'x' }] })).toThrow(/price/);
    expect(() => alertsFromJSON({ format: 'chartist-lite-alerts', version: 1, alerts: [{ id: 'a', price: 1 }, { id: 'a', price: 2 }] })).toThrow(/twice/);
    expect(() => alertsFromJSON({ format: 'chartist-lite-alerts', version: 1, alerts: [{ price: 1 }] })).toThrow(/id/);
  });
  it('keeps the trigger details of a triggered alert; drops them on an armed one or when malformed', () => {
    const fired: PriceAlert = { id: 'a3', price: 50, triggered: true, direction: 'down', value: 49.8, time: 1700000000 };
    expect(alertsFromJSON(alertsToJSON([fired]))).toEqual([fired]);
    expect(alertsFromJSON({ format: 'chartist-lite-alerts', version: 1, alerts: [{ id: 'a', price: 1, direction: 'up', value: 2 }] })).toEqual([{ id: 'a', price: 1, triggered: false }]);
    expect(alertsFromJSON({ format: 'chartist-lite-alerts', version: 1, alerts: [{ id: 'a', price: 1, triggered: true, direction: 'sideways', value: 'x', time: null }] })).toEqual([{ id: 'a', price: 1, triggered: true }]);
  });
});

describe('price alerts fed by the host (watch: false)', () => {
  function fake(closes: number[]) {
    const subs: ((k: 'set' | 'update', row?: unknown) => void)[] = [];
    let rows = closes.map((c, i) => ({ time: 1000 + i * 60, open: c, high: c, low: c, close: c }));
    const series = {
      data: () => rows, options: () => ({ priceFormat: { type: 'price', precision: 2, minMove: 0.01 }, visible: true }), paneIndex: () => 0,
      subscribeDataChanged: (f: (k: 'set' | 'update', row?: unknown) => void) => subs.push(f), unsubscribeDataChanged() {},
      attachPrimitive() {}, detachPrimitive() {}, priceToCoordinate: () => 0, coordinateToPrice: () => 0,
      update(row: { time: number; close: number }) { rows = [...rows, { ...row, open: row.close, high: row.close, low: row.close }]; for (const f of subs) f('update', row); },
    };
    const el = { addEventListener() {}, removeEventListener() {} };
    const chart = { addPointerHandler: () => () => {}, element: () => el, setCursor() {} };
    return { chart, series };
  }
  it('fires on the price the host feeds (the true last price), never on the drawn rows (Renko bricks)', async () => {
    const { createPriceAlerts } = await import('../plugins/extras/alerts');
    const { chart, series } = fake([10, 12]); // brick closes
    let last = 11.3; // the true price of the source bar
    const fired: number[] = [];
    const h = createPriceAlerts(chart as never, series as never, { watch: false, lastPrice: () => last, onTrigger: t => fired.push(t.value) });
    h.add(11.5);
    series.update({ time: 1120, close: 14 }); // a new brick past the level: not watched
    expect(fired).toEqual([]);
    last = 11.4; h.check(11.4, 1180);
    expect(fired).toEqual([]);
    h.check(11.6, 1240);
    expect(fired).toEqual([11.6]);
    expect(h.alerts()[0]).toEqual({ id: 'a1', price: 11.5, triggered: true, direction: 'up', value: 11.6, time: 1240 });
    h.check(11.2, 1300); h.check(11.7, 1360);
    expect(fired).toHaveLength(1); // a triggered alert never fires again
  });
  it('an import starts from the current price: a level already crossed in history does not fire; rebase does not fire', async () => {
    const { createPriceAlerts } = await import('../plugins/extras/alerts');
    const { chart, series } = fake([100]);
    let last = 120;
    const fired: string[] = [];
    const h = createPriceAlerts(chart as never, series as never, { watch: false, lastPrice: () => last, onTrigger: t => fired.push(t.id) });
    h.importJSON({ format: 'chartist-lite-alerts', version: 1, alerts: [{ id: 'a7', price: 110, triggered: false }, { id: 'a8', price: 90, triggered: true, direction: 'down', value: 89, time: 5 }] });
    last = 80; h.rebase();
    expect(fired).toEqual([]);
    h.check(115);
    expect(fired).toEqual(['a7']);
    expect(h.add(130).id).toBe('a9'); // ids continue after the imported ones
  });
  it('maxAlerts: add throws a RangeError past it', async () => {
    const { createPriceAlerts } = await import('../plugins/extras/alerts');
    const { chart, series } = fake([1]);
    const h = createPriceAlerts(chart as never, series as never, { maxAlerts: 2 });
    h.add(1); h.add(2);
    expect(() => h.add(3)).toThrow(RangeError);
    h.applyOptions({ maxAlerts: 3 });
    expect(h.add(3).price).toBe(3);
  });
});

describe('compare maths', () => {
  it('percent change and rebase factor', () => {
    expect(percentChange(110, 100)).toBeCloseTo(10);
    expect(percentChange(90, 100)).toBeCloseTo(-10);
    expect(percentChange(5, 0)).toBeNaN();
    expect(percentChange(-5, -10)).toBeCloseTo(50);
    expect(rebaseFactor(200, 50)).toBe(4);
    expect(rebaseFactor(200, 0)).toBeNaN();
  });
  it('a rebased line reads the same percent on the base axis', () => {
    // Base starts at 200, the other at 50; the other doubles to 100. Scaled by 4 it sits at 400 = +100% of 200.
    const k = rebaseFactor(200, 50);
    expect(percentChange(100 * k, 200)).toBeCloseTo(100);
    expect(scaleRows([{ time: 1, value: 50 }, { time: 2, value: 100 }], k)).toEqual([{ time: 1, value: 200 }, { time: 2, value: 400 }]);
  });
  it('the reference is the first non-zero value at or after the first visible time', () => {
    const rows = [{ time: 1, value: 0 }, { time: 2, value: 0 }, { time: 3, value: 7 }, { time: 4, value: 9 }].map(r => ({ ...r, close: r.value }));
    expect(firstVisibleRef(rows, 1)).toBe(7);
    expect(firstVisibleRef(rows, 4)).toBe(9);
    expect(firstVisibleRef(rows, 5)).toBeNaN();
  });
  it('percent text carries sign and arrow, never a bare colour', () => {
    expect(percentText(12.345)).toBe('▲ +12.35%');
    expect(percentText(-4.1)).toBe('▼ −4.10%');
    expect(percentText(0)).toBe('0.00%');
    expect(percentText(0.001)).toBe('0.00%');
    expect(percentText(NaN)).toBe('');
  });
});

describe('replay timing', () => {
  it('releases at most one bar per frame', () => {
    let carry = 0;
    let steps = 0;
    for (let f = 0; f < 600; f++) { const t = tickReplay(carry, 16.7, 10); carry = t.carry; steps += t.steps; expect(t.steps).toBeLessThanOrEqual(1); }
    // 10 s of frames at 10x: about 100 bars at 800 ms / 10 = 80 ms each.
    expect(steps).toBeGreaterThan(110);
    expect(steps).toBeLessThan(135);
  });
  it('a long frame (hidden tab) never bursts', () => {
    const t = tickReplay(0, 60_000, 10);
    expect(t.steps).toBe(1);
    expect(t.carry).toBeLessThan(BASE_BAR_MS / 10);
  });
  it('1x waits a whole interval', () => {
    expect(tickReplay(0, 400, 1)).toEqual({ steps: 0, carry: 400 });
    expect(tickReplay(400, 400, 1).steps).toBe(1);
  });
  it('picks the start index and clamps steps', () => {
    const times = [10, 20, 30, 40];
    expect(startIndexAt(times, 25)).toBe(2);
    expect(startIndexAt(times, 20)).toBe(1);
    expect(startIndexAt(times, 5)).toBe(0);
    expect(startIndexAt(times, 99)).toBe(3);
    expect(startIndexAt([], 1)).toBeNull();
    expect(stepIndex(1, -5, 3)).toBe(0);
    expect(stepIndex(1, 5, 3)).toBe(3);
    expect(stepIndex(1, 1, 3)).toBe(2);
  });
});

describe('tooltip text', () => {
  it('describes a candle with the change from the previous close, a true minus and no grouping', () => {
    const row = { open: 1000.5, high: 1200, low: 990, close: 1100.25 };
    const prev = { open: 1, high: 2, low: 1, close: 1200.25 };
    const t = describeBar(row, prev, fmt);
    expect(t.kind).toBe('ohlc');
    expect(t.cells.map(c => `${c.label} ${c.value}`)).toEqual(['O 1000.50', 'H 1200.00', 'L 990.00', 'C 1100.25']);
    expect(t.change?.dir).toBe(-1);
    expect(t.change?.text).toBe('▼ −100.00 (−8.33%)');
    expect(t.cells.some(c => c.value.includes(','))).toBe(false);
  });
  it('the first candle changes from its own open; a value row from the previous value', () => {
    expect(describeBar({ open: 10, high: 12, low: 9, close: 11 }, null, fmt).change?.text).toBe('▲ +1.00 (+10.00%)');
    const v = describeBar({ value: 50 }, { value: 40 }, fmt);
    expect(v.kind).toBe('value');
    expect(v.value).toBe('50.00');
    expect(v.change?.text).toBe('▲ +10.00 (+25.00%)');
    expect(describeBar({ value: 50 }, null, fmt).change).toBeNull();
  });
  it('an unchanged price has no arrow or sign; no row, no text', () => {
    expect(describeChange(10, 10, fmt)?.text).toBe('0.00 (0.00%)');
    expect(describeChange(10, 0, fmt)).toBeNull();
    expect(describeBar(null, null, fmt).kind).toBe('none');
    expect(describeBar({ time: 1 }, null, fmt).kind).toBe('none');
  });
});

describe('tooltip placement', () => {
  const bounds = { w: 400, h: 300 };
  const size = { w: 120, h: 80 };
  it('follows the pointer right and below, flips at the right and bottom edges, stays inside', () => {
    expect(placeFloating({ x: 50, y: 50 }, size, bounds)).toEqual({ x: 64, y: 64 });
    expect(placeFloating({ x: 350, y: 50 }, size, bounds).x).toBe(350 - 14 - 120);
    expect(placeFloating({ x: 50, y: 280 }, size, bounds).y).toBe(280 - 14 - 80);
    const corner = placeFloating({ x: 395, y: 295 }, size, bounds);
    expect(corner.x + size.w).toBeLessThanOrEqual(bounds.w);
    expect(corner.y + size.h).toBeLessThanOrEqual(bounds.h);
    expect(placeFloating({ x: 2, y: 2 }, size, bounds).x).toBeGreaterThanOrEqual(0);
  });
  it('a finger puts the card above, flipping below at the top', () => {
    expect(placeFloating({ x: 100, y: 200 }, size, bounds, 28, true).y).toBe(200 - 28 - 80);
    expect(placeFloating({ x: 100, y: 20 }, size, bounds, 28, true).y).toBe(48);
  });
  it('pins over the bar, below when there is no room above, and stays in the plot', () => {
    const plot = { x: 40, width: 300, height: 260 };
    const above = placeTracking(200, 150, 190, size, plot);
    expect(above.below).toBe(false);
    expect(above.y).toBe(150 - 14 - 80);
    expect(above.x).toBe(200 - 60);
    const below = placeTracking(200, 30, 60, size, plot);
    expect(below.below).toBe(true);
    expect(below.y).toBe(74);
    expect(placeTracking(45, 150, 190, size, plot).x).toBe(44);
    expect(placeTracking(335, 150, 190, size, plot).x).toBe(40 + 300 - 120 - 4);
  });
});

describe('bands, session breaks, vertical line, watermark, realtime', () => {
  it('pairs two edges by time, keeping gaps as NaN', () => {
    const a = { t: Float64Array.from([1, 2, 4]), v: Float64Array.from([10, 11, 13]) };
    const b = { t: Float64Array.from([2, 3, 4]), v: Float64Array.from([5, NaN, 7]) };
    const p = pairEdges(a, b);
    expect([...p.t]).toEqual([1, 2, 3, 4]);
    expect([...p.up]).toEqual([10, 11, NaN, 13]);
    expect([...p.lo]).toEqual([NaN, 5, NaN, 7]);
    expect(bandExtent(p.up, p.lo, 0, 3)).toEqual({ min: 5, max: 13 });
    expect(bandExtent(p.up, p.lo, 0, 0)).toBeNull();
    expect(bandExtent(p.up, p.lo, 3, 99)).toEqual({ min: 7, max: 13 });
  });
  it('finds the first bar of each local day', () => {
    const days = [1, 1, 1, 2, 2, 3, 3, 3, 3, 4];
    expect(dayStarts(i => days[i], 0, 9)).toEqual([3, 5, 9]);
    expect(dayStarts(i => days[i], 4, 9)).toEqual([5, 9]);
    expect(dayStarts(i => days[i], 3, 3)).toEqual([]);
  });
  it('tells intraday from daily bars by the median gap', () => {
    expect(isIntraday([300, 300, 300, 3600 * 17])).toBe(true);
    expect(isIntraday([86400, 86400 * 3, 86400, 86400])).toBe(false);
    expect(isIntraday([])).toBe(false);
  });
  it('a chip goes right of the line, left of it near the edge', () => {
    expect(chipLeft(100, 60, 0, 400)).toBe(104);
    expect(chipLeft(380, 60, 0, 400)).toBe(380 - 4 - 60);
    expect(chipLeft(10, 600, 0, 400)).toBe(0);
  });
  it('places the watermark block and shrinks text to fit', () => {
    const pane = { width: 400, height: 200 };
    expect(placeBlock('center', 100, 50, pane)).toEqual({ x: 150, y: 75 });
    expect(placeBlock('top-left', 100, 50, pane)).toEqual({ x: 16, y: 16 });
    expect(placeBlock('bottom-right', 100, 50, pane)).toEqual({ x: 284, y: 134 });
    expect(fitFontSize(56, 300, 400)).toBe(56);
    expect(fitFontSize(56, 800, 400)).toBe(28);
    expect(fitFontSize(56, 99999, 400)).toBe(10);
  });
  it('the realtime button shows once the newest bar centre has left the plot', () => {
    expect(newestBarHidden(2)).toBe(false);
    expect(newestBarHidden(-0.5)).toBe(false);
    expect(newestBarHidden(-0.6)).toBe(true);
    expect(newestBarHidden(-40)).toBe(true);
  });
});

describe('radiogroup keys', () => {
  it('arrows wrap, Home and End jump, other keys do nothing', () => {
    expect(nextIndex('ArrowRight', 8, 9)).toBe(0);
    expect(nextIndex('ArrowLeft', 0, 9)).toBe(8);
    expect(nextIndex('ArrowDown', 2, 9)).toBe(3);
    expect(nextIndex('ArrowUp', 2, 9)).toBe(1);
    expect(nextIndex('Home', 5, 9)).toBe(0);
    expect(nextIndex('End', 5, 9)).toBe(8);
    expect(nextIndex('a', 5, 9)).toBe(-1);
  });
});

describe('contrast', () => {
  for (const [name, theme] of [['light', lightTheme], ['dark', darkTheme]] as const) {
    it(`${name}: alert accent is 4.5:1 text on the background`, () => {
      expect(contrastRatio(accentFor(theme), theme.background)).toBeGreaterThanOrEqual(4.5);
    });
    it(`${name}: series colours are 4.5:1 on the background (usable as text too)`, () => {
      for (const c of seriesPalette(theme)) expect(contrastRatio(c, theme.background)).toBeGreaterThanOrEqual(4.5);
    });
    it(`${name}: switcher labels are 4.5:1 on the track, selected label on the thumb`, () => {
      const c = switcherColors({ colors: theme, dark: name === 'dark' });
      expect(contrastRatio(c.label, c.track)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c.selected, c.thumb)).toBeGreaterThanOrEqual(4.5);
    });
    it(`${name}: tooltip text and change colours are 4.5:1 on the card`, () => {
      for (const c of [theme.text, theme.mutedText, theme.upText, theme.downText]) expect(contrastRatio(c, theme.background)).toBeGreaterThanOrEqual(4.5);
    });
  }
  it('contrast ratio sanity', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
    expect(contrastRatio('#777777', '#777777')).toBe(1);
  });
});

describe('alert chip layout', () => {
  const H = 22, G = 2, STEP = H + G;
  const L = (lines: [string, number][], extra: Partial<Parameters<typeof layoutAlertChips>[1]> = {}) => layoutAlertChips(lines.map(([id, y]) => ({ id, y })), { height: H, gap: G, top: 0, bottom: 400, ...extra });
  const noOverlap = (out: { y: number }[]) => out.every((c, i) => i === 0 || c.y - out[i - 1].y >= STEP - 1e-9);
  it('a lone chip sits on its line', () => {
    expect(L([['a', 100]])).toEqual([{ ids: ['a'], y: 100, line: 100 }]);
  });
  it('two lines 2 px apart: both shown, edge to edge, centred on them, in price order', () => {
    const out = L([['a', 102], ['b', 100]]);
    expect(out.map(c => c.ids[0])).toEqual(['b', 'a']);
    expect(out[1].y - out[0].y).toBe(STEP);
    expect((out[0].y + out[1].y) / 2).toBeCloseTo(101 - 0, 6);
  });
  it('three close lines stack around their mean; far lines stay put', () => {
    const out = L([['a', 200], ['b', 204], ['c', 208], ['far', 40]]);
    expect(out.map(c => c.ids[0])).toEqual(['far', 'a', 'b', 'c']);
    expect(out[0].y).toBe(40);
    expect(noOverlap(out)).toBe(true);
    expect(out[2].y).toBeCloseTo(204, 6);
  });
  it('many within 30 px collapse into one group at the mean of their lines', () => {
    const lines: [string, number][] = Array.from({ length: 10 }, (_, i) => [`a${i}`, 150 + i * 3]);
    const out = L(lines);
    expect(out).toHaveLength(1);
    expect(out[0].ids).toHaveLength(10);
    expect(out[0].line).toBeCloseTo(163.5, 6);
    expect(out[0].y).toBeCloseTo(163.5, 6);
    // Up to five stay stacked.
    expect(L(lines.slice(0, 5)).map(c => c.ids.length)).toEqual([1, 1, 1, 1, 1]);
  });
  it('near the pane edges the stack stays inside', () => {
    const top = L([['a', 1], ['b', 3], ['c', 5]]);
    expect(top[0].y).toBe(H / 2);
    expect(noOverlap(top)).toBe(true);
    const bot = L([['a', 395], ['b', 398], ['c', 399]]);
    expect(bot[2].y).toBe(400 - H / 2);
    expect(noOverlap(bot)).toBe(true);
    // A pane with room for two: three close lines become one group.
    expect(L([['a', 20], ['b', 22], ['c', 24]], { bottom: 50 })).toHaveLength(1);
  });
  it('the last-price tag (an obstacle band) is kept clear', () => {
    const out = L([['a', 200], ['b', 203]], { obstacles: [{ y0: 190, y1: 210 }] });
    for (const c of out) expect(c.y + H / 2 <= 190 - G + 1e-9 || c.y - H / 2 >= 210 + G - 1e-9).toBe(true);
    expect(noOverlap(out)).toBe(true);
  });
  it('order stays the price order while one line moves through the others; the others do not move until it is near', () => {
    let prevOrder = '';
    for (let y = 300; y >= 100; y -= 1) {
      const out = L([['a', 200], ['b', 226], ['m', y]]);
      const byLine = [...out].sort((p, q) => p.line - q.line).map(c => c.ids.join());
      expect(out.map(c => c.ids.join())).toEqual(byLine);
      expect(noOverlap(out)).toBe(true);
      if (Math.abs(y - 213) > 60) expect(out.find(c => c.ids[0] === 'a')!.y).toBe(200);
      prevOrder = byLine.join();
    }
    expect(prevOrder).toBe('m,a,b');
    // Same input, same output (no jitter between frames).
    expect(L([['a', 200], ['b', 201]])).toEqual(L([['a', 200], ['b', 201]]));
  });
});
