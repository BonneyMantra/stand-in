/**
 * Mainnet proof run: own watcher (port 4318, owner-key mode) + scripted thief with the "demo-scripted-thief" decoy key
 * moving 0.01 NEAR from the decoy to the attacker-test account; then measures decoy tx block -> freeze tx block from
 * chain and re-provisions the agent so it is ready for filming. Every tx goes through the budget guard.
 *   node --import tsx packages/mainnet/scripts/prove.ts
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { readEvents, repoRoot, makeProvider } from "@standin/core";
import {
  NEAR, Signer, accessKeys, actions, balanceOf, decoyKeyPath, fmtNear, mainnetConfig, tgas, totals,
} from "../src/index.ts";
import { intentsHas, intentsKeys, provisionFcKey, registerIntentsKey } from "../src/agent.ts";

const root = repoRoot();
const HOME = path.join(root, ".sandbox", "mainnet", ".standin");
const PORT = process.env.STANDIN_PROOF_PORT ?? "4318";
if (PORT === "4317") throw new Error("port 4317 belongs to the coordinator's watcher");
const cfg = mainnetConfig();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const heightOf = async (hash: string, acct: string) => {
  const p = makeProvider(cfg);
  const r: any = await p.viewTransactionStatus({ txHash: hash, accountId: acct, waitUntil: "INCLUDED" } as any);
  return Number(((await p.viewBlock({ blockId: r.transaction_outcome.block_hash } as any)) as any).header.height);
};

async function main() {
  const fcKey = JSON.parse(fs.readFileSync(path.join(root, ".secrets/mainnet/agent-fc.json"), "utf8")).public_key;
  const intentsKey = JSON.parse(fs.readFileSync(path.join(root, ".secrets/mainnet/agent-intents.json"), "utf8")).public_key;
  const before = { fc_keys: (await accessKeys(cfg, cfg.accounts.agent)).filter((k) => k.access_key.permission !== "FullAccess").map((k) => k.public_key), has_public_key: await intentsHas(cfg, intentsKey), bait_yocto: (await balanceOf(cfg, cfg.accounts.decoy)).toString() };
  console.log("before", before);
  if (!before.fc_keys.includes(fcKey) || !before.has_public_key) throw new Error("agent is not provisioned (run agent-setup.ts)");

  const log = fs.openSync(path.join(root, ".sandbox", "mainnet", "watcher.log"), "w");
  const child: ChildProcess = spawn(process.execPath, ["--import", "tsx", "packages/watcher/src/main.ts"], {
    cwd: root, stdio: ["ignore", log, log],
    env: { ...process.env, STANDIN_CONFIG: path.join(root, "config/mainnet.json"), STANDIN_HOME: HOME, STANDIN_WATCHER_PORT: PORT, STANDIN_NO_REPORT: "1", HOME: path.join(root, ".sandbox", "w6") },
  });
  console.log(`own watcher pid ${child.pid} on :${PORT}`);
  try {
    await sleep(9000); // let it warm (nonce, block hash, key lists)
    const t0 = Date.now();
    const thief = Signer.fromFile(cfg, cfg.accounts.decoy, decoyKeyPath("demo-scripted-thief"));
    const theft = await thief.send({
      purpose: "thief", receiverId: cfg.accounts.attacker, acts: [actions.transfer(NEAR / 100n)], amountYocto: NEAR / 100n, gas: tgas(1), what: "scripted thief",
    });
    console.log(`theft tx ${theft.tx_hash} block ${theft.block_height}`);
    let fz: any;
    for (let i = 0; i < 90 && !fz; i++) { await sleep(1000); fz = readEvents({ type: "freeze", where: (e) => e.trip_tx_hash === theft.tx_hash }, HOME).at(-1); }
    if (!fz) throw new Error("no freeze event within 90 s; see .sandbox/mainnet/watcher.log");
    const f = fz.freeze;
    const intentsTx = f.intents_tx_hash as string;
    const intentsBlock = intentsTx ? await heightOf(intentsTx, cfg.accounts.agent) : 0;
    await sleep(6000);
    const after = { fc_keys: (await accessKeys(cfg, cfg.accounts.agent)).filter((k) => k.access_key.permission !== "FullAccess").map((k) => k.public_key), has_public_key: await intentsHas(cfg, intentsKey), intents_keys: await intentsKeys(cfg) };
    const result = {
      theft: { tx_hash: theft.tx_hash, block_height: theft.block_height },
      freeze: { delete_key_tx: f.tx_hash, delete_key_block: f.block_height, remove_public_key_tx: intentsTx, remove_public_key_block: intentsBlock, executed_block_height: fz.executed_block_height, blocks_after_trip_inclusion: f.block_height - theft.block_height, intents_blocks_after_trip: intentsBlock ? intentsBlock - theft.block_height : null, detection_to_submit_ms: fz.detection_to_submit_ms, theft_send_to_freeze_event_s: (Date.now() - t0) / 1000 },
      before, after,
    };
    console.log(JSON.stringify(result, null, 1));
    // re-provision for filming (spend is counted by the guard)
    const fc2 = await provisionFcKey(cfg);
    const it2 = await registerIntentsKey(cfg);
    const reprov = { fc_key_tx: fc2.tx.tx_hash, fc_key_block: fc2.tx.block_height, intents_add_tx: it2.tx.tx_hash, intents_add_block: it2.tx.block_height, has_public_key: await intentsHas(cfg, intentsKey) };
    console.log("re-provision", reprov);
    fs.writeFileSync(path.join(root, ".sandbox", "mainnet", "proof.json"), JSON.stringify({ ...result, reprovision: reprov, at: new Date().toISOString() }, null, 2));
    const t = totals();
    console.log("spend", Object.fromEntries(Object.entries(t.byPurpose).map(([k, v]) => [k, fmtNear(v)])), "global", fmtNear(t.global));
  } finally {
    child.kill("SIGTERM"); // only the pid we started
    fs.closeSync(log);
  }
}
main().catch((e) => { console.error(String(e?.stack ?? e).slice(0, 1500)); process.exit(1); });
