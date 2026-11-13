// Adapter between the hooks and Stand-in state. Ledger = @standin/core's format (NDJSON
// `{type, at, ...}` in $STANDIN_HOME/ledger.ndjson, same event names) written directly so hooks
// stay dependency-free and fast. Decoy keys come from @standin/core's chain-backed pool when the
// repo's core is importable (STANDIN_REPO), else a local mint (offline testing: NOT on-chain).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const home = () => process.env.STANDIN_HOME || path.join(os.homedir(), '.standin');
const sessionsFile = () => path.join(home(), 'sessions.json'); // hook state incl. decoy secrets; agent-denied

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function b58(buf) {
  let n = BigInt('0x' + (Buffer.from(buf).toString('hex') || '0'));
  let s = '';
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of buf) { if (b === 0) s = '1' + s; else break; }
  return s;
}
export function mintLocalKey() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const seed = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32);
  return { public_key: 'ed25519:' + b58(pub), secret_key: 'ed25519:' + b58(Buffer.concat([seed, pub])) };
}

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

export function appendEvent(type, payload = {}) {
  const row = { type, at: new Date().toISOString(), ...payload };
  fs.mkdirSync(home(), { recursive: true });
  fs.appendFileSync(path.join(home(), 'ledger.ndjson'), JSON.stringify(row) + '\n');
  return row;
}
export function readEvents(type) {
  try {
    return fs.readFileSync(path.join(home(), 'ledger.ndjson'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => !type || e.type === type);
  } catch { return []; }
}

function repoDir() {
  if (process.env.STANDIN_REPO) return process.env.STANDIN_REPO;
  try { return JSON.parse(fs.readFileSync(new URL('./repo.json', import.meta.url), 'utf8')).repo; } catch { return ''; }
}

export function accountConfig() {
  const cfg = readJson(path.join(repoDir(), 'config/testnet.json'), {});
  return {
    network: process.env.STANDIN_NETWORK || cfg.network || 'testnet',
    decoy: process.env.STANDIN_DECOY_ACCOUNT || cfg.accounts?.decoy || 'si-decoy-0.testnet',
    agent: process.env.STANDIN_AGENT_ACCOUNT || cfg.accounts?.agent || 'si-agent-0.testnet',
  };
}

/** One decoy key. Returns {public_key, secret_key, source}. */
export async function takeKey() {
  const repo = repoDir();
  if (repo && process.env.STANDIN_POOL !== 'local') {
    try {
      const core = await import(path.join(repo, 'packages/core/src/pool.ts'));
      const k = await core.takeDecoy({ home: home() });
      return { public_key: k.public_key, secret_key: k.secret_key, source: 'core' };
    } catch (e) {
      appendEvent('tool_call', { tool_name: 'standin', warning: `core pool unavailable, minting local key: ${e.message}`.slice(0, 200) });
    }
  }
  return { ...mintLocalKey(), source: 'local' };
}

// sessions.json: { [session_id | launch_id]: { agent, cwd, decoys: [{kind, path, account_id, public_key, secret_key}] } }
export const readSessions = () => readJson(sessionsFile(), {});
export const secretHash = (secret) => crypto.createHash('sha256').update(String(secret).replace(/^ed25519:/, '')).digest('hex');
// Secrets are never stored in hook state, only their hash: a `grep -r ed25519:` over the agent's
// reachable disk finds decoys in the planted files, not a list of every session's keys.
export function saveSession(id, rec) {
  const all = readSessions();
  all[id] = { ...rec, decoys: rec.decoys.map(({ secret_key, ...d }) => ({ ...d, secret_hash: secretHash(secret_key) })) };
  fs.mkdirSync(home(), { recursive: true });
  fs.writeFileSync(sessionsFile(), JSON.stringify(all, null, 2), { mode: 0o600 });
}
export function renameSession(from, to) {
  const all = readSessions();
  if (!all[from] || all[to]) return all[to] || null;
  all[to] = all[from]; delete all[from];
  fs.writeFileSync(sessionsFile(), JSON.stringify(all, null, 2), { mode: 0o600 });
  return all[to];
}
/** Every decoy ever planted: [{session_id, kind, path, account_id, public_key, secret_key}] */
export function allDecoys() {
  return Object.entries(readSessions()).flatMap(([session_id, s]) => (s.decoys || []).map((d) => ({ session_id, ...d })));
}
export const sessionsPath = sessionsFile;

export function agentKey() {
  const k = readJson(path.join(home(), 'agent-scoped-key.json'), null);
  if (!k) return null;
  return { account_id: k.account_id || k.agent_account, public_key: k.public_key, secret_key: k.secret_key || k.private_key };
}
