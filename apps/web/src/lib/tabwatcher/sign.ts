import { signTransaction, type LocalAction } from "../wallet/localSigner";
import { base58Decode, publicKeyOf } from "../wallet/keys";
import { ChainAnswer, type Rpc } from "./rpc";

export type Action = LocalAction;

const toB64 = (b: Uint8Array) => btoa(Array.from(b, (c) => String.fromCharCode(c)).join(""));

/**
 * One browser-held key on one account, pre-warmed like the hosted lab's signer (packages/lab/src/chain.ts): the nonce and a
 * final block hash are read ahead of time, so the freeze itself is one signature and one broadcast. The borsh encoding and
 * signature are the owner console's (lib/wallet/localSigner). The secret is only passed to the signer, never kept elsewhere
 * or logged.
 */
export class KeySigner {
  readonly publicKey: string;
  private nonce = 0n;
  private blockHash = "";
  private warmedAt = 0;

  private rpc: Rpc;
  readonly accountId: string;
  private secretKey: string;

  constructor(rpc: Rpc, accountId: string, secretKey: string) {
    this.rpc = rpc;
    this.accountId = accountId;
    this.secretKey = secretKey;
    this.publicKey = publicKeyOf(secretKey);
  }

  /** Reads the key's nonce and a final block hash. Throws ChainAnswer UNKNOWN_ACCESS_KEY when the key is not on the account. */
  async warm(): Promise<void> {
    const [key, block] = await Promise.all([
      this.rpc.call<{ nonce: number | string }>("query", { request_type: "view_access_key", finality: "optimistic", account_id: this.accountId, public_key: this.publicKey }),
      this.rpc.call<{ header: { hash: string } }>("block", { finality: "final" }),
    ]);
    const n = BigInt(key.nonce);
    if (n > this.nonce) this.nonce = n;
    // A final hash is known to every node; an optimistic one may be unknown to the node that receives the transaction.
    this.blockHash = block.header.hash;
    this.warmedAt = Date.now();
  }

  /** A block hash older than about 20 minutes is refreshed (transactions stay valid for 86,400 blocks; this is margin). */
  get stale() {
    return !this.blockHash || Date.now() - this.warmedAt > 20 * 60_000;
  }

  /**
   * Signs and broadcasts without waiting (`wait_until: NONE`); returns the hash. `onSigned` gets each hash before it is sent,
   * so a caller can record it first (a tab closed mid-send still knows what it may have sent). Re-reads a stale nonce once.
   */
  async broadcast(receiverId: string, actions: Action[], onSigned?: (hash: string) => void): Promise<string> {
    if (this.stale) await this.warm();
    for (let attempt = 0; ; attempt++) {
      this.nonce += 1n;
      const { signed, hash } = signTransaction(
        { signerId: this.accountId, publicKey: this.publicKey, nonce: this.nonce, receiverId, blockHash: base58Decode(this.blockHash), actions },
        this.secretKey,
      );
      onSigned?.(hash);
      try {
        // Every node gets the same signed bytes: the fastest one decides how soon it is included.
        const params = { signed_tx_base64: toB64(signed), wait_until: "NONE" };
        await (this.rpc.callAll ? this.rpc.callAll("send_tx", params) : this.rpc.call("send_tx", params));
        return hash;
      } catch (e) {
        if (attempt === 0 && e instanceof ChainAnswer && /InvalidNonce|Expired/.test(e.message)) {
          await this.warm();
          continue;
        }
        throw e;
      }
    }
  }
}

const TGAS = 10n ** 12n;

export const act = {
  addFullKey: (publicKey: string): Action => ({ type: "AddKey", publicKey, permission: "FullAccess" }),
  deleteKey: (publicKey: string): Action => ({ type: "DeleteKey", publicKey }),
  transfer: (yocto: bigint): Action => ({ type: "Transfer", deposit: yocto }),
  call: (methodName: string, args: Record<string, unknown>, tgas: bigint, deposit = 0n): Action => ({ type: "FunctionCall", methodName, args, gas: tgas * TGAS, deposit }),
};

/** The implicit account of an ed25519 key: the hex of its 32 public bytes. A transfer to it creates the account. */
export function implicitAccountOf(publicKey: string): string {
  const bytes = base58Decode(publicKey.replace(/^ed25519:/, ""));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
