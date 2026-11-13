import { z } from "zod";
import { logger, makeProvider, type NetworkConfig } from "@standin/core";

const log = logger("stream");

export interface SeenTx {
  hash: string;
  signer_id: string;
  public_key: string;
  receiver_id: string;
  actions: unknown[];
}
export interface SeenBlock {
  height: number;
  hash: string;
  timestamp_ms: number;
  txs: SeenTx[];
  /** wall-clock ms when this process received the block */
  received_at: number;
  source: "neardata-optimistic" | "neardata-final" | "rpc";
}

const txSchema = z.object({
  hash: z.string(), signer_id: z.string(), public_key: z.string(), receiver_id: z.string(), actions: z.array(z.unknown()),
});
const blockSchema = z.object({
  block: z.object({ header: z.object({ height: z.number(), hash: z.string(), timestamp_nanosec: z.string() }) }),
  shards: z.array(z.object({ chunk: z.object({ transactions: z.array(z.object({ transaction: txSchema })) }).nullable().optional() })),
});

class RateLimited extends Error { constructor() { super("neardata rate limited (429)"); } }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function neardataBlock(base: string, kind: "block_opt" | "block", height: number): Promise<SeenBlock | null> {
  const res = await fetch(`${base}/v0/${kind}/${height}`, { signal: AbortSignal.timeout(20000) });
  if (res.status === 429) throw new RateLimited();
  if (!res.ok) throw new Error(`neardata ${kind}/${height}: HTTP ${res.status}`);
  const txt = await res.text();
  if (txt === "null" || !txt) return null; // skipped height
  const j = blockSchema.parse(JSON.parse(txt));
  const h = j.block.header;
  return {
    height: h.height, hash: h.hash, timestamp_ms: Number(BigInt(h.timestamp_nanosec) / 1_000_000n),
    txs: j.shards.flatMap((s) => (s.chunk?.transactions ?? []).map((t) => t.transaction)),
    received_at: Date.now(), source: kind === "block_opt" ? "neardata-optimistic" : "neardata-final",
  };
}

async function headHeight(base: string, kind: "optimistic" | "final"): Promise<number> {
  const res = await fetch(`${base}/v0/last_block/${kind}`, { redirect: "manual", signal: AbortSignal.timeout(5000) });
  if (res.status === 429) { await sleep(1500); throw new Error("neardata rate limited (429)"); }
  const loc = res.headers.get("location");
  const m = loc?.match(/(\d+)$/);
  if (!m) throw new Error(`no redirect from last_block/${kind} (${res.status})`);
  return Number(m[1]);
}

/** RPC fallback: block + chunk polling. */
async function rpcBlock(cfg: NetworkConfig, height: number): Promise<SeenBlock | null> {
  const p = makeProvider(cfg);
  let b: any;
  try {
    b = await p.viewBlock({ blockId: height } as any);
  } catch {
    return null;
  }
  const txs: SeenTx[] = [];
  const chunks = await Promise.all(b.chunks.map((c: any) => p.viewChunk(c.chunk_hash as any).catch(() => null)));
  for (const c of chunks as any[]) for (const t of c?.transactions ?? []) txs.push({ hash: t.hash, signer_id: t.signer_id, public_key: t.public_key, receiver_id: t.receiver_id, actions: t.actions });
  return { height, hash: b.header.hash, timestamp_ms: Number(BigInt(b.header.timestamp_nanosec) / 1_000_000n), txs, received_at: Date.now(), source: "rpc" };
}

export interface FollowOpts {
  cfg: NetworkConfig;
  onBlock: (b: SeenBlock) => void | Promise<void>;
  /** "optimistic" sees a block ~1-2 s earlier than "final". Default optimistic. */
  mode?: "optimistic" | "final";
  signal?: AbortSignal;
}

/**
 * Follow blocks until aborted. neardata long-polls: requesting /v0/block_opt/<next> returns as soon
 * as that block exists, so there is no head polling (the free tier rate-limits at ~2 req/s).
 * On repeated neardata failures it falls back to RPC block+chunk polling.
 */
export async function followBlocks(o: FollowOpts): Promise<void> {
  const mode = o.mode ?? "optimistic";
  const kind = mode === "optimistic" ? "block_opt" : "block";
  let next = 0;
  let fails = 0;
  while (!o.signal?.aborted) {
    try {
      if (fails >= 4) {
        // RPC fallback round: process everything up to the current head, then retry neardata.
        const b: any = await makeProvider(o.cfg).viewBlock({ finality: mode === "final" ? "final" : "optimistic" } as any);
        const head: number = b.header.height;
        if (!next) next = head;
        for (; next <= head; next++) { const blk = await rpcBlock(o.cfg, next); if (blk) await o.onBlock(blk); }
        fails = 2; // give neardata another chance
        await sleep(500);
        continue;
      }
      if (!next) next = (await headHeight(o.cfg.neardataUrl, mode)) + 1;
      const blk = await neardataBlock(o.cfg.neardataUrl, kind, next);
      fails = 0;
      if (blk) await o.onBlock(blk); else log.debug(`height ${next} skipped`);
      next++;
    } catch (e) {
      if (o.signal?.aborted) return;
      if (e instanceof RateLimited) { await sleep(600); continue; } // not a failure: just wait
      fails++;
      log.warn(`follow error (${fails}): ${(e as Error).message}`);
      await sleep(300);
    }
  }
}

export interface KeyChange {
  public_key: string;
  block_hash: string;
  tx_hash?: string;
  /** which poll saw it first */
  finality: "optimistic" | "final";
  detected_at: number;
}

/**
 * Cheap, low-latency detector: every tick queries `EXPERIMENTAL_changes all_access_key_changes` for the
 * decoy account at BOTH optimistic and final finality (2 RPC calls). A tx bumps its key's nonce in the block
 * that includes it, so a change on a key that is not the admin key is a trip; the change cause carries the
 * tx hash. The final poll guarantees nothing is missed if an optimistic poll lands between blocks.
 * RPC tolerates ~10 req/s, unlike neardata's free tier.
 */
export async function followKeyChanges(o: {
  cfg: NetworkConfig; accountId: string; ignoreKeys: string[]; onChange: (c: KeyChange) => void | Promise<void>;
  intervalMs?: number; signal?: AbortSignal;
}): Promise<void> {
  const urls = [...new Set([o.cfg.rpcUrl, ...o.cfg.rpcFallbackUrls])];
  const seen = new Set<string>();
  let u = 0;
  let tick = 0;
  const interval = o.intervalMs ?? Number(process.env.STANDIN_POLL_MS ?? 300);
  const query = async (url: string, finality: "optimistic" | "final") => {
    const res = await fetch(url, {
      method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(4000),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "EXPERIMENTAL_changes", params: { changes_type: "all_access_key_changes", account_ids: [o.accountId], finality } }),
    });
    const j: any = await res.json();
    if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 160));
    return j.result as { block_hash: string; changes: any[] };
  };
  while (!o.signal?.aborted) {
    const url = urls[u % urls.length]!;
    try {
      tick++;
      // optimistic every tick (~3 req/s); final every 6th tick is a safety net for a poll that lands between blocks
      const [opt, fin] = await Promise.all([query(url, "optimistic"), tick % 6 === 0 ? query(url, "final") : Promise.resolve({ block_hash: "", changes: [] as any[] })]);
      const detected_at = Date.now();
      for (const [finality, r] of [["optimistic", opt], ["final", fin]] as const) {
        for (const ch of r.changes ?? []) {
          const pk: string | undefined = ch.change?.public_key;
          // transaction_processing = a tx signed BY this key bumped its nonce; AddKey/receipt causes are not use of the key
          if (!pk || ch.type !== "access_key_update" || ch.cause?.type !== "transaction_processing" || o.ignoreKeys.includes(pk)) continue;
          const id = ch.cause?.tx_hash ?? `${r.block_hash}:${pk}`;
          if (seen.has(id)) continue;
          seen.add(id);
          await o.onChange({ public_key: pk, block_hash: r.block_hash, tx_hash: ch.cause?.tx_hash, finality, detected_at });
        }
      }
      if (seen.size > 500) seen.clear();
    } catch (e) {
      u++; // rotate to the next RPC url
      log.warn(`changes poll via ${url}: ${(e as Error).message}`);
      await sleep(150);
    }
    await sleep(interval);
  }
}

/** Find the tx a decoy key signed at `height` (neardata first, RPC chunk scan as fallback). */
export async function resolveTx(cfg: NetworkConfig, height: number, accountId: string, publicKey: string, txHash?: string): Promise<SeenTx | null> {
  if (txHash) {
    try {
      const r: any = await makeProvider(cfg).viewTransactionStatus({ txHash, accountId, waitUntil: "INCLUDED" } as any);
      const t = r.transaction;
      if (t) return { hash: txHash, signer_id: t.signer_id, public_key: t.public_key, receiver_id: t.receiver_id, actions: t.actions };
    } catch (e) {
      log.debug(`resolveTx by hash: ${(e as Error).message}`);
    }
  }
  for (const mode of ["neardata", "rpc"] as const) {
    try {
      const b = mode === "neardata" ? await neardataBlock(cfg.neardataUrl, "block_opt", height) : await rpcBlock(cfg, height);
      const t = b?.txs.find((x) => x.signer_id === accountId && x.public_key === publicKey);
      if (t) return t;
    } catch (e) {
      log.debug(`resolveTx ${mode}: ${(e as Error).message}`);
    }
  }
  return null;
}
