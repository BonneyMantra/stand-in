import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  appendEvent, credentialsPath, eachEndpoint, generateKey, loadNetworkConfig, makeProvider, plantDecoy, requireAccount,
  refillPool, saveScopedKey, standinHome, takeDecoy, type NetworkConfig,
} from "@standin/core";
import { DEFAULT_ALLOWANCE, DEFAULT_DASHBOARD } from "./unfreeze-wallet.ts";
import { err, out } from "./util.ts";

const KEY_RE = /^ed25519:[1-9A-HJ-NP-Za-km-z]+$/;
const pendingSchema = z.object({
  account_id: z.string().min(2),
  watcher: z.string().min(2),
  intents: z.string().min(2),
  public_key: z.string().regex(KEY_RE),
  secret_key: z.string().regex(KEY_RE),
  receiver_id: z.string().min(2),
  method_names: z.array(z.string()),
  allowance: z.string().regex(/^\d+$/),
  created_at: z.string(),
});
export type AdoptPending = z.infer<typeof pendingSchema>;

export const adoptPendingPath = (home = standinHome()) => path.join(home, "adopt-wallet.pending.json");

export function saveAdoptPending(k: AdoptPending, home = standinHome()): void {
  fs.mkdirSync(home, { recursive: true });
  const f = adoptPendingPath(home);
  fs.writeFileSync(f, JSON.stringify(pendingSchema.parse(k), null, 2), { mode: 0o600 });
  fs.chmodSync(f, 0o600);
}
export function loadAdoptPending(home = standinHome()): AdoptPending | null {
  try {
    return pendingSchema.parse(JSON.parse(fs.readFileSync(adoptPendingPath(home), "utf8")));
  } catch {
    return null;
  }
}

/** Testnet named account only: a.b.testnet; no .near, no 64-hex implicit account. */
export function validateTestnetAccount(id: string): string | null {
  if (id.endsWith(".near") || id === "near") return `${id} is a mainnet account; adopt --wallet supports testnet only`;
  if (!/^(?:[a-z\d]+[-_])*[a-z\d]+(?:\.(?:[a-z\d]+[-_])*[a-z\d]+)*\.testnet$/.test(id) || id.length > 64) return `${id} is not a valid testnet named account (expected name.testnet)`;
  return null;
}

/** The contract with the dashboard owner console (do not change the parameter names). */
export function adoptUrl(dashboard: string, k: AdoptPending): string {
  const e = encodeURIComponent;
  const q = [
    ["op", "adopt"], ["account", k.account_id], ["watcher", k.watcher], ["intents", k.intents], ["agent_key", k.public_key],
    ["receiver", k.receiver_id], ["methods", k.method_names.join(",")], ["allowance", k.allowance],
  ].map(([a, b]) => `${a}=${e(b!)}`).join("&");
  return `${dashboard.replace(/\/+$/, "")}/app/owner?${q}`;
}

export interface AdoptKeyView { receiver_id: string; method_names: string[]; allowance: string | null; full_access: boolean }
export interface GuardianView { owner: string; watcher: string; frozen: boolean; agent_keys: string[] }
/** Chain reads, injectable for tests. viewKey: null when the key does not exist. guardian: null when no guardian is deployed. */
export interface AdoptChain {
  viewKey(account: string, publicKey: string): Promise<AdoptKeyView | null>;
  guardian(account: string): Promise<GuardianView | null>;
}
export interface AdoptWalletOpts {
  account: string;
  /** account that must be get_state.owner (default: the account itself; a factory guardian has an external owner) */
  owner?: string;
  home: string;
  resume?: boolean;
  timeoutSec?: number;
  chain?: AdoptChain;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  pollMs?: number;
  dashboard?: string;
  /** decoy source, injectable for tests (default: the pre-minted pool) */
  takeDecoy?: (home: string) => Promise<{ public_key: string; secret_key: string }>;
}

function liveChain(cfg: NetworkConfig): AdoptChain {
  const prov = makeProvider(cfg);
  const missing = (e: unknown) => /does not exist|UnknownAccessKey|AccessKeyDoesNotExist/i.test(String((e as Error)?.message ?? e) + String((e as Error)?.name ?? ""));
  return {
    async viewKey(account, publicKey) {
      let k: any;
      try {
        k = await eachEndpoint(cfg, false, (p) => p.viewAccessKey({ accountId: account, publicKey } as any), missing);
      } catch (e) {
        if (missing(e)) return null;
        throw e;
      }
      const p = k.permission;
      if (p === "FullAccess" || p?.FullAccess !== undefined) return { receiver_id: "", method_names: [], allowance: null, full_access: true };
      const fc = p.FunctionCall ?? p;
      return { receiver_id: fc.receiver_id, method_names: fc.method_names ?? [], allowance: fc.allowance == null ? null : String(fc.allowance), full_access: false };
    },
    async guardian(account) {
      try {
        const st: any = await prov.callFunction({ contractId: account, method: "get_state", args: {} } as any);
        if (!st || typeof st !== "object") return null;
        return { owner: String(st.owner), watcher: String(st.watcher), frozen: !!st.frozen, agent_keys: (st.agent_keys ?? []).map(String) };
      } catch (e) {
        if (/no contract|CodeDoesNotExist|MethodNotFound|MethodResolveError|does not exist|not found/i.test(String((e as Error)?.message ?? e))) return null;
        throw e;
      }
    },
  };
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join("\0") === [...b].sort().join("\0");
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const explorer = (cfg: NetworkConfig, id: string) => `https://${cfg.network === "mainnet" ? "" : cfg.network + "."}nearblocks.io/address/${id}`;

/** Exit codes: 0 protected, 6 timed out (pending kept, resume with --resume), 1 error or refusal. */
export async function adoptWallet(o: AdoptWalletOpts): Promise<number> {
  const cfg = loadNetworkConfig();
  const timeout = o.timeoutSec ?? 600;
  if (!Number.isFinite(timeout) || timeout <= 0) { err("--timeout must be a positive number of seconds"); return 1; }
  // An owner may also be an Ethereum-wallet account (0x + 40 hex) that owns a factory guardian.
  const ownerBad = o.owner && !/^0x[0-9a-f]{40}$/.test(o.owner) ? validateTestnetAccount(o.owner) : null;
  const bad = validateTestnetAccount(o.account) ?? ownerBad;
  if (bad) { err(bad); return 1; }
  const owner = o.owner ?? o.account;
  if (cfg.network !== "testnet") { err(`config network is ${cfg.network}; adopt --wallet supports testnet only`); return 1; }
  const watcher = requireAccount(cfg, "watcher");
  const intents = requireAccount(cfg, "intents");
  const home = standinHome();
  let pending: AdoptPending;
  if (o.resume) {
    const p = loadAdoptPending(home);
    if (!p) { err(`no pending key in ${adoptPendingPath(home)}; run \`standin adopt --wallet --account ${o.account} --home DIR\` first`); return 1; }
    if (p.account_id !== o.account) { err(`the pending key is for ${p.account_id}, not ${o.account}`); return 1; }
    pending = p;
  } else {
    const k = generateKey();
    pending = {
      account_id: o.account, watcher, intents, public_key: k.public_key, secret_key: k.secret_key,
      receiver_id: requireAccount(cfg, "project"), method_names: ["record_deploy"],
      allowance: DEFAULT_ALLOWANCE, created_at: new Date().toISOString(),
    };
    saveAdoptPending(pending, home);
  }
  const dash = o.dashboard ?? process.env.STANDIN_DASHBOARD_URL ?? DEFAULT_DASHBOARD;
  out(`Open this link and approve in your NEAR wallet (owner of ${pending.account_id}). One transaction deploys the guardian and registers the agent key; no owner key leaves your wallet:`);
  out(adoptUrl(dash, pending));
  out(`new agent key ${pending.public_key}  receiver ${pending.receiver_id}  methods ${pending.method_names.join(",") || "(any)"}  allowance ${pending.allowance} yoctoNEAR  watcher ${pending.watcher}`);
  out(`waiting up to ${timeout}s for the transaction...`);

  const chain = o.chain ?? liveChain(cfg);
  const sleep = o.sleep ?? realSleep, now = o.now ?? Date.now;
  const refuse = (outcome: string, msg: string): number => {
    err(msg);
    appendEvent("tool_call", { tool_name: "standin adopt", outcome, via: "wallet", account_id: pending.account_id, agent_key_public: pending.public_key }, home);
    return 1;
  };
  const deadline = now() + timeout * 1000;
  for (;;) {
    let v: AdoptKeyView | null = null, g: GuardianView | null = null;
    try {
      v = await chain.viewKey(pending.account_id, pending.public_key);
      if (v) g = await chain.guardian(pending.account_id);
    } catch (e) {
      err(`chain read failed, retrying: ${(e as Error).message}`);
    }
    if (v) {
      const want = pending.allowance === "0" ? null : pending.allowance;
      if (v.full_access) return refuse("full_access_refused", `the key ${pending.public_key} exists on ${pending.account_id} as a FULL-ACCESS key; refusing to adopt it`);
      if (v.receiver_id !== pending.receiver_id || !sameSet(v.method_names, pending.method_names) || v.allowance !== want) {
        return refuse("scope_mismatch", `the key ${pending.public_key} exists on ${pending.account_id} with a different scope than requested (${v.receiver_id} [${v.method_names.join(",")}] allowance ${v.allowance ?? "unlimited"}); refusing to adopt it`);
      }
      if (g) {
        if (g.owner !== owner) return refuse("wrong_owner", `the guardian on ${pending.account_id} reports owner ${g.owner}, expected ${owner}; refusing to adopt`);
        if (g.watcher !== pending.watcher) return refuse("wrong_watcher", `the guardian on ${pending.account_id} is watched by ${g.watcher}, not ${pending.watcher}; its freeze would never come from our watcher. Refusing to adopt`);
        if (g.frozen) err("the guardian is frozen; unfreeze it in your wallet (`standin unfreeze --wallet`), still waiting...");
        else if (g.agent_keys.includes(pending.public_key)) return finish(cfg, pending, o, home);
      }
    }
    if (now() >= deadline) {
      err(`timed out after ${timeout}s; the pending key is kept. Approve the link above, then run \`standin adopt --wallet --account ${pending.account_id} --home ${o.home} --resume\``);
      return 6;
    }
    await sleep(o.pollMs ?? 3000);
  }
}

async function finish(cfg: NetworkConfig, p: AdoptPending, o: AdoptWalletOpts, home: string): Promise<number> {
  // Decoy first: a failure here keeps the pending key, so `--resume` can finish the job (the chain side is already done).
  const decoy = requireAccount(cfg, "decoy");
  const take = o.takeDecoy ?? (async (h: string) => { await refillPool(1, cfg, h); return takeDecoy({ cfg, home: h }); });
  const d = await take(home);
  const target = credentialsPath(o.home, cfg.network, decoy);
  plantDecoy({ kind: "near-credentials", path: target, decoyAccountId: decoy, key: d, agent: "manual", cwd: o.home, network: cfg.network, home });
  const raw = cfg.raw as { accounts?: Record<string, unknown> };
  const config = { ...cfg.raw, accounts: { ...(raw.accounts ?? {}), ...cfg.accounts, agent: p.account_id } };
  const cfgFile = path.join(home, "config.json");
  fs.writeFileSync(cfgFile, JSON.stringify(config, null, 2) + "\n");
  saveScopedKey({
    account_id: p.account_id, public_key: p.public_key, secret_key: p.secret_key,
    receiver_id: p.receiver_id, method_names: p.method_names, created_at: new Date().toISOString(),
  }, home);
  fs.rmSync(adoptPendingPath(home), { force: true });
  appendEvent("tool_call", { tool_name: "standin adopt", outcome: "adopted via wallet", via: "wallet", account_id: p.account_id, agent_key_public: p.public_key }, home);
  out(`${p.account_id} is protected: guardian active, scoped agent key registered, decoy planted at ${target}`);
  out(`guardian: ${explorer(cfg, p.account_id)}`);
  out(`config for this home: ${cfgFile} (agent = ${p.account_id})`);
  out(`start the watcher for it:  STANDIN_HOME=${home} STANDIN_CONFIG=${cfgFile} standin dev up`);
  out(`(dev up only checks accounts, tops up the decoy pool and starts the watcher; it never deploys or signs as ${p.account_id}. Add STANDIN_WATCHER_PORT=<port> if :4317 is taken.)`);
  return 0;
}
