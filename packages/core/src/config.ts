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
  neardataUrl: string;
  nearblocksUrl: string;
  accounts: Record<Role, string>;
  /** original parsed file, for fields other workers add (contract hashes, tx links...) */
  raw: Record<string, unknown>;
}

export function loadNetworkConfig(file?: string): NetworkConfig {
  const p = file ?? process.env.STANDIN_CONFIG ?? path.join(repoRoot(), "config", "testnet.json");
  if (!fs.existsSync(p)) throw new Error(`config not found: ${p} (W1 writes config/testnet.json)`);
  const c = rawConfig.parse(JSON.parse(fs.readFileSync(p, "utf8")));
  const accounts = {} as Record<Role, string>;
  for (const r of ROLES) {
    const v = c.accounts[r];
    if (v) accounts[r] = typeof v === "string" ? v : v.account_id;
  }
  return {
    network: c.network,
    rpcUrl: process.env.STANDIN_RPC ?? c.rpc_url ?? c.rpcUrl ?? "https://rpc.testnet.fastnear.com",
    archivalRpcUrl: c.archival_rpc_url ?? c.archivalRpcUrl ?? "https://archival-rpc.testnet.fastnear.com",
    rpcFallbackUrls: [c.rpc_fallback_url ?? "https://rpc.testnet.near.org", "https://rpc.testnet.fastnear.com"],
    neardataUrl: process.env.STANDIN_NEARDATA ?? "https://testnet.neardata.xyz",
    nearblocksUrl: "https://api-testnet.nearblocks.io",
    accounts,
    raw: c as Record<string, unknown>,
  };
}
export function requireAccount(cfg: NetworkConfig, role: Role): string {
  const a = cfg.accounts[role];
  if (!a) throw new Error(`config/testnet.json has no accounts.${role}`);
  return a;
}
