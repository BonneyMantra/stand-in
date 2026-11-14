// Testnet proof for the phone layer (own watcher on :4399, own STANDIN_HOME; the coordinator's :4317 watcher is untouched).
//   node --import tsx packages/notify/scripts/prove.ts
// (a) scripted decoy drain -> trip + freeze pushes on the private topic;  (b) "freeze" on the reply topic -> freeze.
// Leaves the agent UNFROZEN. Prints push TITLES only, never topics or keys.
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { actions, callMethod, loadDevKey, loadNetworkConfig, makeAccount, makeProvider, parseNearAmountSafe, readEvents, repoRoot, requireAccount, roleAccount } from "@standin/core";
import { loadEnvLocal } from "../src/env.ts";

loadEnvLocal();
const topic = process.env.STANDIN_NTFY_TOPIC, reply = process.env.STANDIN_NTFY_REPLY_TOPIC;
if (!topic || !reply) throw new Error("STANDIN_NTFY_TOPIC / STANDIN_NTFY_REPLY_TOPIC missing in .env.local");
const out = (s: string) => process.stdout.write(s + "\n");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cfg = loadNetworkConfig(), root = repoRoot();
const agent = requireAccount(cfg, "agent"), decoy = requireAccount(cfg, "decoy");
const home = path.join(root, ".sandbox", "w10-proof");
const sandboxHome = home;
const env: NodeJS.ProcessEnv = { ...process.env, STANDIN_HOME: path.join(sandboxHome, ".standin"), STANDIN_POOL_SIZE: "3", STANDIN_NO_REPORT: "1", STANDIN_WATCHER_PORT: "4399" };
const state = async (): Promise<any> => {
  for (let i = 0; ; i++) {
    try { return await makeProvider(cfg).callFunction({ contractId: agent, method: "get_state", args: {} } as any); } catch (e) { if (i > 8) throw e; await sleep(2500); }
  }
};
const owner = () => makeAccount(cfg, agent, loadDevKey(cfg, "agent").secret_key);
const cli = (...a: string[]) => {
  const r = spawnSync(process.execPath, ["--import", "tsx", path.join(root, "packages/cli/src/bin.ts"), ...a], { cwd: root, env, encoding: "utf8" });
  out(`$ standin ${a[0]} ${a[1] ?? ""} -> exit ${r.status}`);
  if (r.status !== 0) throw new Error(r.stderr.split("\n").filter((l) => !/^\d{4}-/.test(l)).join("\n").slice(0, 400));
  return r.stdout;
};
async function retry<T>(f: () => Promise<T> | T): Promise<T> { for (let i = 0; ; i++) { try { return await f(); } catch (e) { if (i > 6) throw e; await sleep(5000); } } }
async function titlesSince(sinceSec: number) {
  const r = await fetch(`https://ntfy.sh/${topic}/json?poll=1&since=${sinceSec}`);
  return (await r.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((m) => m.event === "message").map((m) => ({ title: m.title, priority: m.priority, actions: (m.actions ?? []).map((a: any) => a.label) }));
}
async function waitFreeze(timeoutMs: number) { const end = Date.now() + timeoutMs; while (Date.now() < end) { if ((await state()).frozen) return true; await sleep(1500); } return false; }
async function unfreezeOwner() { if ((await state()).frozen) await callMethod(owner(), agent, "unfreeze", {}, { waitUntil: "EXECUTED_OPTIMISTIC" }); }

fs.rmSync(sandboxHome, { recursive: true, force: true });
const real = loadDevKey(cfg, "agent");
fs.mkdirSync(path.join(sandboxHome, ".near-credentials/testnet"), { recursive: true });
fs.writeFileSync(path.join(sandboxHome, ".near-credentials/testnet", `${agent}.json`), JSON.stringify({ account_id: agent, public_key: real.public_key, private_key: real.secret_key }));
await retry(unfreezeOwner);
await retry(async () => { // testnet decoy needs a bait balance above the 3 NEAR reserve the thief leaves behind
  const bal = BigInt(((await makeProvider(cfg).viewAccount({ accountId: decoy } as any)) as any).amount);
  const want = parseNearAmountSafe("4");
  if (bal < want) await roleAccount(cfg, "attacker").signAndSendTransaction({ receiverId: decoy, actions: [actions.transfer(want - bal + parseNearAmountSafe("1"))], waitUntil: "EXECUTED_OPTIMISTIC" });
});
await retry(() => cli("dev", "up", "--no-watcher"));
await retry(() => cli("adopt", "--home", sandboxHome));
const t0 = Math.floor(Date.now() / 1000) - 5;
const w: ChildProcess = spawn(process.execPath, ["--import", "tsx", path.join(root, "packages/watcher/src/main.ts")], { cwd: root, env, stdio: "ignore" });
out(`own watcher pid ${w.pid} on :4399`);
try {
  await sleep(6000);
  const planted = fs.readdirSync(path.join(sandboxHome, ".near-credentials/testnet")).find((f) => f.startsWith(decoy))!;
  await retry(() => cli("attack", "drain", "--key", path.join(sandboxHome, ".near-credentials/testnet", planted), "--reserve", "3"));
  out(`(a) frozen on chain: ${await waitFreeze(90_000)}`);
  await sleep(8000); // let the ledger tail publish
  out("(a) pushes on the private topic: " + JSON.stringify(await titlesSince(Math.floor(Date.now() / 1000) - 600)));
  await retry(unfreezeOwner);
  await sleep(8000);
  out(`unfrozen on chain (read twice): ${!(await state()).frozen && !(await state()).frozen}`);
  // (b) the phone's Freeze now button = POST "freeze" to the reply topic; proof = a manual freeze event in the ledger
  const t1 = Date.now();
  const pub = await fetch(`https://ntfy.sh/${reply}`, { method: "POST", body: "freeze" });
  out(`(b) published "freeze" to reply topic: HTTP ${pub.status}`);
  let ev: any;
  while (!ev && Date.now() - t1 < 90_000) { ev = readEvents({ type: "freeze", where: (e) => e.manual === true }, env.STANDIN_HOME).at(-1); if (!ev) await sleep(500); }
  out(`(b) ledger freeze event manual=${ev?.manual} reason="${ev?.reason}" after ${((Date.now() - t1) / 1000).toFixed(1)} s, tx ${ev?.freeze?.tx_hash ? "recorded" : "none"}`);
  out(`(b) frozen on chain: ${(await state()).frozen}`);
  out("(b) pushes now: " + JSON.stringify((await titlesSince(Math.floor(Date.now() / 1000) - 120)).map((m) => m.title)));
} finally {
  if (w.pid) process.kill(w.pid);
  await sleep(500);
  await retry(unfreezeOwner);
  out(`final: agent frozen=${(await state()).frozen} (must be false), t0=${t0}`);
}
process.exit(0);
