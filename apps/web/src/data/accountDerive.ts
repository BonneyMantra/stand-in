import { hasSigned, signedCount, type AccountSnapshot, type GuardianView, type HomeAccountView, type KeyInfo } from "./account";
import { canFreeze, type HomeRecord } from "../lib/wallet/homeStore";

/** What the dashboard derives from a snapshot plus this browser's home. Pure: no RPC, no storage. */

export interface DecoyView {
  public_key: string;
  /** the bait's own key (adds decoys): never a decoy */
  admin: boolean;
  /** this browser holds the secret (a decoy it added, or the bait key) */
  heldHere: boolean;
  signed: boolean;
  signedTxs: number;
  /** freeze records that name this key as the decoy that tripped */
  trippedBy: FreezeView[];
}

export interface FreezeView {
  guardian: string;
  at_block: string;
  reason: string;
  by: string;
  byRole: "watcher" | "owner" | "other";
  decoy_public_key: string | null;
  /** the decoy's transaction (the theft), when the watcher recorded it */
  trip_tx: string | null;
  deleted_keys: string[];
  intents_keys_removed: string[];
  /** a decoy was used on chain (the watcher froze with its key or tx); otherwise a manual freeze */
  trip: boolean;
}

export function decoysOf(bait: HomeAccountView, home: HomeRecord | null, freezes: FreezeView[]): DecoyView[] {
  const held = new Set(home ? [home.bait.public_key, ...home.decoys.map((d) => d.public_key)] : []);
  const admin = home?.bait.public_key ?? null;
  return bait.keys
    .map((k: KeyInfo) => ({
      public_key: k.public_key, admin: k.public_key === admin, heldHere: held.has(k.public_key),
      signed: hasSigned(k), signedTxs: signedCount(k), trippedBy: freezes.filter((f) => f.decoy_public_key === k.public_key),
    }))
    .sort((a, b) => Number(b.admin) - Number(a.admin) || Number(b.signed) - Number(a.signed));
}

export function freezesOf(guardians: GuardianView[]): FreezeView[] {
  const out: FreezeView[] = [];
  for (const g of guardians) {
    for (const r of g.state.freeze_log) {
      const byRole = r.by === g.state.watcher ? "watcher" : r.by === g.state.owner ? "owner" : "other";
      out.push({
        guardian: g.id, at_block: r.at_block, reason: r.reason, by: r.by, byRole,
        decoy_public_key: r.decoy_public_key ?? null, trip_tx: r.tx_hash ?? null,
        deleted_keys: r.deleted_keys, intents_keys_removed: r.intents_keys_removed,
        trip: !!(r.decoy_public_key || r.tx_hash),
      });
    }
  }
  return out.sort((a, b) => Number(BigInt(b.at_block) - BigInt(a.at_block)));
}

/**
 * The home's bait or watcher as this browser sees it:
 *  missing: not on chain (to be created); held: on chain with a key this browser holds;
 *  foreign: on chain, but this browser holds no key for it (another browser or a CLI home has it);
 *  pending: this browser holds a key for an account that is not on chain yet (a request that did not land).
 */
export type HomeAcctStatus = "missing" | "held" | "foreign" | "pending";

export function homeStatus(view: HomeAccountView, key: string | null): HomeAcctStatus {
  if (!view.exists) return key ? "pending" : "missing";
  return key && view.keys.some((k) => k.public_key === key) ? "held" : "foreign";
}

export interface HomeSummary {
  bait: HomeAcctStatus;
  watcher: HomeAcctStatus;
  /** the watcher key this browser holds, as the chain shows it */
  watcherKey: KeyInfo | null;
  /** guardians watched by watch.<owner> that this browser's watcher key can sign freeze on */
  covered: string[];
  /** guardians watched by watch.<owner> that it cannot (another guardian made after the home, or no key here) */
  uncovered: string[];
  /** guardians watched by someone else (the project's watcher, from before the self-serve home) */
  foreignWatched: { id: string; watcher: string }[];
}

export function homeSummary(s: AccountSnapshot, home: HomeRecord | null): HomeSummary {
  const bait = homeStatus(s.bait, home?.bait.public_key ?? null);
  const watcher = homeStatus(s.watcher, home?.watcher.public_key ?? null);
  const watcherKey = home ? s.watcher.keys.find((k) => k.public_key === home.watcher.public_key) ?? null : null;
  const mine = s.guardians.filter((g) => g.state.watcher === s.watcher.id);
  const coveredBy = (g: GuardianView) => {
    if (!home || watcher !== "held" || !watcherKey) return false;
    if (watcherKey.kind === "full") return true;
    return watcherKey.receiver_id === g.id && (watcherKey.method_names ?? []).includes("freeze") && canFreeze(home, g.id);
  };
  return {
    bait, watcher, watcherKey,
    covered: mine.filter(coveredBy).map((g) => g.id),
    uncovered: mine.filter((g) => !coveredBy(g)).map((g) => g.id),
    foreignWatched: s.guardians.filter((g) => g.state.watcher !== s.watcher.id).map((g) => ({ id: g.id, watcher: g.state.watcher })),
  };
}

export type NextStep =
  | { kind: "no-account" }
  | { kind: "protect" }
  | { kind: "create-home"; guardian: string }
  | { kind: "import-home" }
  | { kind: "unfreeze"; guardian: string }
  | { kind: "add-decoy" }
  | { kind: "agent-key"; guardian: string }
  | { kind: "protected" };

/** The one thing a new owner should do next, in the order the setup happens. */
export function nextStep(s: AccountSnapshot, home: HomeRecord | null, eth: boolean): NextStep {
  if (!s.ownerAccount) return { kind: "no-account" };
  if (s.guardians.length === 0) return { kind: "protect" };
  const frozen = s.guardians.find((g) => g.state.frozen);
  const h = homeSummary(s, home);
  const watchedByMe = s.guardians.find((g) => g.state.watcher === s.watcher.id);
  if (!eth && watchedByMe) {
    if (h.bait === "foreign" || h.watcher === "foreign") return { kind: "import-home" };
    if (h.bait !== "held" || h.watcher !== "held") return { kind: "create-home", guardian: home?.guardians[0] ?? watchedByMe.id };
  }
  if (frozen) return { kind: "unfreeze", guardian: frozen.id };
  if (!eth && h.bait === "held" && decoysOf(s.bait, home, []).every((d) => d.admin)) return { kind: "add-decoy" };
  const keyless = s.guardians.find((g) => g.state.agent_keys.length === 0);
  if (keyless) return { kind: "agent-key", guardian: keyless.id };
  return { kind: "protected" };
}
