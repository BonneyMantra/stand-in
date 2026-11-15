import fs from "node:fs";
import { Account, PublicKey } from "near-api-js";
import {
  BAIT_FUND, WATCHER_FUND, actions, assertSuccess, eachEndpoint, generateKey, homeAccountIds, homeAccountProblem, homeConfigFile, homeKeysDir,
  loadHomeKey, near, quoteAdopt, saveHomeKey, shortOf, type HomeRole, type NetworkConfig, type Quote,
} from "@standin/core";

/**
 * Self-serve accounts for a home (both adopt routes): the bait `deployer.<parent>` and the watcher `watch.<parent>`, where
 * <parent> owns the guardian. Keys are generated here and saved to <home>/keys before anything is signed, so a landed
 * transaction always has its key on disk; a link or an owner transaction only ever carries their public keys.
 */

export interface AccountView { amount: bigint; storage_usage: bigint; code_hash: string }
export interface HomeChain {
  account(id: string): Promise<AccountView | null>;
  /** true when `publicKey` is a full-access key on `id` */
  fullAccess(id: string, publicKey: string): Promise<boolean>;
  /**
   * The permission of `publicKey` on `id`, or null when it is not on the account. Optional: a chain without it can only
   * tell full access, so a function-call watcher key (made by the owner console) is accepted only where this exists.
   */
  keyView?(id: string, publicKey: string): Promise<KeyView | null>;
}
export type KeyView = { kind: "full-access" } | { kind: "function-call"; receiver_id: string; method_names: string[] };
export interface HomeAccount { role: HomeRole; account_id: string; public_key: string; exists: boolean }
export interface HomePlan { parent: string; bait: HomeAccount; watcher: HomeAccount; toCreate: HomeAccount[] }

/** A refusal before anything is signed; the message names the fix. */
export class HomeRefusal extends Error {}

const missing = (e: unknown) => /does not exist|UnknownAccount|AccountDoesNotExist|UnknownAccessKey|AccessKeyDoesNotExist/i.test(String((e as Error)?.message ?? e) + String((e as Error)?.name ?? ""));

export function liveHomeChain(cfg: NetworkConfig): HomeChain {
  return {
    async account(id) {
      try {
        const a: any = await eachEndpoint(cfg, false, (p) => p.viewAccount({ accountId: id } as any), missing);
        return { amount: BigInt(a.amount), storage_usage: BigInt(a.storage_usage), code_hash: String(a.code_hash) };
      } catch (e) {
        if (missing(e)) return null;
        throw e;
      }
    },
    async fullAccess(id, publicKey) {
      return (await this.keyView!(id, publicKey))?.kind === "full-access";
    },
    async keyView(id, publicKey) {
      try {
        const k: any = await eachEndpoint(cfg, false, (p) => p.viewAccessKey({ accountId: id, publicKey } as any), missing);
        if (k.permission === "FullAccess" || k.permission?.FullAccess !== undefined) return { kind: "full-access" };
        const fc = k.permission?.FunctionCall ?? k.permission?.functionCall;
        if (!fc) return null;
        return { kind: "function-call", receiver_id: String(fc.receiver_id ?? fc.receiverId), method_names: (fc.method_names ?? fc.methodNames ?? []).map(String) };
      } catch (e) {
        if (missing(e)) return null;
        throw e;
      }
    },
  };
}

/** A function-call key that may call `freeze` on exactly this guardian (what the owner console makes for a watcher). */
const freezesGuardian = (k: KeyView | null, guardian: string) => k?.kind === "function-call" && k.receiver_id === guardian && k.method_names.includes("freeze");

/**
 * Per home account: on chain with this home's key: reuse. On chain without it: refuse, naming the fix. Missing: create,
 * with a key generated now and saved first (an unfinished run's saved key is reused, so its printed link stays valid).
 * The bait needs a full-access key (every decoy is a key added to it). The watcher also accepts, when `guardian` is given,
 * a function-call key whose receiver is that guardian and whose methods include `freeze`: all a freeze needs.
 */
export async function planHomeAccounts(parent: string, home: string, chain: HomeChain, guardian?: string): Promise<HomePlan> {
  const problem = homeAccountProblem(parent);
  if (problem) throw new HomeRefusal(problem);
  const ids = homeAccountIds(parent);
  const one = async (role: HomeRole, id: string): Promise<HomeAccount> => {
    const local = loadHomeKey(home, id);
    if (await chain.account(id)) {
      if (local && (await chain.fullAccess(id, local.public_key))) return { role, account_id: id, public_key: local.public_key, exists: true };
      const view = local && role === "watcher" && guardian && chain.keyView ? await chain.keyView(id, local.public_key) : null;
      if (local && guardian && freezesGuardian(view, guardian)) return { role, account_id: id, public_key: local.public_key, exists: true };
      const what = role === "bait" ? "add decoy keys to it" : "sign freezes with it";
      const orFc = role === "watcher" && guardian ? `, nor a function-call key that may call freeze on ${guardian}` : "";
      const seen = view?.kind === "function-call" ? ` Its key here is a function-call key on ${view.receiver_id} for ${view.method_names.length ? view.method_names.join(", ") : "any method"}.` : "";
      throw new HomeRefusal(`${id} already exists and this home holds no full-access key for it${orFc}, so Stand-in cannot ${what}.${seen} Run adopt with the --home that created it, or copy that home's .standin/keys/${id}.json into ${homeKeysDir(home)}/`);
    }
    const key = local ?? generateKey();
    if (!local) saveHomeKey(home, role, id, key);
    return { role, account_id: id, public_key: key.public_key, exists: false };
  };
  const bait = await one("bait", ids.bait);
  const watcher = await one("watcher", ids.watcher);
  return { parent, bait, watcher, toCreate: [bait, watcher].filter((a) => !a.exists) };
}

/** The quote for this plan, from @standin/core funding (the owner console quotes from the same function). */
export const planQuote = (plan: HomePlan, storageBytes: bigint, deployGuardian: boolean): Quote =>
  quoteAdopt({ storageBytes, deployGuardian, createBait: !plan.bait.exists, createWatcher: !plan.watcher.exists });

/** The quote as lines for a terminal: amount, what it is, why. */
export const quoteText = (q: Quote) =>
  [...q.lines.filter((l) => l.yocto > 0n).map((l) => `  ${near(l.yocto, 3).padStart(7)} NEAR  ${l.label}: ${l.why}`), `  ${near(q.total, 3).padStart(7)} NEAR  total the account must hold`].join("\n");

/** Refuses, before anything is signed, when `parent` cannot hold the quote. Returns the quote to show before signing. */
export async function checkFunding(chain: HomeChain, plan: HomePlan, deployGuardian: boolean): Promise<{ quote: Quote; summary: string }> {
  const acc = await chain.account(plan.parent);
  if (!acc) throw new HomeRefusal(`${plan.parent} does not exist on testnet; create and fund it first`);
  const quote = planQuote(plan, acc.storage_usage, deployGuardian);
  const short = shortOf(acc.amount, quote);
  if (short > 0n) {
    throw new HomeRefusal(`${plan.parent} holds ${near(acc.amount, 3)} NEAR and needs ${near(quote.total, 3)}:\n${quoteText(quote)}\nShort by ${near(short, 3)} NEAR: fund ${plan.parent} and run the command again. Nothing was sent.`);
  }
  return { quote, summary: `${plan.parent} holds ${near(acc.amount, 3)} NEAR; this needs ${near(quote.total, 3)}:\n${quoteText(quote)}` };
}

/** CreateAccount + Transfer (the role's funding) + AddKey(full access, the home's key): one transaction from the parent per account. */
export const createActions = (a: Pick<HomeAccount, "role" | "public_key">) => [
  actions.createAccount(), actions.transfer(a.role === "bait" ? BAIT_FUND : WATCHER_FUND), actions.addFullAccessKey(PublicKey.from(a.public_key)),
];

/** Keystore route: the owner key the CLI already holds creates each missing home account. */
export async function createHomeAccounts(owner: Account, plan: HomePlan): Promise<{ account_id: string; tx_hash: string }[]> {
  const done: { account_id: string; tx_hash: string }[] = [];
  for (const a of plan.toCreate) {
    const res: any = await owner.signAndSendTransaction({ receiverId: a.account_id, actions: createActions(a), waitUntil: "EXECUTED_OPTIMISTIC" });
    assertSuccess(res);
    done.push({ account_id: a.account_id, tx_hash: String(res.transaction?.hash ?? res.transaction_outcome?.id) });
  }
  return done;
}

/** The home's config.json: the base accounts with this home's guardian (`agent`), bait (`decoy`) and watcher. */
export function writeHomeConfig(home: string, cfg: NetworkConfig, agent: string, plan: HomePlan): string {
  const raw = cfg.raw as { accounts?: Record<string, unknown> };
  const config = {
    ...cfg.raw,
    accounts: { ...(raw.accounts ?? {}), ...cfg.accounts, agent, decoy: plan.bait.account_id, watcher: plan.watcher.account_id },
    home_accounts: { parent: plan.parent, bait: plan.bait.account_id, watcher: plan.watcher.account_id },
  };
  fs.mkdirSync(home, { recursive: true });
  const f = homeConfigFile(home);
  fs.writeFileSync(f, JSON.stringify(config, null, 2) + "\n");
  return f;
}

/** The guardian cannot change its watcher (no such method), so a guardian watched by anyone else is refused, with the fix. */
export function watcherMismatch(account: string, current: string, wanted: string): string {
  return `the guardian on ${account} is watched by ${current}, and this home's watcher is ${wanted}. The guardian has no method to change its watcher and this home holds no key for ${current}, so no freeze would ever come from your own watcher. Protect a fresh account instead, or create a guarded agent account in the owner console (it uses ${wanted}) and adopt that one with --owner`;
}
