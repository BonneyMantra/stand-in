#!/usr/bin/env node
// node attacks/run.mjs [route-id-prefix ...|all] [--mode on|off|both]
// Always sandboxed; testnet only. Logs: attacks/logs/<route>.<mode>.json|log
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRoute } from './lib/route.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const mi = args.indexOf('--mode');
const mode = mi >= 0 ? args.splice(mi, 2)[1] : 'on';
const want = args.length && args[0] !== 'all' ? args : null;
export const routeDirs = () => fs.readdirSync(here).filter((d) => /^\d\d-/.test(d)).sort().filter((d) => !want || want.some((w) => d.startsWith(w)));

const results = [];
for (const d of routeDirs()) {
  const { meta, attack } = await import(path.join(here, d, 'route.mjs'));
  for (const m of mode === 'both' ? ['on', 'off'] : [mode]) {
    process.stderr.write(`== ${meta.id} [${meta.kind}] mode=${m}\n`);
    const r = await runRoute(meta, attack, { mode: m });
    results.push(r);
    process.stderr.write(`   ${r.status || (r.score ? `detected=${r.score.exposure_detected} trip=${r.score.trip_detected}` : JSON.stringify(r.baseline))}\n`);
  }
}
process.stdout.write(JSON.stringify(results, null, 2) + '\n');
