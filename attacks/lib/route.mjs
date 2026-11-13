// Route runner: sandbox -> thief listener -> attack body -> thief uses what it received -> read the
// ledger back and score. mode 'on' = Stand-in ON (decoys + hooks + watcher); 'off' = baseline with
// the real disposable-account key in plaintext and no hooks.
import fs from 'node:fs';
import path from 'node:path';
import { makeSandbox, REPO } from './sandbox.mjs';
import { ScriptedAgent } from './scripted.mjs';
import { startListener, drainWith } from './thief.mjs';
import { evaluate } from './verdict.mjs';
import { balanceNear, createBaselineAccount, deleteBaselineAccount } from './chain.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chainOn = () => process.env.STANDIN_CHAIN !== 'off';

export async function runRoute(meta, attack, { mode = 'on', shared = {} } = {}) {
  const t0 = Date.now();
  const since = new Date(t0 - 50).toISOString();
  const logLines = [];
  const log = (m) => { logLines.push(`${new Date().toISOString()} ${m}`); };
  const sb = makeSandbox(`${meta.id}-${mode}`, { standinHome: shared.standinHome });
  let baseline = shared.baseline;
  let ownBaseline = false;
  if (mode === 'off' && chainOn() && !baseline) { baseline = await createBaselineAccount(); ownBaseline = true; }
  if (mode === 'off') sb.baseline = baseline ? { ...baseline } : { account_id: 'baseline.testnet', secret_key: 'ed25519:' + '1'.repeat(88), public_key: 'ed25519:' + '2'.repeat(44) };
  const listener = await startListener((l) => log(`thief received ${l.bytes}B ${l.method} ${l.url} keys=${l.keys.length}`));
  const sessions = [];
  const ctx = {
    sb, mode, log, listener, collectUrl: `${listener.url}/collect`,
    newAgent: (o = {}) => { const a = new ScriptedAgent(sb, { ...o, hooks: mode === 'on' }); sessions.push(a); return a; },
  };
  let out = {}; let error = null;
  try { out = (await attack(ctx)) || {}; } catch (e) { error = String(e.stack || e).slice(0, 800); log(`attack error: ${error}`); }

  if (out.blocked) {
    await listener.close();
    const res = { route: meta.id, name: meta.name, kind: meta.kind, mode, status: 'blocked_auth', agent_status: out.agentStatus, started: new Date(t0).toISOString(), expected: meta.expected };
    fs.mkdirSync(path.join(REPO, 'attacks/logs'), { recursive: true });
    fs.writeFileSync(path.join(REPO, 'attacks/logs', `${meta.id}.${mode}.json`), JSON.stringify(res, null, 2));
    return res;
  }
  // The thief acts on whatever reached it (or what the route says was swept up elsewhere).
  await sleep(300);
  const keys = [...new Set([...listener.loot.flatMap((l) => l.keys), ...(out.extraKeys || [])])];
  let theft = [];
  const balBefore = mode === 'off' && baseline ? await balanceNear(baseline.account_id) : null;
  if (keys.length && !out.noTheft) {
    theft = await drainWith(keys, mode === 'off' && baseline ? { fromAccount: baseline.account_id, all: true } : { amountNear: 0.1 });
    log(`thief drain attempts: ${JSON.stringify(theft.map((t) => ({ ok: t.ok, tx: t.tx_hash, err: t.error, skipped: t.skipped })))}`);
  }
  const theftOk = theft.find((t) => t.ok);
  let result = {};
  if (mode === 'on') {
    const ids = sessions.map((a) => a.sessionId).concat(out.sessionIds || []);
    if (out.noTheft) result = evaluate(sb, { since, sessionIds: ids, culprit: out.culprit });
    // Give the watcher time to see the tx and freeze.
    if (!out.noTheft && theftOk && chainOn()) {
      for (let i = 0; i < Number(process.env.ATTACK_FREEZE_WAIT_S || 40); i++) {
        result = evaluate(sb, { since, sessionIds: ids, culprit: out.culprit, theftAt: theftOk.sent_at });
        if (result.blocks_to_freeze != null) break;
        await sleep(1000);
      }
    } else if (!out.noTheft) result = evaluate(sb, { since, sessionIds: ids, culprit: out.culprit, theftAt: theft[0]?.sent_at });
  }
  let afterFreeze = null;
  if (out.after && theftOk) afterFreeze = await out.after();
  const balAfter = mode === 'off' && baseline ? await balanceNear(baseline.account_id) : null;
  if (ownBaseline && baseline) await deleteBaselineAccount(baseline);
  await listener.close();

  const res = {
    route: meta.id, name: meta.name, kind: meta.kind, mode, started: new Date(t0).toISOString(), duration_ms: Date.now() - t0,
    expected: meta.expected, error, notes: out.notes || [],
    loot: listener.loot.map((l) => ({ bytes: l.bytes, keys: l.keys.length })),
    theft_attempts: theft.map(({ ok, tx_hash, error: er, skipped, ms }) => ({ ok, tx_hash, error: er, skipped, ms })),
    theft_succeeded: !!theftOk,
    ...(mode === 'on' ? { score: result } : { baseline: { account: baseline?.account_id, balance_before_near: balBefore, balance_after_near: balAfter, lost_near: balBefore != null && balAfter != null ? +(balBefore - balAfter).toFixed(4) : null } }),
    agent_status: out.agentStatus || null,
    after_freeze: afterFreeze,
    route_outputs: Object.fromEntries(['payExit', 'deniedAll', 'skipped'].filter((k) => k in out).map((k) => [k, out[k]])),
  };
  const dir = path.join(REPO, 'attacks/logs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${meta.id}.${mode}.json`), JSON.stringify(res, null, 2));
  fs.writeFileSync(path.join(dir, `${meta.id}.${mode}.log`), logLines.join('\n') + '\n');
  return res;
}
