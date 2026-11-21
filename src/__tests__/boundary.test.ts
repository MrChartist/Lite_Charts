// The rules that keep this package liftable into its own repository: no import leaves the package, source files
// import no other package, and nothing touches the DOM when a module is imported (SSR-safe).
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = join(pkg, 'src');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx|mts)$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = walk(src);
const isTest = (f: string): boolean => f.includes(`${sep}__tests__${sep}`) || f.endsWith('.test.ts');
const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function specifiers(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(IMPORT_RE)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/** Text with comments and string contents removed. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, '""');
}

describe('package boundary', () => {
  it('finds the source files', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('no import leaves the package; source files import no other package', () => {
    const bad: string[] = [];
    for (const f of files) {
      for (const spec of specifiers(readFileSync(f, 'utf8'))) {
        if (spec.startsWith('.')) {
          const target = resolve(dirname(f), spec);
          if (relative(pkg, target).startsWith('..')) bad.push(`${relative(pkg, f)} -> ${spec}`);
        } else if (!isTest(f) || !['vitest', 'node:fs', 'node:path', 'node:url'].includes(spec)) {
          bad.push(`${relative(pkg, f)} -> ${spec}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('no DOM or browser global is touched at module top level', () => {
    const bad: string[] = [];
    const GLOBALS = /\b(window|document|navigator|matchMedia|requestAnimationFrame|ResizeObserver|devicePixelRatio|localStorage|customElements|HTMLElement)\b/;
    for (const f of files.filter(x => !isTest(x))) {
      const lines = code(readFileSync(f, 'utf8')).split('\n');
      let depth = 0;
      for (const line of lines) {
        // Only statements at brace depth 0 run on import. `typeof x` checks are allowed anywhere.
        if (depth === 0 && GLOBALS.test(line.replace(/typeof\s+\w+/g, '')) && !/^\s*(import|export\s+type|type|interface)\b/.test(line)) {
          bad.push(`${relative(pkg, f)}: ${line.trim()}`);
        }
        for (const ch of line) {
          if (ch === '{' || ch === '(') depth++;
          else if (ch === '}' || ch === ')') depth--;
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('imports and exposes the API in an environment with no DOM', async () => {
    expect(typeof (globalThis as { window?: unknown }).window).toBe('undefined');
    const mod = await import('../index');
    expect(typeof mod.createChart).toBe('function');
    expect(mod.CandlestickSeries.type).toBe('candlestick');
    expect(mod.LineSeries.type).toBe('line');
    expect(() => mod.createChart('chart')).toThrow(/no element/);
    for (const entry of ['../indicators/index', '../element/index', '../react/index']) {
      await expect(import(entry)).resolves.toBeDefined();
    }
  });
});
