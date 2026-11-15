import { DEFAULT_WATCHER } from "./guardianCode";
import type { AdoptRequest } from "./deeplink";
import { BAIT_FUND, WATCHER_FUND, quoteAdopt, shortOf, type Quote } from "./funding";
import { accountExists, isEthAccount, viewAccessKey } from "./near";

/**
 * A home's own accounts (same rules as packages/core homeacct.ts): the bait `deployer.<owner>`, on which every decoy is a
 * key, and the watcher `watch.<owner>`, which freezes the guardian. `standin adopt --wallet` generates their keys on the
 * user's machine; an adopt link carries only the public keys, and the owner's wallet creates and funds both accounts.
 */
export const WATCH_PREFIX = "watch";

/**
 * The watcher a new guardian gets from this console: the owner's own `watch.<owner>` (created later by
 * `standin adopt --wallet`, whose key never leaves the owner's machine). A 0x account cannot create sub-accounts, so a
 * guardian owned by one keeps the project's watcher.
 */
export const watcherFor = (ownerId: string) => (isEthAccount(ownerId) ? DEFAULT_WATCHER : `${WATCH_PREFIX}.${ownerId}`);
export const ownsWatcher = (ownerId: string, watcher: string) => watcher === `${WATCH_PREFIX}.${ownerId}`;

export type HomeRole = "bait" | "watcher";
export interface HomeAccountReq { role: HomeRole; accountId: string; publicKey: string }
/** missing: to create; ready: exists with the CLI's key; conflict: exists without it (refused: the CLI could not use it). */
export type HomeAccountStatus = "missing" | "ready" | "conflict";
export interface HomeAccountState extends HomeAccountReq { status: HomeAccountStatus }

/** The accounts an adopt link asks the owner to create (only those the CLI sent a key for). */
export function homeAccountsOf(req: AdoptRequest): HomeAccountReq[] {
  const out: HomeAccountReq[] = [];
  if (req.bait && req.bait_key) out.push({ role: "bait", accountId: req.bait, publicKey: req.bait_key });
  if (req.watch_key) out.push({ role: "watcher", accountId: req.watcher, publicKey: req.watch_key });
  return out;
}

export async function readHomeAccount(a: HomeAccountReq): Promise<HomeAccountState> {
  // Optimistic: read right after the owner's transaction, a final read can still miss the new account.
  if (!(await accountExists(a.accountId, "optimistic"))) return { ...a, status: "missing" };
  const k = await viewAccessKey(a.accountId, a.publicKey);
  return { ...a, status: k?.permission === "FullAccess" ? "ready" : "conflict" };
}

/** What each new account receives (shared with the CLI). */
export const fundFor = (role: HomeRole) => (role === "bait" ? BAIT_FUND : WATCHER_FUND);

/**
 * The quote before signing, from the shared funding module (the CLI prints the same lines): the signer's locked storage,
 * the guardian when the request deploys one, each account still to create, gas.
 */
export function adoptQuote(signer: { amount: bigint; storageUsage: bigint }, creates: HomeRole[], deployGuardian: boolean): Quote & { short: bigint } {
  const q = quoteAdopt({ storageBytes: signer.storageUsage, deployGuardian, createBait: creates.includes("bait"), createWatcher: creates.includes("watcher") });
  return { ...q, short: shortOf(signer.amount, q) };
}

/** One transaction from the owner per account: CreateAccount, Transfer (its funding), AddKey (full access, the CLI's key). */
export function createAccountTx(a: HomeAccountReq) {
  return {
    receiverId: a.accountId,
    actions: [
      { type: "CreateAccount" as const },
      { type: "Transfer" as const, params: { deposit: fundFor(a.role).toString() } },
      { type: "AddKey" as const, params: { publicKey: a.publicKey, accessKey: { permission: "FullAccess" as const } } },
    ],
  };
}

/**
 * The home this browser holds (homeStore): one transaction per account still missing, from the owner. The bait gets a
 * full-access key (it adds decoy keys to itself); the watcher gets a function-call key that may only call `freeze` on its
 * one guardian, with no allowance cap (it holds only its own 0.45 NEAR, and a function-call key cannot attach a deposit).
 */
export function browserHomeTxs(home: { bait: { account_id: string; public_key: string }; watcher: { account_id: string; public_key: string; scope: { kind: string; receiver_id?: string; method_names?: string[] } } }, create: { bait: boolean; watcher: boolean }) {
  const txs: { role: HomeRole; accountId: string; tx: ReturnType<typeof createAccountTx> | ReturnType<typeof watcherTx> }[] = [];
  if (create.bait) txs.push({ role: "bait", accountId: home.bait.account_id, tx: createAccountTx({ role: "bait", accountId: home.bait.account_id, publicKey: home.bait.public_key }) });
  if (create.watcher) txs.push({ role: "watcher", accountId: home.watcher.account_id, tx: watcherTx(home.watcher) });
  return txs;
}

function watcherTx(w: { account_id: string; public_key: string; scope: { kind: string; receiver_id?: string; method_names?: string[] } }) {
  const permission = w.scope.kind === "function-call" && w.scope.receiver_id
    ? { receiverId: w.scope.receiver_id, methodNames: w.scope.method_names ?? ["freeze"] }
    : ("FullAccess" as const);
  return {
    receiverId: w.account_id,
    actions: [
      { type: "CreateAccount" as const },
      { type: "Transfer" as const, params: { deposit: WATCHER_FUND.toString() } },
      { type: "AddKey" as const, params: { publicKey: w.public_key, accessKey: { permission } } },
    ],
  };
}
