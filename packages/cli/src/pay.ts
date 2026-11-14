import readline from "node:readline/promises";
import {
  actions, appendEvent, assertSuccess, checkCounterparty, explorerTx, loadNetworkConfig, loadScopedKey, makeAccount, parseNearAmountSafe,
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

/** A NEAR account id valid on `network`: named (a.b.testnet / a.b.near), a 64-hex implicit account or a 0x Ethereum-style one. */
export function validateReceiver(id: string, network: string): string | null {
  const named = /^(?:[a-z\d]+[-_])*[a-z\d]+(?:\.(?:[a-z\d]+[-_])*[a-z\d]+)*$/;
  const implicit = /^(?:[0-9a-f]{64}|0x[0-9a-f]{40})$/;
  if (id.length < 2 || id.length > 64 || !(named.test(id) || implicit.test(id))) return `${id} is not a valid NEAR account id`;
  if (implicit.test(id)) return null;
  const suffix = network === "mainnet" ? "near" : "testnet";
  if (!id.endsWith(`.${suffix}`) && id !== suffix) return `${id} is not a ${network} account (expected name.${suffix})`;
  return null;
}

/** Exit codes: 0 sent, 3 refused (blocklist), 4 warn not approved, 1 error. */
export async function pay(o: PayOpts): Promise<number> {
  const cfg = loadNetworkConfig();
  const bad = validateReceiver(o.receiver, cfg.network);
  if (bad) { err(bad); return 1; }
  const isAmount = /^\d+(\.\d+)?$/.test(o.what);
  if (isAmount && !(Number(o.what) > 0)) { err("amount must be greater than 0"); return 1; }
  if (!isAmount && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(o.what)) { err(`"${o.what}" is neither a NEAR amount (for example 0.5) nor a contract method name`); return 1; }
  let args: Record<string, unknown> = {};
  if (o.args) {
    try { args = JSON.parse(o.args); } catch { err("--args is not valid JSON"); return 1; }
  }
  const r = await (o.check ?? ((id) => checkCounterparty(id, { cfg })))(o.receiver);
  for (const x of r.reasons) err(`  [${x.level}] ${x.code}: ${x.message}`);
  // Fail closed: a blocklist that could not be read is not an allow.
  if (r.decision === "allow" && r.reasons.some((x) => x.code === "registry_unavailable")) {
    err("blocklist could not be read; treating the receiver as warned (owner approval required)");
    r.decision = "warn";
  }
  if (r.decision === "block") {
    err(`REFUSED: ${o.receiver} is on the Stand-in blocklist.`);
    appendEvent("tool_call", { tool_name: "standin pay", receiver: o.receiver, outcome: "refused", reasons: r.reasons.map((x) => x.code) });
    if (o.json) out(JSON.stringify(r));
    return 3;
  }
  const key = loadScopedKey();
  if (!key) { err("no scoped agent key; run `standin adopt` first"); return 1; }
  // The agent holds a function-call key: the chain accepts one call to its receiver's listed methods, never a transfer.
  if (isAmount) {
    err(`the agent key (${key.public_key}) is scoped to ${key.method_names.join(", ") || "any method"} on ${key.receiver_id}; the chain will not let it transfer NEAR. Pay by calling a method: standin pay ${key.receiver_id} <method> --args JSON`);
    return 1;
  }
  if (o.receiver !== key.receiver_id || (key.method_names.length && !key.method_names.includes(o.what))) {
    err(`the agent key (${key.public_key}) may only call ${key.method_names.join(", ") || "any method"} on ${key.receiver_id}; ${o.what}() on ${o.receiver} would be refused by the chain`);
    return 1;
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
  const acct = makeAccount(cfg, key.account_id, key.secret_key);
  try {
    const res: any = isAmount
      ? await acct.signAndSendTransaction({ receiverId: o.receiver, actions: [actions.transfer(parseNearAmountSafe(o.what))], waitUntil: "EXECUTED_OPTIMISTIC" })
      : await acct.callFunctionRaw({ contractId: o.receiver, methodName: o.what, args, waitUntil: "EXECUTED_OPTIMISTIC" });
    assertSuccess(res);
    const hash = String(res.transaction?.hash ?? res.transaction_outcome?.id);
    appendEvent("tool_call", { tool_name: "standin pay", receiver: o.receiver, outcome: "sent", tx_hash: hash });
    out(`sent ${isAmount ? o.what + " NEAR" : o.what + "()"} to ${o.receiver}: ${explorerTx(cfg, hash)}`);
    return 0;
  } catch (e) {
    err(`send failed: ${(e as Error).message}`);
    return 1;
  }
}
