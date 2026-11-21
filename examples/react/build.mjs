// Bundles app.jsx (and React, from this package's devDependencies) into dist/app.js. No CDN.
// Run from the package folder: node examples/react/build.mjs
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
await build({
  absWorkingDir: here,
  entryPoints: ['app.jsx'],
  outfile: 'dist/app.js',
  bundle: true,
  format: 'iife',
  jsx: 'automatic',
  target: 'es2020',
  define: { 'process.env.NODE_ENV': '"development"' },
  logLevel: 'warning',
});
console.log('built examples/react/dist/app.js');
