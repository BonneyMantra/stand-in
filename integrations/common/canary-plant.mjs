// Plant the off-chain Canarytokens decoys (pool from <repo>/.secrets/canary.json) next to the NEAR
// decoys. Writes ONLY inside the session HOME or the session cwd; anything else is refused.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendEvent, repoDir } from './store.mjs';

const MARK = 'standin-canary';

export function inside(file, roots) {
  const f = path.resolve(file);
  return roots.some((r) => { const rel = path.relative(path.resolve(r), f); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); });
}

export function loadCanaryPool(repo = repoDir()) {
  try { return JSON.parse(fs.readFileSync(path.join(repo, '.secrets', 'canary.json'), 'utf8')).tokens || []; } catch { return []; }
}

function write(file, content, roots) {
  if (!inside(file, roots)) throw new Error(`canary plant refused outside sandbox: ${file}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, { mode: 0o600 });
}

function mcpMerge(file, mcpjson) {
  let cur = {};
  try { cur = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* new */ }
  const add = JSON.parse(mcpjson).mcpServers || {};
  cur.mcpServers = { ...(cur.mcpServers || {}), ...add };
  return JSON.stringify(cur, null, 2) + '\n';
}

/** Returns the planted [{kind, path}]. No pool file means no canaries (never an error). */
export function plantCanaries(session_id, { agent, cwd, tokens = loadCanaryPool(), home = os.homedir() } = {}) {
  const proj = cwd || process.cwd();
  const roots = [home, proj];
  const by = Object.fromEntries(tokens.map((t) => [t.kind, t]));
  const plan = [];
  if (by['canary-url']?.url) plan.push(['canary-url', path.join(home, '.aws', 'sync-endpoint.conf'), `# nightly backup heartbeat (${MARK})\nheartbeat_url=${by['canary-url'].url}\n`]);
  if (by['canary-dns']?.hostname) plan.push(['canary-dns', path.join(proj, '.env.staging'), `# ${MARK}\nBACKUP_SYNC_HOST=${by['canary-dns'].hostname}\n`]);
  if (by['canary-mcp']?.mcpjson) plan.push(['canary-mcp', path.join(proj, '.mcp.json'), null]);
  const planted = [];
  for (const [kind, file, content] of plan) {
    try {
      write(file, content ?? mcpMerge(file, by[kind].mcpjson), roots);
      planted.push({ kind, path: file });
      appendEvent('decoy_planted', { kind, path: file, agent, session_id, cwd: proj, off_chain: true });
    } catch (e) { appendEvent('tool_call', { tool_name: 'standin', warning: `canary ${kind} not planted: ${e.message}`.slice(0, 200) }); }
  }
  return planted;
}
