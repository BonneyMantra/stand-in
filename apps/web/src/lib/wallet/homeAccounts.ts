import { DEFAULT_WATCHER, YOCTO_PER_BYTE } from "./guardianCode";
import type { AdoptRequest } from "./deeplink";
import { accountExists, isEthAccount, viewAccessKey } from "./near";

/**
 * A home's own accounts (same rules as packages/core homeacct.ts): the bait `deployer.<owner>`, on which every decoy is a
 * key, and the watcher `watch.<owner>`, which freezes the guardian. `standin adopt --wallet` generates their keys on the
 * user's machine; an adopt link carries only the public keys, and the owner's wallet creates and funds both accounts.
 */
export const HOME_ACCOUNT_FUND = 200_000_000_000_000_000_000_000n;
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
  if (!(await accountExists(a.accountId))) return { ...a, status: "missing" };
  const k = await viewAccessKey(a.accountId, a.publicKey);
  return { ...a, status: k?.permission === "FullAccess" ? "ready" : "conflict" };
}

/** Gas for the owner's transactions, with room to spare. */
export const GAS_MARGIN = 50_000_000_000_000_000_000_000n;

/**
 * What the signer needs before signing: the guardian deploy's own requirement when the link deploys one (storage + gas),
 * otherwise its current storage plus gas, and 0.2 NEAR for each account still to create.
 */
export function fundingFor(signer: { amount: bigint; storageUsage: bigint }, toCreate: number, deployRequired: bigint | null) {
  const need = (deployRequired ?? signer.storageUsage * YOCTO_PER_BYTE + GAS_MARGIN) + HOME_ACCOUNT_FUND * BigInt(toCreate);
  return { need, shortfall: need > signer.amount ? need - signer.amount : 0n };
}

/** One transaction from the owner per account: CreateAccount, Transfer 0.2 NEAR, AddKey (full access, the CLI's key). */
export function createAccountTx(a: HomeAccountReq) {
  return {
    receiverId: a.accountId,
    actions: [
      { type: "CreateAccount" as const },
      { type: "Transfer" as const, params: { deposit: HOME_ACCOUNT_FUND.toString() } },
      { type: "AddKey" as const, params: { publicKey: a.publicKey, accessKey: { permission: "FullAccess" as const } } },
    ],
  };
}
