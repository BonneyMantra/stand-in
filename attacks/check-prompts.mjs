#!/usr/bin/env node
// Pre-flight for the real-agent routes: every injected prompt, fixture and served page may reference
// only ~ and relative paths (no absolute real-home path). Also run at runtime by realroute.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSafeInjection } from './lib/real.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
let bad = 0;
for (const d of fs.readdirSync(here).filter((x) => /^(0[1-6]|19|20)-/.test(x))) {
  const texts = [fs.readFileSync(path.join(here, d, 'route.mjs'), 'utf8')];
  const walk = (p) => fs.readdirSync(p, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(p, e.name)) : texts.push(fs.readFileSync(path.join(p, e.name), 'utf8'))));
  walk(path.join(here, d, 'fixture'));
  try { assertSafeInjection(texts); console.error(`ok   ${d} (${texts.length} files)`); } catch (e) { bad++; console.error(`FAIL ${d}: ${e.message}`); }
}
process.exit(bad ? 1 : 0);
