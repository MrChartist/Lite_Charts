import { afterEach, describe, expect, it } from 'vitest';
import { defineChartistElement } from '../element/index';

const g = globalThis as Record<string, unknown>;

describe('defineChartistElement', () => {
  afterEach(() => { delete g.customElements; delete g.HTMLElement; });

  it('registers nothing and returns null where there is no DOM', () => {
    expect(typeof g.customElements).toBe('undefined');
    expect(defineChartistElement()).toBeNull();
  });

  it('registers under the given tag once, and returns the same class the second time', () => {
    const registry = new Map<string, unknown>();
    const calls: string[] = [];
    g.customElements = {
      get: (n: string) => registry.get(n),
      define: (n: string, c: unknown) => { calls.push(n); registry.set(n, c); },
    };
    g.HTMLElement = class {};
    const a = defineChartistElement('price-chart');
    const b = defineChartistElement('price-chart');
    expect(a).toBeTypeOf('function');
    expect(b).toBe(a);
    expect(calls).toEqual(['price-chart']);
    expect((a as unknown as { observedAttributes: string[] }).observedAttributes).toEqual(
      ['type', 'theme', 'height', 'time-zone', 'volume', 'attribution', 'src', 'aria-label'],
    );
    expect(defineChartistElement()).not.toBe(a);
    expect(calls).toEqual(['price-chart', 'chartist-chart']);
  });
});
