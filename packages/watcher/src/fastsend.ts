import { KeyPair, KeyPairSigner, actions, baseDecode, baseEncode, createTransaction } from "near-api-js";
import { makeProvider, logger, type NetworkConfig } from "@standin/core";

const log = logger("fastsend");

/**
 * Pre-warmed single-key sender: nonce and a recent block hash are cached and refreshed in the
 * background, so a freeze costs one sign + one broadcast RPC instead of three round trips.
 */
export class FastSender {
  private nonce = 0n;
  private blockHash: Uint8Array | null = null;
  private timer?: NodeJS.Timeout;
  private signer: KeyPairSigner;
  private publicKey: string;
  private provider;
  constructor(private cfg: NetworkConfig, readonly accountId: string, secretKey: string) {
    this.signer = KeyPairSigner.fromSecretKey(secretKey as `ed25519:${string}`);
    this.publicKey = KeyPair.fromString(secretKey as `ed25519:${string}`).getPublicKey().toString();
    this.provider = makeProvider(cfg);
  }

  async warm(): Promise<void> {
    const [ak, blk] = await Promise.all([
      this.provider.viewAccessKey({ accountId: this.accountId, publicKey: this.publicKey } as any) as Promise<any>,
      this.provider.viewBlock({ finality: "final" } as any) as Promise<any>,
    ]);
    const n = BigInt(ak.nonce);
    if (n > this.nonce) this.nonce = n;
    this.blockHash = baseDecode(blk.header.hash);
  }
  start(everyMs = 5000): void {
    this.timer = setInterval(() => this.warm().catch((e) => log.warn(`warm failed: ${e.message}`)), everyMs);
    this.timer.unref();
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Sign and broadcast a function call; resolves with the tx hash as soon as RPC accepts it. */
  async call(contractId: string, methodName: string, args: object, gas = 100_000_000_000_000n, deposit = 0n): Promise<string> {
    if (!this.blockHash) await this.warm();
    this.nonce += 1n;
    const tx = createTransaction(
      this.accountId, await this.signer.getPublicKey(), contractId, this.nonce,
      [actions.functionCall(methodName, args as Record<string, unknown>, gas, deposit)], this.blockHash!,
    );
    const { txHash: hash, signedTransaction: signed } = await this.signer.signTransaction(tx);
    await this.provider.sendTransactionAsync(signed);
    return baseEncode(hash);
  }
}
