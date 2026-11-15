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
  private provider: ReturnType<typeof makeProvider>;
  /** `newProvider` is the rotation source (core's makeProvider by default); tests pass a stub so no retry hits the network. */
  constructor(
    private cfg: NetworkConfig, readonly accountId: string, secretKey: string,
    private newProvider: (cfg: NetworkConfig) => ReturnType<typeof makeProvider> = makeProvider,
  ) {
    this.signer = KeyPairSigner.fromSecretKey(secretKey as `ed25519:${string}`);
    this.publicKey = KeyPair.fromString(secretKey as `ed25519:${string}`).getPublicKey().toString();
    this.provider = this.newProvider(cfg);
  }

  /**
   * Refresh nonce + block hash. Never throws: on a 429/5xx it backs off and rebuilds the provider
   * (core's makeProvider rotates through the healthy endpoints), keeping the cached values meanwhile.
   * Returns false if every attempt failed.
   */
  async warm(attempts = 4, baseDelayMs = 400): Promise<boolean> {
    for (let i = 0; i < attempts; i++) {
      try {
        const [ak, blk] = await Promise.all([
          this.provider.viewAccessKey({ accountId: this.accountId, publicKey: this.publicKey } as any) as Promise<any>,
          this.provider.viewBlock({ finality: "final" } as any) as Promise<any>,
        ]);
        const n = BigInt(ak.nonce);
        if (n > this.nonce) this.nonce = n;
        this.blockHash = baseDecode(blk.header.hash);
        return true;
      } catch (e: any) {
        log.warn(`warm attempt ${i + 1}/${attempts} failed: ${String(e?.message ?? e).slice(0, 120)}`);
        this.provider = this.newProvider(this.cfg); // rotate endpoint
        if (i < attempts - 1) await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** i));
      }
    }
    return false;
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
    if (!this.blockHash && !(await this.warm()) && !this.blockHash) throw new Error("fastsend: no recent block hash (RPC unavailable)");
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
