#!/usr/bin/env node
// Bench: the attack suite with Stand-in ON (decoys, hooks, watcher, guardian) and with it OFF
// (the real disposable-account key in plaintext, no hooks). Testnet only. Writes results.json and
// README.md. Flags: --routes 07,09  --no-baseline  --start-watcher  --pool N
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { REPO } from '../attacks/lib/sandbox.mjs';
import { runRoute } from '../attacks/lib/route.mjs';
import { core, balanceNear, guardianState, resetAgent, retry, returnLoot } from '../attacks/lib/chain.mjs';
import { summarize } from './summary.mjs';
import { renderReadme } from './report.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const startedAt = new Date().toISOString();
const runId =new Date().toISOString().replace(/[:.]/g, '-'); // each bench run gets its own ledger and watcher home
const shared = path.join(REPO, '.sandbox', `bench-${runId}`, '.standin');
fs.mkdirSync(shared, { recursive: true });
process.env.ATTACK_STANDIN_HOME = shared;
process.env.STANDIN_WATCHER_PORT = String(4400 + Math.floor(Math.random() * 500)); // private per run: never reuse another run's or session's watcher
if (!flag('--with-report')) process.env.STANDIN_NO_REPORT ||= '1'; // blocklist report costs testnet NEAR; owned by the registry worker
process.env.STANDIN_HOME = shared;

async function watcherUp() {
  try { return (await fetch(`http://127.0.0.1:${process.env.STANDIN_WATCHER_PORT}/api/state`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; }
}

async function main() {
  const { c, cfg } = await core();
  const pre = { network: cfg.network, agent: c.requireAccount(cfg, 'agent'), decoy: c.requireAccount(cfg, 'decoy') };
  // The watcher freezes once per process lifetime, so --start-watcher gives every ON route a fresh one.
  const ownWatcher = flag('--start-watcher') && !(await watcherUp());
  let child;
  const startWatcher = async () => {
    child = spawn('node', ['--import', 'tsx', path.join(REPO, 'packages/watcher/src/main.ts')], { cwd: REPO, env: { ...process.env, STANDIN_HOME: shared }, stdio: ['ignore', 'ignore', 'ignore'] });
    for (let i = 0; i < 40 && !(await watcherUp()); i++) await sleep(1000);
  };
  for (const sig of ['SIGINT', 'SIGTERM', 'exit']) process.on(sig, () => { child?.kill(); if (sig !== 'exit') process.exit(1); }); // never orphan the watcher
  const stopWatcher = async () => { child?.kill(); child = null; await sleep(1500); };
  if (ownWatcher) await startWatcher();
  pre.watcher_running = await watcherUp();
  const g = await guardianState();
  pre.guardian_deployed = !g?.error;
  pre.chain_freeze_measurable = pre.watcher_running && pre.guardian_deployed;
  pre.agent_balance_near_before = await retry(() => balanceNear(pre.agent));
  pre.decoy_balance_near_before = await retry(() => balanceNear(pre.decoy));
  await retry(() => c.refillPool(Number(opt('--pool', 24)), cfg, shared)).catch((e) => process.stderr.write(`pool refill failed (${e.message}); continuing with ${c.poolSize(shared)} keys\n`));
  if (pre.guardian_deployed) await resetAgent(shared);

  const want = opt('--routes', '').split(',').filter(Boolean);
  const dirs = fs.readdirSync(path.join(REPO, 'attacks')).filter((d) => /^\d\d-/.test(d)).sort().filter((d) => !want.length || want.some((w) => d.startsWith(w)));
  const onNow = []; const offNow = [];
  const versions = {};
  for (const [k, cmd] of [['claude', ['claude', '--version']], ['codex', ['codex', '--version']]]) {
    try { versions[k] = execFileSync(cmd[0], cmd.slice(1), { encoding: 'utf8' }).trim(); } catch { versions[k] = 'unavailable'; }
  }
  // --merge keeps rows from the previous results.json for routes not re-run now (labelled with their own run_id).
  const prior = flag('--merge') ? JSON.parse(fs.readFileSync(path.join(here, 'results.json'), 'utf8')) : null;
  const ids = new Set(dirs.map((d) => d.slice(0, 2)));
  const keep = (rows, rid) => (prior ? rows.filter((r) => !ids.has(r.route.slice(0, 2))).map((r) => ({ run_id: rid, ...r })) : []);
  const byRoute = (a, b) => a.route.localeCompare(b.route);
  const write = (final) => {
    const on = [...keep(prior?.stand_in_on || [], prior?.run_id), ...onNow].sort(byRoute);
    const off = [...keep(prior?.baseline_off || [], prior?.run_id), ...offNow].sort(byRoute);
    const results = { run_id: runId, started_at: startedAt, generated_at: new Date().toISOString(), complete: final, preflight: pre, versions, stand_in_on: on, baseline_off: off, summary: summarize(on, off, pre) };
    fs.writeFileSync(path.join(here, 'results.json'), JSON.stringify(results, null, 2));
    fs.writeFileSync(path.join(here, 'README.md'), renderReadme(results));
    return results;
  };
  const guard = async (label, meta, fn) => {
    try { return await fn(); } catch (e) {
      process.stderr.write(`${label} ${meta.id} crashed: ${e.message}\n`);
      return { route: meta.id, name: meta.name, kind: meta.kind, mode: label, status: 'harness_error', agent_status: String(e.message).slice(0, 200) };
    }
  };
  for (const d of dirs) {
    const { meta, attack } = await import(path.join(REPO, 'attacks', d, 'route.mjs'));
    process.stderr.write(`== ${meta.id} ON\n`);
    if (pre.guardian_deployed) await resetAgent(shared).catch((e) => process.stderr.write(`resetAgent failed: ${e.message}\n`));
    if (ownWatcher) { await stopWatcher(); await startWatcher(); }
    onNow.push(await guard('on', meta, () => runRoute(meta, attack, { mode: 'on', shared: { standinHome: shared } })));
    if (!flag('--no-baseline')) {
      process.stderr.write(`== ${meta.id} OFF\n`);
      offNow.push(await guard('off', meta, () => runRoute(meta, attack, { mode: 'off', shared: { standinHome: shared } })));
    }
    write(false);
  }
  pre.agent_balance_near_after = await retry(() => balanceNear(pre.agent)).catch(() => null);
  pre.decoy_balance_near_after = await retry(() => balanceNear(pre.decoy)).catch(() => null);
  await stopWatcher();
  // Leave the shared agent account unfrozen with a provisioned agent key, whatever the run did.
  if (pre.guardian_deployed) { await resetAgent(shared).then(() => { pre.agent_restored = true; }).catch((e) => { pre.agent_restored = false; pre.agent_restore_error = e.message.slice(0, 120); }); }
  const looted = +offNow.map((r) => r.baseline?.lost_near || 0).reduce((a, b) => a + b, 0).toFixed(4);
  pre.baseline_loot_near = looted; // stays in the attacker account: baseline accounts are the attacker's children
  const results = write(true);
  process.stderr.write(JSON.stringify(results.summary, null, 2) + '\n');
}
main().catch((e) => { process.stderr.write(`bench failed: ${e.stack}\n`); process.exit(1); });
