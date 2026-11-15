import fs from "node:fs";
import path from "node:path";
import { homeKeysDir } from "./config.ts";
import { publicKeyOf, type GeneratedKey } from "./rpc.ts";

/**
 * A home's own accounts, so a stranger needs no key of ours: the bait (every decoy is a full-access key on it) and the
 * watcher (the guardian's `watcher`, which freezes it). Both are sub-accounts of the account that owns the guardian,
 * created and funded by its owner, with keys generated on the user's machine and kept only in <home>/keys.
 */

/** The bait is named like a deployment key, which is what a thief looks for. The watcher is never planted anywhere. */
export const BAIT_PREFIX = "deployer";
export const WATCH_PREFIX = "watch";

export interface HomeAccountIds { parent: string; bait: string; watcher: string }
export type HomeRole = "bait" | "watcher";

export function homeAccountIds(parent: string): HomeAccountIds {
  return { parent, bait: `${BAIT_PREFIX}.${parent}`, watcher: `${WATCH_PREFIX}.${parent}` };
}

/** Why `parent` cannot hold the two sub-accounts, or null. Only a named account can create sub-accounts of itself. */
export function homeAccountProblem(parent: string): string | null {
  if (/^0x[0-9a-f]{40}$/.test(parent)) return `${parent} is an Ethereum Wallets account; only a named NEAR account can create the bait and watcher sub-accounts`;
  if (/^[0-9a-f]{64}$/.test(parent)) return `${parent} is an implicit account; only a named NEAR account can create the bait and watcher sub-accounts`;
  const longest = `${BAIT_PREFIX}.${parent}`;
  if (longest.length > 64) return `${longest} would be ${longest.length} characters (NEAR allows 64), so ${parent} is too long to hold the bait and watcher sub-accounts`;
  return null;
}

const keyFile = (home: string, accountId: string) => path.join(homeKeysDir(home), `${accountId}.json`);

/** Stores a home account's key (file 0600, dir 0700). Never overwrites a different key: that file may be its only copy. */
export function saveHomeKey(home: string, role: HomeRole, accountId: string, key: GeneratedKey): string {
  const dir = homeKeysDir(home);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  const f = keyFile(home, accountId);
  const prev = loadHomeKey(home, accountId);
  if (prev && prev.public_key !== key.public_key) throw new Error(`${f} already holds another key for ${accountId}; refusing to overwrite it`);
  const body = { account_id: accountId, role, public_key: key.public_key, private_key: key.secret_key, created_at: new Date().toISOString() };
  fs.writeFileSync(f, JSON.stringify(body, null, 2) + "\n", { mode: 0o600 });
  fs.chmodSync(f, 0o600);
  return f;
}

/** The home's key for `accountId`, or null when this home has none. */
export function loadHomeKey(home: string, accountId: string): GeneratedKey | null {
  try {
    const j = JSON.parse(fs.readFileSync(keyFile(home, accountId), "utf8"));
    const secret = j.private_key ?? j.secret_key;
    if (typeof secret !== "string" || !secret.startsWith("ed25519:")) return null;
    return { secret_key: secret, public_key: publicKeyOf(secret) };
  } catch {
    return null;
  }
}
