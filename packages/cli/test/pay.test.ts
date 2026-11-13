import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pay } from "../src/pay.ts";
import { scanHome } from "../src/scan.ts";

const verdict = (decision: "allow" | "warn" | "block") => async (id: string) => ({
  account_id: id, decision, prior_interactions: 0, checked_at: "now",
  reasons: decision === "block" ? [{ level: "block" as const, code: "blocklist" as const, message: "on blocklist (mock registry)" }] : [],
});

describe("standin pay (mocked registry)", () => {
  it("refuses a blocklisted receiver with exit 3", async () => {
    process.env.STANDIN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "si-"));
    expect(await pay({ receiver: "thief.testnet", what: "1", check: verdict("block") })).toBe(3);
  });
  it("asks on warn and sends nothing when declined (exit 4)", async () => {
    process.env.STANDIN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "si-"));
    let asked = 0;
    const code = await pay({ receiver: "new.testnet", what: "1", check: verdict("warn"), ask: async () => { asked++; return false; } });
    expect(code).toBe(4);
    expect(asked).toBe(1);
  });
});

describe("scanHome", () => {
  it("finds keys in credentials, .env and shell history", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "si-home-"));
    const key = "ed25519:" + "3".repeat(87);
    fs.mkdirSync(path.join(home, ".near-credentials/testnet"), { recursive: true });
    fs.writeFileSync(path.join(home, ".near-credentials/testnet/a.testnet.json"), JSON.stringify({ account_id: "a.testnet", private_key: key }));
    fs.mkdirSync(path.join(home, "proj"));
    fs.writeFileSync(path.join(home, "proj/.env"), `NEAR_ACCOUNT_ID=a.testnet\nNEAR_PRIVATE_KEY=${key}\n`);
    fs.writeFileSync(path.join(home, ".zsh_history"), `: 1:0;near send a.testnet b.testnet 1 --privateKey ${key}\n`);
    expect(scanHome(home).map((f) => f.kind).sort()).toEqual(["dotenv", "near-credentials", "shell-history"]);
  });
});
