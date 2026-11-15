import { readGuardian, rpc, type GuardianLookup, type GuardianState } from "../lib/wallet/near";
import { viewAccount } from "../lib/wallet/guardianCode";

/**
 * "My account": the signed-in owner's own Stand-in state, read from testnet RPC (drpc first, see near.ts). Nothing here
 * comes from the recorded run or from a watcher of ours.
 *  - guardians: the owner's own account when it runs the guardian, plus the factory's guardians_of(owner), plus any guardian
 *    the browser's home watches;
 *  - each guardian's get_state: frozen, agent keys, intents keys, freeze_log;
 *  - the home accounts: deployer.<owner> (bait; every key on it but the admin key is a decoy) and watch.<owner>, with
 *    view_access_key_list.
 */

export const FACTORY = "guard.si-project-5289.testnet";
const NONCE_RANGE = 1_000_000n;

export interface KeyInfo {
  public_key: string;
  nonce: bigint;
  kind: "full" | "function-call";
  receiver_id?: string;
  method_names?: string[];
  /** yoctoNEAR; null = unlimited */
  allowance?: string | null;
}

export interface GuardianView {
  id: string;
  /** self: the owner's own account runs it; factory: <name>.guard…; other: another account the owner owns */
  hosted: "self" | "factory" | "other";
  state: GuardianState;
}

export interface HomeAccountView { id: string; exists: boolean; keys: KeyInfo[]; amount: bigint | null }

export interface OwnerAccountView { amount: bigint; storageUsage: bigint; codeHash: string }

export interface AccountSnapshot {
  owner: string;
  readAt: number;
  /** null: the owner account does not exist on testnet */
  ownerAccount: OwnerAccountView | null;
  /** what get_state on the owner's own account said (a guardian, no contract, another contract) */
  self: GuardianLookup;
  guardians: GuardianView[];
  /** guardian ids that could not be read (listed by the factory or the home, but get_state failed) */
  unreadable: { id: string; why: string }[];
  bait: HomeAccountView;
  watcher: HomeAccountView;
}

/** Everything the snapshot reads from chain; tests pass a fake. */
export interface Chain {
  guardian(id: string): Promise<GuardianLookup>;
  guardiansOf(owner: string): Promise<string[]>;
  keys(id: string): Promise<KeyInfo[] | null>;
  account(id: string): Promise<OwnerAccountView | null>;
}

type RawKey = { public_key: string; access_key: { nonce: number | string; permission: "FullAccess" | { FunctionCall: { allowance: string | null; receiver_id: string; method_names: string[] } } } };

export function toKeyInfo(k: RawKey): KeyInfo {
  const p = k.access_key.permission;
  const nonce = BigInt(k.access_key.nonce);
  if (p === "FullAccess") return { public_key: k.public_key, nonce, kind: "full" };
  return { public_key: k.public_key, nonce, kind: "function-call", receiver_id: p.FunctionCall.receiver_id, method_names: p.FunctionCall.method_names, allowance: p.FunctionCall.allowance };
}

const missing = (e: unknown) => /UNKNOWN_ACCOUNT|does not exist/i.test(e instanceof Error ? e.message : String(e));
const b64 = (o: unknown) => btoa(JSON.stringify(o));

export const liveChain: Chain = {
  guardian: readGuardian,
  async guardiansOf(owner) {
    const r = await rpc<{ result: number[] }>("query", {
      request_type: "call_function", finality: "optimistic", account_id: FACTORY, method_name: "guardians_of", args_base64: b64({ owner }),
    });
    const v = JSON.parse(new TextDecoder().decode(new Uint8Array(r.result)));
    return Array.isArray(v) ? v.map(String) : [];
  },
  async keys(id) {
    try {
      const r = await rpc<{ keys: RawKey[] }>("query", { request_type: "view_access_key_list", finality: "optimistic", account_id: id });
      return r.keys.map(toKeyInfo);
    } catch (e) {
      if (missing(e)) return null;
      throw e;
    }
  },
  async account(id) {
    try {
      return await viewAccount(id);
    } catch (e) {
      if (missing(e)) return null;
      throw e;
    }
  },
};

export const isFactoryGuardian = (id: string) => id.endsWith(`.${FACTORY}`) && !id.slice(0, -FACTORY.length - 1).includes(".");
export const homeAccountIds = (owner: string) => ({ bait: `deployer.${owner}`, watcher: `watch.${owner}` });

async function homeAccount(chain: Chain, id: string): Promise<HomeAccountView> {
  // view_access_key_list answers an empty list for an account that does not exist: existence comes from view_account.
  const acct = await chain.account(id);
  if (!acct) return { id, exists: false, keys: [], amount: null };
  return { id, exists: true, keys: (await chain.keys(id)) ?? [], amount: acct.amount };
}

/**
 * Reads the owner's whole Stand-in state. `extraGuardians`: ids the browser's home knows about (a guardian on another
 * account, e.g. from an adopt link), checked for `owner` like the others. Throws only when the RPC itself fails.
 */
export async function readAccountSnapshot(owner: string, extraGuardians: string[] = [], chain: Chain = liveChain, now = Date.now): Promise<AccountSnapshot> {
  const ids = homeAccountIds(owner);
  const [ownerAccount, self, listed, bait, watcher] = await Promise.all([
    chain.account(owner),
    chain.guardian(owner),
    chain.guardiansOf(owner).catch(() => [] as string[]),
    homeAccount(chain, ids.bait),
    homeAccount(chain, ids.watcher),
  ]);
  const guardians: GuardianView[] = [];
  const unreadable: { id: string; why: string }[] = [];
  if (self.kind === "guardian" && self.state.owner === owner) guardians.push({ id: owner, hosted: "self", state: self.state });
  const others = [...new Set([...listed, ...extraGuardians])].filter((id) => id !== owner);
  const reads = await Promise.all(others.map(async (id) => {
    try { return { id, lookup: await chain.guardian(id) }; } catch (e) { return { id, error: e instanceof Error ? e.message : String(e) }; }
  }));
  for (const r of reads) {
    if ("error" in r) { unreadable.push({ id: r.id, why: r.error ?? "read failed" }); continue; }
    if (r.lookup.kind !== "guardian") { if (listed.includes(r.id)) unreadable.push({ id: r.id, why: `no guardian state (${r.lookup.kind})` }); continue; }
    if (r.lookup.state.owner !== owner) continue; // a home may list a guardian another account owns: not this owner's
    guardians.push({ id: r.id, hosted: isFactoryGuardian(r.id) ? "factory" : "other", state: r.lookup.state });
  }
  return { owner, readAt: now(), ownerAccount, self, guardians, unreadable, bait, watcher };
}

/** A key that has signed at least one transaction: NEAR starts a new key's nonce at a multiple of 10^6. */
export const hasSigned = (k: Pick<KeyInfo, "nonce">) => k.nonce % NONCE_RANGE !== 0n;
/** Transactions signed with a key, when its signer used consecutive nonces (the usual case). */
export const signedCount = (k: Pick<KeyInfo, "nonce">) => Number(k.nonce % NONCE_RANGE);
