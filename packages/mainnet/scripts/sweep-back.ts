/**
 * Move every recoverable mainnet NEAR back to the funding account (7aa26dbb...c93e), through the budget guard.
 *   node --import tsx packages/mainnet/scripts/sweep-back.ts             # dry run (default): prints what would move
 *   node --import tsx packages/mainnet/scripts/sweep-back.ts --execute   # real transfers
 * Sources: decoy (admin key), attacker-test (its key), agent (owner key). Each keeps its storage minimum
 * (storage_usage x 1e19 yocto) plus a gas margin, because an account below that cannot send. Accounts are NOT deleted.
 * Pass --leave-agent <near> to keep extra NEAR on the agent (freeze and re-provision gas) when you will film next.
 * The gas of each sweep is reserved as purpose "gas"; the amount returned is recorded as `recovered` and credited
 * against the purpose that funded it (decoy -> bait, attacker -> thief, agent -> account).
 */
import fs from "node:fs";
import path from "node:path";
import { repoRoot, rpcRaw } from "@standin/core";
import {
  NEAR, Signer, accountKeyPath, actions, balanceOf, fmtNear, loadKeyFile, mainnetConfig, mainnetKeysDir, tgas, totals, recovered, recoveredTotal,
} from "../src/index.ts";

const execute = process.argv.includes("--execute");
const li = process.argv.indexOf("--leave-agent");
const leaveAgent = li > 0 ? BigInt(Math.round(Number(process.argv[li + 1]) * 1e6)) * (NEAR / 1_000_000n) : 0n;
const GAS_MARGIN = (9n * NEAR) / 1000n; // a transfer to an implicit account (the funding account) is validated against ~0.0076 NEAR of prepaid creation fees (refunded when the account exists)
const cfg = mainnetConfig();
const ops = JSON.parse(fs.readFileSync(path.join(repoRoot(), ".secrets", "mainnet-ops.json"), "utf8"));

async function storageLocked(id: string): Promise<bigint> {
  const a: any = await rpcRaw(cfg, "query", { request_type: "view_account", finality: "final", account_id: id });
  return BigInt(a.storage_usage) * 10n ** 19n;
}

const sources: { label: string; id: string; keyFile: string; credit: "bait" | "thief" | "account"; extraKeep: bigint }[] = [
  { label: "decoy", id: cfg.accounts.decoy, keyFile: accountKeyPath(cfg.accounts.decoy), credit: "bait", extraKeep: 0n },
  { label: "attacker-test", id: cfg.accounts.attacker, keyFile: path.join(mainnetKeysDir(), "attacker-test.json"), credit: "thief", extraKeep: 0n },
  { label: "agent", id: cfg.accounts.agent, keyFile: accountKeyPath(cfg.accounts.agent), credit: "account", extraKeep: leaveAgent },
];

const fundingBefore = await balanceOf(cfg, ops.account_id);
console.log(`funding account ${ops.account_id.slice(0, 8)}... balance before: ${fmtNear(fundingBefore)} NEAR  (${execute ? "EXECUTE" : "dry run"})`);
for (const s of sources) {
  const bal = await balanceOf(cfg, s.id);
  const keep = (await storageLocked(s.id)) + GAS_MARGIN + s.extraKeep;
  const move = bal > keep ? bal - keep : 0n;
  console.log(`${s.label.padEnd(14)} ${s.id.slice(0, 26).padEnd(26)} balance ${fmtNear(bal)}  keeps ${fmtNear(keep)}  moves ${fmtNear(move)}`);
  if (!execute || move === 0n) continue;
  const signer = Signer.fromFile(cfg, s.id, s.keyFile);
  const r = await signer.send({ purpose: "gas", receiverId: ops.account_id, acts: [actions.transfer(move)], gas: tgas(1), what: `sweep ${s.label}` });
  recovered(s.credit, move, r.tx_hash);
  console.log(`   swept tx ${r.tx_hash} block ${r.block_height} gas ${fmtNear(r.gas_burnt_yocto)}`);
}
const fundingAfter = await balanceOf(cfg, ops.account_id);
console.log(`funding balance after: ${fmtNear(fundingAfter)} NEAR  (before ${fmtNear(fundingBefore)})`);
const t = totals();
console.log(`budget: net counted ${fmtNear(t.global)} NEAR, recovered so far ${fmtNear(recoveredTotal())} NEAR`);
void loadKeyFile;
