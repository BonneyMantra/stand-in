import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { saveScopedKey } from "@standin/core";
import { pay, validateReceiver } from "../src/pay.ts";
import { base58 } from "../src/adopt-guardian.ts";

const setup = () => {
  process.env.STANDIN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "si-"));
  saveScopedKey({ account_id: "agent.testnet", public_key: "ed25519:pk", secret_key: "ed25519:sk", receiver_id: "proj.testnet", method_names: ["record_deploy"], created_at: "now" });
};
const verdict = (decision: "allow" | "warn", code?: "registry_unavailable") => async (id: string) => ({
  account_id: id, decision, prior_interactions: 0, checked_at: "now",
  reasons: code ? [{ level: "info" as const, code, message: "unreachable" }] : [],
});

describe("pay input", () => {
  it("validates receivers per network", () => {
    expect(validateReceiver("a.testnet", "testnet")).toBeNull();
    expect(validateReceiver("a.b.testnet", "testnet")).toBeNull();
    expect(validateReceiver("a.near", "testnet")).toMatch(/not a testnet account/);
    expect(validateReceiver("a.testnet", "mainnet")).toMatch(/not a mainnet account/);
    expect(validateReceiver("Bad_Id!", "testnet")).toMatch(/not a valid NEAR account id/);
    expect(validateReceiver("a".repeat(64), "testnet")).toBeNull();
    expect(validateReceiver("x", "testnet")).toMatch(/not a valid/);
  });
  it("rejects a bad receiver, amount, method and args before any network call (exit 1)", async () => {
    setup();
    const never = async () => { throw new Error("must not be called"); };
    expect(await pay({ receiver: "foo.near", what: "1", check: never })).toBe(1);
    expect(await pay({ receiver: "a.testnet", what: "0", check: never })).toBe(1);
    expect(await pay({ receiver: "a.testnet", what: "1,5", check: never })).toBe(1);
    expect(await pay({ receiver: "a.testnet", what: "record_deploy", args: "{nope", check: never })).toBe(1);
  });
  it("refuses a transfer or a foreign method the agent's scoped key cannot make (exit 1, nothing sent)", async () => {
    setup();
    expect(await pay({ receiver: "proj.testnet", what: "0.5", check: verdict("allow") })).toBe(1);
    expect(await pay({ receiver: "other.testnet", what: "record_deploy", check: verdict("allow") })).toBe(1);
    expect(await pay({ receiver: "proj.testnet", what: "withdraw", check: verdict("allow") })).toBe(1);
  });
  it("fails closed when the blocklist cannot be read: owner approval is required (exit 4)", async () => {
    setup();
    const code = await pay({ receiver: "proj.testnet", what: "record_deploy", check: verdict("allow", "registry_unavailable"), gate: async () => false, approveWarn: true });
    expect(code).toBe(4);
  });
});

describe("base58", () => {
  it("encodes a sha256 the way NEAR prints code hashes", () => {
    expect(base58(Buffer.from("00ff", "hex"))).toBe("15Q");
  });
});
