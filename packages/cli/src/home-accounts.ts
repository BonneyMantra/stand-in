import fs from "node:fs";
import { Account, PublicKey } from "near-api-js";
import {
  HOME_ACCOUNT_FUND, actions, assertSuccess, eachEndpoint, generateKey, homeAccountIds, homeAccountProblem, homeConfigFile, homeKeysDir,
  loadHomeKey, saveHomeKey, type HomeRole, type NetworkConfig,
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
}
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
      try {
        const k: any = await eachEndpoint(cfg, false, (p) => p.viewAccessKey({ accountId: id, publicKey } as any), missing);
        return k.permission === "FullAccess" || k.permission?.FullAccess !== undefined;
      } catch (e) {
        if (missing(e)) return false;
        throw e;
      }
    },
  };
}

/**
 * Per home account: on chain with this home's key: reuse. On chain without it: refuse, naming the fix. Missing: create,
 * with a key generated now and saved first (an unfinished run's saved key is reused, so its printed link stays valid).
 */
export async function planHomeAccounts(parent: string, home: string, chain: HomeChain): Promise<HomePlan> {
  const problem = homeAccountProblem(parent);
  if (problem) throw new HomeRefusal(problem);
  const ids = homeAccountIds(parent);
  const one = async (role: HomeRole, id: string): Promise<HomeAccount> => {
    const local = loadHomeKey(home, id);
    if (await chain.account(id)) {
      if (local && (await chain.fullAccess(id, local.public_key))) return { role, account_id: id, public_key: local.public_key, exists: true };
      const what = role === "bait" ? "add decoy keys to it" : "sign freezes with it";
      throw new HomeRefusal(`${id} already exists and this home holds no full-access key for it, so Stand-in cannot ${what}. Run adopt with the --home that created it, or copy that home's .standin/keys/${id}.json into ${homeKeysDir(home)}/`);
    }
    const key = local ?? generateKey();
    if (!local) saveHomeKey(home, role, id, key);
    return { role, account_id: id, public_key: key.public_key, exists: false };
  };
  const bait = await one("bait", ids.bait);
  const watcher = await one("watcher", ids.watcher);
  return { parent, bait, watcher, toCreate: [bait, watcher].filter((a) => !a.exists) };
}

/** NEAR an account can spend: its balance minus what its storage locks (1 NEAR per 100 kB). */
export const spendable = (a: AccountView) => a.amount - a.storage_usage * 10n ** 19n;
/** Gas for the owner's transactions, with room to spare. */
export const GAS_MARGIN = 50_000_000_000_000_000_000_000n;
/** What the parent must be able to spend before signing: guardian storage when it deploys one, 0.2 NEAR per account to create, gas. */
export const fundingNeed = (plan: HomePlan, guardianStorage: bigint) => guardianStorage + HOME_ACCOUNT_FUND * BigInt(plan.toCreate.length) + GAS_MARGIN;
export const nearStr = (y: bigint, digits = 3) => (Number(y / 10n ** 18n) / 1e6).toFixed(digits);

/** Refuses, before anything is signed, when `parent` cannot pay for the plan. */
export async function checkFunding(chain: HomeChain, plan: HomePlan, guardianStorage: bigint): Promise<void> {
  const need = fundingNeed(plan, guardianStorage);
  const acc = await chain.account(plan.parent);
  if (!acc) throw new HomeRefusal(`${plan.parent} does not exist on testnet; create and fund it first`);
  const have = spendable(acc);
  if (have < need) {
    const parts = [guardianStorage ? `${nearStr(guardianStorage, 2)} NEAR guardian storage` : "", plan.toCreate.length ? `${nearStr(HOME_ACCOUNT_FUND, 1)} NEAR for each of ${plan.toCreate.map((a) => a.account_id).join(" and ")}` : "", `${nearStr(GAS_MARGIN, 2)} NEAR gas`].filter(Boolean);
    throw new HomeRefusal(`${plan.parent} can spend ${nearStr(have)} NEAR; this needs ${nearStr(need)} (${parts.join(", ")}). Short by ${nearStr(need - have)} NEAR: fund ${plan.parent} and run the command again. Nothing was sent.`);
  }
}

/** CreateAccount + Transfer(0.2 NEAR) + AddKey(full access, the home's key): one transaction from the parent per account. */
export const createActions = (publicKey: string) => [
  actions.createAccount(), actions.transfer(HOME_ACCOUNT_FUND), actions.addFullAccessKey(PublicKey.from(publicKey)),
];

/** Keystore route: the owner key the CLI already holds creates each missing home account. */
export async function createHomeAccounts(owner: Account, plan: HomePlan): Promise<{ account_id: string; tx_hash: string }[]> {
  const done: { account_id: string; tx_hash: string }[] = [];
  for (const a of plan.toCreate) {
    const res: any = await owner.signAndSendTransaction({ receiverId: a.account_id, actions: createActions(a.public_key), waitUntil: "EXECUTED_OPTIMISTIC" });
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
