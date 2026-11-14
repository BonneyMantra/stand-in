import { apiKey } from "./env.ts";

/**
 * Same rule as apps/web/src/data/build-demo-state.mjs (any 60+ char base58 string, optionally ed25519:-prefixed,
 * is private key material; 44-char public keys survive), plus API-key shapes, secret assignments and home paths.
 */
export function redact(input: unknown): string {
  let s = String(input ?? "");
  const k = apiKey();
  if (k) s = s.split(k).join("<redacted>");
  s = s.replace(/(ed25519:)?[1-9A-HJ-NP-Za-km-z]{60,}/g, "<redacted>");
  s = s.replace(/sk-[A-Za-z0-9_-]{10,}/g, "<redacted>");
  s = s.replace(/\b([A-Z0-9_]*(?:PRIVATE_KEY|SECRET|TOKEN|PASSWORD|API_KEY)[A-Z0-9_]*)\s*[=:]\s*\S+/gi, "$1=<redacted>");
  s = s.replace(/\/Users\/[^/\s"']+/g, "~").replace(/\/home\/[^/\s"']+/g, "~");
  return s;
}

/** Deep-redact every string in a JSON-able value. */
export function redactDeep<T>(v: T): T {
  if (typeof v === "string") return redact(v) as T;
  if (Array.isArray(v)) return v.map(redactDeep) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redactDeep(x)])) as T;
  return v;
}
