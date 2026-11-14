import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";
import { buildEvidence } from "../src/evidence.ts";
import { redact } from "../src/redact.ts";
import { parseReportJson } from "../src/report.ts";
import { CAP_USD, guardSpend, recordSpend, SpendCapError, totalSpentUsd } from "../src/spend.ts";
import { recoverEthSigner } from "../src/verify.ts";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "nearai-test-"));
const price = { input: 3, output: 15 };

describe("spend cap", () => {
  it("records usage and sums it", () => {
    const file = path.join(tmp(), "spend.ndjson");
    recordSpend({ model: "m", price, prompt_tokens: 1000, completion_tokens: 500, file });
    expect(totalSpentUsd(file)).toBeCloseTo(0.0105, 6);
  });
  it("allows a call under the cap", () => {
    const file = path.join(tmp(), "spend.ndjson");
    expect(() => guardSpend({ model: "m", price, maxTokens: 900, promptText: "x".repeat(3000), file })).not.toThrow();
  });
  it("refuses BEFORE sending when spent + worst case would exceed the cap", () => {
    const file = path.join(tmp(), "spend.ndjson");
    // 1.99 spent; worst case for this call is ~ 900*15/1e6 = 0.0135 + prompt, so 2.00 is exceeded.
    fs.writeFileSync(file, JSON.stringify({ at: "x", model: "m", prompt_tokens: 1, completion_tokens: 1, usd: 1.99 }) + "\n");
    expect(() => guardSpend({ model: "m", price, maxTokens: 900, promptText: "hello", file })).toThrow(SpendCapError);
    // and with a cheaper model that still fits it is allowed
    expect(() => guardSpend({ model: "m", price: { input: 0.08, output: 0.5 }, maxTokens: 900, promptText: "hello", file })).not.toThrow();
  });
  it("refuses when already over the cap and honors the $2 default", () => {
    const file = path.join(tmp(), "spend.ndjson");
    expect(CAP_USD).toBe(2);
    fs.writeFileSync(file, JSON.stringify({ at: "x", model: "m", prompt_tokens: 0, completion_tokens: 0, usd: 2.5 }) + "\n");
    expect(() => guardSpend({ model: "m", price: { input: 0, output: 0 }, maxTokens: 1, promptText: "", file })).toThrow(/spend cap/);
  });
});

describe("redact", () => {
  it("strips key material, sk- tokens, secret assignments and home paths; keeps public keys", () => {
    const secret = "ed25519:" + "5".repeat(88);
    const pub = "ed25519:" + "Hn5YvG8gQfZJ1eWc3pQ9uVxRk2sTb7mNd4aLyCzXoE6F".slice(0, 44);
    const tok = "sk" + "-abcdefghijkl1234", home = "/Users" + "/someone";
    const out = redact(`key ${secret} tok ${tok} NEAR_PRIVATE_KEY=abc ${home}/proj/.env pub ${pub}`);
    expect(out).not.toContain("55555");
    expect(out).not.toContain(tok);
    expect(out).not.toContain(home);
    expect(out).not.toMatch(/PRIVATE_KEY=abc/);
    expect(out).toContain(pub);
  });
  it("evidence packet contains no secret or home path", () => {
    const ev = JSON.stringify(buildEvidence({
      tx_hash: "H1", block_height: 5, decoy_public_key: "ed25519:pub", attacker_account: "bad.testnet",
      attributed_to: { session_id: "s1", agent: "claude-code", tool_name: "Bash", tool_use_id: "t1", path: "/Users" + "/gabe/creds/x.json" },
    }, tmp()));
    expect(ev).not.toContain("/Users" + "/gabe");
    expect(ev).toContain("claude-code");
  });
});

describe("verify", () => {
  it("recovers the EIP-191 signer of a message", () => {
    const sk = secp256k1.utils.randomSecretKey();
    const pub = secp256k1.getPublicKey(sk, false);
    const addr = "0x" + bytesToHex(keccak_256(pub.slice(1)).slice(12));
    const text = "z-ai/glm-5.3-flash:aa:bb";
    const m = utf8ToBytes(text);
    const digest = keccak_256(Uint8Array.from([...utf8ToBytes(`\x19Ethereum Signed Message:\n${m.length}`), ...m]));
    const sig = secp256k1.sign(digest, sk, { prehash: false, format: "recovered" });
    // noble 'recovered' format is recovery||r||s; the wire format is r||s||v
    const wire = Uint8Array.from([...sig.slice(1), sig[0] + 27]);
    expect(recoverEthSigner(text, bytesToHex(wire))).toBe(addr);
    expect(recoverEthSigner(text + "x", bytesToHex(wire))).not.toBe(addr);
  });
});

describe("report json", () => {
  const ok = { summary: "s", root_cause: "r", leaked_via: "l", blast_radius: "b", actions_taken: ["a"], recommended_next_steps: ["n"], confidence: "High" };
  it("parses fenced JSON and normalizes confidence", () => {
    expect(parseReportJson("```json\n" + JSON.stringify(ok) + "\n```").confidence).toBe("high");
  });
  it("rejects invalid shapes", () => {
    expect(() => parseReportJson("nope")).toThrow();
    expect(() => parseReportJson(JSON.stringify({ ...ok, actions_taken: "x" }))).toThrow();
  });
});
