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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function neardataBlock(base: string, kind: "block_opt" | "block", height: number): Promise<SeenBlock | null> {
  const res = await fetch(`${base}/v0/${kind}/${height}`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return null;
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
  pollMs?: number;
  signal?: AbortSignal;
}

/** Follow blocks forever (until signal aborts). Falls back to RPC polling if neardata errors. */
export async function followBlocks(o: FollowOpts): Promise<void> {
  const mode = o.mode ?? "optimistic";
  const kind = mode === "optimistic" ? "block_opt" : "block";
  const poll = o.pollMs ?? 120;
  let last = 0;
  let neardataFails = 0;
  while (!o.signal?.aborted) {
    try {
      let head: number;
      let useRpc = neardataFails >= 3;
      if (!useRpc) {
        try {
          head = await headHeight(o.cfg.neardataUrl, mode);
          neardataFails = 0;
        } catch (e) {
          neardataFails++;
          log.warn(`neardata head failed (${neardataFails}): ${(e as Error).message}`);
          await sleep(poll);
          continue;
        }
      } else {
        const b: any = await makeProvider(o.cfg).viewBlock({ finality: mode === "final" ? "final" : "optimistic" } as any);
        head = b.header.height;
      }
      if (!last) last = head - 1;
      for (let h = last + 1; h <= head; h++) {
        const blk = useRpc ? await rpcBlock(o.cfg, h) : await neardataBlock(o.cfg.neardataUrl, kind, h);
        if (blk) await o.onBlock(blk);
      }
      last = Math.max(last, head);
      if (useRpc && Math.random() < 0.1) neardataFails = 0; // probe neardata again occasionally
    } catch (e) {
      log.warn(`follow error: ${(e as Error).message}`);
    }
    await sleep(poll);
  }
}
