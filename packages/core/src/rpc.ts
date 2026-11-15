import fs from "node:fs";
import path from "node:path";
import { Account, FailoverRpcError, FailoverRpcProvider, JsonRpcProvider, KeyPair, KeyPairSigner, actions } from "near-api-js";
import { orderedEndpoints, markFailure, markOk } from "./health.ts";
import { logger } from "./logger.ts";
import { devKeysDir, requireAccount, type NetworkConfig, type Role } from "./config.ts";

export { actions };

export interface GeneratedKey {
  public_key: string;
  secret_key: string;
}
export function generateKey(): GeneratedKey {
  const kp = KeyPair.fromRandom("ed25519");
  return { public_key: kp.getPublicKey().toString(), secret_key: kp.toString() };
}
export function publicKeyOf(secret: string): string {
  return KeyPair.fromString(secret as `ed25519:${string}`).getPublicKey().toString();
}

const rpcLog = logger("rpc");
const RPC_OPTS = { retries: 6, backoff: 1.6, wait: 600 } as any;

/** Archival order: the configured one (drpc on testnet, which only serves recent blocks), then archives that serve old ones, FastNEAR last. */
function archivalUrls(cfg: NetworkConfig): string[] {
  return cfg.network === "mainnet"
    ? [cfg.archivalRpcUrl, "https://archival-rpc.mainnet.near.org"]
    : [cfg.archivalRpcUrl, "https://archival-rpc.testnet.near.org", "https://archival-rpc.testnet.fastnear.com"];
}

/**
 * near-api-js prints every failed attempt with console.error (stack included). This keeps its failover behaviour,
 * logs each attempt at debug level only (STANDIN_LOG=debug) and ends with one readable line naming the last cause.
 */
function quietFailover(p: FailoverRpcProvider): FailoverRpcProvider {
  (p as any).withBackoff = quietBackoff.withBackoff;
  return p;
}

const quietBackoff = {
  async withBackoff<T>(this: any, getResult: (p: unknown) => Promise<T>): Promise<T> {
    const self = this;
    const errors: unknown[] = [];
    for (let i = 0; i < self.providers.length; i++) {
      try {
        return await getResult(self.currentProvider);
      } catch (e) {
        errors.push(e);
        rpcLog.debug(`rpc attempt ${i + 1}/${self.providers.length} failed: ${String((e as Error)?.message ?? e).slice(0, 300)}`);
        self.switchToNextProvider();
      }
    }
    const err = new FailoverRpcError(self.providers.length, errors);
    const last = errors[errors.length - 1] as Error | undefined;
    if (last?.message) err.message = `${err.message}: ${last.message.slice(0, 300)}`;
    throw err;
  }
}

/** The RPC urls a provider would use, in order, without duplicates. */
export function endpointUrls(cfg: NetworkConfig, archival = false): string[] {
  const urls = archival ? archivalUrls(cfg) : orderedEndpoints(cfg);
  return [...new Set(urls)];
}

/** Provider with failover across the configured RPC urls (fastnear free tier rate-limits at ~2 req/s). */
export function makeProvider(cfg: NetworkConfig, archival = false): JsonRpcProvider {
  const uniq = endpointUrls(cfg, archival);
  if (uniq.length === 1) return new JsonRpcProvider({ url: uniq[0]! }, RPC_OPTS);
  return quietFailover(new FailoverRpcProvider(uniq.map((url) => new JsonRpcProvider({ url }, RPC_OPTS)))) as unknown as JsonRpcProvider;
}

/**
 * Runs `fn` against each endpoint in turn, silently. A thrown error for which `definitive(e)` is true (for
 * example "account does not exist") is an answer, not an outage: it is rethrown at once without trying other
 * endpoints. near-api-js's FailoverRpcProvider instead prints every error and wraps a definitive answer into
 * "Exceeded N providers", which hid AccountDoesNotExist from callers.
 */
export async function eachEndpoint<T>(cfg: NetworkConfig, archival: boolean, fn: (p: JsonRpcProvider) => Promise<T>, definitive: (e: unknown) => boolean): Promise<T> {
  let last: unknown;
  for (const url of endpointUrls(cfg, archival)) {
    try {
      return await fn(new JsonRpcProvider({ url }, RPC_OPTS));
    } catch (e) {
      if (definitive(e)) throw e;
      last = e;
    }
  }
  throw last ?? new Error("no RPC endpoint configured");
}
export function makeAccount(cfg: NetworkConfig, accountId: string, secretKey: string): Account {
  return new Account(accountId, makeProvider(cfg), KeyPairSigner.fromSecretKey(secretKey as `ed25519:${string}`));
}

/**
 * Dev keys live in <repo>/.secrets/. Accepted file names (first hit wins), all JSON with a
 * `private_key` | `secret_key` | `privateKey` field, or a bare `ed25519:...` text file:
 *   <accountId>.json, <role>.json, <accountId>.key, <role>.key, and the same under <net>/ .
 */
export function loadDevKey(cfg: NetworkConfig, accountOrRole: string): GeneratedKey {
  const id = (cfg.accounts as Record<string, string>)[accountOrRole] ?? accountOrRole;
  const dir = devKeysDir();
  const names = [id, accountOrRole].flatMap((n) => [`${n}.json`, `${n}.key`]);
  // A home's own accounts first (cfg.keysDir = <home>/keys, named by account id only), then the project's .secrets.
  const own = cfg.keysDir ? [`${id}.json`, `${id}.key`].map((n) => path.join(cfg.keysDir!, n)) : [];
  const shared = [dir, path.join(dir, "keys"), path.join(dir, cfg.network)].flatMap((b) => names.map((n) => path.join(b, n)));
  for (const f of [...own, ...shared]) {
    const k = readKeyFile(f);
    if (k) return k;
  }
  throw new Error(`no dev key for ${id} in ${cfg.keysDir ? `${cfg.keysDir} or ` : ""}${dir} (tried ${names.join(", ")})`);
}

function readKeyFile(f: string): GeneratedKey | null {
  if (!fs.existsSync(f)) return null;
  const txt = fs.readFileSync(f, "utf8").trim();
  let secret: string | undefined;
  if (txt.startsWith("{")) {
    const j = JSON.parse(txt);
    secret = j.private_key ?? j.secret_key ?? j.privateKey ?? j.secretKey;
  } else secret = txt;
  return secret?.startsWith("ed25519:") ? { secret_key: secret, public_key: publicKeyOf(secret) } : null;
}

/** Account handle for one of the 7 roles, signing with its dev key (admin/owner/watcher key). */
export function roleAccount(cfg: NetworkConfig, role: Role): Account {
  const id = requireAccount(cfg, role);
  return makeAccount(cfg, id, loadDevKey(cfg, role).secret_key);
}

/** Call a change method and return {tx_hash, block_hash, outcome}. */
export async function callMethod(
  acct: Account,
  contractId: string,
  methodName: string,
  args: Record<string, unknown>,
  opts: { gas?: bigint; deposit?: bigint; waitUntil?: "INCLUDED" | "EXECUTED_OPTIMISTIC" | "FINAL" } = {},
) {
  const res = (await acct.callFunctionRaw({
    contractId,
    methodName,
    args,
    gas: opts.gas ?? 100_000_000_000_000n,
    deposit: opts.deposit ?? 0n,
    waitUntil: opts.waitUntil ?? "EXECUTED_OPTIMISTIC",
  })) as any;
  return {
    tx_hash: String(res.transaction?.hash ?? res.transaction_outcome?.id),
    block_hash: res.transaction_outcome?.block_hash as string | undefined,
    outcome: res,
  };
}

export async function blockHeightOfHash(cfg: NetworkConfig, hash: string): Promise<number> {
  const b = (await makeProvider(cfg).viewBlock({ blockId: hash })) as any;
  return b.header.height;
}

/** Throws if a receipt in the tx outcome failed. */
export function assertSuccess(outcome: any): void {
  const s = outcome?.status;
  if (s && typeof s === "object" && "Failure" in s) throw new Error(`tx failed: ${JSON.stringify(s.Failure)}`);
}

export function explorerTx(cfg: NetworkConfig, txHash: string): string {
  return `https://${cfg.network === "mainnet" ? "" : cfg.network + "."}nearblocks.io/txns/${txHash}`;
}

/** NEAR decimal string -> yocto bigint (no float math). */
export function parseNearAmountSafe(near: string): bigint {
  const [i, f = ""] = near.split(".");
  return BigInt(i || "0") * 10n ** 24n + BigInt((f + "0".repeat(24)).slice(0, 24));
}

/** Raw JSON-RPC with failover across configured urls (for methods near-api-js does not wrap, e.g. EXPERIMENTAL_changes). */
export async function rpcRaw(cfg: NetworkConfig, method: string, params: unknown, archival = false): Promise<any> {
  const urls = archival ? [cfg.archivalRpcUrl] : orderedEndpoints(cfg);
  let last: unknown;
  for (const url of urls) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(6000) });
      const j: any = await res.json();
      if (j.error) { if (/429|rate/i.test(JSON.stringify(j.error))) markFailure(url); throw new Error(JSON.stringify(j.error).slice(0, 600)); }
      markOk(url);
      return j.result;
    } catch (e) {
      last = e;
    }
  }
  throw last;
}
