// End-to-end proof on testnet: seed a sandbox HOME with plaintext keys, `standin adopt`, drain a planted
// decoy with the scripted thief, wait for the watcher's freeze, print measured blocks and tx links.
//   node --import tsx packages/watcher/scripts/prove.ts [runs=1]
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  actions, callMethod, explorerTx, loadDevKey, loadNetworkConfig, makeAccount, makeProvider, parseNearAmountSafe,
  repoRoot, requireAccount, roleAccount,
} from "@standin/core";

const out = (s: string) => process.stdout.write(s + "\n");
const cfg = loadNetworkConfig();
const root = repoRoot();
const runs = Number(process.argv[2] ?? 1);
const agent = requireAccount(cfg, "agent");
const decoy = requireAccount(cfg, "decoy");

function cli(env: NodeJS.ProcessEnv, ...args: string[]) {
  const r = spawnSync(process.execPath, ["--import", "tsx", path.join(root, "packages/cli/src/bin.ts"), ...args], { cwd: root, env, encoding: "utf8" });
  out(`$ standin ${args.join(" ")}\n${r.stdout}${r.stderr.split("\n").filter((l) => !/^\d{4}-/.test(l)).join("\n")}`);
  if (r.status !== 0) throw new Error(`standin ${args[0]} exited ${r.status}`);
  return r.stdout;
}

function seed(home: string) {
  fs.rmSync(home, { recursive: true, force: true });
  const real = loadDevKey(cfg, "agent");
  fs.mkdirSync(path.join(home, ".near-credentials/testnet"), { recursive: true });
  fs.writeFileSync(path.join(home, ".near-credentials/testnet", `${agent}.json`), JSON.stringify({ account_id: agent, public_key: real.public_key, private_key: real.secret_key }, null, 2));
  fs.mkdirSync(path.join(home, "work/app"), { recursive: true });
  fs.writeFileSync(path.join(home, "work/app/.env"), `NEAR_ENV=testnet\nNEAR_ACCOUNT_ID=${agent}\nNEAR_PRIVATE_KEY=${real.secret_key}\n`);
  fs.writeFileSync(path.join(home, ".zsh_history"), `: 1731500000:0;export NEAR_ACCOUNT_ID=${agent} NEAR_PRIVATE_KEY=${real.secret_key}\n`);
}

async function ensureFundsAndUnfrozen() {
  const prov = makeProvider(cfg);
  const bal = BigInt(((await prov.viewAccount({ accountId: decoy } as any)) as any).amount);
  const want = parseNearAmountSafe("4");
  if (bal < want) {
    await roleAccount(cfg, "attacker").signAndSendTransaction({ receiverId: decoy, actions: [actions.transfer(want - bal + parseNearAmountSafe("1"))], waitUntil: "EXECUTED_OPTIMISTIC" });
  }
  const st: any = await prov.callFunction({ contractId: agent, method: "get_state", args: {} } as any);
  if (st.frozen) {
    const owner = makeAccount(cfg, agent, loadDevKey(cfg, "agent").secret_key);
    await callMethod(owner, agent, "unfreeze", {}, { waitUntil: "EXECUTED_OPTIMISTIC" });
    out("unfroze agent from previous run");
  }
}

const results: any[] = [];
for (let n = 1; n <= runs; n++) {
  out(`\n=== run ${n}/${runs} ===`);
  await ensureFundsAndUnfrozen();
  const home = path.join(root, ".sandbox", `w3-proof-${n}`);
  seed(home);
  const env = { ...process.env, STANDIN_HOME: path.join(home, ".standin"), STANDIN_POOL_SIZE: "4" };
  // restart the watcher so it follows this run's ledger
  try { const pid = Number(fs.readFileSync(path.join(env.STANDIN_HOME, "watcher.pid"), "utf8")); process.kill(pid); } catch { /* none */ }
  cli(env, "dev", "up");
  cli(env, "adopt", "--home", home);
  const planted = fs.readdirSync(path.join(home, ".near-credentials/testnet")).find((f) => f.startsWith(decoy));
  if (!planted) throw new Error("no decoy credentials file after adopt");
  const drained = cli(env, "attack", "drain", "--key", path.join(home, ".near-credentials/testnet", planted), "--reserve", "3");
  const deadline = Date.now() + 90_000;
  let trip: any;
  while (Date.now() < deadline) {
    const s: any = await (await fetch("http://127.0.0.1:4317/api/state")).json().catch(() => null);
    trip = s?.trips?.at(-1);
    if (trip?.freeze?.tx_hash && trip.freeze.deleted_keys?.length) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const events = fs.readFileSync(path.join(env.STANDIN_HOME, "ledger.ndjson"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const fz = events.filter((e) => e.type === "freeze").at(-1);
  const st: any = await makeProvider(cfg).callFunction({ contractId: agent, method: "get_state", args: {} } as any);
  results.push({
    run: n, trip_tx: trip?.tx_hash, trip_block: trip?.block_height, freeze_tx: trip?.freeze?.tx_hash,
    freeze_block: trip?.freeze?.block_height, blocks_after_trip: trip?.freeze?.blocks_after_trip,
    executed_blocks_after_trip: fz?.executed_blocks_after_trip, detection_to_submit_ms: fz?.detection_to_submit_ms,
    deleted_keys: trip?.freeze?.deleted_keys?.length, agent_frozen: st.frozen, agent_keys_left: st.agent_keys.length,
  });
  void drained;
  out(JSON.stringify(results.at(-1), null, 2));
  if (results.at(-1).trip_tx) out(`trip   ${explorerTx(cfg, results.at(-1).trip_tx)}\nfreeze ${explorerTx(cfg, results.at(-1).freeze_tx)}`);
}
out("\nSUMMARY " + JSON.stringify(results.map((r) => ({ run: r.run, blocks_after_trip: r.blocks_after_trip, executed: r.executed_blocks_after_trip }))));
process.exit(0);
