// The few Node APIs the boundary test uses, declared here so the package needs no @types/node.
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function readdirSync(path: string, options: { withFileTypes: true }): { name: string; isDirectory(): boolean }[];
}
declare module 'node:path' {
  export const sep: string;
  export function join(...parts: string[]): string;
  export function resolve(...parts: string[]): string;
  export function dirname(path: string): string;
  export function relative(from: string, to: string): string;
}
declare module 'node:url' {
  export function fileURLToPath(url: string): string;
}
