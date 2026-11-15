import { GuardianState } from "../wallet/near";
import { GUARDIAN_CODE_HASH, DEFAULT_WATCHER } from "../wallet/guardianCode";
import { ChainAnswer, TabRpc, viewAccount, viewFunction, type KeyPermission, type Rpc } from "../tabwatcher/rpc";
import { ENDPOINTS } from "./rpc";

/**
 * "Check any guardian" on /verify: everything about one account, read from public RPC in this browser. The guardian builds
 * Stand-in ships: the pinned build the owner console deploys (apps/web/public/guardian, the code on si-agent-5289.testnet)
 * and the factory's build (docs/guardian-factory.md: adds new_owned and withdraw), which every factory guardian runs.
 */
export const FACTORY = "guard.si-project-5289.testnet";
export const FACTORY_GUARDIAN_HASH = "8mfwwJ9bmSEoaTEtrk8NPbh2A1A65WDWjaHeGoaF4Lm4";
export const MPC_SIGNER = "v1.signer-prod.testnet";
export const BUILDS: Record<string, string> = {
  [GUARDIAN_CODE_HASH]: "pinned build (the owner console deploys it; byte-identical to si-agent-5289.testnet)",
  [FACTORY_GUARDIAN_HASH]: `factory build (every <name>.${FACTORY} runs it)`,
};
const EMPTY_CODE = "11111111111111111111111111111111";

/** drpc first, then the archival nodes: freeze records can be days old. */
export const verifyRpc: Rpc = new TabRpc(ENDPOINTS.testnet);

export const ACCOUNT_RE = /^(?=.{2,64}$)(?:[a-z0-9]+(?:[-_][a-z0-9]+)*\.)*[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

export interface KeyRow { public_key: string; permission: KeyPermission }
export interface AgentKeyRow { key: string; onChain: KeyPermission | null }
export interface IntentsRow { key: string; registered: boolean | null }

export type WatcherKind = "self-serve" | "project" | "other";

export interface GuardianReport {
  kind: "guardian";
  account: string;
  height: number;
  codeHash: string;
  build: string | null;
  storageBytes: bigint;
  state: GuardianState;
  isFactory: boolean;
  /** factory guardians: does guardians_of(owner) list it */
  factoryListed: boolean | null;
  watcher: { id: string; kind: WatcherKind; exists: boolean | null; keys: KeyRow[] | null };
  agentKeys: AgentKeyRow[];
  intents: IntentsRow[];
  accessKeys: KeyRow[];
}

export type CheckResult =
  | GuardianReport
  | { kind: "missing"; account: string }
  | { kind: "no-contract"; account: string; height: number }
  | { kind: "not-guardian"; account: string; codeHash: string; build: string | null; detail: string };

export const watcherKind = (owner: string, watcher: string): WatcherKind =>
  watcher === `watch.${owner}` ? "self-serve" : watcher === DEFAULT_WATCHER ? "project" : "other";

const isFactoryChild = (id: string) => id.endsWith(`.${FACTORY}`) && !id.slice(0, -FACTORY.length - 1).includes(".");

async function keyList(rpc: Rpc, account: string): Promise<KeyRow[] | null> {
  try {
    const r = await rpc.call<{ keys: { public_key: string; access_key: { permission: KeyPermission } }[] }>("query", { request_type: "view_access_key_list", finality: "final", account_id: account });
    return r.keys.map((k) => ({ public_key: k.public_key, permission: k.access_key.permission }));
  } catch (e) {
    if (e instanceof ChainAnswer && e.kind === "UNKNOWN_ACCOUNT") return null;
    throw e;
  }
}

/** Reads one account. Throws RpcDown when no node answers; every other outcome is a CheckResult. */
export async function checkGuardian(account: string, rpc: Rpc = verifyRpc): Promise<CheckResult> {
  const acct = await viewAccount(rpc, account);
  if (!acct) return { kind: "missing", account };
  if (acct.codeHash === EMPTY_CODE) return { kind: "no-contract", account, height: acct.blockHeight };
  const build = BUILDS[acct.codeHash] ?? null;
  let raw: unknown;
  try {
    raw = await viewFunction(rpc, account, "get_state", {}, "final");
  } catch (e) {
    if (e instanceof ChainAnswer) return { kind: "not-guardian", account, codeHash: acct.codeHash, build, detail: e.kind === "CONTRACT_ERROR" ? "its contract has no get_state method (or it panics)" : e.kind };
    throw e;
  }
  const parsed = GuardianState.safeParse(raw);
  if (!parsed.success) return { kind: "not-guardian", account, codeHash: acct.codeHash, build, detail: "get_state answers, but not with a guardian's fields" };
  const state = parsed.data;
  const isFactory = isFactoryChild(account);
  const [accessKeys, watcherKeys, factoryListed, intents] = await Promise.all([
    keyList(rpc, account),
    keyList(rpc, state.watcher),
    isFactory ? viewFunction<string[]>(rpc, FACTORY, "guardians_of", { owner: state.owner }, "final").then((l) => l.includes(account), () => null) : Promise.resolve(null),
    Promise.all(state.intents_keys.map(async (key) => ({
      key, registered: await viewFunction<boolean>(rpc, state.intents_contract, "has_public_key", { account_id: account, public_key: key }, "final").catch(() => null),
    }))),
  ]);
  const keys = accessKeys ?? [];
  return {
    kind: "guardian", account, height: acct.blockHeight, codeHash: acct.codeHash, build, storageBytes: acct.storageUsage, state, isFactory, factoryListed,
    watcher: { id: state.watcher, kind: watcherKind(state.owner, state.watcher), exists: watcherKeys !== null, keys: watcherKeys },
    agentKeys: state.agent_keys.map((key) => ({ key, onChain: keys.find((k) => k.public_key === key)?.permission ?? null })),
    intents, accessKeys: keys,
  };
}

/**
 * The transaction behind a freeze record. The guardian logs the block its freeze ran in (`at_block`) and who called it
 * (`by`), not the transaction hash: the caller's key nonce moved in the block that included it, at most a few blocks
 * earlier, so those blocks' key changes for `by` name candidate transactions, each confirmed as `freeze` on this guardian.
 */
export async function findFreezeTx(guardian: string, by: string, atBlock: number, rpc: Rpc = verifyRpc): Promise<string | null> {
  for (let h = atBlock; h >= atBlock - 3; h--) {
    let changes: { type?: string; cause?: { type?: string; tx_hash?: string } }[];
    try {
      const r = await rpc.call<{ changes: typeof changes }>("EXPERIMENTAL_changes", { changes_type: "all_access_key_changes", account_ids: [by], block_id: h });
      changes = r.changes ?? [];
    } catch (e) {
      if (e instanceof ChainAnswer) continue;
      throw e;
    }
    for (const c of changes) {
      const hash = c.cause?.type === "transaction_processing" ? c.cause.tx_hash : undefined;
      if (!hash) continue;
      const t = await rpc.call<{ transaction: { receiver_id: string; actions: { FunctionCall?: { method_name: string } }[] } }>("tx", { tx_hash: hash, sender_account_id: by, wait_until: "NONE" }).catch(() => null);
      if (t?.transaction.receiver_id === guardian && t.transaction.actions.some((a) => a.FunctionCall?.method_name === "freeze")) return hash;
    }
  }
  return null;
}
