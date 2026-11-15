import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { standinHome } from "@standin/core";

/** The pending `adopt --wallet` request: the agent key (its secret stays here until the chain shows it) and the home accounts. */
const KEY_RE = /^ed25519:[1-9A-HJ-NP-Za-km-z]+$/;
const pendingSchema = z.object({
  account_id: z.string().min(2),
  watcher: z.string().min(2),
  intents: z.string().min(2),
  public_key: z.string().regex(KEY_RE),
  secret_key: z.string().regex(KEY_RE),
  receiver_id: z.string().min(2),
  method_names: z.array(z.string()),
  allowance: z.string().regex(/^\d+$/),
  created_at: z.string(),
  /** who creates the home accounts (the guardian's owner) and their ids; public keys only for accounts still to create */
  parent: z.string().min(2),
  bait: z.string().min(2),
  bait_key: z.string().regex(KEY_RE).optional(),
  watch_key: z.string().regex(KEY_RE).optional(),
});
export type AdoptPending = z.infer<typeof pendingSchema>;

export const adoptPendingPath = (home = standinHome()) => path.join(home, "adopt-wallet.pending.json");

export function saveAdoptPending(k: AdoptPending, home = standinHome()): void {
  fs.mkdirSync(home, { recursive: true });
  const f = adoptPendingPath(home);
  fs.writeFileSync(f, JSON.stringify(pendingSchema.parse(k), null, 2), { mode: 0o600 });
  fs.chmodSync(f, 0o600);
}
export function loadAdoptPending(home = standinHome()): AdoptPending | null {
  try {
    return pendingSchema.parse(JSON.parse(fs.readFileSync(adoptPendingPath(home), "utf8")));
  } catch {
    return null;
  }
}

/** Testnet named account only: a.b.testnet; no .near, no 64-hex implicit account. */
export function validateTestnetAccount(id: string): string | null {
  if (id.endsWith(".near") || id === "near") return `${id} is a mainnet account; Stand-in runs on testnet only`;
  if (!/^(?:[a-z\d]+[-_])*[a-z\d]+(?:\.(?:[a-z\d]+[-_])*[a-z\d]+)*\.testnet$/.test(id) || id.length > 64) return `${id} is not a valid testnet named account (expected name.testnet)`;
  return null;
}

/**
 * The contract with the dashboard owner console (do not change the parameter names). `bait` names the bait account;
 * `bait_key` / `watch_key` appear only for an account the owner still has to create, and carry public keys only.
 */
export function adoptUrl(dashboard: string, k: AdoptPending): string {
  const e = encodeURIComponent;
  const q: [string, string][] = [
    ["op", "adopt"], ["account", k.account_id], ["watcher", k.watcher], ["intents", k.intents], ["agent_key", k.public_key],
    ["receiver", k.receiver_id], ["methods", k.method_names.join(",")], ["allowance", k.allowance], ["bait", k.bait],
  ];
  if (k.bait_key) q.push(["bait_key", k.bait_key]);
  if (k.watch_key) q.push(["watch_key", k.watch_key]);
  return `${dashboard.replace(/\/+$/, "")}/app/owner?${q.map(([a, b]) => `${a}=${e(b)}`).join("&")}`;
}
