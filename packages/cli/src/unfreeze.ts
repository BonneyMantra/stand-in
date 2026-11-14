import {
  appendEvent, callMethod, explorerTx, generateKey, loadDevKey, loadNetworkConfig, loadScopedKey, makeAccount, makeProvider,
  requireAccount, saveScopedKey,
} from "@standin/core";
import { requireFingerprint } from "@standin/touchid";
import { readRealKey } from "./keystore.ts";
import { err, out } from "./util.ts";

export interface UnfreezeOpts {
  /** test seam; default is the Touch ID gate */
  gate?: (reason: string) => Promise<boolean>;
  keychain?: boolean;
}

/** Exit codes: 0 done, 5 owner presence not proven (nothing sent), 1 error. */
export async function unfreeze(o: UnfreezeOpts = {}): Promise<number> {
  const cfg = loadNetworkConfig();
  const agent = requireAccount(cfg, "agent");
  if (!(await (o.gate ?? requireFingerprint)(`Unfreeze ${agent}`))) {
    err("owner fingerprint not confirmed; nothing sent");
    appendEvent("tool_call", { tool_name: "standin unfreeze", outcome: "gate_failed" });
    return 5;
  }
  const secret = readRealKey(o.keychain ? "keychain" : "dev", agent) ?? loadDevKey(cfg, "agent").secret_key;
  const owner = makeAccount(cfg, agent, secret);
  const st: any = await makeProvider(cfg).callFunction({ contractId: agent, method: "get_state", args: {} } as any);
  if (st.frozen) {
    const r = await callMethod(owner, agent, "unfreeze", {}, { waitUntil: "EXECUTED_OPTIMISTIC" });
    out(`unfrozen: ${explorerTx(cfg, r.tx_hash)}`);
  } else out("guardian was not frozen");
  // Re-provision the agent's scoped key (the freeze deleted the old one): same scope as the previous key (guardian.add_agent_key).
  const prev = loadScopedKey();
  const scope = {
    receiver: prev?.receiver_id ?? requireAccount(cfg, "project"), methods: prev?.method_names ?? ["record_deploy"],
    allowance: "250000000000000000000000",
  };
  const k = generateKey();
  const r = await callMethod(owner, agent, "add_agent_key", {
    public_key: k.public_key, receiver_id: scope.receiver, method_names: scope.methods, allowance: scope.allowance,
  }, { waitUntil: "EXECUTED_OPTIMISTIC" });
  saveScopedKey({
    account_id: agent, public_key: k.public_key, secret_key: k.secret_key, receiver_id: scope.receiver,
    method_names: scope.methods, created_at: new Date().toISOString(),
  });
  appendEvent("tool_call", { tool_name: "standin unfreeze", outcome: "unfrozen", agent_key_tx: r.tx_hash });
  out(`agent key re-provisioned: ${explorerTx(cfg, r.tx_hash)}`);
  return 0;
}
