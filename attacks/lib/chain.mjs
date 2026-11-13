// Testnet helpers for attacks and bench. Testnet only; refuses any other network.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { REPO } from './sandbox.mjs';

/** Retry on public-RPC rate limits (HTTP 429 / failover exhausted). */
export async function retry(fn, tries = 10) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      if (!/429|Exceeded \d+ providers|fetch failed|timeout/i.test(String(e.message))) throw e;
      await new Promise((r) => setTimeout(r, Math.min(15000, 2000 * (i + 1))));
    }
  }
  throw last;
}

let _core;
export async function core() {
  if (!_core) _core = await import(path.join(REPO, 'packages/core/src/index.ts'));
  const cfg = _core.loadNetworkConfig();
  if (cfg.network !== 'testnet') throw new Error(`attacks/bench run on testnet only (config says ${cfg.network})`);
  return { c: _core, cfg };
}

export async function balanceNear(accountId) {
  const { c, cfg } = await core();
  try {
    const a = await c.makeProvider(cfg).viewAccount({ accountId });
    return Number(BigInt(a.amount) / 10n ** 18n) / 1e6;
  } catch { return null; }
}

export async function guardianState() {
  const { c, cfg } = await core();
  try { return await c.makeProvider(cfg).callFunction({ contractId: c.requireAccount(cfg, 'agent'), method: 'get_state', args: {} }); } catch (e) { return { error: String(e.message).slice(0, 120) }; }
}

/** Disposable "real" account for the Stand-in-OFF baseline: a subaccount of the agent account. */
export const createBaselineAccount = (fundNear = '0.3') => retry(() => createBaselineAccountOnce(fundNear));
async function createBaselineAccountOnce(fundNear) {
  const { c, cfg } = await core();
  // Funded by the attacker account (it holds the testnet loot), so the guardian's agent account is never touched.
  const id = `bl${Date.now().toString(36)}.${c.requireAccount(cfg, 'attacker')}`;
  const kp = c.generateKey();
  const owner = c.roleAccount(cfg, 'attacker');
  const { KeyPair } = createRequire(path.join(REPO, 'packages/core/package.json'))('near-api-js');
  await owner.signAndSendTransaction({
    receiverId: id,
    actions: [c.actions.createAccount(), c.actions.transfer(c.parseNearAmountSafe(fundNear)), c.actions.addFullAccessKey(KeyPair.fromString(kp.secret_key).getPublicKey())],
    waitUntil: 'EXECUTED_OPTIMISTIC',
  });
  return { account_id: id, ...kp };
}

export async function deleteBaselineAccount(b) {
  const { c, cfg } = await core();
  try {
    const acct = c.makeAccount(cfg, b.account_id, b.secret_key);
    await acct.signAndSendTransaction({ receiverId: b.account_id, actions: [c.actions.deleteAccount(c.requireAccount(cfg, 'attacker'))], waitUntil: 'EXECUTED_OPTIMISTIC' });
    return true;
  } catch { return false; }
}

/** After a freeze: unfreeze, then provision a fresh scoped function-call key and save it where hooks read it. */
export const resetAgent = (standinHome) => retry(() => resetAgentOnce(standinHome));
async function resetAgentOnce(standinHome) {
  const { c, cfg } = await core();
  const agent = c.requireAccount(cfg, 'agent');
  const project = c.requireAccount(cfg, 'project');
  const owner = c.roleAccount(cfg, 'agent');
  const st = await guardianState();
  if (st?.frozen) await c.callMethod(owner, agent, 'unfreeze', {}, { waitUntil: 'EXECUTED_OPTIMISTIC' });
  const scoped = c.generateKey();
  const methods = ['record_deploy'];
  await c.callMethod(owner, agent, 'add_agent_key', { public_key: scoped.public_key, receiver_id: project, method_names: methods, allowance: '1000000000000000000000000' }, { waitUntil: 'EXECUTED_OPTIMISTIC' });
  fs.mkdirSync(standinHome, { recursive: true });
  fs.writeFileSync(path.join(standinHome, 'agent-scoped-key.json'), JSON.stringify({ account_id: agent, ...scoped, receiver_id: project, method_names: methods, created_at: new Date().toISOString() }, null, 2), { mode: 0o600 });
  return scoped;
}

/** Legit use of the scoped FC key: record_deploy on the project contract. */
export async function useScopedKey(k, note = 'attack-suite') {
  const { c, cfg } = await core();
  try {
    const acct = c.makeAccount(cfg, k.account_id, k.secret_key);
    await c.callMethod(acct, c.requireAccount(cfg, 'project'), 'record_deploy', { note }, { waitUntil: 'EXECUTED_OPTIMISTIC' });
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 200) }; }
}

/** Return baseline loot from the attacker account to the agent account (testnet bookkeeping). */
export async function returnLoot(near) {
  if (!(near > 0.01)) return null;
  const { c, cfg } = await core();
  const thief = c.roleAccount(cfg, 'attacker');
  const amount = c.parseNearAmountSafe((near - 0.005).toFixed(4));
  await thief.signAndSendTransaction({ receiverId: c.requireAccount(cfg, 'agent'), actions: [c.actions.transfer(amount)], waitUntil: 'EXECUTED_OPTIMISTIC' });
  return near;
}

/** Block heights read from chain for a tx: inclusion block and the last receipt's execution block. */
export async function txBlocks(txHash, signerId) {
  const { c, cfg } = await core();
  return retry(async () => {
    const prov = c.makeProvider(cfg);
    const r = await prov.viewTransactionStatus({ txHash, accountId: signerId, waitUntil: 'FINAL' });
    const h = async (hash) => Number((await prov.viewBlock({ blockId: hash })).header.height);
    const included = await h(r.transaction_outcome.block_hash);
    const exec = await Promise.all((r.receipts_outcome || []).map((o) => h(o.block_hash)));
    return { included, executed: exec.length ? Math.max(...exec) : included };
  });
}
