import { GuardianState } from "../wallet/near";
import { canFreeze, type HomeRecord } from "../wallet/homeStore";
import { REPORT_UPFRONT, UPFRONT_PER_TGAS } from "../wallet/funding";
import { ChainAnswer, spendable, viewAccessKey, viewAccount, viewFunction, type AccountView, type KeyPermission, type Rpc } from "./rpc";

const NEAR = 10n ** 24n;
/** What the thief takes from the bait in a lab run (the hosted lab's 0.05 NEAR); it is returned at the end. */
export const LOOT = NEAR / 20n;
/** The bait pays for the decoy key's storage and two small transactions on top of the loot. */
export const BAIT_NEEDS = LOOT + NEAR / 100n;
/** A freeze prepays 100 TGas (packages/core funding: about 0.1 NEAR up front, 0.0002 spent). */
export const FREEZE_UPFRONT = 100n * UPFRONT_PER_TGAS;
export const REGISTRY = "blocklist.si-ol-25769.testnet";
export const REPORT_DEPOSIT = 50_000_000_000_000_000_000_000n;

export type ProblemKind =
  | "not-guardian" | "watcher-mismatch" | "cannot-freeze" | "no-watcher-account" | "no-watcher-key" | "no-bait-account" | "no-bait-key"
  | "bait-low" | "watcher-low" | "allowance-low";

export interface Problem { kind: ProblemKind; text: string; account?: string; short?: bigint }

export interface Preflight {
  guardian: string;
  state: GuardianState | null;
  bait: AccountView | null;
  watcher: AccountView | null;
  watcherKey: KeyPermission | null;
  /** Problems that stop a run. "Already frozen" is not one: it is shown with its own Unfreeze offer. */
  problems: Problem[];
  report: { ok: boolean; why: string };
}

const fmt = (y: bigint) => (Number((y * 1000n) / NEAR) / 1000).toFixed(3);

/** Reads everything a run on `guardian` needs from chain and lists what stops it. Throws RpcDown when no node answers. */
export async function preflight(rpc: Rpc, home: HomeRecord, guardian: string): Promise<Preflight> {
  const [rawState, bait, watcher, watcherKey, baitKey] = await Promise.all([
    viewFunction<unknown>(rpc, guardian, "get_state").catch((e) => (e instanceof ChainAnswer ? e : Promise.reject(e))),
    viewAccount(rpc, home.bait.account_id),
    viewAccount(rpc, home.watcher.account_id),
    viewAccessKey(rpc, home.watcher.account_id, home.watcher.public_key),
    viewAccessKey(rpc, home.bait.account_id, home.bait.public_key),
  ]);
  const problems: Problem[] = [];
  const parsed = rawState instanceof ChainAnswer ? null : GuardianState.safeParse(rawState);
  const state = parsed?.success ? parsed.data : null;
  if (!state) problems.push({ kind: "not-guardian", text: `${guardian} does not answer get_state like a Stand-in guardian${rawState instanceof ChainAnswer ? ` (${rawState.kind})` : ""}.` });
  if (state && state.watcher !== home.watcher.account_id) {
    problems.push({ kind: "watcher-mismatch", account: state.watcher, text: `${guardian}'s watcher is ${state.watcher}, not your ${home.watcher.account_id}. The guardian has no method to change its watcher, so only ${state.watcher} can freeze it.` });
  }
  if (!canFreeze(home, guardian)) problems.push({ kind: "cannot-freeze", text: `The watcher key in this browser is scoped to ${home.watcher.scope.kind === "function-call" ? home.watcher.scope.receiver_id : "other guardians"}, not ${guardian}.` });
  if (!watcher) problems.push({ kind: "no-watcher-account", account: home.watcher.account_id, text: `${home.watcher.account_id} does not exist on testnet yet.` });
  else if (!watcherKey) problems.push({ kind: "no-watcher-key", account: home.watcher.account_id, text: `The watcher key in this browser is not on ${home.watcher.account_id}.` });
  if (!bait) problems.push({ kind: "no-bait-account", account: home.bait.account_id, text: `${home.bait.account_id} does not exist on testnet yet.` });
  else if (!baitKey) problems.push({ kind: "no-bait-key", account: home.bait.account_id, text: `The bait key in this browser is not on ${home.bait.account_id}, so it cannot plant a decoy.` });

  if (bait && spendable(bait) < BAIT_NEEDS) {
    const short = BAIT_NEEDS - spendable(bait);
    problems.push({ kind: "bait-low", account: home.bait.account_id, short, text: `${home.bait.account_id} can spend ${fmt(spendable(bait))} NEAR; a run needs ${fmt(BAIT_NEEDS)} (0.05 for the thief to take, returned at the end, and gas). Short by ${fmt(short)} NEAR.` });
  }
  if (watcher && spendable(watcher) < FREEZE_UPFRONT) {
    const short = FREEZE_UPFRONT - spendable(watcher);
    problems.push({ kind: "watcher-low", account: home.watcher.account_id, short, text: `${home.watcher.account_id} can spend ${fmt(spendable(watcher))} NEAR; a freeze prepays ${fmt(FREEZE_UPFRONT)} (100 TGas; about 0.0002 is spent). Short by ${fmt(short)} NEAR.` });
  }
  const fc = watcherKey && typeof watcherKey.permission === "object" ? watcherKey.permission.FunctionCall : null;
  if (fc) {
    if (fc.receiver_id !== guardian || !fc.method_names.includes("freeze")) {
      problems.push({ kind: "cannot-freeze", text: `The watcher key on chain may call ${fc.method_names.join(", ") || "any method"} on ${fc.receiver_id}, not freeze on ${guardian}.` });
    }
    if (fc.allowance !== null && BigInt(fc.allowance) < FREEZE_UPFRONT) {
      problems.push({ kind: "allowance-low", account: home.watcher.account_id, text: `The watcher key's gas allowance is ${fmt(BigInt(fc.allowance))} NEAR, below the ${fmt(FREEZE_UPFRONT)} NEAR a freeze prepays. Add a new freeze key from the owner console.` });
    }
  }

  const full = watcherKey?.permission === "FullAccess";
  const canPay = !!watcher && spendable(watcher) >= REPORT_UPFRONT + FREEZE_UPFRONT;
  const report = !full
    ? { ok: false, why: "Available with a CLI watcher (full key): the browser's watcher key may only call freeze, and a report attaches a 0.05 NEAR deposit." }
    : !canPay
      ? { ok: false, why: `Skipped: ${home.watcher.account_id} can spend ${watcher ? fmt(spendable(watcher)) : "0"} NEAR and a report prepays about ${fmt(REPORT_UPFRONT)} NEAR on top of the freeze (unused gas and deposit come back).` }
      : { ok: true, why: `Your watcher holds a full-access key and ${fmt(spendable(watcher!))} NEAR, enough to prepay a report.` };
  return { guardian, state, bait, watcher, watcherKey: watcherKey?.permission ?? null, problems, report };
}

export { fmt as nearFmt };

/** What an account can spend, for display ("—" when it was not read). */
export const spendableOf = (a: { amount: bigint; storageUsage: bigint } | null) => (a ? fmt(a.amount - a.storageUsage * 10n ** 19n) : "—");
