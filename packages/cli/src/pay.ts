import readline from "node:readline/promises";
import {
  actions, appendEvent, checkCounterparty, explorerTx, loadNetworkConfig, loadScopedKey, makeAccount, parseNearAmountSafe,
  type CounterpartyResult,
} from "@standin/core";
import { requireFingerprint } from "@standin/touchid";
import { err, out } from "./util.ts";

export interface PayOpts {
  receiver: string;
  what: string; // NEAR amount ("0.5") or a method name
  args?: string; // JSON for method calls
  approveWarn?: boolean;
  json?: boolean;
  /** test seam */
  check?: (id: string) => Promise<CounterpartyResult>;
  ask?: (q: string) => Promise<boolean>;
  gate?: (reason: string) => Promise<boolean>;
}

async function askTty(q: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const a = (await rl.question(q + " [y/N] ")).trim().toLowerCase();
  rl.close();
  return a === "y" || a === "yes";
}

/** Exit codes: 0 sent, 3 refused (blocklist), 4 warn not approved, 1 error. */
export async function pay(o: PayOpts): Promise<number> {
  const cfg = loadNetworkConfig();
  const r = await (o.check ?? ((id) => checkCounterparty(id, { cfg })))(o.receiver);
  for (const x of r.reasons) err(`  [${x.level}] ${x.code}: ${x.message}`);
  if (r.decision === "block") {
    err(`REFUSED: ${o.receiver} is on the Stand-in blocklist.`);
    appendEvent("tool_call", { tool_name: "standin pay", receiver: o.receiver, outcome: "refused", reasons: r.reasons.map((x) => x.code) });
    if (o.json) out(JSON.stringify(r));
    return 3;
  }
  if (r.decision === "warn") {
    const ok = o.approveWarn ? true : await (o.ask ?? askTty)(`Stand-in warns about ${o.receiver}. Proceed?`);
    // Owner presence: --approve-warn or a typed yes never approves a warned receiver on its own; the fingerprint must pass too.
    const present = ok && (await (o.gate ?? requireFingerprint)(`Approve warned payment of ${o.what} to ${o.receiver}`));
    if (!present) {
      err("not approved (owner fingerprint required for a warned receiver); nothing sent");
      appendEvent("tool_call", { tool_name: "standin pay", receiver: o.receiver, outcome: "warn_declined" });
      return 4;
    }
  }
  const key = loadScopedKey();
  if (!key) { err("no scoped agent key; run `standin adopt` first"); return 1; }
  const acct = makeAccount(cfg, key.account_id, key.secret_key);
  const isAmount = /^\d+(\.\d+)?$/.test(o.what);
  try {
    const res: any = isAmount
      ? await acct.signAndSendTransaction({ receiverId: o.receiver, actions: [actions.transfer(parseNearAmountSafe(o.what))], waitUntil: "EXECUTED_OPTIMISTIC" })
      : await acct.callFunctionRaw({ contractId: o.receiver, methodName: o.what, args: o.args ? JSON.parse(o.args) : {}, waitUntil: "EXECUTED_OPTIMISTIC" });
    const hash = String(res.transaction?.hash ?? res.transaction_outcome?.id);
    appendEvent("tool_call", { tool_name: "standin pay", receiver: o.receiver, outcome: "sent", tx_hash: hash });
    out(`sent ${isAmount ? o.what + " NEAR" : o.what + "()"} to ${o.receiver}: ${explorerTx(cfg, hash)}`);
    return 0;
  } catch (e) {
    err(`send failed: ${(e as Error).message}`);
    return 1;
  }
}
