import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  appendEvent, eachEndpoint, generateKey, loadNetworkConfig, loadScopedKey, makeProvider, requireAccount, saveScopedKey, standinHome,
} from "@standin/core";
import { err, out } from "./util.ts";

export const DEFAULT_DASHBOARD = "https://stand-in-44e.pages.dev";
export const DEFAULT_ALLOWANCE = "250000000000000000000000";

const pendingSchema = z.object({
  account_id: z.string().min(2),
  public_key: z.string().regex(/^ed25519:[1-9A-HJ-NP-Za-km-z]+$/),
  secret_key: z.string().regex(/^ed25519:[1-9A-HJ-NP-Za-km-z]+$/),
  receiver_id: z.string().min(2),
  method_names: z.array(z.string()),
  allowance: z.string().regex(/^\d+$/),
  created_at: z.string(),
});
export type PendingKey = z.infer<typeof pendingSchema>;

export const pendingKeyPath = (home = standinHome()) => path.join(home, "agent-scoped-key.pending.json");

export function savePendingKey(k: PendingKey, home = standinHome()): void {
  fs.mkdirSync(home, { recursive: true });
  const f = pendingKeyPath(home);
  fs.writeFileSync(f, JSON.stringify(pendingSchema.parse(k), null, 2), { mode: 0o600 });
  fs.chmodSync(f, 0o600); // mode above only applies when the file is created
}
export function loadPendingKey(home = standinHome()): PendingKey | null {
  try {
    return pendingSchema.parse(JSON.parse(fs.readFileSync(pendingKeyPath(home), "utf8")));
  } catch {
    return null;
  }
}

/** The contract with the dashboard owner console (do not change the parameter names). */
export function ownerUrl(dashboard: string, k: PendingKey): string {
  const e = encodeURIComponent;
  const q = [
    ["op", "unfreeze"], ["account", k.account_id], ["agent_key", k.public_key], ["receiver", k.receiver_id],
    ["methods", k.method_names.join(",")], ["allowance", k.allowance],
  ].map(([a, b]) => `${a}=${e(b!)}`).join("&");
  return `${dashboard.replace(/\/+$/, "")}/app/owner?${q}`;
}

export interface KeyView { receiver_id: string; method_names: string[]; full_access: boolean }
/** Chain reads, injectable for tests. viewKey returns null when the key does not exist. */
export interface WalletChain {
  viewKey(account: string, publicKey: string): Promise<KeyView | null>;
  frozen(account: string): Promise<boolean>;
}
export interface UnfreezeWalletOpts {
  resume?: boolean;
  timeoutSec?: number;
  chain?: WalletChain;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  pollMs?: number;
  dashboard?: string;
}

function liveChain(): WalletChain {
  const cfg = loadNetworkConfig();
  const prov = makeProvider(cfg);
  const missing = (e: unknown) => /does not exist|UnknownAccessKey|AccessKeyDoesNotExist/i.test(String((e as Error)?.message ?? e) + String((e as Error)?.name ?? ""));
  return {
    async viewKey(account, publicKey) {
      let k: any;
      try {
        // eachEndpoint rethrows "key does not exist" at once instead of the failover provider's noisy wrapping
        k = await eachEndpoint(cfg, false, (p) => p.viewAccessKey({ accountId: account, publicKey } as any), missing);
      } catch (e) {
        if (missing(e)) return null;
        throw e;
      }
      const p = k.permission;
      if (p === "FullAccess" || p?.FullAccess !== undefined) return { receiver_id: "", method_names: [], full_access: true };
      const fc = p.FunctionCall ?? p;
      return { receiver_id: fc.receiver_id, method_names: fc.method_names ?? [], full_access: false };
    },
    async frozen(account) {
      const st: any = await prov.callFunction({ contractId: account, method: "get_state", args: {} } as any);
      return !!st.frozen;
    },
  };
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join("\0") === [...b].sort().join("\0");
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Exit codes: 0 key active, 6 timed out (pending kept, resume with --resume), 1 error or scope mismatch. */
export async function unfreezeWallet(o: UnfreezeWalletOpts = {}): Promise<number> {
  const cfg = loadNetworkConfig();
  const agent = requireAccount(cfg, "agent");
  const timeout = o.timeoutSec ?? 600;
  if (!Number.isFinite(timeout) || timeout <= 0) { err("--timeout must be a positive number of seconds"); return 1; }
  let pending: PendingKey;
  if (o.resume) {
    const p = loadPendingKey();
    if (!p) { err(`no pending key in ${pendingKeyPath()}; run \`standin unfreeze --wallet\` first`); return 1; }
    pending = p;
  } else {
    const prev = loadScopedKey();
    const k = generateKey();
    pending = {
      account_id: agent, public_key: k.public_key, secret_key: k.secret_key,
      receiver_id: prev?.receiver_id ?? requireAccount(cfg, "project"), method_names: prev?.method_names ?? ["record_deploy"],
      allowance: DEFAULT_ALLOWANCE, created_at: new Date().toISOString(),
    };
    savePendingKey(pending);
  }
  const dash = o.dashboard ?? process.env.STANDIN_DASHBOARD_URL ?? DEFAULT_DASHBOARD;
  out(`Open this link and approve in your NEAR wallet (owner of ${pending.account_id}):`);
  out(ownerUrl(dash, pending));
  out(`new agent key ${pending.public_key}  receiver ${pending.receiver_id}  methods ${pending.method_names.join(",") || "(any)"}  allowance ${pending.allowance} yoctoNEAR`);
  out(`waiting up to ${timeout}s for the transaction...`);

  const chain = o.chain ?? liveChain();
  const sleep = o.sleep ?? realSleep, now = o.now ?? Date.now;
  const deadline = now() + timeout * 1000;
  for (;;) {
    let v: KeyView | null = null, frozen = true;
    try {
      v = await chain.viewKey(pending.account_id, pending.public_key);
      if (v) frozen = await chain.frozen(pending.account_id);
    } catch (e) {
      err(`chain read failed, retrying: ${(e as Error).message}`);
    }
    if (v) {
      if (v.full_access || v.receiver_id !== pending.receiver_id || !sameSet(v.method_names, pending.method_names)) {
        err(`the key ${pending.public_key} exists on ${pending.account_id} with a different scope than requested (${v.full_access ? "full access" : `${v.receiver_id} [${v.method_names.join(",")}]`}); refusing to activate it`);
        appendEvent("tool_call", { tool_name: "standin unfreeze", outcome: "scope_mismatch", via: "wallet", agent_key_public: pending.public_key });
        return 1;
      }
      if (!frozen) {
        saveScopedKey({
          account_id: pending.account_id, public_key: pending.public_key, secret_key: pending.secret_key,
          receiver_id: pending.receiver_id, method_names: pending.method_names, created_at: new Date().toISOString(),
        });
        fs.rmSync(pendingKeyPath(), { force: true });
        appendEvent("tool_call", { tool_name: "standin unfreeze", outcome: "unfrozen", via: "wallet", agent_key_public: pending.public_key });
        out(`agent key active, guardian unfrozen: https://${cfg.network === "mainnet" ? "" : cfg.network + "."}nearblocks.io/address/${pending.account_id}`);
        return 0;
      }
    }
    if (now() >= deadline) {
      err(`timed out after ${timeout}s; the pending key is kept. Approve the link above, then run \`standin unfreeze --wallet --resume\``);
      return 6;
    }
    await sleep(o.pollMs ?? 3000);
  }
}
