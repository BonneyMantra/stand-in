// Live registry proof: report a real decoy-drain tx and print the outcome + check().
//   node --import tsx packages/watcher/scripts/report.ts <tx_hash> <attacker_account>
import { loadDevKey, loadNetworkConfig, makeAccount, makeProvider, requireAccount, explorerTx, rpcRaw } from "@standin/core";
const [tx, attacker] = process.argv.slice(2);
const cfg = loadNetworkConfig();
const out = (s: string) => process.stdout.write(s + "\n");
const decoy = requireAccount(cfg, "decoy");
const w = makeAccount(cfg, requireAccount(cfg, "watcher"), loadDevKey(cfg, "watcher").secret_key);
const res: any = await w.callFunctionRaw({
  contractId: cfg.accounts.registry, methodName: "report", gas: 300_000_000_000_000n, deposit: 50_000_000_000_000_000_000_000n,
  args: { tx_hash: tx, decoy_account_id: decoy, sender_id: decoy, admin_public_key: loadDevKey(cfg, "decoy").public_key }, waitUntil: "INCLUDED",
});
const h = String(res.transaction?.hash ?? res.transaction_outcome?.id);
out(`report tx ${explorerTx(cfg, h)}`);
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 4000));
  const st: any = await rpcRaw(cfg, "tx", { tx_hash: h, sender_account_id: requireAccount(cfg, "watcher"), wait_until: "FINAL" }).catch(() => null);
  if (!st) continue;
  const logs = (st.receipts_outcome ?? []).flatMap((o: any) => o.outcome.logs).map((l: string) => l.slice(0, 220));
  out(`status ${JSON.stringify(st.status).slice(0, 300)}\nlogs ${JSON.stringify(logs, null, 1)}`);
  break;
}
out(`check(${attacker}) = ${JSON.stringify(await makeProvider(cfg).callFunction({ contractId: cfg.accounts.registry, method: "check", args: { account_id: attacker } } as any))}`);
