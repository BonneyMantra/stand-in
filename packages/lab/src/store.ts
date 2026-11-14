// KV-backed lock, per-IP rate limit and run history. KV is eventually consistent across colos; fine for a demo lab.
export interface KV { get(k: string): Promise<string | null>; put(k: string, v: string, o?: { expirationTtl?: number }): Promise<void>; delete(k: string): Promise<void> }

export const LOCK_TTL_S = 120;
export const RATE_MAX = 3;
export const RATE_WINDOW_S = 600;
const LOCK = "lab:lock";
const RUNS = "lab:runs";

export async function takeLock(kv: KV, runId: string): Promise<{ ok: true } | { ok: false; retry_after_s: number }> {
  const cur = await kv.get(LOCK);
  if (cur) {
    const { at } = JSON.parse(cur) as { at: number };
    return { ok: false, retry_after_s: Math.max(1, LOCK_TTL_S - Math.floor((Date.now() - at) / 1000)) };
  }
  await kv.put(LOCK, JSON.stringify({ runId, at: Date.now() }), { expirationTtl: LOCK_TTL_S });
  return { ok: true };
}
export async function releaseLock(kv: KV, runId: string) {
  const cur = await kv.get(LOCK);
  if (cur && (JSON.parse(cur) as { runId: string }).runId === runId) await kv.delete(LOCK);
}

/** Returns true when the IP may start a run (and records it). */
export async function rateOk(kv: KV, ip: string): Promise<boolean> {
  const key = `lab:rl:${ip}`;
  const now = Date.now();
  const hits = (JSON.parse((await kv.get(key)) ?? "[]") as number[]).filter((t) => now - t < RATE_WINDOW_S * 1000);
  if (hits.length >= RATE_MAX) return false;
  hits.push(now);
  await kv.put(key, JSON.stringify(hits), { expirationTtl: RATE_WINDOW_S });
  return true;
}
export interface RunRecord { run_id: string; at: string; blocks_to_freeze: number | null; steps: unknown[] }
export async function saveRun(kv: KV, rec: RunRecord) {
  const list = JSON.parse((await kv.get(RUNS)) ?? "[]") as RunRecord[];
  list.unshift(rec);
  await kv.put(RUNS, JSON.stringify(list.slice(0, 20)));
}
export async function listRuns(kv: KV, limit: number): Promise<RunRecord[]> {
  return (JSON.parse((await kv.get(RUNS)) ?? "[]") as RunRecord[]).slice(0, limit);
}
