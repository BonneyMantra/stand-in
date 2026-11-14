import { KeyPair, KeyPairSigner, actions, baseDecode, baseEncode, createTransaction, PublicKey, type Action } from "near-api-js";
import { Rpc } from "./rpc.ts";

export const NEAR = 10n ** 24n;
export const nearAmount = (milli: number) => (BigInt(milli) * NEAR) / 1000n; // milliNEAR -> yocto
export const explorerTx = (hash: string) => `https://testnet.nearblocks.io/txns/${hash}`;

export interface TxResult { hash: string; blockHash: string; ok: boolean; error?: string; raw: any }

/** One account + one key. Tracks the nonce locally so back-to-back txs do not need an RPC round trip. */
export class Wallet {
  readonly publicKey: string;
  private signer: KeyPairSigner;
  private nonce = 0n;
  private blockHash = "";
  constructor(readonly rpc: Rpc, readonly accountId: string, secret: string) {
    const kp = KeyPair.fromString(secret as `ed25519:${string}`);
    this.publicKey = kp.getPublicKey().toString();
    this.signer = new KeyPairSigner(kp);
  }

  get lastNonce() { return this.nonce; }

  /** Fetch nonce + a recent block hash. Call ahead of time (pre-warm) so the send itself is one request. */
  async warm(finalHash?: string): Promise<void> {
    const r = await this.rpc.call("query", { request_type: "view_access_key", finality: "optimistic", account_id: this.accountId, public_key: this.publicKey });
    this.nonce = BigInt(r.nonce) > this.nonce ? BigInt(r.nonce) : this.nonce;
    // a FINAL block hash is known to every RPC node; an optimistic one can be unknown to the node that later receives the tx
    this.blockHash = finalHash ?? r.block_hash;
  }

  async build(receiverId: string, acts: Action[]): Promise<{ hash: string; b64: string }> {
    if (!this.blockHash) await this.warm();
    this.nonce += 1n;
    const tx = createTransaction(this.accountId, PublicKey.from(this.publicKey), receiverId, this.nonce, acts, baseDecode(this.blockHash));
    const { txHash: hashBytes, signedTransaction: signed } = await this.signer.signTransaction(tx);
    const hash = baseEncode(hashBytes);
    return { hash, b64: Buffer.from(signed.encode()).toString("base64") };
  }

  /** Fire and forget; returns the tx hash immediately. */
  async broadcast(receiverId: string, acts: Action[]): Promise<string> {
    const { hash, b64 } = await this.build(receiverId, acts);
    await this.rpc.call("send_tx", { signed_tx_base64: b64, wait_until: "NONE" });
    return hash;
  }

  /** Send and wait until the tx and its receipts executed (optimistic). Re-warms and retries once on a stale nonce/hash. */
  async send(receiverId: string, acts: Action[], wait = "EXECUTED_OPTIMISTIC"): Promise<TxResult> {
    for (let attempt = 0; ; attempt++) {
      const { hash, b64 } = await this.build(receiverId, acts);
      try {
        const raw = await this.rpc.call("send_tx", { signed_tx_base64: b64, wait_until: wait }, 3);
        return parseOutcome(raw, hash);
      } catch (e: any) {
        if (/TIMEOUT/i.test(String(e?.message))) return await waitTx(this.rpc, hash, this.accountId, wait);
        if (attempt < 1 && /InvalidNonce|Expired|InvalidTransaction/i.test(String(e?.message))) { this.nonce = 0n; this.blockHash = ""; continue; }
        throw e;
      }
    }
  }
}

export function parseOutcome(raw: any, fallbackHash: string): TxResult {
  const hash = raw?.transaction?.hash ?? raw?.transaction_outcome?.id ?? fallbackHash;
  const blockHash = raw?.transaction_outcome?.block_hash ?? "";
  const outs = [raw?.transaction_outcome, ...(raw?.receipts_outcome ?? [])].filter(Boolean);
  const failed = outs.find((o: any) => o.outcome?.status && typeof o.outcome.status === "object" && "Failure" in o.outcome.status);
  return { hash, blockHash, ok: !failed && !raw?.status?.Failure, error: failed ? JSON.stringify(failed.outcome.status.Failure).slice(0, 300) : undefined, raw };
}

export async function waitTx(rpc: Rpc, hash: string, sender: string, wait = "EXECUTED_OPTIMISTIC", tries = 6): Promise<TxResult> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try { return parseOutcome(await rpc.call("tx", { tx_hash: hash, sender_account_id: sender, wait_until: wait }, 2), hash); } catch (e) { last = e; await new Promise((r) => setTimeout(r, 700)); }
  }
  throw last;
}

export async function blockHeight(rpc: Rpc, blockHash: string): Promise<number> {
  const b = await rpc.call("block", { block_id: blockHash });
  return b.header.height as number;
}

export const addFullKey = (pk: string) => actions.addFullAccessKey(PublicKey.from(pk));
export const deleteKey = (pk: string) => actions.deleteKey(PublicKey.from(pk));
export const transfer = (yocto: bigint) => actions.transfer(yocto);
export const call = (method: string, args: object, gasTgas = 60, deposit = 0n) =>
  actions.functionCall(method, args, BigInt(gasTgas) * 10n ** 12n, deposit);
export { actions, PublicKey };
export const newKey = () => { const kp = KeyPair.fromRandom("ed25519"); return { secret: kp.toString(), public: kp.getPublicKey().toString() }; };
