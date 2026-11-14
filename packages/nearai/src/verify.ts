import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

export const sha256Hex = (b: Uint8Array | string) => bytesToHex(sha256(typeof b === "string" ? utf8ToBytes(b) : b));
const strip0x = (h: string) => h.replace(/^0x/i, "").toLowerCase();

/** EIP-191 personal_sign recovery: the Ethereum address that signed `text` (65-byte r||s||v hex signature). */
export function recoverEthSigner(text: string, sigHex: string): string {
  const sig = hexToBytes(strip0x(sigHex));
  if (sig.length !== 65) throw new Error("signature is not 65 bytes");
  const v = sig[64] >= 27 ? sig[64] - 27 : sig[64];
  const msg = utf8ToBytes(text);
  const digest = keccak_256(Uint8Array.from([...utf8ToBytes(`\x19Ethereum Signed Message:\n${msg.length}`), ...msg]));
  const pub = new secp256k1.Signature(
    BigInt("0x" + bytesToHex(sig.slice(0, 32))), BigInt("0x" + bytesToHex(sig.slice(32, 64))), v,
  ).recoverPublicKey(digest).toBytes(false);
  return "0x" + bytesToHex(keccak_256(pub.slice(1)).slice(12));
}

export interface QuoteFields {
  version: number; tee_type: number; mrtd: string; mrconfigid: string; rtmr0: string; rtmr1: string; rtmr2: string; rtmr3: string; report_data: string;
}

/** Parse the fixed-offset Intel TDX quote v4 header + TD report body. Parsing is NOT verification of Intel's signature chain. */
export function parseTdxQuote(quoteHex: string): QuoteFields | null {
  let q: Uint8Array;
  try { q = hexToBytes(strip0x(quoteHex)); } catch { return null; }
  if (q.length < 48 + 584) return null;
  const dv = new DataView(q.buffer, q.byteOffset, q.byteLength);
  const body = 48, h = (o: number, n: number) => bytesToHex(q.slice(body + o, body + o + n));
  return {
    version: dv.getUint16(0, true), tee_type: dv.getUint32(4, true),
    mrtd: h(136, 48), mrconfigid: h(184, 48), rtmr0: h(328, 48), rtmr1: h(376, 48), rtmr2: h(424, 48), rtmr3: h(472, 48), report_data: h(520, 64),
  };
}

export interface Check { name: string; ok: boolean; detail: string }
const safeJson = (s: string) => { try { return JSON.parse(s); } catch { return null; } };

/** What can be checked on one attestation report (gateway or model) without an Intel DCAP verifier. */
export function checkReport(rep: any, nonce: string, label: string): { checks: Check[]; summary: Record<string, unknown> } {
  const checks: Check[] = [];
  const q = typeof rep?.intel_quote === "string" ? parseTdxQuote(rep.intel_quote) : null;
  checks.push({ name: `${label}: request_nonce echoed`, ok: rep?.request_nonce === nonce, detail: "report.request_nonce equals the nonce we sent" });
  if (q) {
    const rd = q.report_data;
    const addr = strip0x(String(rep.signing_address ?? ""));
    checks.push({ name: `${label}: quote report_data binds nonce`, ok: rd.includes(nonce.toLowerCase()), detail: "nonce found inside the TDX quote's 64-byte report_data (parsed from the quote bytes)" });
    checks.push({ name: `${label}: quote report_data binds signing address`, ok: addr.length === 40 && rd.includes(addr), detail: "signing_address found inside the TDX quote's report_data" });
    const tcb = rep?.info?.tcb_info;
    const compose = tcb?.app_compose ?? (typeof tcb === "string" ? safeJson(tcb)?.app_compose : undefined);
    if (typeof compose === "string") {
      checks.push({ name: `${label}: MRCONFIGID = 01||sha256(app_compose)`, ok: q.mrconfigid === "01" + sha256Hex(compose) + "00".repeat(15), detail: "sha256 of the reported app_compose matches the quote's MRCONFIGID" });
    }
  } else {
    checks.push({ name: `${label}: TDX quote parsed`, ok: false, detail: "intel_quote missing or not a v4 TDX quote" });
  }
  return {
    checks,
    summary: {
      signing_address: rep?.signing_address ?? null, signing_algo: rep?.signing_algo ?? null,
      quote_sha256: typeof rep?.intel_quote === "string" ? sha256Hex(strip0x(rep.intel_quote)) : null,
      quote_version: q?.version ?? null, tee_type: q ? "0x" + q.tee_type.toString(16) : null,
      mrtd: q?.mrtd ?? null, rtmr3: q?.rtmr3 ?? null, mrconfigid: q?.mrconfigid ?? null, report_data: q?.report_data ?? null,
      gpu_evidence_present: Boolean(rep?.nvidia_payload), event_log_present: Boolean(rep?.event_log),
    },
  };
}
