import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { loadNetworkConfig, repoRoot, requireAccount, standinHome, type NetworkConfig } from "./config.ts";
import { actions, assertSuccess, generateKey, loadDevKey, makeAccount, type GeneratedKey } from "./rpc.ts";
import { logger } from "./logger.ts";
import { KeyPair } from "near-api-js";

const log = logger("pool");
const poolSchema = z.object({
  keys: z.array(z.object({ public_key: z.string(), secret_key: z.string(), minted_at: z.string(), tx_hash: z.string().optional() })),
});
export type PoolKey = z.infer<typeof poolSchema>["keys"][number];

export const DEFAULT_POOL_TARGET = Number(process.env.STANDIN_POOL_SIZE ?? 8);

const poolFile = (home: string) => path.join(home, "pool.json");

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
/** mkdir-based cross-process lock (hooks are separate short-lived processes). */
async function withLock<T>(file: string, fn: () => Promise<T> | T, waitMs = 60_000): Promise<T> {
  const lock = file + ".lock";
  const start = Date.now();
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  for (;;) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch {
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > 90_000) fs.rmdirSync(lock); // stale
      } catch { /* raced */ }
      if (Date.now() - start > waitMs) throw new Error(`lock timeout ${lock}`);
      await sleep(50);
    }
  }
  try {
    return await fn();
  } finally {
    try { fs.rmdirSync(lock); } catch { /* ignore */ }
  }
}

function readPool(home: string): PoolKey[] {
  try {
    return poolSchema.parse(JSON.parse(fs.readFileSync(poolFile(home), "utf8"))).keys;
  } catch {
    return [];
  }
}
function writePool(home: string, keys: PoolKey[]) {
  fs.mkdirSync(home, { recursive: true });
  const tmp = poolFile(home) + `.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ keys }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, poolFile(home));
}

export function poolSize(home = standinHome()): number {
  return readPool(home).length;
}

/** Add `count` fresh full-access keys to the decoy account in ONE tx signed by the decoy admin key. */
export async function mintKeys(cfg: NetworkConfig, count: number): Promise<{ keys: PoolKey[]; tx_hash: string }> {
  const decoy = requireAccount(cfg, "decoy");
  const admin = makeAccount(cfg, decoy, loadDevKey(cfg, "decoy").secret_key);
  const gen: GeneratedKey[] = Array.from({ length: count }, generateKey);
  const res = (await admin.signAndSendTransaction({
    receiverId: decoy,
    actions: gen.map((k) => actions.addFullAccessKey(KeyPair.fromString(k.secret_key as `ed25519:${string}`).getPublicKey())),
    waitUntil: "EXECUTED_OPTIMISTIC",
  })) as any;
  assertSuccess(res.status);
  const tx_hash = String(res.transaction?.hash ?? res.transaction_outcome?.id);
  const minted_at = new Date().toISOString();
  return { tx_hash, keys: gen.map((k) => ({ ...k, minted_at, tx_hash })) };
}

/** Top the pool up to `target` keys. Safe to call concurrently from many processes. */
export async function refillPool(target = DEFAULT_POOL_TARGET, cfg = loadNetworkConfig(), home = standinHome()): Promise<number> {
  return withLock(poolFile(home) + ".refill", async () => {
    const have = readPool(home).length;
    if (have >= target) return 0;
    const { keys, tx_hash } = await mintKeys(cfg, target - have);
    await withLock(poolFile(home), () => writePool(home, [...readPool(home), ...keys]));
    log.info(`minted ${keys.length} decoy keys (tx ${tx_hash}), pool now ${have + keys.length}`);
    return keys.length;
  });
}

/** Spawn a detached process that refills the pool (survives short-lived hook processes). */
export function refillInBackground(target = DEFAULT_POOL_TARGET, home = standinHome()): void {
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "refill-main.ts");
  const child = spawn(process.execPath, ["--import", "tsx", script, String(target)], {
    cwd: repoRoot(), detached: true, stdio: "ignore", env: { ...process.env, STANDIN_HOME: home },
  });
  child.unref();
}

/**
 * Take one pre-minted decoy key (removed from the pool). Refill happens in the background.
 * If the pool is empty it mints one synchronously (slow path, ~2s).
 */
export async function takeDecoy(opts: { cfg?: NetworkConfig; home?: string; refill?: boolean } = {}): Promise<PoolKey> {
  const home = opts.home ?? standinHome();
  const cfg = opts.cfg ?? loadNetworkConfig();
  const taken = await withLock(poolFile(home), () => {
    const keys = readPool(home);
    const k = keys.shift();
    if (k) writePool(home, keys);
    return k;
  });
  if (opts.refill !== false) refillInBackground(DEFAULT_POOL_TARGET, home);
  if (taken) return taken;
  log.warn("pool empty, minting synchronously");
  return (await mintKeys(cfg, 1)).keys[0]!;
}
