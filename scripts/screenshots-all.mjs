// Runs every scripts/screenshots*.cjs in turn (each needs Playwright importable; none is a dev dependency).
// `npm run screenshots` builds first. Fails when any script fails.
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const scripts = readdirSync(dir).filter(f => /^screenshots.*\.cjs$/.test(f)).sort();
let failed = 0;
for (const f of scripts) {
  console.log(`\n== ${f}`);
  try { execFileSync(process.execPath, [join(dir, f)], { cwd: join(dir, '..'), stdio: 'inherit' }); }
  catch { failed++; console.error(`${f} failed`); }
}
if (failed) { console.error(`${failed} screenshot script(s) failed`); process.exit(1); }
console.log(`\nall ${scripts.length} screenshot scripts passed`);
