import fs from "node:fs";
import {
  BAIT_FUND, WATCHER_FUND, appendEvent, credentialsPath, eachEndpoint, generateKey, homeAccountIds, homeAccountProblem, loadHomeKey, loadNetworkConfig, makeProvider, near,
  plantDecoy, refillPool, requireAccount, saveScopedKey, standinHome, takeDecoy, type NetworkConfig,
} from "@standin/core";
import { adoptPendingPath, adoptUrl, loadAdoptPending, saveAdoptPending, validateTestnetAccount, type AdoptPending } from "./adopt-link.ts";
import { checkFunding, HomeRefusal, liveHomeChain, planHomeAccounts, watcherMismatch, writeHomeConfig, type HomeChain, type HomePlan } from "./home-accounts.ts";
import { DEFAULT_ALLOWANCE, DEFAULT_DASHBOARD } from "./unfreeze-wallet.ts";
import { err, out } from "./util.ts";

export { adoptPendingPath, adoptUrl, loadAdoptPending, saveAdoptPending, validateTestnetAccount, type AdoptPending } from "./adopt-link.ts";

export interface AdoptKeyView { receiver_id: string; method_names: string[]; allowance: string | null; full_access: boolean }
export interface GuardianView { owner: string; watcher: string; frozen: boolean; agent_keys: string[] }
/** Chain reads, injectable for tests. viewKey: null when the key does not exist. guardian: null when no guardian is deployed. */
export interface AdoptChain {
  viewKey(account: string, publicKey: string): Promise<AdoptKeyView | null>;
  guardian(account: string): Promise<GuardianView | null>;
  /** the home accounts (default: live chain) */
  home?: HomeChain;
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
  /** decoy source, injectable for tests (default: the home's own pool, minted on its bait account) */
  takeDecoy?: (home: string, cfg: NetworkConfig) => Promise<{ public_key: string; secret_key: string }>;
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
    home: liveHomeChain(cfg),
  };
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join("\0") === [...b].sort().join("\0");
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const resumeCmd = (o: AdoptWalletOpts) => `standin adopt --wallet --account ${o.account}${o.owner ? ` --owner ${o.owner}` : ""} --home ${o.home} --resume`;
const explorer = (cfg: NetworkConfig, id: string) => `https://${cfg.network === "mainnet" ? "" : cfg.network + "."}nearblocks.io/address/${id}`;

/** The home plan as the pending record describes it (for --resume and for finishing). */
function planOf(p: AdoptPending): HomePlan {
  const bait = { role: "bait" as const, account_id: p.bait, public_key: p.bait_key ?? "", exists: !p.bait_key };
  const watcher = { role: "watcher" as const, account_id: p.watcher, public_key: p.watch_key ?? "", exists: !p.watch_key };
  return { parent: p.parent, bait, watcher, toCreate: [bait, watcher].filter((a) => !a.exists) };
}

/** Exit codes: 0 protected, 6 timed out (pending kept, resume with --resume), 1 error or refusal (nothing sent). */
export async function adoptWallet(o: AdoptWalletOpts): Promise<number> {
  const cfg = loadNetworkConfig();
  const timeout = o.timeoutSec ?? 600;
  if (!Number.isFinite(timeout) || timeout <= 0) { err("--timeout must be a positive number of seconds"); return 1; }
  const ownerBad = o.owner && !/^0x[0-9a-f]{40}$/.test(o.owner) ? validateTestnetAccount(o.owner) : null;
  const bad = validateTestnetAccount(o.account) ?? ownerBad;
  if (bad) { err(bad); return 1; }
  const parent = o.owner ?? o.account;
  if (cfg.network !== "testnet") { err(`config network is ${cfg.network}; adopt --wallet supports testnet only`); return 1; }
  const intents = requireAccount(cfg, "intents");
  // A key whose receiver is the guardian account itself could call its owner methods on a self-hosted guardian.
  if (requireAccount(cfg, "project") === o.account) { err(`the agent key's receiver may not be the guardian account ${o.account} itself`); return 1; }
  const home = standinHome();
  const chain = o.chain ?? liveChain(cfg);
  const homeChain = chain.home ?? liveHomeChain(cfg);
  let pending: AdoptPending;
  let quoteSummary = "";
  if (o.resume) {
    const p = loadAdoptPending(home);
    if (!p) { err(`no pending key in ${adoptPendingPath(home)}; run \`standin adopt --wallet --account ${o.account} --home DIR\` first`); return 1; }
    if (p.account_id !== o.account) { err(`the pending key is for ${p.account_id}, not ${o.account}`); return 1; }
    pending = p;
  } else {
    // Every check below runs before a link exists: a refusal sends nothing and asks the wallet for nothing.
    const problem = homeAccountProblem(parent);
    if (problem) { err(`${problem}. Nothing was sent.`); return 1; }
    const ids = homeAccountIds(parent);
    try {
      const g = await chain.guardian(o.account);
      if (g && g.watcher !== ids.watcher) throw new HomeRefusal(watcherMismatch(o.account, g.watcher, ids.watcher));
      const plan = await planHomeAccounts(parent, home, homeChain);
      const deploys = !g && o.account === parent;
      quoteSummary = (await checkFunding(homeChain, plan, deploys)).summary;
      const k = generateKey();
      pending = {
        account_id: o.account, watcher: ids.watcher, intents, public_key: k.public_key, secret_key: k.secret_key,
        receiver_id: requireAccount(cfg, "project"), method_names: ["record_deploy"], allowance: DEFAULT_ALLOWANCE, created_at: new Date().toISOString(),
        parent, bait: ids.bait, bait_key: plan.bait.exists ? undefined : plan.bait.public_key, watch_key: plan.watcher.exists ? undefined : plan.watcher.public_key,
      };
    } catch (e) {
      if (e instanceof HomeRefusal) { err(e.message); return 1; }
      throw e;
    }
    saveAdoptPending(pending, home);
  }
  const plan = planOf(pending);
  const dash = o.dashboard ?? process.env.STANDIN_DASHBOARD_URL ?? DEFAULT_DASHBOARD;
  const creates = plan.toCreate.map((a) => `${a.account_id} (${a.role === "bait" ? `bait, ${near(BAIT_FUND)}` : `watcher, ${near(WATCHER_FUND)}`} NEAR)`);
  if (quoteSummary) out(`Before you sign: ${quoteSummary}\n(The owner console shows the same quote, from the same code: packages/core/src/funding.ts.)`);
  const many = creates.length ? ` It is one wallet request with ${creates.length + 1} transactions (one approval in wallets that sign batches, such as Meteor and Intear; others ask once per transaction). The new accounts' keys were generated here and stay in ${home}/keys; the link carries public keys only.` : "";
  out(`Open this link and approve in your NEAR wallet (${parent}): the guardian and the agent key${creates.length ? `, then ${creates.join(" and ")}` : ""}.${many}`);
  out(adoptUrl(dash, pending));
  out(`new agent key ${pending.public_key}  receiver ${pending.receiver_id}  methods ${pending.method_names.join(",") || "(any)"}  allowance ${pending.allowance} yoctoNEAR  watcher ${pending.watcher}  bait ${pending.bait}`);
  out(`waiting up to ${timeout}s for the transactions...`);

  const sleep = o.sleep ?? realSleep, now = o.now ?? Date.now;
  const refuse = (outcome: string, msg: string): number => {
    err(msg);
    appendEvent("tool_call", { tool_name: "standin adopt", outcome, via: "wallet", account_id: pending.account_id, agent_key_public: pending.public_key }, home);
    return 1;
  };
  const deadline = now() + timeout * 1000;
  let said = "";
  for (;;) {
    let v: AdoptKeyView | null = null, g: GuardianView | null = null;
    const missingAccts: string[] = [];
    try {
      v = await chain.viewKey(pending.account_id, pending.public_key);
      if (v) g = await chain.guardian(pending.account_id);
      for (const a of plan.toCreate) if (!(await homeChain.fullAccess(a.account_id, a.public_key))) missingAccts.push(a.account_id);
    } catch (e) {
      err(`chain read failed, retrying: ${(e as Error).message}`);
      if (now() >= deadline) { err(`timed out after ${timeout}s; the pending request is kept. Run \`${resumeCmd(o)}\``); return 6; }
      await sleep(o.pollMs ?? 3000);
      continue;
    }
    let keyDone = false;
    if (v) {
      const want = pending.allowance === "0" ? null : pending.allowance;
      if (v.full_access) return refuse("full_access_refused", `the key ${pending.public_key} exists on ${pending.account_id} as a FULL-ACCESS key; refusing to adopt it`);
      if (v.receiver_id !== pending.receiver_id || !sameSet(v.method_names, pending.method_names) || v.allowance !== want) {
        return refuse("scope_mismatch", `the key ${pending.public_key} exists on ${pending.account_id} with a different scope than requested (${v.receiver_id} [${v.method_names.join(",")}] allowance ${v.allowance ?? "unlimited"}); refusing to adopt it`);
      }
      if (g) {
        if (g.owner !== parent) return refuse("wrong_owner", `the guardian on ${pending.account_id} reports owner ${g.owner}, expected ${parent}; refusing to adopt`);
        if (g.watcher !== pending.watcher) return refuse("wrong_watcher", `the guardian on ${pending.account_id} is watched by ${g.watcher}, not ${pending.watcher}; its freeze would never come from this home's watcher. Refusing to adopt`);
        if (g.frozen) err("the guardian is frozen; unfreeze it in your wallet (`standin unfreeze --wallet`), still waiting...");
        else keyDone = g.agent_keys.includes(pending.public_key);
      }
    }
    if (keyDone && !missingAccts.length) return finish(cfg, pending, plan, o, home);
    // A partly landed batch: say once what is still missing; the same link offers only that part.
    const state = keyDone ? `agent key registered; still missing on chain: ${missingAccts.join(", ")}` : missingAccts.length < plan.toCreate.length ? `created ${plan.toCreate.filter((a) => !missingAccts.includes(a.account_id)).map((a) => a.account_id).join(", ")}; the guardian part has not landed yet` : "";
    if (state && state !== said) { out(`${state}. The same link offers only what is missing.`); said = state; }
    if (now() >= deadline) {
      err(`timed out after ${timeout}s; the pending request is kept${state ? ` (${state})` : ""}. Approve the link above, then run \`${resumeCmd(o)}\``);
      return 6;
    }
    await sleep(o.pollMs ?? 3000);
  }
}

async function finish(base: NetworkConfig, p: AdoptPending, plan: HomePlan, o: AdoptWalletOpts, home: string): Promise<number> {
  // The home config first: from here on every mint, plant and the watcher use this home's own bait and watcher keys.
  for (const a of [plan.bait, plan.watcher]) {
    if (!loadHomeKey(home, a.account_id)) return refuse1(`${home}/keys has no key for ${a.account_id}; it was created with a key this home no longer holds. Restore that file, then run \`${resumeCmd(o)}\``);
  }
  const cfgFile = writeHomeConfig(home, base, p.account_id, plan);
  const cfg = loadNetworkConfig(cfgFile);
  const decoy = requireAccount(cfg, "decoy");
  const take = o.takeDecoy ?? (async (h: string, c: NetworkConfig) => { await refillPool(1, c, h); return takeDecoy({ cfg: c, home: h }); });
  let d: { public_key: string; secret_key: string };
  try {
    d = await take(home, cfg);
  } catch (e) {
    return refuse1(`the agent key is registered on ${p.account_id}, but planting the decoy on ${decoy} failed: ${(e as Error).message}. The pending request is kept; finish with \`${resumeCmd(o)}\`.`);
  }
  const target = credentialsPath(o.home, cfg.network, decoy);
  plantDecoy({ kind: "near-credentials", path: target, decoyAccountId: decoy, key: d, agent: "manual", cwd: o.home, network: cfg.network, home });
  saveScopedKey({
    account_id: p.account_id, public_key: p.public_key, secret_key: p.secret_key,
    receiver_id: p.receiver_id, method_names: p.method_names, created_at: new Date().toISOString(),
  }, home);
  fs.rmSync(adoptPendingPath(home), { force: true });
  appendEvent("tool_call", { tool_name: "standin adopt", outcome: "adopted via wallet", via: "wallet", account_id: p.account_id, agent_key_public: p.public_key }, home);
  out(`${p.account_id} is protected: guardian active, scoped agent key registered, decoy planted at ${target}`);
  out(`guardian: ${explorer(cfg, p.account_id)}`);
  out(`this home's own accounts: bait ${decoy} (every decoy is a key on it), watcher ${requireAccount(cfg, "watcher")} (freezes the guardian); keys in ${home}/keys`);
  out(`config for this home: ${cfgFile} (agent = ${p.account_id})`);
  out(`start the watcher for it:  standin dev up --home ${o.home}`);
  out(`after a freeze, get the agent a new key from your wallet:  standin unfreeze --wallet --home ${o.home}`);
  out(`(dev up checks the accounts, tops up the decoy pool on ${decoy} and starts the watcher; it never deploys or signs as ${p.account_id}. Add STANDIN_WATCHER_PORT=<port> if :4317 is taken.)`);
  return 0;
}

function refuse1(msg: string): number {
  err(msg);
  return 1;
}
