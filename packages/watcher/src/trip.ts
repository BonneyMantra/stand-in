import {
  appendEvent, callMethod, findPlanted, loadDevKey, logger, makeAccount, makeProvider, readEvents, requireAccount,
  type LedgerEvent, type NetworkConfig,
} from "@standin/core";
import { FastSender } from "./fastsend.ts";
import type { SeenBlock, SeenTx } from "./stream.ts";

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
  private lastActivity = Date.now();
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

  /** Called for every block. Returns after the freeze has been *submitted* (not confirmed). */
  async onBlock(b: SeenBlock): Promise<void> {
    for (const tx of b.txs) {
      if (tx.signer_id !== this.decoy || tx.public_key === this.adminPk || this.seen.has(tx.hash)) continue;
      this.seen.add(tx.hash);
      await this.handleTrip(tx, b);
    }
  }

  private async handleTrip(tx: SeenTx, b: SeenBlock): Promise<void> {
    const detectedAt = Date.now();
    const blockAgeMs = detectedAt - b.timestamp_ms;
    log.warn(`TRIP decoy key ${tx.public_key} signed tx ${tx.hash} in block ${b.height} (${b.source}); block age at detection ${blockAgeMs} ms`);
    const planted = findPlanted(tx.public_key, this.home);
    const attributed_to = {
      session_id: planted?.session_id ?? "", agent: planted?.agent ?? "", path: planted?.path ?? "",
      tool_name: "", tool_use_id: "",
    };
    // Find the exposure event that names a tool call for this key (set by W4 hooks).
    const exp = readEvents({ type: "exposure", where: (e) => e.decoy_public_key === tx.public_key }, this.home).at(-1);
    if (exp) { attributed_to.tool_name = exp.tool_name ?? ""; attributed_to.tool_use_id = exp.tool_use_id ?? ""; }
    const attacker = attackerOf(tx);
    const trip: LedgerEvent = appendEvent("trip", {
      tx_hash: tx.hash, block_height: b.height, decoy_public_key: tx.public_key, attacker_account: attacker, attributed_to,
      detected_at_ms: detectedAt, block_age_ms_at_detection: blockAgeMs, stream: b.source,
    }, this.home);

    const freeze = await this.freezeOnce(tx, attacker, b.height);
    const blocks_after_trip = freeze.block_height - b.height;
    const detail = await this.freezeDetail(freeze.tx_hash).catch(() => ({ deleted: [] as string[], intents: [] as string[], executed_height: 0 }));
    appendEvent("freeze", {
      trip_tx_hash: tx.hash,
      freeze: { tx_hash: freeze.tx_hash, block_height: freeze.block_height, blocks_after_trip, deleted_keys: detail.deleted, intents_keys_removed: detail.intents },
      executed_block_height: detail.executed_height, executed_blocks_after_trip: detail.executed_height ? detail.executed_height - b.height : undefined,
      detection_to_submit_ms: freeze.submitted_ms - detectedAt,
    }, this.home);
    log.info(`freeze ${freeze.tx_hash} included in block ${freeze.block_height}: ${blocks_after_trip} block(s) after trip`);
    void trip;
    void this.reportToRegistry(tx, attacker);
  }

  /** Exactly one freeze tx per process (and none if already frozen on chain). */
  private async freezeOnce(tx: SeenTx, attacker: string, tripHeight: number) {
    const t0 = Date.now();
    if (this.frozenAt) return { ...this.frozenAt, submitted_ms: t0 };
    if (!this.inflight) {
      const reason = `decoy key ${tx.public_key} signed tx ${tx.hash} at block ${tripHeight}; value to ${attacker}`;
      this.inflight = (async () => {
        const hash = await this.sender.call(this.agent, "freeze", { reason, decoy_public_key: tx.public_key, tx_hash: tx.hash });
        log.info(`freeze submitted ${hash} ${Date.now() - t0} ms after detection`);
        return { tx_hash: hash, block_height: await this.inclusionHeight(hash) };
      })();
      this.inflight.then((r) => { this.frozenAt = r; }).catch(() => { this.inflight = null; });
    }
    const r = await this.inflight;
    return { ...r, submitted_ms: t0 };
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
    if (!this.registry) return;
    try {
      const w = makeAccount(this.cfg, requireAccount(this.cfg, "watcher"), loadDevKey(this.cfg, "watcher").secret_key);
      const deposit = BigInt(process.env.STANDIN_REPORT_DEPOSIT_YOCTO ?? "100000000000000000000000"); // 0.1 NEAR for OutLayer; refunded by registry if unused
      const res = await callMethod(w, this.registry, "report", { tx_hash: tx.hash, decoy_account_id: this.decoy }, { deposit, waitUntil: "INCLUDED" });
      log.info(`registry.report submitted ${res.tx_hash}`);
      const prov = makeProvider(this.cfg);
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const v: any = await prov.callFunction({ contractId: this.registry, method: "check", args: { account_id: attacker } } as any).catch(() => null);
        if (v?.verdict === "block") {
          appendEvent("blocklist", {
            trip_tx_hash: tx.hash, account_id: attacker, evidence_tx: tx.hash, decoy_public_key: tx.public_key,
            attested_at: new Date().toISOString(),
            blocklist: { tx_hash: res.tx_hash, outlayer_execution: v.outlayer_call_or_tx ?? v.outlayer_execution ?? "", attested: true },
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
