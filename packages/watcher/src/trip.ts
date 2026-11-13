import {
  appendEvent, callMethod, findPlanted, loadDevKey, logger, makeAccount, makeProvider, readEvents, requireAccount,
  type LedgerEvent, type NetworkConfig,
} from "@standin/core";
import { FastSender } from "./fastsend.ts";
import { resolveTx, type KeyChange, type SeenBlock, type SeenTx } from "./stream.ts";

const log = logger("trip");

export interface TripRecord {
  tx_hash: string;
  block_height: number;
  decoy_public_key: string;
  attacker_account: string;
  attributed_to: { session_id: string; agent: string; tool_name: string; tool_use_id: string; path: string };
  freeze: { tx_hash: string; block_height: number; blocks_after_trip: number; deleted_keys: string[]; intents_keys_removed: string[] };
  blocklist: { tx_hash: string; outlayer_execution: string; attested: boolean };
  detected_latency_ms?: number;
}

/** Where did the value go? Transfer -> receiver, DeleteAccount -> beneficiary, otherwise the tx receiver. */
export function attackerOf(tx: SeenTx): string {
  for (const a of tx.actions as any[]) {
    if (a?.DeleteAccount?.beneficiary_id) return a.DeleteAccount.beneficiary_id;
  }
  return tx.receiver_id;
}

export class TripHandler {
  private sender: FastSender;
  private seen = new Set<string>();
  private frozenAt: { tx_hash: string; block_height: number } | null = null;
  private inflight: Promise<{ tx_hash: string; block_height: number }> | null = null;
  private adminPk: string;
  readonly decoy: string;
  readonly agent: string;
  readonly registry: string;
  private submittedAt = 0;
  constructor(private cfg: NetworkConfig, private home?: string) {
    this.decoy = requireAccount(cfg, "decoy");
    this.agent = requireAccount(cfg, "agent");
    this.registry = cfg.accounts.registry ?? "";
    this.adminPk = loadDevKey(cfg, "decoy").public_key;
    const w = loadDevKey(cfg, "watcher");
    this.sender = new FastSender(cfg, requireAccount(cfg, "watcher"), w.secret_key);
  }

  async init(): Promise<void> {
    await this.sender.warm();
    this.sender.start();
    // Resume: never double-freeze if the agent is already frozen on chain.
    const st = await this.guardianState().catch(() => null);
    if (st?.frozen) {
      const prior = readEvents({ type: "freeze" }, this.home).at(-1);
      this.frozenAt = { tx_hash: prior?.freeze?.tx_hash ?? "", block_height: prior?.freeze?.block_height ?? 0 };
      log.info("agent already frozen on chain; will record trips without re-freezing");
    }
  }
  stop(): void {
    this.sender.stop();
  }

  async guardianState(): Promise<any> {
    return makeProvider(this.cfg).callFunction({ contractId: this.agent, method: "get_state", args: {} } as any);
  }

  /** Block follower path (neardata / RPC polling): full tx info is already known. */
  async onBlock(b: SeenBlock): Promise<void> {
    for (const tx of b.txs) {
      if (tx.signer_id !== this.decoy || tx.public_key === this.adminPk) continue;
      await this.handleTrip({ public_key: tx.public_key, height: b.height, tx, detectedAt: Date.now(), blockTimeMs: b.timestamp_ms, source: b.source });
    }
  }

  /** Key-change detector path: only the key and block hash are known; the freeze does not wait for the tx hash. */
  async onKeyChange(c: KeyChange): Promise<void> {
    if (c.public_key === this.adminPk) return;
    await this.handleTrip({ public_key: c.public_key, blockHash: c.block_hash, txHash: c.tx_hash, detectedAt: c.detected_at, source: `rpc-changes-${c.finality}` });
  }

  adminKey(): string { return this.adminPk; }

  private async handleTrip(t: {
    public_key: string; height?: number; blockHash?: string; txHash?: string; tx?: SeenTx; detectedAt: number; blockTimeMs?: number; source: string;
  }): Promise<void> {
    const dedupe = t.tx?.hash ?? t.txHash ?? `${t.public_key}@${t.blockHash ?? t.height}`;
    if (this.seen.has(dedupe)) return;
    this.seen.add(dedupe);
    log.warn(`TRIP decoy key ${t.public_key} used (${t.source})${t.tx ? ` tx ${t.tx.hash}` : ""}`);
    // 1. freeze first, in parallel with everything else
    const freezeP = this.freezeOnce(t.public_key, t.tx?.hash ?? t.txHash, t.tx ? attackerOf(t.tx) : "");
    // 2. resolve block height / tx hash / attacker while the freeze is in flight
    const height: number = t.height ?? (await makeProvider(this.cfg).viewBlock({ blockId: t.blockHash! } as any).then((b: any) => Number(b.header.height)));
    const blockTime = t.blockTimeMs ?? (await makeProvider(this.cfg).viewBlock({ blockId: height } as any).then((b: any) => Number(BigInt(b.header.timestamp_nanosec) / 1_000_000n)).catch(() => 0));
    const tx = t.tx ?? (await resolveTx(this.cfg, height, this.decoy, t.public_key, t.txHash));
    const attacker = tx ? attackerOf(tx) : "";
    const planted = findPlanted(t.public_key, this.home);
    const attributed_to = { session_id: planted?.session_id ?? "", agent: planted?.agent ?? "", path: planted?.path ?? "", tool_name: "", tool_use_id: "" };
    const exp = readEvents({ type: "exposure", where: (e) => e.decoy_public_key === t.public_key }, this.home).at(-1);
    if (exp) { attributed_to.tool_name = exp.tool_name ?? ""; attributed_to.tool_use_id = exp.tool_use_id ?? ""; }
    const tripTx = tx?.hash ?? t.txHash ?? "";
    appendEvent("trip", {
      tx_hash: tripTx, block_height: height, decoy_public_key: t.public_key, attacker_account: attacker, attributed_to,
      detected_at_ms: t.detectedAt, block_age_ms_at_detection: blockTime ? t.detectedAt - blockTime : undefined, stream: t.source,
    }, this.home);

    const freeze = await freezeP;
    const blocks_after_trip = freeze.block_height - height;
    const detail = await this.freezeDetail(freeze.tx_hash).catch(() => ({ deleted: [] as string[], intents: [] as string[], executed_height: 0 }));
    appendEvent("freeze", {
      trip_tx_hash: tripTx,
      freeze: { tx_hash: freeze.tx_hash, block_height: freeze.block_height, blocks_after_trip, deleted_keys: detail.deleted, intents_keys_removed: detail.intents },
      executed_block_height: detail.executed_height,
      executed_blocks_after_trip: detail.executed_height ? detail.executed_height - height : undefined,
      detection_to_submit_ms: freeze.submitted_ms - t.detectedAt,
    }, this.home);
    log.info(`freeze ${freeze.tx_hash} included in block ${freeze.block_height}: ${blocks_after_trip} block(s) after trip block ${height}; submit ${freeze.submitted_ms - t.detectedAt} ms after detection`);
    if (tx) void this.reportToRegistry(tx, attacker);
  }

  /** Exactly one freeze tx per process (and none if already frozen on chain). */
  private async freezeOnce(publicKey: string, txHash: string | undefined, attacker: string) {
    if (this.frozenAt) return { ...this.frozenAt, submitted_ms: Date.now() };
    if (!this.inflight) {
      const reason = `decoy key ${publicKey} signed a transaction${txHash ? ` (${txHash})` : ""}; value to ${attacker || "unknown"}`;
      this.inflight = (async () => {
        const hash = await this.sender.call(this.agent, "freeze", { reason, decoy_public_key: publicKey, tx_hash: txHash ?? null });
        this.submittedAt = Date.now();
        log.info(`freeze submitted ${hash}`);
        return { tx_hash: hash, block_height: await this.inclusionHeight(hash) };
      })();
      this.inflight.then((r) => { this.frozenAt = r; }).catch(() => { this.inflight = null; });
    }
    const r = await this.inflight;
    return { ...r, submitted_ms: this.submittedAt || Date.now() };
  }

  private async inclusionHeight(txHash: string): Promise<number> {
    const prov = makeProvider(this.cfg);
    for (let i = 0; i < 60; i++) {
      try {
        const r: any = await prov.viewTransactionStatus({ txHash, accountId: requireAccount(this.cfg, "watcher"), waitUntil: "INCLUDED" } as any);
        const bh = r?.transaction_outcome?.block_hash;
        if (bh) return ((await prov.viewBlock({ blockId: bh } as any)) as any).header.height;
      } catch { /* not yet visible */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`freeze tx ${txHash} not found`);
  }

  private async freezeDetail(txHash: string) {
    const prov = makeProvider(this.cfg);
    const r: any = await prov.viewTransactionStatusWithReceipts({ txHash, accountId: requireAccount(this.cfg, "watcher"), waitUntil: "FINAL" } as any);
    const st = await this.guardianState().catch(() => null);
    const log0 = st?.freeze_log?.at?.(-1) ?? {};
    let executed = 0;
    for (const o of r.receipts_outcome ?? []) {
      const h = ((await prov.viewBlock({ blockId: o.block_hash } as any)) as any).header.height;
      if (h > executed) executed = h;
    }
    return {
      deleted: (log0?.deleted_keys ?? []) as string[],
      intents: (log0?.intents_keys_removed ?? []) as string[],
      executed_height: executed,
    };
  }

  /** registry.report(tx_hash, decoy_account_id) signed by the watcher account; then poll check(attacker). */
  private async reportToRegistry(tx: SeenTx, attacker: string): Promise<void> {
    if (!this.registry || process.env.STANDIN_NO_REPORT === "1") return;
    try {
      const w = makeAccount(this.cfg, requireAccount(this.cfg, "watcher"), loadDevKey(this.cfg, "watcher").secret_key);
      const deposit = BigInt(process.env.STANDIN_REPORT_DEPOSIT_YOCTO ?? "50000000000000000000000"); // 0.05 NEAR (registry min 0.01); OutLayer refunds the unused part
      const res = await callMethod(w, this.registry, "report", { tx_hash: tx.hash, decoy_account_id: this.decoy, sender_id: this.decoy, admin_public_key: this.adminPk }, { deposit, waitUntil: "INCLUDED" });
      log.info(`registry.report submitted ${res.tx_hash}`);
      const prov = makeProvider(this.cfg);
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const v: any = await prov.callFunction({ contractId: this.registry, method: "check", args: { account_id: attacker } } as any).catch(() => null);
        if (v?.verdict === "block") {
          appendEvent("blocklist", {
            trip_tx_hash: tx.hash, account_id: attacker, evidence_tx: tx.hash, decoy_public_key: tx.public_key,
            attested_at: new Date().toISOString(),
            blocklist: { tx_hash: res.tx_hash, outlayer_execution: res.tx_hash, attested: true },
          }, this.home);
          log.info(`blocklisted ${attacker}`);
          return;
        }
      }
      log.warn("registry did not return block verdict within 180 s");
    } catch (e) {
      log.error(`registry report failed: ${(e as Error).message}`);
    }
  }
}
