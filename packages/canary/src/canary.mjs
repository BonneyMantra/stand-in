// Canarytokens off-chain decoys. A small pool (max 4) is created ONCE and reused; each token's
// webhook is the owner's ntfy topic, so a firing canary is a phone push with no server.
// The pool file (<repo>/.secrets/canary.json, 0600) holds manage URLs, which are secrets.
import fs from 'node:fs';
import path from 'node:path';

export const GENERATE = 'https://canarytokens.org/d3aece8093b71007b5ccfedad91ebb11/generate';
export const MAX_POOL = 4;
export const GAP_MS = 5000;

export const ntfyWebhook = (topic) => `https://ntfy.sh/${topic}?title=${encodeURIComponent('Canary fired: a Stand-in decoy was touched')}&priority=5&tags=rotating_light`;

const repoRoot = () => process.env.STANDIN_REPO || path.resolve(new URL('../../..', import.meta.url).pathname);
export const poolFile = () => path.join(repoRoot(), '.secrets', 'canary.json');

export function loadPool(file = poolFile()) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
export function savePool(pool, file = poolFile()) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(pool, null, 2), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

/** One token. Throws (with no secrets in the message) on any non-success so callers stop. */
export async function generate(body, fetchImpl = fetch) {
  const r = await fetchImpl(GENERATE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { j = null; }
  if (!r.ok || !j || j.error) throw new Error(`canarytokens refused ${body.token_type}: HTTP ${r.status} ${String(j?.error_message || text).slice(0, 160)}`);
  return j;
}

/** Strip a generate response down to what planting and managing need. */
export function shape(kind, j) {
  const manage_url = j.manage_url || (j.auth_token && j.token ? `https://canarytokens.org/nest/manage?token=${j.token}&auth=${j.auth_token}` : '');
  return { kind, token: j.token || j.canarytoken || '', hostname: j.hostname || '', url: j.url || j.token_url || '', mcpjson: j.mcpjson || null, manage_url, created_at: new Date().toISOString() };
}

const SPECS = (webhook_url) => [
  ['canary-dns', { token_type: 'dns', webhook_url, memo: 'standin decoy: dns' }],
  ['canary-url', { token_type: 'web', webhook_url, memo: 'standin decoy: url' }],
  ['canary-mcp', { token_type: 'mcp', mcp_alert_on: 'tool_call', webhook_url, memo: 'standin decoy: mcp tool_call' }],
];

/** Create the pool once. Skips kinds already present; 5 s between calls; stops at the first refusal. */
export async function createPool({ topic, file = poolFile(), fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = () => {} } = {}) {
  if (!topic) throw new Error('STANDIN_NTFY_TOPIC is required');
  const pool = loadPool(file) || { tokens: [] };
  let first = true;
  for (const [kind, body] of SPECS(ntfyWebhook(topic))) {
    if (pool.tokens.some((t) => t.kind === kind)) continue;
    if (pool.tokens.length >= MAX_POOL) break;
    if (!first) await sleep(GAP_MS);
    first = false;
    try { pool.tokens.push(shape(kind, await generate(body, fetchImpl))); } catch (e) { log(`stopped: ${e.message}`); savePool(pool, file); return { pool, stopped: e.message }; }
    savePool(pool, file);
    log(`created ${kind}`);
  }
  return { pool, stopped: null };
}
