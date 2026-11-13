import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appendEvent, findPlanted, readEvents, plantDecoy, checkCounterparty, credentialsPath } from "../src/index.ts";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "standin-"));
const key = { public_key: "ed25519:PUB", secret_key: "ed25519:SEC" };

describe("ledger + plant", () => {
  it("appends, reads, resolves planted key", () => {
    const home = tmp();
    const dir = tmp();
    plantDecoy({ kind: "near-credentials", path: credentialsPath(dir, "testnet", "decoy.testnet"), decoyAccountId: "decoy.testnet", key, agent: "manual", home });
    plantDecoy({ kind: "dotenv", path: path.join(dir, ".env"), decoyAccountId: "decoy.testnet", key, agent: "manual", home });
    const env = fs.readFileSync(path.join(dir, ".env"), "utf8");
    expect(env).toContain("NEAR_ACCOUNT_ID=decoy.testnet");
    expect(findPlanted("ed25519:PUB", home)?.kind).toBe("dotenv");
    appendEvent("tool_call", { tool_name: "Bash", input: { to: "bob.testnet" } }, home);
    expect(readEvents({ type: "tool_call" }, home)).toHaveLength(1);
  });
});

describe("counterparty", () => {
  const base = { stateAt: async () => ({ existed: true, codeHash: "x" }), currentCodeHash: async () => "11111111111111111111111111111111" };
  it("blocks on registry hit (mocked registry)", async () => {
    const r = await checkCounterparty("thief.testnet", { ...base, home: tmp(), registryCheck: async () => ({ verdict: "block", reasons: ["drained decoy"], evidence_tx: "TX1" }) });
    expect(r.decision).toBe("block");
    expect(r.reasons[0]?.code).toBe("blocklist");
  });
  it("warns on young account", async () => {
    const r = await checkCounterparty("new.testnet", { ...base, home: tmp(), registryCheck: async () => ({ verdict: "allow" }), stateAt: async () => ({ existed: false }) });
    expect(r.decision).toBe("warn");
  });
  it("warns when contract code changed within 72h", async () => {
    const r = await checkCounterparty("c.testnet", { home: tmp(), registryCheck: async () => ({ verdict: "allow" }), currentCodeHash: async () => "NEW", stateAt: async () => ({ existed: true, codeHash: "OLD" }) });
    expect(r.decision).toBe("warn");
    expect(r.reasons.some((x) => x.code === "contract_changed")).toBe(true);
  });
  it("allows a clean account and counts prior interactions", async () => {
    const home = tmp();
    appendEvent("tool_call", { to: "ok.testnet" }, home);
    const r = await checkCounterparty("ok.testnet", { ...base, home, registryCheck: async () => ({ verdict: "allow" }) });
    expect(r.decision).toBe("allow");
    expect(r.prior_interactions).toBe(1);
  });
});
