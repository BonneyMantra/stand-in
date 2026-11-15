import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const ROLES = ["agent", "project", "decoy", "watcher", "registry", "intents", "attacker"] as const;
export type Role = (typeof ROLES)[number];

/** Repo root = three levels above packages/core/src. */
export function repoRoot(): string {
  if (process.env.STANDIN_REPO) return process.env.STANDIN_REPO;
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}
/** Dev key files for our own testnet accounts (gitignored). */
export function devKeysDir(): string {
  return process.env.STANDIN_SECRETS ?? path.join(repoRoot(), ".secrets");
}
/** Ledger, pool and scoped agent key live here. Default: <repo>/.sandbox/default/.standin */
export function standinHome(): string {
  return process.env.STANDIN_HOME ?? path.join(repoRoot(), ".sandbox", "default", ".standin");
}
/** The config `standin adopt` writes for a home: its guardian, its own bait and watcher accounts. */
export const homeConfigFile = (home = standinHome()) => path.join(home, "config.json");
/** Keys of a home's own accounts (bait admin, watcher): 0600 files in a 0700 dir, never in the repository. */
export const homeKeysDir = (home = standinHome()) => path.join(home, "keys");
/** The project's own testnet config (the film and demo accounts; their keys are in <repo>/.secrets). */
export const repoConfigFile = () => path.join(repoRoot(), "config", "testnet.json");

const accountRef = z.union([z.string(), z.object({ account_id: z.string() }).passthrough()]);
const rawConfig = z
  .object({
    network: z.string().default("testnet"),
    rpc_url: z.string().optional(),
    rpcUrl: z.string().optional(),
    rpc_fallback_url: z.string().optional(),
    archival_rpc_url: z.string().optional(),
    archivalRpcUrl: z.string().optional(),
    accounts: z.record(z.string(), accountRef).default({}),
  })
  .passthrough();

export interface NetworkConfig {
  network: string;
  rpcUrl: string;
  archivalRpcUrl: string;
  rpcFallbackUrls: string[];
  /** slow endpoints used only after every primary failed */
  rpcLastResortUrls: string[];
  neardataUrl: string;
  nearblocksUrl: string;
  accounts: Record<Role, string>;
  /** original parsed file, for fields other workers add (contract hashes, tx links...) */
  raw: Record<string, unknown>;
  /** the file this config was read from */
  file: string;
  /** <config dir>/keys when it exists: a home's own account keys, searched before <repo>/.secrets */
  keysDir?: string;
}

/**
 * Resolution: an explicit file, then STANDIN_CONFIG, then the home's own config.json (written by adopt), then the
 * project's config/testnet.json. A home without config.json (the film's .sandbox/default) keeps the project's accounts.
 */
export function loadNetworkConfig(file?: string): NetworkConfig {
  const ownHome = homeConfigFile();
  const p = file ?? process.env.STANDIN_CONFIG ?? (fs.existsSync(ownHome) ? ownHome : repoConfigFile());
  const keysDir = path.join(path.dirname(p), "keys");
  if (!fs.existsSync(p)) throw new Error(`config not found: ${p} (W1 writes config/testnet.json)`);
  const c = rawConfig.parse(JSON.parse(fs.readFileSync(p, "utf8")));
  const accounts = {} as Record<Role, string>;
  for (const r of ROLES) {
    const v = c.accounts[r];
    if (v) accounts[r] = typeof v === "string" ? v : v.account_id;
  }
  const main = c.network === "mainnet";
  return {
    network: c.network,
    rpcUrl: process.env.STANDIN_RPC ?? c.rpc_url ?? c.rpcUrl ?? (main ? "https://rpc.mainnet.fastnear.com" : "https://near-testnet.drpc.org"),
    archivalRpcUrl: c.archival_rpc_url ?? c.archivalRpcUrl ?? (main ? "https://archival-rpc.mainnet.fastnear.com" : "https://near-testnet.drpc.org"),
    // mainnet rotation (all probed 2026-11-14): fastnear first, then free.rpc.fastnear.com and drpc (1rpc.io lacks EXPERIMENTAL_changes: dropped); the deprecated rpc.mainnet.near.org is last resort
    rpcFallbackUrls: main ? ["https://free.rpc.fastnear.com", "https://near.drpc.org"] : ["https://rpc.testnet.fastnear.com"],
    // rpc.testnet.near.org is deprecated and slow (~3 s): last resort only
    rpcLastResortUrls: [c.rpc_fallback_url ?? (main ? "https://rpc.mainnet.near.org" : "https://rpc.testnet.near.org")],
    neardataUrl: process.env.STANDIN_NEARDATA ?? (main ? "https://mainnet.neardata.xyz" : "https://testnet.neardata.xyz"),
    nearblocksUrl: main ? "https://api.nearblocks.io" : "https://api-testnet.nearblocks.io",
    accounts,
    raw: c as Record<string, unknown>,
    file: p,
    keysDir: fs.existsSync(keysDir) ? keysDir : undefined,
  };
}
export function requireAccount(cfg: NetworkConfig, role: Role): string {
  const a = cfg.accounts[role];
  if (!a) throw new Error(`config has no accounts.${role} (network ${cfg.network})`);
  return a;
}
