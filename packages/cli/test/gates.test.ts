import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { saveScopedKey } from "@standin/core";
import { pay } from "../src/pay.ts";
import { unfreeze } from "../src/unfreeze.ts";

const warn = async (id: string) => ({ account_id: id, decision: "warn" as const, prior_interactions: 0, checked_at: "now", reasons: [] });
const home = () => {
  process.env.STANDIN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "si-"));
  saveScopedKey({ account_id: "agent.testnet", public_key: "ed25519:pk", secret_key: "ed25519:sk", receiver_id: "new.testnet", method_names: ["record_deploy"], created_at: "now" });
};

it("unfreeze sends nothing when the fingerprint gate fails (exit 5)", async () => {
  home();
  let reason = "";
  expect(await unfreeze({ gate: async (r) => { reason = r; return false; } })).toBe(5);
  expect(reason).toMatch(/^Unfreeze .+\.testnet$/);
});

it("pay --approve-warn still needs the fingerprint (exit 4 when it fails)", async () => {
  home();
  let gated = "";
  const code = await pay({ receiver: "new.testnet", what: "record_deploy", check: warn, approveWarn: true, gate: async (r) => { gated = r; return false; } });
  expect(code).toBe(4);
  expect(gated).toContain("new.testnet");
});

it("a typed yes on warn is not enough without the fingerprint", async () => {
  home();
  expect(await pay({ receiver: "new.testnet", what: "record_deploy", check: warn, ask: async () => true, gate: async () => false })).toBe(4);
});
