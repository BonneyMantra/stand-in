// One-off: node packages/canary/src/create-pool.mjs   (reads STANDIN_NTFY_TOPIC from .env.local)
import fs from 'node:fs';
import path from 'node:path';
import { createPool } from './canary.mjs';

const root = path.resolve(new URL('../../..', import.meta.url).pathname);
let topic = process.env.STANDIN_NTFY_TOPIC || '';
if (!topic) for (const l of fs.readFileSync(path.join(root, '.env.local'), 'utf8').split('\n')) if (l.startsWith('STANDIN_NTFY_TOPIC=')) topic = l.slice(19).trim().replace(/^["']|["']$/g, '');
const { pool, stopped } = await createPool({ topic, log: (m) => process.stderr.write(m + '\n') });
process.stdout.write(`pool kinds: ${pool.tokens.map((t) => t.kind).join(', ') || 'none'}${stopped ? ' (STOPPED: ' + stopped + ')' : ''}\n`);
process.exit(stopped ? 1 : 0);
