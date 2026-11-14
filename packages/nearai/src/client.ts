import { apiKey, scrubKey } from "./env.ts";
import type { Price } from "./spend.ts";
import { FALLBACK_PRICE } from "./spend.ts";

/** OpenAI-compatible gateway (docs: https://docs.near.ai/cloud/inference-sdk). */
export const baseUrl = () => (process.env.NEARAI_BASE_URL ?? "https://cloud-api.near.ai/v1").replace(/\/$/, "");

export interface HttpResult { status: number; raw: Buffer; json: any }

async function http(pathAndQuery: string, init: { method?: string; body?: string; timeoutMs?: number } = {}): Promise<HttpResult> {
  const key = apiKey();
  if (!key) throw new Error("NEARAI_API_KEY is not set (put it in <repo>/.env.local)");
  const res = await fetch(baseUrl() + pathAndQuery, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${key}`, Accept: "application/json", "x-no-aliasing": "true",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body,
    signal: AbortSignal.timeout(init.timeoutMs ?? 90_000),
  });
  const raw = Buffer.from(await res.arrayBuffer());
  let json: any = null;
  try { json = JSON.parse(raw.toString("utf8")); } catch { /* non-JSON body */ }
  return { status: res.status, raw, json };
}

const fail = (what: string, r: HttpResult) =>
  new Error(`${what}: HTTP ${r.status} ${scrubKey(r.raw.toString("utf8")).slice(0, 300)}`);

/** GET /v1/models. */
export async function listModels(): Promise<any[]> {
  const r = await http("/models");
  if (r.status !== 200 || !Array.isArray(r.json?.data)) throw fail("GET /v1/models", r);
  return r.json.data;
}

/** Per-1M-token USD price from the /v1/models `pricing.input|output` fields, else the conservative fallback. */
export function priceFromModels(models: any[], id: string): { price: Price; source: "models-endpoint" | "fallback" } {
  const p = models.find((m) => m.id === id)?.pricing;
  const input = Number(p?.input), output = Number(p?.output);
  if (Number.isFinite(input) && Number.isFinite(output) && (input > 0 || output > 0)) return { price: { input, output }, source: "models-endpoint" };
  return { price: FALLBACK_PRICE, source: "fallback" };
}

/** GET /v1/attestation/report (gateway + NEAR model evidence, fresh nonce, ECDSA signer). Free, non-billable. */
export async function fetchAttestation(model: string, nonce: string): Promise<any> {
  const q = new URLSearchParams({ model, provider: "near", signing_algo: "ecdsa", include_tls_fingerprint: "false", nonce });
  const r = await http(`/attestation/report?${q}`, { timeoutMs: 60_000 });
  if (r.status !== 200 || !r.json) throw fail("GET /v1/attestation/report", r);
  return r.json;
}

/** POST /v1/chat/completions with the exact body bytes we hash for the signature check. */
export const chatCompletion = (body: string) => http("/chat/completions", { method: "POST", body });

/** GET /v1/signature/{chat_id}; the signature can be cached on another node, so retry briefly. */
export async function fetchSignature(chatId: string, model: string, tries = 6): Promise<{ sig: any | null; error?: string }> {
  let last = "";
  for (let i = 0; i < tries; i++) {
    const q = new URLSearchParams({ model, signing_algo: "ecdsa" });
    const r = await http(`/signature/${encodeURIComponent(chatId)}?${q}`, { timeoutMs: 30_000 });
    if (r.status === 200 && typeof r.json?.signature === "string" && typeof r.json?.text === "string") return { sig: r.json };
    last = `HTTP ${r.status} ${scrubKey(r.raw.toString("utf8")).slice(0, 160)}`;
    await new Promise((res) => setTimeout(res, 1500));
  }
  return { sig: null, error: last };
}
