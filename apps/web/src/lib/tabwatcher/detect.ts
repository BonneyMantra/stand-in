/**
 * How the tab watcher decides that a decoy was used. Pure functions, unit-tested in apps/web/test/tabwatcher-detect.test.ts.
 *
 * The CLI watcher (packages/watcher/src/stream.ts, followKeyChanges) treats any `access_key_update` on the bait whose cause is
 * `transaction_processing` and whose key is not the bait's admin key as a theft: only a transaction signed by that key bumps
 * its nonce. A browser tab can be throttled or miss a poll, so the tab watcher reads the same fact from key state, which
 * cannot be skipped: every tick it reads the bait's key list (`view_access_key_list`) and compares nonces with the previous
 * read. A nonce that grew is a use somewhere in the blocks between the two reads; those blocks are then scanned with
 * `EXPERIMENTAL_changes` (the CLI's own rule) for the transaction hash and its block.
 */

/** NEAR gives a new key the nonce (block height - 1) * 10^6, so a fresh key's nonce is a multiple of this. */
export const NONCE_RANGE = 1_000_000n;

export interface Snapshot {
  height: number;
  hash: string;
  /** The bait account does not exist at this height. */
  missing: boolean;
  /** public key -> nonce */
  keys: Map<string, bigint>;
}

export interface RawKeyList {
  block_height: number;
  block_hash: string;
  keys: { public_key: string; access_key: { nonce: number | string } }[];
}

export function snapshotOf(r: RawKeyList): Snapshot {
  return { height: r.block_height, hash: r.block_hash, missing: false, keys: new Map(r.keys.map((k) => [k.public_key, BigInt(k.access_key.nonce)])) };
}

export const missingSnapshot = (height: number, hash = ""): Snapshot => ({ height, hash, missing: true, keys: new Map() });

export interface Diff {
  /** Keys that certainly signed at least one transaction between the two reads. */
  used: string[];
  /** Keys whose state alone cannot say (new with a fresh-looking nonce, or gone): the blocks in between must be scanned. */
  suspects: string[];
}

/**
 * Compares two reads of the bait's keys (`a` older than `b`). The admin key (the bait's own key, which plants and deletes
 * decoys) is never a theft. Returns null when `b` is not newer than `a` (a lagging node), so nothing is concluded from it.
 */
export function diffSnapshots(a: Snapshot, b: Snapshot, admin: string): Diff | null {
  if (b.height <= a.height) return null;
  const used: string[] = [];
  const suspects: string[] = [];
  for (const [pk, nonce] of b.keys) {
    if (pk === admin) continue;
    const before = a.keys.get(pk);
    if (before !== undefined) {
      if (nonce > before) used.push(pk);
      else if (nonce < before) suspects.push(pk); // deleted and added again in between
    } else if (nonce % NONCE_RANGE !== 0n) {
      used.push(pk); // a new key that has already signed: AddKey only ever sets a multiple of 10^6
    } else {
      suspects.push(pk); // new and fresh-looking: a planted decoy, or one used with a crafted nonce
    }
  }
  for (const pk of a.keys.keys()) if (pk !== admin && !b.keys.has(pk)) suspects.push(pk); // deleted, maybe by itself
  return { used, suspects };
}

/** One use of a bait key as `EXPERIMENTAL_changes` reports it. */
export interface KeyUse {
  public_key: string;
  tx_hash: string | null;
  height: number;
}

export interface RawChange {
  type?: string;
  cause?: { type?: string; tx_hash?: string };
  change?: { public_key?: string; account_id?: string };
}

/** The CLI watcher's rule, applied to one block's changes for the bait: a transaction signed by a non-admin key. */
export function usesIn(changes: RawChange[], height: number, admin: string): KeyUse[] {
  const out: KeyUse[] = [];
  for (const ch of changes) {
    const pk = ch.change?.public_key;
    if (!pk || pk === admin || ch.type !== "access_key_update" || ch.cause?.type !== "transaction_processing") continue;
    out.push({ public_key: pk, tx_hash: ch.cause.tx_hash ?? null, height });
  }
  return out;
}

/** Heights after `from` up to `to`, at most `cap` of them, oldest first. */
export function heightsBetween(from: number, to: number, cap = 40): number[] {
  const out: number[] = [];
  for (let h = from + 1; h <= to && out.length < cap; h++) out.push(h);
  return out;
}

/** A detected theft: the key that signed, and (once the blocks are scanned) its transaction and block. */
export interface Trip {
  id: string;
  public_key: string;
  tx_hash: string | null;
  /** The block that included the decoy-signed transaction (from the changes scan), when known. */
  theft_block: number | null;
  /** The read that first showed the use. */
  detected_at_block: number;
  detected_at: number;
  via: "key state" | "changes";
}

/** One trip per key per use: a key's later nonce bumps (the thief again) are new trips, a re-read of the same one is not. */
export const tripId = (pk: string, nonce: bigint | undefined, txHash: string | null) => txHash ?? `${pk}@${nonce ?? "?"}`;

/** Freeze arguments the guardian records in its freeze log (reason is limited to 500 bytes). */
export function freezeArgs(t: Pick<Trip, "public_key" | "tx_hash">, bait: string) {
  const reason = `tab watcher: decoy key ${t.public_key} on ${bait} signed a transaction${t.tx_hash ? ` (${t.tx_hash})` : ""}`;
  return { reason: reason.slice(0, 500), decoy_public_key: t.public_key, tx_hash: t.tx_hash };
}
