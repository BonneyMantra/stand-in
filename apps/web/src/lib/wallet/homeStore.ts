import { z } from "zod";
import { generateKeyPair, keyMatches } from "./keys";

/**
 * The owner's self-serve home, held in this browser: the bait `deployer.<owner>` (every decoy is a key on it) and the
 * watcher `watch.<owner>` (the guardian's watcher, which freezes it). The owner console generates both keys here and the
 * owner's wallet creates the accounts; the secrets never leave this browser unless the owner exports them.
 *
 * These are low-value testnet keys: the bait holds 0.2 NEAR that is meant to be stolen, and a browser-made watcher key is a
 * function-call key that may only call `freeze` on one guardian. Never put real funds behind them.
 *
 * Storage: localStorage, one entry per owner (`standin.home.v1:<owner>`). Every access is wrapped: a private window or
 * blocked storage reads as "no home", and a save reports false instead of throwing.
 *
 * Stable contract (the lab, /verify and the in-tab watcher import it): loadHome(owner) returns
 * { bait: { account_id, secret_key }, watcher: { account_id, secret_key }, guardians } or null, and saveHome(home)
 * stores one. Fields are only ever added.
 */

const KEY_PREFIX = "standin.home.v1:";
export const HOME_EVENT = "standin:home";

const Ed = z.string().regex(/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,90}$/, "an ed25519 key");
const Account = z.string().min(2).max(64).regex(/^(?:[a-z0-9]+(?:[-_][a-z0-9]+)*\.)*[a-z0-9]+(?:[-_][a-z0-9]+)*$/, "a NEAR account id");

export const HomeKey = z.object({ account_id: Account, public_key: Ed, secret_key: Ed });
export type HomeKey = z.infer<typeof HomeKey>;

/** What the watcher's key may do on chain. A browser-made key: `function-call` on one guardian, `freeze` only. */
export const WatcherScope = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("full-access") }),
  z.object({ kind: z.literal("function-call"), receiver_id: Account, method_names: z.array(z.string()) }),
]);
export type WatcherScope = z.infer<typeof WatcherScope>;

/** A decoy key this browser added to the bait (its secret is what gets leaked on purpose). */
export const HomeDecoy = z.object({ public_key: Ed, secret_key: Ed, added_at: z.string(), tx_hash: z.string().optional(), label: z.string().optional() });
export type HomeDecoy = z.infer<typeof HomeDecoy>;

/** A transaction this browser sent or the wallet signed for this home, for explorer links. */
export const HomeTx = z.object({ hash: z.string(), label: z.string(), at: z.number() });
export type HomeTx = z.infer<typeof HomeTx>;

export const HomeRecord = z.object({
  version: z.literal(1),
  owner: Account,
  network: z.literal("testnet"),
  bait: HomeKey,
  watcher: HomeKey.extend({ scope: WatcherScope }),
  /** Guardians this home's watcher key can freeze (a function-call key: exactly its receiver). */
  guardians: z.array(Account),
  /** browser: keys generated here; cli-import: keys read from a CLI --home. */
  source: z.enum(["browser", "cli-import"]),
  created_at: z.string(),
  decoys: z.array(HomeDecoy).default([]),
  txs: z.array(HomeTx).default([]),
});
export type HomeRecord = z.infer<typeof HomeRecord>;

/** Where homes are kept; tests pass a Map-backed one. */
export interface KeyValueStore { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void; key(i: number): string | null; readonly length: number }

let override: KeyValueStore | null = null;
/** Tests only: route every read and write to `s` (null restores localStorage). */
export function setHomeStorage(s: KeyValueStore | null) { override = s; }

function store(): KeyValueStore | null {
  if (override) return override;
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export const homeIds = (owner: string) => ({ bait: `deployer.${owner}`, watcher: `watch.${owner}` });

/** Every key in the record is well-formed and its secret matches its public half. */
function keysHold(h: HomeRecord): boolean {
  return keyMatches(h.bait.secret_key, h.bait.public_key) && keyMatches(h.watcher.secret_key, h.watcher.public_key)
    && h.decoys.every((d) => keyMatches(d.secret_key, d.public_key));
}

/** The full record for `owner`, or null (none stored, unreadable storage, or a record that fails validation). */
export function loadHomeRecord(owner: string): HomeRecord | null {
  const s = store();
  if (!s) return null;
  try {
    const raw = s.getItem(KEY_PREFIX + owner);
    if (!raw) return null;
    const parsed = HomeRecord.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.owner !== owner || !keysHold(parsed.data)) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

/** The stable shape: bait and watcher keys plus the guardians the watcher can freeze, or null. */
export function loadHome(owner: string): HomeRecord | null {
  return loadHomeRecord(owner);
}

function emit(owner: string) {
  try {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(HOME_EVENT, { detail: { owner } }));
  } catch {
    // no window (tests) or a browser without CustomEvent: subscribers re-read on their next render
  }
}

/** Stores `home` under its owner. Returns false when the record is invalid or storage refused it (quota, private mode). */
export function saveHome(home: HomeRecord): boolean {
  const parsed = HomeRecord.safeParse(home);
  if (!parsed.success || !keysHold(parsed.data)) return false;
  const s = store();
  if (!s) return false;
  try {
    s.setItem(KEY_PREFIX + parsed.data.owner, JSON.stringify(parsed.data));
  } catch {
    return false;
  }
  emit(parsed.data.owner);
  return true;
}

/** Applies `fn` to the stored record and saves the result; returns it, or null when there is none or the save failed. */
export function updateHome(owner: string, fn: (h: HomeRecord) => HomeRecord): HomeRecord | null {
  const h = loadHomeRecord(owner);
  if (!h) return null;
  const next = fn(h);
  return saveHome(next) ? next : null;
}

export function removeHome(owner: string): boolean {
  const s = store();
  if (!s) return false;
  try {
    s.removeItem(KEY_PREFIX + owner);
  } catch {
    return false;
  }
  emit(owner);
  return true;
}

/** Owners with a home in this browser. */
export function listHomeOwners(): string[] {
  const s = store();
  if (!s) return [];
  const out: string[] = [];
  try {
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k?.startsWith(KEY_PREFIX)) out.push(k.slice(KEY_PREFIX.length));
    }
  } catch {
    return out;
  }
  return out.sort();
}

/** Calls `fn(owner)` when a home changes in this tab (saveHome) or in another tab (storage event). */
export function subscribeHome(fn: (owner: string) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const local = (e: Event) => fn(String((e as CustomEvent<{ owner: string }>).detail?.owner ?? ""));
  const other = (e: StorageEvent) => { if (e.key?.startsWith(KEY_PREFIX)) fn(e.key.slice(KEY_PREFIX.length)); };
  window.addEventListener(HOME_EVENT, local);
  window.addEventListener("storage", other);
  return () => { window.removeEventListener(HOME_EVENT, local); window.removeEventListener("storage", other); };
}

/** The scope a browser-made watcher key gets: `freeze` on one guardian, nothing else. */
export const freezeOnly = (guardian: string): WatcherScope => ({ kind: "function-call", receiver_id: guardian, method_names: ["freeze"] });

/**
 * A new home for `owner` watching `guardian`, with fresh keys. Not saved: the caller saves it before asking the wallet to
 * create the accounts, so a landed transaction always has its key in this browser.
 */
export function newHome(owner: string, guardian: string, now = new Date()): HomeRecord {
  const ids = homeIds(owner);
  const bait = generateKeyPair(), watcher = generateKeyPair();
  return {
    version: 1, owner, network: "testnet", source: "browser", created_at: now.toISOString(),
    bait: { account_id: ids.bait, ...bait },
    watcher: { account_id: ids.watcher, ...watcher, scope: freezeOnly(guardian) },
    guardians: [guardian], decoys: [], txs: [],
  };
}

/** Can this home's watcher key sign `freeze` on `guardian`? */
export function canFreeze(home: Pick<HomeRecord, "watcher" | "guardians">, guardian: string): boolean {
  const s = home.watcher.scope;
  return s.kind === "full-access" ? home.guardians.includes(guardian) : s.receiver_id === guardian && s.method_names.includes("freeze");
}

/** Records a transaction for explorer links (newest first, at most 100). */
export function recordHomeTx(owner: string, tx: HomeTx): HomeRecord | null {
  return updateHome(owner, (h) => ({ ...h, txs: [tx, ...h.txs.filter((t) => t.hash !== tx.hash)].slice(0, 100) }));
}
