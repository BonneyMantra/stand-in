import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { appendEvent, logger, standinHome } from "@standin/core";
import { z } from "zod";
import { chatCompletion, fetchAttestation, fetchSignature, listModels, priceFromModels } from "./client.ts";
import { buildEvidence, type Trip } from "./evidence.ts";
import { redactDeep } from "./redact.ts";
import { guardSpend, recordSpend } from "./spend.ts";
import { checkReport, recoverEthSigner, sha256Hex, type Check } from "./verify.ts";

const log = logger("nearai");

/** Open-weights model served from NEAR AI's own TEE fleet (owned_by "nearai"); override with NEARAI_MODEL. */
export const DEFAULT_MODEL = "Qwen/Qwen3.8-27B";
export const MAX_TOKENS = 900;

export const reportSchema = z.object({
  summary: z.string().min(1), root_cause: z.string().min(1), leaked_via: z.string().min(1), blast_radius: z.string().min(1),
  actions_taken: z.array(z.string()), recommended_next_steps: z.array(z.string()),
  confidence: z.preprocess((v) => (typeof v === "string" ? v.toLowerCase() : v), z.enum(["low", "medium", "high"])),
});
export type IncidentReport = z.infer<typeof reportSchema>;

const SYSTEM = `You are a security incident analyst for Stand-in, a system that plants decoy NEAR keys for AI coding agents.
You receive a redacted evidence packet about one decoy-key trip. Write a short incident report using ONLY facts in the packet.
Say "unknown" where the packet does not show something; never invent hashes, accounts, or causes. Be concise (each field at most 2 sentences; lists at most 4 items).
Reply with ONE JSON object and nothing else, with exactly these keys:
{"summary": string, "root_cause": string, "leaked_via": string, "blast_radius": string, "actions_taken": string[], "recommended_next_steps": string[], "confidence": "low"|"medium"|"high"}`;

export function parseReportJson(text: string): IncidentReport {
  const t = text.replace(/```(?:json)?/gi, "");
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("no JSON object in model output");
  return reportSchema.parse(JSON.parse(t.slice(a, b + 1)));
}

export interface Proof {
  model: string; chat_id: string; request_hash: string; response_hash: string; signature: string | null;
  signing_address: string | null; signing_algo: string; signature_kind: string | null; signed_text: string | null;
  attestation: { fetched_at: string; nonce: string; gateway: Record<string, unknown>; model: Record<string, unknown>; verified: boolean };
  verified: boolean; checks: Check[]; unverified: { what: string; reason: string }[];
  billing: { prompt_tokens: number; completion_tokens: number; usd: number; price_source: string };
}
export interface IncidentReportEvent { trip_tx_hash: string; at: string; model: string; report: IncidentReport; proof: Proof }

export async function report(trip: Trip, opts: { home?: string; model?: string } = {}): Promise<IncidentReportEvent> {
  const home = opts.home ?? standinHome();
  const model = opts.model ?? process.env.NEARAI_MODEL ?? DEFAULT_MODEL;
  const evidence = buildEvidence(trip, opts.home);
  const { price, source } = priceFromModels(await listModels(), model);

  // Preflight attestation BEFORE the completion (docs: a report fetched afterwards cannot stand in for it).
  const nonce = crypto.randomBytes(32).toString("hex");
  const att = await fetchAttestation(model, nonce);
  const fetched_at = new Date().toISOString();

  const user = `Evidence packet:\n${JSON.stringify(evidence, null, 1)}`;
  let last: { body: string; raw: Buffer; id: string; text: string } | null = null;
  let parsed: IncidentReport | null = null;
  let usageAll = { p: 0, c: 0, usd: 0 };
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    const body = JSON.stringify({
      model, max_tokens: MAX_TOKENS, temperature: 0.1, chat_template_kwargs: { enable_thinking: false },
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }],
    });
    guardSpend({ model, price, maxTokens: MAX_TOKENS, promptText: body });
    const r = await chatCompletion(body);
    const usage = r.json?.usage ?? {};
    const line = recordSpend({ model, price, prompt_tokens: Number(usage.prompt_tokens ?? 0), completion_tokens: Number(usage.completion_tokens ?? 0) });
    usageAll = { p: usageAll.p + line.prompt_tokens, c: usageAll.c + line.completion_tokens, usd: usageAll.usd + line.usd };
    if (r.status !== 200 || !r.json?.id) throw new Error(`chat completion failed: HTTP ${r.status}`);
    const text = String(r.json.choices?.[0]?.message?.content ?? "");
    last = { body, raw: r.raw, id: String(r.json.id), text };
    try { parsed = parseReportJson(text); } catch (e) { log.warn(`attempt ${attempt + 1}: invalid report JSON (${(e as Error).message.slice(0, 80)})`); }
  }
  if (!parsed || !last) throw new Error("model returned invalid report JSON twice");

  const proof = await buildProof({ model, nonce, att, fetched_at, last, usage: usageAll, price_source: source });
  const clean = redactDeep(parsed);
  const ev = appendEvent("incident_report", { trip_tx_hash: trip.tx_hash, model, report: clean, proof }, home);
  // The full attestation report (quote, event log, GPU payload) is kept next to the ledger for independent verification.
  const dir = path.join(home, "nearai");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${last.id}.attestation.json`), JSON.stringify({ nonce, fetched_at, report: att }, null, 1));
  return { trip_tx_hash: trip.tx_hash, at: ev.at, model, report: clean, proof };
}

async function buildProof(a: {
  model: string; nonce: string; att: any; fetched_at: string; last: { body: string; raw: Buffer; id: string };
  usage: { p: number; c: number; usd: number }; price_source: string;
}): Promise<Proof> {
  const request_hash = sha256Hex(a.last.body), response_hash = sha256Hex(a.last.raw);
  const checks: Check[] = [];
  const unverified: Proof["unverified"] = [];
  const modelRep = (a.att.model_attestations ?? [])[0] ?? null;
  const gw = checkReport(a.att.gateway_attestation, a.nonce, "gateway");
  const mr = modelRep ? checkReport(modelRep, a.nonce, "model") : { checks: [{ name: "model: attestation present", ok: false, detail: "no model_attestations[] returned" }], summary: {} };
  checks.push(...gw.checks, ...mr.checks);
  const attestationOk = [...gw.checks, ...mr.checks].every((c) => c.ok);

  const { sig, error } = await fetchSignature(a.last.id, a.model);
  let signature: string | null = null, signer: string | null = null, kind: string | null = null, text: string | null = null;
  if (!sig) {
    unverified.push({ what: "response signature", reason: `not retrievable: ${error}` });
  } else {
    signature = sig.signature; signer = String(sig.signing_address).toLowerCase(); kind = sig.signature_kind ?? null; text = sig.text;
    try {
      const rec = recoverEthSigner(sig.text, sig.signature);
      checks.push({ name: "signature: ECDSA (EIP-191) recovers to signing_address", ok: rec === signer, detail: `recovered ${rec}` });
    } catch (e) { checks.push({ name: "signature: ECDSA recovery", ok: false, detail: (e as Error).message }); }
    const wantModel = `${a.model}:${request_hash}:${response_hash}`, wantGw = `${request_hash}:${response_hash}`;
    const hashOk = sig.text === wantModel || sig.text === wantGw;
    checks.push({ name: "signature: signed text matches sha256 of our exact request and response bytes", ok: hashOk, detail: hashOk ? "hashes equal" : "text differs from our hashes (the gateway may rewrite response bytes)" });
    if (!hashOk) unverified.push({ what: "request/response byte hashes", reason: "signed text does not equal sha256 of the bytes we sent and received; the signature proves the TEE signed that text, not that it covers these exact bytes" });
    const matches = signer === String(modelRep?.signing_address ?? "").toLowerCase() || signer === String(a.att.gateway_attestation?.signing_address ?? "").toLowerCase();
    checks.push({ name: "signature: signer equals a preflight attestation's signing_address", ok: matches, detail: modelRep ? `model report signer ${modelRep.signing_address}` : "no model report" });
  }
  unverified.push(
    { what: "Intel TDX quote signature chain (DCAP)", reason: "no DCAP verifier in this package; quote fields were parsed and bound, but Intel's certificate chain and TCB status were not checked (verify at https://cloud.near.ai/verify or with dcap-qvl)" },
    { what: "RTMR3 event-log replay", reason: "not implemented locally" },
    { what: "NVIDIA GPU evidence (nvidia_payload)", reason: "no NVIDIA attestation verifier run locally; presence only" },
  );
  const sigChecks = checks.filter((c) => c.name.startsWith("signature:"));
  const verified = Boolean(sig) && attestationOk && sigChecks.length > 0 && sigChecks.every((c) => c.ok);
  return {
    model: a.model, chat_id: a.last.id, request_hash, response_hash, signature, signing_address: signer, signing_algo: "ecdsa",
    signature_kind: kind, signed_text: text,
    attestation: { fetched_at: a.fetched_at, nonce: a.nonce, gateway: gw.summary, model: mr.summary, verified: attestationOk },
    verified, checks, unverified,
    billing: { prompt_tokens: a.usage.p, completion_tokens: a.usage.c, usd: Number(a.usage.usd.toFixed(8)), price_source: a.price_source },
  };
}
