import fs from "node:fs";
import path from "node:path";
import { KeyPair, KeyPairSigner, actions, baseDecode, baseEncode, createTransaction } from "near-api-js";
import { loadNetworkConfig, makeProvider, rpcRaw, repoRoot, devKeysDir, type NetworkConfig } from "@standin/core";
import { reserve, commit, settle, type Purpose } from "./budget.ts";

export { actions };
export const NEAR = 10n ** 24n;
/** Minimum protocol gas price; used only to turn attached gas into a reservation upper bound. */
export const GAS_PRICE = 100_000_000n;
export const tgas = (n: number) => BigInt(n) * 10n ** 12n;

export function mainnetConfig(): NetworkConfig {
  return loadNetworkConfig(path.join(repoRoot(), "config", "mainnet.json"));
}
export function mainnetKeysDir(): string {
  return path.join(devKeysDir(), "mainnet");
}

export interface KeyFile { account_id: string; public_key: string; private_key: string; label?: string }

export function saveKey(file: string, k: KeyFile): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(k, null, 2), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}
export function loadKeyFile(file: string): KeyFile {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
export const accountKeyPath = (accountId: string) => path.join(mainnetKeysDir(), `${accountId}.json`);
export const decoyKeyPath = (label: string) => path.join(mainnetKeysDir(), "decoys", `${label}.json`);
export const agentFcKeyPath = () => path.join(mainnetKeysDir(), "agent-fc.json");
export const intentsKeyPath = () => path.join(mainnetKeysDir(), "agent-intents.json");
export function newKeyPair(): { public_key: string; private_key: string } {
  const kp = KeyPair.fromRandom("ed25519");
  return { public_key: kp.getPublicKey().toString(), private_key: kp.toString() };
}

export interface SentTx {
  tx_hash: string; block_hash: string; block_height: number; gas_burnt_yocto: bigint; spend_id: string; outcome: any;
}

/** Sum of tokens burnt over the tx and all its receipts (the real gas cost; deposits are separate). */
export function tokensBurnt(res: any): bigint {
  let t = BigInt(res?.transaction_outcome?.outcome?.tokens_burnt ?? 0);
  for (const r of res?.receipts_outcome ?? []) t += BigInt(r?.outcome?.tokens_burnt ?? 0);
  return t;
}
/** Throw when any receipt of the outcome failed. */
export function assertOk(res: any, what: string): void {
  const bad = (res?.receipts_outcome ?? []).find((r: any) => r?.outcome?.status && "Failure" in r.outcome.status);
  const top = res?.status && typeof res.status === "object" && "Failure" in res.status ? res.status.Failure : null;
  if (top || bad) throw new Error(`${what} failed: ${JSON.stringify(top ?? bad.outcome.status.Failure).slice(0, 300)}`);
}

/**
 * The ONLY way this package signs and broadcasts a mainnet transaction. The budget guard runs after signing and
 * before broadcasting: over a cap it throws and nothing leaves the machine.
 */
export class Signer {
  private signer: KeyPairSigner;
  readonly publicKey: string;
  constructor(readonly cfg: NetworkConfig, readonly accountId: string, secretKey: string) {
    this.signer = KeyPairSigner.fromSecretKey(secretKey as `ed25519:${string}`);
    this.publicKey = KeyPair.fromString(secretKey as `ed25519:${string}`).getPublicKey().toString();
  }
  static fromFile(cfg: NetworkConfig, accountId: string, file: string): Signer {
    return new Signer(cfg, accountId, loadKeyFile(file).private_key);
  }
  async send(opts: {
    purpose: Purpose; receiverId: string; acts: any[]; amountYocto?: bigint; gas?: bigint; what: string; wait?: "INCLUDED" | "EXECUTED_OPTIMISTIC" | "FINAL";
  }): Promise<SentTx> {
    const prov = makeProvider(this.cfg);
    const [ak, blk] = await Promise.all([
      prov.viewAccessKey({ accountId: this.accountId, publicKey: this.publicKey } as any) as Promise<any>,
      prov.viewBlock({ finality: "final" } as any) as Promise<any>,
    ]);
    const tx = createTransaction(this.accountId, await this.signer.getPublicKey(), opts.receiverId, BigInt(ak.nonce) + 1n, opts.acts, baseDecode(blk.header.hash));
    const { txHash, signedTransaction } = await this.signer.signTransaction(tx);
    const gas = opts.gas ?? tgas(5);
    const id = reserve(opts.purpose, opts.amountYocto ?? 0n, gas * GAS_PRICE);
    const hash = baseEncode(txHash);
    commit(id, hash);
    const res: any = await prov.sendTransactionUntil(signedTransaction, opts.wait ?? "EXECUTED_OPTIMISTIC");
    const burnt = tokensBurnt(res);
    if (burnt > 0n) settle(id, burnt); // actual burn, even when higher than the estimate (the account-creation fee is 0.007 NEAR)
    assertOk(res, opts.what);
    const bh = res?.transaction_outcome?.block_hash as string;
    const height = bh ? Number(((await prov.viewBlock({ blockId: bh } as any)) as any).header.height) : 0;
    return { tx_hash: hash, block_hash: bh, block_height: height, gas_burnt_yocto: burnt, spend_id: id, outcome: res };
  }
  functionCall(o: { purpose: Purpose; receiverId: string; method: string; args: object; gas: bigint; deposit?: bigint; what?: string }) {
    return this.send({
      purpose: o.purpose, receiverId: o.receiverId, gas: o.gas, amountYocto: o.deposit ?? 0n, what: o.what ?? `${o.receiverId}.${o.method}`,
      acts: [actions.functionCall(o.method, o.args as Record<string, unknown>, o.gas, o.deposit ?? 0n)],
    });
  }
}

export async function view(cfg: NetworkConfig, contractId: string, method: string, args: object): Promise<any> {
  return makeProvider(cfg).callFunction({ contractId, method, args } as any);
}
export async function balanceOf(cfg: NetworkConfig, accountId: string): Promise<bigint> {
  const a: any = await rpcRaw(cfg, "query", { request_type: "view_account", finality: "final", account_id: accountId });
  return BigInt(a.amount);
}
export async function accountExists(cfg: NetworkConfig, accountId: string): Promise<boolean> {
  try { await balanceOf(cfg, accountId); return true; } catch (e: any) {
    if (/UNKNOWN_ACCOUNT|does not exist/i.test(String(e?.message ?? e))) return false;
    throw e;
  }
}
export async function accessKeys(cfg: NetworkConfig, accountId: string): Promise<{ public_key: string; access_key: any }[]> {
  const r: any = await rpcRaw(cfg, "query", { request_type: "view_access_key_list", finality: "final", account_id: accountId });
  return r.keys;
}
export const isFullAccess = (k: { access_key: any }) => k.access_key?.permission === "FullAccess";

