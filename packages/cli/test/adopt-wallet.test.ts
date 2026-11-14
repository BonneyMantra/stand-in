import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, expect, it } from "vitest";
import { loadScopedKey, readEvents } from "@standin/core";
import {
  adoptPendingPath, adoptUrl, adoptWallet, loadAdoptPending, validateTestnetAccount, type AdoptChain, type AdoptKeyView, type GuardianView,
} from "../src/adopt-wallet.ts";

const ACCT = "wallet-owner.si-test.testnet";
const ALLOW = "250000000000000000000000";
let tick = 0, home = "", dir = "";
const clock = { now: () => tick, sleep: async (ms: number) => { tick += ms; } };
const decoy = { public_key: "ed25519:DecoyPub1111111111111111111111111111111111", secret_key: "ed25519:3tgdk2wPraJzT4nsTuf86UX41xgPNk3MHnq8epARMdBNs29AFEztAuaQ7iHddDfXG9F2RzV1XNQYgJyAyoW51UBB" };
const planter = { takeDecoy: async () => decoy };
const keyView: AdoptKeyView = { receiver_id: "proj.testnet", method_names: ["record_deploy"], allowance: ALLOW, full_access: false };
const guard = (g: Partial<GuardianView> = {}, pk?: () => string): (() => GuardianView) => () => ({ owner: ACCT, watcher: "watch.testnet", frozen: false, agent_keys: [pk?.() ?? ""], ...g });
const chain = (v: AdoptKeyView | null, g: () => GuardianView | null): AdoptChain => ({ viewKey: async () => v, guardian: async () => g() });
const pk = () => loadAdoptPending(home)?.public_key ?? "";
const run = (c: AdoptChain, extra: Partial<Parameters<typeof adoptWallet>[0]> = {}) =>
  adoptWallet({ account: ACCT, home: dir, chain: c, timeoutSec: 6, ...planter, ...clock, ...extra });

beforeEach(() => {
  tick = 0;
  home = fs.mkdtempSync(path.join(os.tmpdir(), "si-aw-"));
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "si-aw-dir-"));
  process.env.STANDIN_HOME = home;
  process.env.STANDIN_CONFIG = path.join(home, "cfg.json");
  fs.writeFileSync(process.env.STANDIN_CONFIG, JSON.stringify({
    network: "testnet", extra_field: 7,
    accounts: { agent: "si-agent.testnet", project: "proj.testnet", decoy: "decoy.testnet", watcher: "watch.testnet", intents: "intents.testnet", registry: "reg.testnet" },
  }));
});

it("validates testnet named accounts and refuses .near", () => {
  expect(validateTestnetAccount("a.si-x.testnet")).toBeNull();
  for (const bad of ["alice.near", "alice", "ALICE.testnet", "a b.testnet", "a..testnet", "-a.testnet", "x".repeat(70) + ".testnet", "a".repeat(64)]) expect(validateTestnetAccount(bad)).not.toBeNull();
});

it("link carries the fixed contract names, encoded", () => {
  const p = { account_id: ACCT, watcher: "w.testnet", intents: "i.testnet", public_key: "ed25519:AbC", secret_key: "ed25519:x", receiver_id: "r.testnet", method_names: ["a", "b"], allowance: ALLOW, created_at: "" };
  const u = new URL(adoptUrl("https://d.example/", p));
  expect(u.origin + u.pathname).toBe("https://d.example/app/owner");
  expect([...u.searchParams.keys()]).toEqual(["op", "account", "watcher", "intents", "agent_key", "receiver", "methods", "allowance"]);
  expect(Object.fromEntries(u.searchParams)).toMatchObject({ op: "adopt", account: ACCT, watcher: "w.testnet", intents: "i.testnet", agent_key: "ed25519:AbC", receiver: "r.testnet", methods: "a,b", allowance: ALLOW });
  expect(adoptUrl("https://d.example", p)).toContain("methods=a%2Cb");
  expect(new URL(adoptUrl("https://d.example", { ...p, method_names: [] })).searchParams.get("methods")).toBe("");
});

it("times out with exit 6, keeps a 0600 pending key, never prints the secret", async () => {
  const w = process.stdout.write.bind(process.stdout);
  let seen = "";
  process.stdout.write = ((s: string) => { seen += s; return true; }) as any;
  let code: number;
  try { code = await run(chain(null, () => null)); } finally { process.stdout.write = w; }
  expect(code).toBe(6);
  expect(fs.statSync(adoptPendingPath(home)).mode & 0o777).toBe(0o600);
  const p = loadAdoptPending(home)!;
  expect(p).toMatchObject({ account_id: ACCT, watcher: "watch.testnet", intents: "intents.testnet", receiver_id: "proj.testnet", method_names: ["record_deploy"], allowance: ALLOW });
  expect(seen).toContain(p.public_key);
  expect(seen).toContain("op=adopt");
  expect(seen).not.toContain(p.secret_key);
  expect(loadScopedKey(home)).toBeNull();
  expect(fs.existsSync(path.join(home, "config.json"))).toBe(false);
});

it("success: saves key, plants decoy, writes config, deletes pending, ledger events", async () => {
  expect(await run(chain(null, () => null), { timeoutSec: 1 })).toBe(6);
  const p = loadAdoptPending(home)!;
  expect(await run(chain(keyView, guard({}, pk)), { resume: true })).toBe(0);
  expect(loadScopedKey(home)).toMatchObject({ account_id: ACCT, public_key: p.public_key, receiver_id: "proj.testnet" });
  expect(fs.existsSync(adoptPendingPath(home))).toBe(false);
  const cred = JSON.parse(fs.readFileSync(path.join(dir, ".near-credentials", "testnet", "decoy.testnet.json"), "utf8"));
  expect(cred).toMatchObject({ account_id: "decoy.testnet", public_key: decoy.public_key });
  const cfg = JSON.parse(fs.readFileSync(path.join(home, "config.json"), "utf8"));
  expect(cfg.accounts.agent).toBe(ACCT);
  expect(cfg.accounts.watcher).toBe("watch.testnet");
  expect(cfg.extra_field).toBe(7);
  expect(readEvents({ type: "decoy_planted" }, home)).toHaveLength(1);
  expect(readEvents({ type: "tool_call", where: (e) => e.outcome === "adopted via wallet" }, home)).toHaveLength(1);
});

it("one-shot success when the key is already live", async () => {
  // pending is created inside the run, so the chain reads the key lazily
  expect(await run({ viewKey: async () => keyView, guardian: async () => guard({}, pk)() })).toBe(0);
});

it("refuses a scope mismatch (receiver, methods, allowance), exit 1, ledger event, pending kept", async () => {
  for (const v of [{ ...keyView, receiver_id: "evil.testnet" }, { ...keyView, method_names: [] }, { ...keyView, allowance: null }, { ...keyView, allowance: "1" }]) {
    expect(await run(chain(v, guard({}, pk)))).toBe(1);
  }
  expect(loadScopedKey(home)).toBeNull();
  expect(fs.existsSync(adoptPendingPath(home))).toBe(true);
  expect(readEvents({ type: "tool_call", where: (e) => e.outcome === "scope_mismatch" }, home).length).toBe(4);
});

it("refuses a full-access key", async () => {
  expect(await run(chain({ receiver_id: "", method_names: [], allowance: null, full_access: true }, guard({}, pk)))).toBe(1);
  expect(readEvents({ type: "tool_call", where: (e) => e.outcome === "full_access_refused" }, home)).toHaveLength(1);
  expect(loadScopedKey(home)).toBeNull();
});

it("refuses a guardian with the wrong watcher or owner", async () => {
  expect(await run(chain(keyView, guard({ watcher: "someone-else.testnet" }, pk)))).toBe(1);
  expect(readEvents({ type: "tool_call", where: (e) => e.outcome === "wrong_watcher" }, home)).toHaveLength(1);
  expect(await run(chain(keyView, guard({ owner: "other.testnet" }, pk)))).toBe(1);
  expect(loadScopedKey(home)).toBeNull();
});

it("keeps waiting while frozen, or while the key is not in agent_keys, or no guardian yet", async () => {
  expect(await run(chain(keyView, guard({ frozen: true }, pk)))).toBe(6);
  expect(await run(chain(keyView, guard({ agent_keys: [] })), { resume: true })).toBe(6);
  expect(await run(chain(keyView, () => null), { resume: true })).toBe(6);
  expect(loadScopedKey(home)).toBeNull();
  expect(fs.existsSync(adoptPendingPath(home))).toBe(true);
});

it("a chain read error is retried, not fatal", async () => {
  let n = 0;
  const flaky: AdoptChain = { viewKey: async () => { if (n++ < 2) throw new Error("rpc down"); return keyView; }, guardian: async () => guard({}, pk)() };
  expect(await run(flaky, { timeoutSec: 30 })).toBe(0);
});

it("--resume needs a pending key for the same account; rejects mainnet accounts and bad timeouts", async () => {
  expect(await run(chain(null, () => null), { resume: true })).toBe(1);
  await run(chain(null, () => null), { timeoutSec: 1 });
  expect(await run(chain(null, () => null), { resume: true, account: "other.testnet" })).toBe(1);
  expect(await run(chain(null, () => null), { account: "alice.near" })).toBe(1);
  expect(await run(chain(null, () => null), { timeoutSec: -1 })).toBe(1);
});

it("external owner (factory guardian): --owner is the one checked, default stays the account", async () => {
  const ext = "owner.si-test.testnet";
  expect(await run(chain(keyView, guard({ owner: ext }, pk)), { owner: ext })).toBe(0);
  expect(await run(chain(keyView, guard({ owner: ext }, pk)), { resume: true })).toBe(1);
});
