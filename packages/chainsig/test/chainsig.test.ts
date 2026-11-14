import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { appendChainsig, chainsigState } from "@standin/core";
import { addressOf, fromHex, hex, rlp, serializeSigned, signingHash } from "../src/evm.ts";
import { base58Decode, deriveKeyLocal, parseSignature, recoverKey } from "../src/mpc.ts";

describe("rlp (Ethereum yellow paper vectors)", () => {
  it("encodes strings, lists and integers", () => {
    const t = (s: string) => new TextEncoder().encode(s);
    expect(hex(rlp(t("dog")))).toBe("0x83646f67");
    expect(hex(rlp([t("cat"), t("dog")]))).toBe("0xc88363617483646f67");
    expect(hex(rlp(new Uint8Array()))).toBe("0x80");
    expect(hex(rlp([]))).toBe("0xc0");
    expect(hex(rlp(fromHex("0400")))).toBe("0x820400");
  });
});

describe("evm address and signature recovery", () => {
  it("private key 1 has the well-known address", () => {
    const pub = secp256k1.getPublicKey(fromHex("00".repeat(31) + "01"), false);
    expect(addressOf(pub)).toBe("0x7e5f4552091a69125d5dfcb7b8c2659029395bdf");
  });
  it("a signature over the type-2 signing hash recovers to the signer", () => {
    const sk = secp256k1.utils.randomSecretKey();
    const pub = secp256k1.getPublicKey(sk, false);
    const tx = { chainId: 11155111, nonce: 0, maxPriorityFeePerGas: 1n, maxFeePerGas: 10n, gasLimit: 21000, to: addressOf(pub), value: 0n, data: "0x" };
    const h = signingHash(tx);
    const sig = secp256k1.Signature.fromBytes(secp256k1.sign(h, sk, { prehash: false, format: "recovered" }).slice(1), "compact");
    const recId = secp256k1.sign(h, sk, { prehash: false, format: "recovered" })[0]!;
    const mpcShape = { scheme: "Secp256k1", big_r: { affine_point: "0" + (2 + (recId & 1)) + sig.r.toString(16).padStart(64, "0") }, s: { scalar: sig.s.toString(16).padStart(64, "0") }, recovery_id: recId };
    const parsed = parseSignature(mpcShape);
    expect(Buffer.from(recoverKey(parsed, h)).equals(Buffer.from(pub))).toBe(true);
    expect(serializeSigned(tx, parsed.recoveryId, parsed.r, parsed.s).startsWith("0x02")).toBe(true);
  });
  it("rejects a malformed MPC response", () => {
    expect(() => parseSignature({ nope: 1 })).toThrow(/unexpected MPC signature shape/);
  });
});

describe("derivation", () => {
  it("base58 round trip of a leading-zero string", () => {
    expect([...base58Decode("11")]).toEqual([0, 0]);
  });
  it("derived key differs per path and is on the curve", () => {
    const root = secp256k1.getPublicKey(fromHex("00".repeat(31) + "07"), false);
    const a = deriveKeyLocal(root, "si-agent-5289.testnet", "standin-evm-1");
    const b = deriveKeyLocal(root, "si-agent-5289.testnet", "standin-evm-2");
    expect(hex(a)).not.toBe(hex(b));
    expect(() => secp256k1.Point.fromBytes(a)).not.toThrow();
  });
});

describe("chainsig ledger", () => {
  it("builds the optional /api/state object, and nothing when empty", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "chainsig-"));
    expect(chainsigState(home)).toBeUndefined();
    const base = { evm_address: "0xabc", chain_id: 11155111, path: "standin-evm-1" };
    appendChainsig({ ...base, type: "sign", ok: true, tx_hash: "T1" }, home);
    appendChainsig({ ...base, type: "blocked", via: "owner-key", tx_hash: "T2", error: "frozen: sign_evm refused until unfreeze" }, home);
    const s = chainsigState(home)!;
    expect(s.last_sign).toMatchObject({ tx_hash: "T1", ok: true });
    expect(s.blocked_after_freeze).toEqual({ tx_hash: "T2", error: "frozen: sign_evm refused until unfreeze" });
    expect(s).toMatchObject(base);
  });
});
