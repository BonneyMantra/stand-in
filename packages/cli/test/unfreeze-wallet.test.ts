import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, expect, it } from "vitest";
import { loadScopedKey } from "@standin/core";
import {
  loadPendingKey, ownerUrl, pendingKeyPath, unfreezeWallet, type KeyView, type PendingKey, type WalletChain,
} from "../src/unfreeze-wallet.ts";

const KEY: PendingKey = {
  account_id: "si-test.testnet", public_key: "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp",
  secret_key: "ed25519:3tgdk2wPraJzT4nsTuf86UX41xgPNk3MHnq8epARMdBNs29AFEztAuaQ7iHddDfXG9F2RzV1XNQYgJyAyoW51UBB",
  receiver_id: "proj.testnet", method_names: ["record_deploy", "x y"], allowance: "250000000000000000000000", created_at: "now",
};
let tick = 0;
const clock = { now: () => tick, sleep: async (ms: number) => { tick += ms; } };
const chain = (key: KeyView | null, frozen = false): WalletChain => ({ viewKey: async () => key, frozen: async () => frozen });
const good: KeyView = { receiver_id: "", method_names: [], full_access: false };

beforeEach(() => {
  tick = 0;
  process.env.STANDIN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "si-w-"));
  process.env.STANDIN_CONFIG = path.join(process.env.STANDIN_HOME, "cfg.json");
  fs.writeFileSync(process.env.STANDIN_CONFIG, JSON.stringify({ network: "testnet", accounts: { agent: "si-test.testnet", project: "proj.testnet" } }));
});

it("URL encodes every parameter and keeps the contract names", () => {
  const u = new URL(ownerUrl("https://d.example/", KEY));
  expect(u.origin + u.pathname).toBe("https://d.example/app/owner");
  expect(Object.fromEntries(u.searchParams)).toEqual({
    op: "unfreeze", account: KEY.account_id, agent_key: KEY.public_key, receiver: "proj.testnet",
    methods: "record_deploy,x y", allowance: KEY.allowance,
  });
  expect(ownerUrl("https://d.example", KEY)).toContain("methods=record_deploy%2Cx%20y");
  expect(new URL(ownerUrl("https://d.example", { ...KEY, method_names: [] })).searchParams.get("methods")).toBe("");
});

it("saves a pending key (0600, not active), then times out with exit 6", async () => {
  const code = await unfreezeWallet({ chain: chain(null), timeoutSec: 9, pollMs: 3000, ...clock });
  expect(code).toBe(6);
  expect(fs.statSync(pendingKeyPath()).mode & 0o777).toBe(0o600);
  expect(loadPendingKey()?.method_names).toEqual(["record_deploy"]);
  expect(loadScopedKey()).toBeNull();
});

it("never prints the secret", async () => {
  const w = process.stdout.write.bind(process.stdout);
  let seen = "";
  process.stdout.write = ((s: string) => { seen += s; return true; }) as any;
  try { await unfreezeWallet({ chain: chain(null), timeoutSec: 1, ...clock }); } finally { process.stdout.write = w; }
  const p = loadPendingKey()!;
  expect(seen).toContain(p.public_key);
  expect(seen).not.toContain(p.secret_key);
});

it("activates the key once it exists with the right scope and the guardian is unfrozen", async () => {
  const first = await unfreezeWallet({ chain: chain(null), timeoutSec: 1, ...clock });
  expect(first).toBe(6);
  const pend = loadPendingKey()!;
  const view: KeyView = { receiver_id: pend.receiver_id, method_names: pend.method_names, full_access: false };
  expect(await unfreezeWallet({ resume: true, chain: chain(view, false), ...clock })).toBe(0);
  expect(loadScopedKey()?.public_key).toBe(pend.public_key);
  expect(fs.existsSync(pendingKeyPath())).toBe(false);
});

it("keeps waiting while the guardian is still frozen", async () => {
  await unfreezeWallet({ chain: chain(null), timeoutSec: 1, ...clock });
  const pend = loadPendingKey()!;
  const view: KeyView = { receiver_id: pend.receiver_id, method_names: pend.method_names, full_access: false };
  expect(await unfreezeWallet({ resume: true, chain: chain(view, true), timeoutSec: 6, ...clock })).toBe(6);
  expect(loadScopedKey()).toBeNull();
});

it("refuses a key that appears with a different scope or full access (exit 1)", async () => {
  await unfreezeWallet({ chain: chain(null), timeoutSec: 1, ...clock });
  for (const v of [{ receiver_id: "evil.testnet", method_names: ["record_deploy"], full_access: false }, { receiver_id: "proj.testnet", method_names: [], full_access: false }, { receiver_id: "", method_names: [], full_access: true }]) {
    expect(await unfreezeWallet({ resume: true, chain: chain(v), ...clock })).toBe(1);
  }
  expect(loadScopedKey()).toBeNull();
  expect(fs.existsSync(pendingKeyPath())).toBe(true);
});

it("--resume without a pending key is an error; bad timeout is rejected", async () => {
  expect(await unfreezeWallet({ resume: true, chain: chain(null), ...clock })).toBe(1);
  expect(await unfreezeWallet({ timeoutSec: -3, chain: chain(null), ...clock })).toBe(1);
});
