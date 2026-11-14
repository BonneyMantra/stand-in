import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "@standin/core";

/** Hard cap for the whole feature, enforced here by refusing calls before they are sent. */
export const CAP_USD = 2.0;
/** Used when /v1/models exposes no pricing for the model: USD per 1M tokens. */
export const FALLBACK_PRICE = { input: 3, output: 15 };
export interface Price { input: number; output: number } // USD per 1M tokens

export class SpendCapError extends Error {
  constructor(msg: string) { super(msg); this.name = "SpendCapError"; }
}

export interface SpendLine { at: string; model: string; prompt_tokens: number; completion_tokens: number; usd: number }

export const spendFile = () => process.env.STANDIN_NEARAI_SPEND_FILE ?? path.join(repoRoot(), ".secrets", "nearai-spend.ndjson");

export function readSpend(file = spendFile()): SpendLine[] {
  if (!fs.existsSync(file)) return [];
  const out: SpendLine[] = [];
  for (const l of fs.readFileSync(file, "utf8").split("\n")) {
    if (!l.trim()) continue;
    try { out.push(JSON.parse(l)); } catch { /* skip torn line */ }
  }
  return out;
}
export const totalSpentUsd = (file = spendFile()) => readSpend(file).reduce((a, l) => a + (Number(l.usd) || 0), 0);

export const costUsd = (p: Price, promptTokens: number, completionTokens: number) =>
  (promptTokens * p.input + completionTokens * p.output) / 1_000_000;

/** Conservative token estimate for a prompt we have not sent yet (bytes/3, never an under-count for English/JSON). */
export const estimatePromptTokens = (text: string) => Math.ceil(Buffer.byteLength(text, "utf8") / 3) + 64;

/**
 * Throws SpendCapError BEFORE a request is sent when recorded spend plus the worst case for this call
 * (max_tokens x output price + estimated prompt tokens x input price) would exceed the cap.
 */
export function guardSpend(a: { model: string; price: Price; maxTokens: number; promptText: string; file?: string; cap?: number }): number {
  const cap = a.cap ?? CAP_USD;
  const worst = costUsd(a.price, estimatePromptTokens(a.promptText), a.maxTokens);
  const spent = totalSpentUsd(a.file);
  if (spent + worst > cap) {
    throw new SpendCapError(`NEAR AI spend cap: $${spent.toFixed(4)} spent + $${worst.toFixed(4)} worst case for this ${a.model} call would exceed $${cap.toFixed(2)}; call refused, nothing sent`);
  }
  return worst;
}

/** Append the actual usage of a finished call. Returns the usd charged. */
export function recordSpend(a: { model: string; price: Price; prompt_tokens: number; completion_tokens: number; file?: string }): SpendLine {
  const line: SpendLine = {
    at: new Date().toISOString(), model: a.model, prompt_tokens: a.prompt_tokens, completion_tokens: a.completion_tokens,
    usd: Number(costUsd(a.price, a.prompt_tokens, a.completion_tokens).toFixed(8)),
  };
  const f = a.file ?? spendFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.appendFileSync(f, JSON.stringify(line) + "\n");
  return line;
}
