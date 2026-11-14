import cfg from "../../../config/lab.json";
import { runLab, type LabEnv, type Step } from "./lab.ts";
import { listRuns, rateOk, releaseLock, saveRun, takeLock, type KV } from "./store.ts";

export interface Env extends Partial<LabEnv> { LAB_KV: KV }
const EXPLORER = "https://testnet.nearblocks.io";
const J = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...extra } });
export const err = (error: string, status: number, code?: string, extra: Record<string, unknown> = {}) => J({ error, ...(code ? { code } : {}), ...extra }, status);

export function labConfig(env: Env) {
  return J({ network: "testnet", accounts: cfg.accounts, ntfy_topic: env.LAB_NTFY_TOPIC ?? null, explorer: EXPLORER });
}

export async function labRuns(env: Env, url: URL) {
  const raw = url.searchParams.get("limit");
  const limit = raw === null ? 10 : Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) return err("limit must be an integer from 1 to 20", 400, "bad_limit");
  try { return J({ runs: await listRuns(env.LAB_KV, limit) }); } catch { return err("storage unavailable", 503, "kv_unavailable"); }
}

function missing(env: Env): string | null {
  for (const k of ["LAB_AGENT_OWNER_KEY", "LAB_DECOY_ADMIN_KEY", "LAB_THIEF_KEY", "LAB_WATCH_FC_KEY"] as const) if (!env[k]) return k;
  return null;
}

export async function labRun(req: Request, env: Env, waitUntil: (p: Promise<unknown>) => void) {
  if (missing(env)) return err("lab is not configured", 503, "not_configured");
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const runId = crypto.randomUUID();
  try {
    const lock = await takeLock(env.LAB_KV, runId);
    if (!lock.ok) return err("busy", 409, undefined, { retry_after_s: lock.retry_after_s });
    if (!(await rateOk(env.LAB_KV, ip))) { await releaseLock(env.LAB_KV, runId); return err("rate_limited", 429, undefined, { retry_after_s: 600 }); }
  } catch { return err("storage unavailable", 503, "kv_unavailable"); }

  const { readable, writable } = new TransformStream();
  const w = writable.getWriter();
  const enc = new TextEncoder();
  let open = true;
  const emit = (name: string, data: unknown) => {
    if (!open) return;
    w.write(enc.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)).catch(() => { open = false; });
  };
  const job = (async () => {
    let result: { blocks_to_freeze: number | null; steps: Step[] } = { blocks_to_freeze: null, steps: [] };
    try {
      result = await runLab(runId, cfg as any, env as LabEnv, emit);
    } catch (e: any) {
      emit("error", { run_id: runId, error: String(e?.message ?? "run failed").slice(0, 200) });
    } finally {
      try { await saveRun(env.LAB_KV, { run_id: runId, at: new Date().toISOString(), blocks_to_freeze: result.blocks_to_freeze, steps: result.steps }); } catch { /* history is best effort */ }
      try { await releaseLock(env.LAB_KV, runId); } catch { /* TTL frees it */ }
      await w.close().catch(() => {});
    }
  })();
  waitUntil(job);
  return new Response(readable, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no", "x-run-id": runId } });
}
