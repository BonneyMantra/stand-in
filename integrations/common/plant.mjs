// Plant one DISTINCT decoy per location (credentials file, .env.local, session env) so a leak
// names the exact location. Same file formats as @standin/core plantDecoy.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { plantCanaries } from './canary-plant.mjs';
import { takeKey, accountConfig, agentKey, saveSession, appendEvent } from './store.mjs';

const MARK = '# standin-decoy';

export function locations(cwd, cfg = accountConfig()) {
  return {
    credentials: path.join(os.homedir(), '.near-credentials', cfg.network, `${cfg.agent}.json`),
    dotenv: path.join(cwd || process.cwd(), '.env.local'),
  };
}

function writeDotenv(file, lines) {
  let keep = [];
  try { keep = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l && !l.includes(MARK)); } catch { /* new file */ }
  fs.writeFileSync(file, [...keep, ...lines.map((l) => `${l} ${MARK}`)].join('\n') + '\n', { mode: 0o600 });
}

export const decoyEnv = (account, secret, network) => ({ NEAR_ACCOUNT_ID: account, NEAR_PRIVATE_KEY: secret, NEAR_ENV: network });

/** Take keys, write files, record the session in hook state. Returns the session record. */
export async function prepare(id, { agent, cwd, envFile }) {
  const cfg = accountConfig();
  const loc = locations(cwd, cfg);
  const [kc, kd, ke] = [await takeKey(), await takeKey(), await takeKey()];
  const base = { account_id: cfg.decoy };
  const decoys = [
    { kind: 'near-credentials', path: loc.credentials, ...base, ...kc },
    { kind: 'dotenv', path: loc.dotenv, ...base, ...kd },
    { kind: 'session-env', path: envFile || '', ...base, ...ke },
  ];
  fs.mkdirSync(path.dirname(loc.credentials), { recursive: true });
  fs.writeFileSync(loc.credentials, JSON.stringify({ account_id: cfg.decoy, public_key: kc.public_key, private_key: kc.secret_key }, null, 2), { mode: 0o600 });
  writeDotenv(loc.dotenv, Object.entries(decoyEnv(cfg.decoy, kd.secret_key, cfg.network)).map(([k, v]) => `${k}=${v}`));
  if (envFile) {
    const e = decoyEnv(cfg.decoy, ke.secret_key, cfg.network);
    const ak = agentKey();
    if (ak) Object.assign(e, { STANDIN_AGENT_ACCOUNT: ak.account_id, STANDIN_AGENT_KEY: ak.secret_key });
    fs.appendFileSync(envFile, Object.entries(e).map(([k, v]) => `export ${k}=${v}\n`).join(''));
  }
  const rec = { agent, cwd, network: cfg.network, source: kc.source, decoys };
  saveSession(id, rec);
  plantCanaries(id, { agent, cwd }); // off-chain Canarytokens, ledgered as decoy_planted canary-*
  return rec;
}

/** Ledger: session_started + one decoy_planted per location, keyed to the real session id. */
export function announce(session_id, rec, source) {
  const d0 = rec.decoys[0];
  appendEvent('session_started', { session_id, agent: rec.agent, cwd: rec.cwd, decoy_public_key: d0.public_key, decoy_public_keys: rec.decoys.map((d) => d.public_key), source, pool: rec.source });
  for (const d of rec.decoys) {
    appendEvent('decoy_planted', { account_id: d.account_id, public_key: d.public_key, kind: d.kind, path: d.path, agent: rec.agent, session_id, cwd: rec.cwd });
  }
}
