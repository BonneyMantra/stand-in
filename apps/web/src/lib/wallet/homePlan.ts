import { accountExists, isEthAccount, viewAccessKey } from "./near";
import { freezeOnly, homeIds, loadHomeRecord, newHome, saveHome, type HomeRecord } from "./homeStore";
import { browserHomeTxs } from "./homeAccounts";

/**
 * What the owner's next wallet request must add so this browser holds a working home for `guardian`: the bait and the
 * watcher, created in the same approval as the guardian unless they already exist with keys this browser holds.
 *
 *  missing: not on chain, no key here: created with fresh keys;
 *  pending: not on chain, but this browser kept keys from a request that did not land: created with those keys;
 *  held: on chain with this browser's key: nothing to do;
 *  foreign: on chain without a key this browser holds (another browser or a CLI home): nothing is created, the owner imports.
 */
export type RoleStatus = "missing" | "pending" | "held" | "foreign";

export type HomePlan =
  | { kind: "eth"; reason: string }
  | { kind: "plan"; home: HomeRecord; isNew: boolean; bait: RoleStatus; watcher: RoleStatus; create: { bait: boolean; watcher: boolean };
      /** a foreign account blocks creating the other: a home is one pair of keys */
      blocked: boolean;
      /** the browser's watcher key can sign freeze on `guardian` once the request lands */
      covers: boolean };

async function roleStatus(accountId: string, publicKey: string | null): Promise<RoleStatus> {
  // optimistic: right after a request, a final read can still miss a new account
  const exists = await accountExists(accountId, "optimistic");
  if (!exists) return publicKey ? "pending" : "missing";
  if (!publicKey) return "foreign";
  return (await viewAccessKey(accountId, publicKey)) ? "held" : "foreign";
}

export async function planBrowserHome(owner: string, guardian: string): Promise<HomePlan> {
  if (isEthAccount(owner)) return { kind: "eth", reason: "An Ethereum Wallets (0x) account cannot create sub-accounts, so it has no bait or watcher of its own; its guardian keeps the project's watcher and you freeze it from this console." };
  const ids = homeIds(owner);
  const stored = loadHomeRecord(owner);
  const [bait, watcher] = await Promise.all([
    roleStatus(ids.bait, stored?.bait.public_key ?? null),
    roleStatus(ids.watcher, stored?.watcher.public_key ?? null),
  ]);
  const blocked = bait === "foreign" || watcher === "foreign";
  const create = { bait: !blocked && (bait === "missing" || bait === "pending"), watcher: !blocked && (watcher === "missing" || watcher === "pending") };
  return retarget({ kind: "plan", home: stored ?? newHome(owner, guardian), isNew: !stored, bait, watcher, create, blocked, covers: false }, guardian);
}

/**
 * The same plan for another guardian (the factory's name is typed after the plan was read). A watcher key not yet on chain
 * takes its scope at creation, so it is pointed at `guardian`; one already on chain keeps its scope. Synchronous, so a sign
 * button can call it without a network wait before the wallet opens.
 */
export function retarget(plan: HomePlan, guardian: string): HomePlan {
  if (plan.kind !== "plan") return plan;
  const fresh = plan.watcher === "pending" || plan.watcher === "missing";
  const home = fresh ? { ...plan.home, watcher: { ...plan.home.watcher, scope: freezeOnly(guardian) }, guardians: [guardian] } : plan.home;
  const s = home.watcher.scope;
  const covers = !plan.blocked && (s.kind === "full-access" ? true : s.receiver_id === guardian);
  return { ...plan, home, covers };
}

/**
 * Saves the plan's keys before the wallet is asked anything (a landed request must always find its key here) and returns
 * the transactions to append to the request. Returns null when storage refused the keys: then nothing may be created.
 */
export function commitHomePlan(plan: HomePlan): ReturnType<typeof browserHomeTxs> | null {
  if (plan.kind !== "plan" || (!plan.create.bait && !plan.create.watcher)) return [];
  if (!saveHome(plan.home)) return null;
  return browserHomeTxs(plan.home, plan.create);
}
