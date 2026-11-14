import { KeyPair, KeyPairSigner, PublicKey, actions, baseDecode, baseEncode, createTransaction } from "near-api-js";
import { logger, makeProvider, rpcRaw, type NetworkConfig } from "@standin/core";
import { commit, reserve, settle } from "@standin/mainnet/budget";

const log = logger("ownerfreeze");

/** Gas for one `remove_public_key` action on intents.near (measured: ~0.0004 NEAR burnt; 12 Tgas attached is the ceiling). */
const REMOVE_GAS = 12n * 10n ** 12n;
const GAS_PRICE = 100_000_000n;

/**
 * Mainnet freeze in OWNER-KEY mode (no guardian contract on mainnet: storage staking would exceed the budget).
 * On a decoy trip it signs with the agent account's OWNER key:
 *   tx A -> agent account: one DeleteKey action per function-call key (every agent FC key, in one tx)
 *   tx B -> intents.near : one `remove_public_key` (1 yocto) action per registered intents key (one tx)
 * Both are signed and broadcast in parallel (nonces n+1, n+2) from a pre-warmed nonce / block hash / key list that
 * is refreshed every 5 s. Every tx goes through the mainnet budget guard first and is refused over a cap.
 * Demo: the owner key is loaded from .secrets/mainnet. Production: it would sit in the macOS keychain, read at
 * watcher start (`security find-generic-password`), never on disk.
 */
export class OwnerKeyFreezer {
  private signer: KeyPairSigner;
  private publicKey: string;
  private nonce = 0n;
  private blockHash: Uint8Array | null = null;
  private fcKeys: string[] = [];
  private intentsKeys: string[] = [];
  private timer?: NodeJS.Timeout;
  private provider: ReturnType<typeof makeProvider>;
  constructor(private cfg: NetworkConfig, readonly accountId: string, private intentsId: string, ownerSecret: string) {
    this.signer = KeyPairSigner.fromSecretKey(ownerSecret as `ed25519:${string}`);
    this.publicKey = KeyPair.fromString(ownerSecret as `ed25519:${string}`).getPublicKey().toString();
    this.provider = makeProvider(cfg);
  }

  /** Refresh nonce, block hash, FC key list and registered intents keys. Never throws; keeps the cached values on failure. */
  async warm(attempts = 4): Promise<boolean> {
    for (let i = 0; i < attempts; i++) {
      try {
        const [ak, blk, list, ik] = await Promise.all([
          this.provider.viewAccessKey({ accountId: this.accountId, publicKey: this.publicKey } as any) as Promise<any>,
          this.provider.viewBlock({ finality: "final" } as any) as Promise<any>,
          rpcRaw(this.cfg, "query", { request_type: "view_access_key_list", finality: "final", account_id: this.accountId }),
          this.provider.callFunction({ contractId: this.intentsId, method: "public_keys_of", args: { account_id: this.accountId } } as any) as Promise<any>,
        ]);
        if (BigInt(ak.nonce) > this.nonce) this.nonce = BigInt(ak.nonce);
        this.blockHash = baseDecode(blk.header.hash);
        this.fcKeys = (list.keys as any[]).filter((k) => k.access_key?.permission !== "FullAccess" && k.public_key !== this.publicKey).map((k) => k.public_key);
        this.intentsKeys = ik as string[];
        return true;
      } catch (e: any) {
        log.warn(`warm ${i + 1}/${attempts}: ${String(e?.message ?? e).slice(0, 120)}`);
        this.provider = makeProvider(this.cfg);
        await new Promise((r) => setTimeout(r, 400 * 2 ** i));
      }
    }
    return false;
  }
  async init(): Promise<{ alreadyFrozen: boolean }> {
    await this.warm();
    this.timer = setInterval(() => void this.warm().catch(() => undefined), 5000);
    this.timer.unref();
    return { alreadyFrozen: this.fcKeys.length === 0 && this.intentsKeys.length === 0 };
  }
  stop(): void { if (this.timer) clearInterval(this.timer); }
  keys(): { fc: string[]; intents: string[] } { return { fc: [...this.fcKeys], intents: [...this.intentsKeys] }; }

  private async signAndSend(purpose: "gas" | "intents", receiverId: string, acts: any[], gas: bigint, amount: bigint) {
    if (!this.blockHash && !(await this.warm()) && !this.blockHash) throw new Error("ownerfreeze: no recent block hash (RPC unavailable)");
    this.nonce += 1n;
    const tx = createTransaction(this.accountId, await this.signer.getPublicKey(), receiverId, this.nonce, acts, this.blockHash!);
    const { txHash, signedTransaction } = await this.signer.signTransaction(tx);
    const hash = baseEncode(txHash);
    const id = reserve(purpose, amount, gas * GAS_PRICE); // throws (and nothing is sent) over a cap
    commit(id, hash);
    await this.provider.sendTransactionAsync(signedTransaction);
    return { hash, id };
  }

  /** Freeze: returns the DeleteKey tx hash as `tx_hash` and the intents removal tx in `extra`. */
  async freeze(): Promise<{ tx_hash: string; extra: { intents_tx_hash: string; deleted_keys: string[]; intents_keys_removed: string[] } }> {
    const fc = [...this.fcKeys];
    const ik = [...this.intentsKeys];
    // Both txs use the SAME owner key: a later nonce landing first invalidates the earlier tx (measured on mainnet, where a
    // parallel broadcast dropped the DeleteKey). So broadcast one after the other (DeleteKey, nonce n+1, first), verify each
    // reached the node, and re-sign once with a fresh nonce if one did not.
    const mkA = () => this.signAndSend("gas", this.accountId, fc.map((k) => actions.deleteKey(PublicKey.from(k))), 3n * 10n ** 12n, 0n);
    const mkB = () => this.signAndSend("intents", this.intentsId, ik.map((k) => actions.functionCall("remove_public_key", { public_key: k }, REMOVE_GAS, 1n)), REMOVE_GAS * BigInt(ik.length), BigInt(ik.length));
    let a = fc.length ? await mkA() : null;
    let b = ik.length ? await mkB() : null;
    if (!a && !b) throw new Error("ownerfreeze: nothing to freeze (no agent FC keys and no intents keys)");
    log.info(`freeze submitted: deleteKey=${a?.hash ?? "-"} remove_public_key=${b?.hash ?? "-"}`);
    if (a && !(await this.landed(a.hash))) { log.warn("deleteKey tx did not land; re-signing"); await this.warm(2); a = await mkA(); }
    if (b && !(await this.landed(b.hash))) { log.warn("remove_public_key tx did not land; re-signing"); await this.warm(2); b = await mkB(); }
    void this.settleLater([a, b]);
    return { tx_hash: (a ?? b)!.hash, extra: { intents_tx_hash: b?.hash ?? "", deleted_keys: fc, intents_keys_removed: ik } };
  }

  /** True once the tx is known to the node (pool or chain); polls ~6 s. Rate-limit errors count as landed (unknown). */
  private async landed(hash: string): Promise<boolean> {
    for (let i = 0; i < 9; i++) {
      try { await rpcRaw(this.cfg, "EXPERIMENTAL_tx_status", { tx_hash: hash, sender_account_id: this.accountId, wait_until: "NONE" }); return true; }
      catch (e: any) { if (!/UNKNOWN_TRANSACTION|doesn't exist/i.test(String(e?.message))) return true; }
      await new Promise((r) => setTimeout(r, 700));
    }
    return false;
  }

  /** After the txs land, replace each gas estimate with the tokens actually burnt. */
  private async settleLater(rows: ({ hash: string; id: string } | null)[]): Promise<void> {
    for (const r of rows) {
      if (!r) continue;
      for (let i = 0; i < 40; i++) {
        try {
          const res: any = await this.provider.viewTransactionStatusWithReceipts({ txHash: r.hash, accountId: this.accountId, waitUntil: "EXECUTED_OPTIMISTIC" } as any);
          let burnt = BigInt(res.transaction_outcome.outcome.tokens_burnt);
          for (const ro of res.receipts_outcome ?? []) burnt += BigInt(ro.outcome.tokens_burnt);
          settle(r.id, burnt);
          break;
        } catch { await new Promise((x) => setTimeout(x, 1000)); }
      }
    }
  }

  /** Block in which the DeleteKey receipt applied (state-change query), searched from the inclusion block. */
  async executedHeight(inclusionHeight: number): Promise<number> {
    for (let h = inclusionHeight; h <= inclusionHeight + 8; h++) {
      const ch: any = await rpcRaw(this.cfg, "EXPERIMENTAL_changes", { changes_type: "all_access_key_changes", account_ids: [this.accountId], block_id: h }).catch(() => null);
      if ((ch?.changes ?? []).some((c: any) => c.type === "access_key_deletion")) return h;
    }
    return 0;
  }
}
