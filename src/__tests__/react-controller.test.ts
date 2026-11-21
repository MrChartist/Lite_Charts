import { describe, expect, it } from 'vitest';
import { ChartController } from '../react/controller';
import type { ChartProps } from '../react/controller';
import { createChartistReact } from '../react/index';
import type { ReactLike } from '../react/index';
import { CandlestickSeries, LineSeries } from '../index';

type Log = string[];

function fakeEnv() {
  const log: Log = [];
  let crosshair: ((p: unknown) => void) | null = null;
  let serial = 0;
  const chart = {
    applyOptions: (o: unknown) => log.push(`chart.applyOptions ${JSON.stringify(o)}`),
    addSeries: (def: { type: string }, o?: unknown) => {
      const id = ++serial;
      log.push(`addSeries ${def.type}#${id} ${JSON.stringify(o ?? null)}`);
      return {
        setData: (d: readonly unknown[]) => log.push(`#${id}.setData ${d.length}`),
        update: (r: { time: unknown }) => log.push(`#${id}.update ${String(r.time)}`),
        applyOptions: (o2: unknown) => log.push(`#${id}.applyOptions ${JSON.stringify(o2)}`),
        id,
      };
    },
    removeSeries: (s: { id: number }) => log.push(`removeSeries #${s.id}`),
    subscribeCrosshairMove: (h: (p: unknown) => void) => { crosshair = h; log.push('subscribe'); },
    unsubscribeCrosshairMove: () => { crosshair = null; log.push('unsubscribe'); },
    remove: () => log.push('remove'),
  };
  let created = 0;
  const createChart = (_el: unknown, o?: unknown) => { created++; log.push(`create ${JSON.stringify(o ?? null)}`); return chart as never; };
  return { log, createChart, get created() { return created; }, fireCrosshair: (p: unknown) => crosshair?.(p) };
}

const bar = (t: number, c = t) => ({ time: t, open: c, high: c + 1, low: c - 1, close: c });
const bars = (n: number) => Array.from({ length: n }, (_, i) => bar(i + 1));
const el = {} as HTMLElement;

describe('ChartController', () => {
  it('creates once, adds series and sets their data', () => {
    const env = fakeEnv();
    const props: ChartProps = { options: { theme: 'dark' }, series: [{ type: 'candlestick', data: bars(5) }, { type: LineSeries, id: 'sma', data: [{ time: 1, value: 1 }], options: { lineWidth: 2 } }] };
    new ChartController(el, props, env);
    expect(env.created).toBe(1);
    expect(env.log).toEqual([
      'create {"theme":"dark"}', 'subscribe',
      'addSeries candlestick#1 null', '#1.setData 5',
      'addSeries line#2 {"lineWidth":2}', '#2.setData 1',
    ]);
  });

  it('a new array with the same rows, and equal options, change nothing', () => {
    const env = fakeEnv();
    const a = bars(50);
    const c = new ChartController(el, { options: { theme: 'light' }, series: [{ type: 'candlestick', data: a, options: { wickVisible: true } }] }, env);
    env.log.length = 0;
    c.apply({ options: { theme: 'light' }, series: [{ type: 'candlestick', data: a.map(r => ({ ...r })), options: { wickVisible: true } }] });
    expect(env.log).toEqual([]);
    expect(env.created).toBe(1);
  });

  it('a changed last bar and appended bars go through update, never setData', () => {
    const env = fakeEnv();
    const a = bars(50);
    const c = new ChartController(el, { series: [{ type: 'candlestick', data: a }] }, env);
    env.log.length = 0;
    const b = [...a.slice(0, 49), bar(50, 70)];
    c.apply({ series: [{ type: 'candlestick', data: b }] });
    expect(env.log).toEqual(['#1.update 50']);
    env.log.length = 0;
    c.apply({ series: [{ type: 'candlestick', data: [...b, bar(51)] }] });
    expect(env.log).toEqual(['#1.update 50', '#1.update 51']);
  });

  it('an earlier change or a different length replaces the data', () => {
    const env = fakeEnv();
    const a = bars(20);
    const c = new ChartController(el, { series: [{ type: 'candlestick', data: a }] }, env);
    env.log.length = 0;
    c.apply({ series: [{ type: 'candlestick', data: [bar(1, 9), ...a.slice(1)] }] });
    expect(env.log).toEqual(['#1.setData 20']);
    env.log.length = 0;
    c.apply({ series: [{ type: 'candlestick', data: a.slice(0, 5) }] });
    expect(env.log).toEqual(['#1.setData 5']);
  });

  it('changed options are applied in place; changed series options too', () => {
    const env = fakeEnv();
    const a = bars(3);
    const c = new ChartController(el, { options: { theme: 'light' }, series: [{ type: 'candlestick', data: a, options: { wickVisible: true } }] }, env);
    env.log.length = 0;
    c.apply({ options: { theme: 'dark' }, series: [{ type: 'candlestick', data: a, options: { wickVisible: false } }] });
    expect(env.log).toEqual(['chart.applyOptions {"theme":"dark"}', '#1.applyOptions {"wickVisible":false}']);
  });

  it('adds, removes and retypes series by key', () => {
    const env = fakeEnv();
    const a = bars(3);
    const c = new ChartController(el, { series: [{ id: 'p', type: 'candlestick', data: a }, { id: 'x', type: 'line', data: [{ time: 1, value: 1 }] }] }, env);
    env.log.length = 0;
    c.apply({ series: [{ id: 'x', type: 'line', data: [{ time: 1, value: 1 }] }, { id: 'p', type: CandlestickSeries, data: a }, { id: 'n', type: 'line', data: [{ time: 2, value: 2 }] }] });
    // 'p' keeps its slot (a type name and the definition object resolve to the same definition), 'n' is added.
    expect(env.log).toEqual(['addSeries line#3 null', '#3.setData 1']);
    env.log.length = 0;
    c.apply({ series: [{ id: 'x', type: 'candlestick', data: a }] });
    expect(env.log).toEqual(['removeSeries #2', 'removeSeries #1', 'removeSeries #3', 'addSeries candlestick#4 null', '#4.setData 3']);
  });

  it('onReady runs once, after creation, with the chart; a destroyed controller is never announced', async () => {
    const env = fakeEnv();
    const seen: unknown[] = [];
    const c = new ChartController(el, { onReady: ch => seen.push(ch) }, env);
    expect(seen).toEqual([]);
    await Promise.resolve();
    expect(seen).toEqual([c.chart]);

    const first = new ChartController(el, { onReady: ch => seen.push(ch) }, env);
    first.destroy();
    const second = new ChartController(el, { onReady: ch => seen.push(ch) }, env);
    await Promise.resolve();
    expect(seen).toEqual([c.chart, second.chart]);
    expect(first.chart).toBe(second.chart);
  });

  it('the crosshair handler is subscribed once and always calls the latest prop', () => {
    const env = fakeEnv();
    const calls: string[] = [];
    const c = new ChartController(el, { onCrosshairMove: () => calls.push('old') }, env);
    c.apply({ onCrosshairMove: () => calls.push('new') });
    env.fireCrosshair({});
    expect(calls).toEqual(['new']);
    expect(env.log.filter(l => l === 'subscribe')).toHaveLength(1);
  });

  it('destroy removes the chart once and later applies do nothing', () => {
    const env = fakeEnv();
    const c = new ChartController(el, { series: [{ type: 'line', data: [{ time: 1, value: 1 }] }] }, env);
    c.destroy();
    c.destroy();
    env.log.length = 0;
    c.apply({ series: [{ type: 'line', data: [{ time: 1, value: 2 }] }] });
    expect(env.log).toEqual([]);
  });

  it('an unknown series type is a plain-words error', () => {
    const env = fakeEnv();
    expect(() => new ChartController(el, { series: [{ type: 'pie' as never }] }, env)).toThrow(/unknown series type "pie"/);
  });
});

describe('createChartistReact (server render)', () => {
  // A stand-in for React: hooks do nothing, as on the server where effects never run.
  const fake: ReactLike<{ type: string; props: Record<string, unknown> }> = {
    createElement: (type, props) => ({ type, props: props ?? {} }),
    useRef: initial => ({ current: initial }),
    useEffect: () => undefined,
    useState: initial => [initial, () => undefined],
  };
  const { ChartistChart } = createChartistReact(fake);

  it('renders an empty sized div and touches no DOM', () => {
    const out = ChartistChart({ className: 'c', series: [{ type: 'line', data: [] }] });
    expect(out.type).toBe('div');
    expect(out.props.className).toBe('c');
    expect(out.props.style).toEqual({ position: 'relative', width: '100%', height: 360 });
  });

  it('height and style props', () => {
    expect(ChartistChart({ height: '50vh' }).props.style).toMatchObject({ height: '50vh' });
    expect(ChartistChart({ height: 200, style: { height: 100, border: 'none' } }).props.style).toMatchObject({ height: 100, border: 'none' });
  });
});
