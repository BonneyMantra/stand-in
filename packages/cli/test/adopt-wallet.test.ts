import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, expect, it } from "vitest";
import { loadHomeKey, loadScopedKey, readEvents, type NetworkConfig } from "@standin/core";
import {
  adoptPendingPath, adoptUrl, adoptWallet, loadAdoptPending, validateTestnetAccount, type AdoptChain, type AdoptKeyView, type GuardianView,
} from "../src/adopt-wallet.ts";
import type { HomeChain } from "../src/home-accounts.ts";

const ACCT = "wallet-owner.si-test.testnet";
const BAIT = `deployer.${ACCT}`, WATCH = `watch.${ACCT}`;
const ALLOW = "250000000000000000000000";
const NEAR = 10n ** 24n;
let tick = 0, home = "", dir = "";
const clock = { now: () => tick, sleep: async (ms: number) => { tick += ms; } };
const decoy = { public_key: "ed25519:DecoyPub1111111111111111111111111111111111", secret_key: "ed25519:3tgdk2wPraJzT4nsTuf86UX41xgPNk3MHnq8epARMdBNs29AFEztAuaQ7iHddDfXG9F2RzV1XNQYgJyAyoW51UBB" };
let tookFor = "";
const planter = { takeDecoy: async (_h: string, c: NetworkConfig) => { tookFor = c.accounts.decoy; return decoy; } };
const keyView: AdoptKeyView = { receiver_id: "proj.testnet", method_names: ["record_deploy"], allowance: ALLOW, full_access: false };
const guard = (g: Partial<GuardianView> = {}, pk?: () => string): (() => GuardianView) => () => ({ owner: ACCT, watcher: WATCH, frozen: false, agent_keys: [pk?.() ?? ""], ...g });
const pk = () => loadAdoptPending(home)?.public_key ?? "";

/** In-memory accounts: id -> balance and full-access keys. */
let accounts: Map<string, { amount: bigint; keys: Set<string> }>;
const homeChain: HomeChain = {
  account: async (id) => { const a = accounts.get(id); return a ? { amount: a.amount, storage_usage: 182n, code_hash: "1".repeat(32) } : null; },
  fullAccess: async (id, k) => !!accounts.get(id)?.keys.has(k),
};
/** The owner's wallet landing the home-account transactions with the keys the link carried. */
const landHome = () => {
  const p = loadAdoptPending(home)!;
  if (p.bait_key) accounts.set(p.bait, { amount: NEAR / 5n, keys: new Set([p.bait_key]) });
  if (p.watch_key) accounts.set(p.watcher, { amount: NEAR / 5n, keys: new Set([p.watch_key]) });
};
const chain = (v: AdoptKeyView | null, g: () => GuardianView | null): AdoptChain => ({ viewKey: async () => v, guardian: async () => g(), home: homeChain });
const run = (c: AdoptChain, extra: Partial<Parameters<typeof adoptWallet>[0]> = {}) =>
  adoptWallet({ account: ACCT, home: dir, chain: c, timeoutSec: 6, ...planter, ...clock, ...extra });
const capture = async (stream: "stdout" | "stderr", fn: () => Promise<number>) => {
  const s = process[stream];
  const w = s.write.bind(s);
  let seen = "";
  s.write = ((x: string) => { seen += x; return true; }) as any;
  try { return { code: await fn(), seen }; } finally { s.write = w; }
};

beforeEach(() => {
  tick = 0; tookFor = "";
  home = fs.mkdtempSync(path.join(os.tmpdir(), "si-aw-"));
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "si-aw-dir-"));
  accounts = new Map([[ACCT, { amount: 10n * NEAR, keys: new Set() }]]);
  process.env.STANDIN_HOME = home;
  process.env.STANDIN_CONFIG = path.join(home, "base.json");
  fs.writeFileSync(process.env.STANDIN_CONFIG, JSON.stringify({
    network: "testnet", extra_field: 7,
    accounts: { agent: "si-agent.testnet", project: "proj.testnet", decoy: "decoy.testnet", watcher: "watch.testnet", intents: "intents.testnet", registry: "reg.testnet" },
  }));
});

it("validates testnet named accounts and refuses .near", () => {
  expect(validateTestnetAccount("a.si-x.testnet")).toBeNull();
  for (const bad of ["alice.near", "alice", "ALICE.testnet", "a b.testnet", "a..testnet", "-a.testnet", "x".repeat(70) + ".testnet", "a".repeat(64)]) expect(validateTestnetAccount(bad)).not.toBeNull();
  expect(validateTestnetAccount("alice.near")).toBe("alice.near is a mainnet account; Stand-in runs on testnet only");
});

it("link carries the fixed contract names and, for accounts to create, public keys only", () => {
  const p = { account_id: ACCT, watcher: WATCH, intents: "i.testnet", public_key: "ed25519:AbC", secret_key: "ed25519:x", receiver_id: "r.testnet", method_names: ["a", "b"], allowance: ALLOW, created_at: "", parent: ACCT, bait: BAIT, bait_key: "ed25519:Bk", watch_key: "ed25519:Wk" };
  const u = new URL(adoptUrl("https://d.example/", p));
  expect(u.origin + u.pathname).toBe("https://d.example/app/owner");
  expect([...u.searchParams.keys()]).toEqual(["op", "account", "watcher", "intents", "agent_key", "receiver", "methods", "allowance", "bait", "bait_key", "watch_key"]);
  expect(Object.fromEntries(u.searchParams)).toMatchObject({ op: "adopt", account: ACCT, watcher: WATCH, agent_key: "ed25519:AbC", methods: "a,b", bait: BAIT, bait_key: "ed25519:Bk", watch_key: "ed25519:Wk" });
  expect(adoptUrl("https://d.example", p)).toContain("methods=a%2Cb");
  expect([...new URL(adoptUrl("https://d.example", { ...p, bait_key: undefined, watch_key: undefined })).searchParams.keys()]).not.toContain("bait_key");
});

it("times out with exit 6: pending 0600, home keys 0600 in <home>/keys, no secret printed", async () => {
  const { code, seen } = await capture("stdout", () => run(chain(null, () => null)));
  expect(code).toBe(6);
  expect(fs.statSync(adoptPendingPath(home)).mode & 0o777).toBe(0o600);
  const p = loadAdoptPending(home)!;
  expect(p).toMatchObject({ account_id: ACCT, watcher: WATCH, bait: BAIT, parent: ACCT, receiver_id: "proj.testnet", method_names: ["record_deploy"], allowance: ALLOW });
  const bk = loadHomeKey(home, BAIT)!, wk = loadHomeKey(home, WATCH)!;
  expect([p.bait_key, p.watch_key]).toEqual([bk.public_key, wk.public_key]);
  expect(fs.statSync(path.join(home, "keys", `${BAIT}.json`)).mode & 0o777).toBe(0o600);
  expect(fs.statSync(path.join(home, "keys")).mode & 0o777).toBe(0o700);
  expect(seen).toContain("op=adopt");
  for (const s of [p.secret_key, bk.secret_key, wk.secret_key]) expect(seen).not.toContain(s);
  expect(loadScopedKey(home)).toBeNull();
  expect(fs.existsSync(path.join(home, "config.json"))).toBe(false);
});

it("success: home config names its own bait and watcher, decoy planted on the bait, pending removed", async () => {
  expect(await run(chain(null, () => null), { timeoutSec: 1 })).toBe(6);
  landHome();
  expect(await run(chain(keyView, guard({}, pk)), { resume: true })).toBe(0);
  expect(tookFor).toBe(BAIT);
  expect(fs.existsSync(adoptPendingPath(home))).toBe(false);
  expect(loadScopedKey(home)).toMatchObject({ account_id: ACCT, receiver_id: "proj.testnet" });
  const cred = JSON.parse(fs.readFileSync(path.join(dir, ".near-credentials", "testnet", `${BAIT}.json`), "utf8"));
  expect(cred).toMatchObject({ account_id: BAIT, public_key: decoy.public_key });
  const cfg = JSON.parse(fs.readFileSync(path.join(home, "config.json"), "utf8"));
  expect(cfg.accounts).toMatchObject({ agent: ACCT, decoy: BAIT, watcher: WATCH, project: "proj.testnet" });
  expect(cfg.home_accounts).toEqual({ parent: ACCT, bait: BAIT, watcher: WATCH });
  expect(cfg.extra_field).toBe(7);
  expect(readEvents({ type: "decoy_planted" }, home)).toHaveLength(1);
  expect(readEvents({ type: "tool_call", where: (e) => e.outcome === "adopted via wallet" }, home)).toHaveLength(1);
});

it("a partly landed request: keeps waiting and names what is missing; --resume finishes once the rest lands", async () => {
  await run(chain(null, () => null), { timeoutSec: 1 });
  const { code, seen } = await capture("stdout", () => run(chain(keyView, guard({}, pk)), { resume: true }));
  expect(code).toBe(6);
  expect(seen).toContain(`still missing on chain: ${BAIT}, ${WATCH}`);
  landHome();
  expect(await run(chain(keyView, guard({}, pk)), { resume: true })).toBe(0);
});

it("an existing home account with this home's key is reused: no key for it in the link", async () => {
  await run(chain(null, () => null), { timeoutSec: 1 });
  const bk = loadHomeKey(home, BAIT)!;
  accounts.set(BAIT, { amount: NEAR, keys: new Set([bk.public_key]) });
  fs.rmSync(adoptPendingPath(home));
  await run(chain(null, () => null), { timeoutSec: 1 });
  const p = loadAdoptPending(home)!;
  expect(p.bait_key).toBeUndefined();
  expect(p.watch_key).toBe(loadHomeKey(home, WATCH)!.public_key);
});

it("refuses before any link: a home account that exists without this home's key", async () => {
  accounts.set(WATCH, { amount: NEAR, keys: new Set(["ed25519:someoneElse"]) });
  const { code, seen } = await capture("stderr", () => run(chain(null, () => null)));
  expect(code).toBe(1);
  expect(seen).toContain(`${WATCH} already exists and this home holds no full-access key for it`);
  expect(fs.existsSync(adoptPendingPath(home))).toBe(false);
});

it("refuses before any link: a guardian watched by someone else (the guardian cannot change its watcher)", async () => {
  const { code, seen } = await capture("stderr", () => run(chain(null, guard({ watcher: "si-watch-5289.testnet" }))));
  expect(code).toBe(1);
  expect(seen).toContain("has no method to change its watcher");
  expect(fs.existsSync(adoptPendingPath(home))).toBe(false);
});

it("refuses before any link: not enough NEAR for the guardian and the two accounts", async () => {
  accounts.set(ACCT, { amount: NEAR, keys: new Set() });
  const { code, seen } = await capture("stderr", () => run(chain(null, () => null)));
  expect(code).toBe(1);
  expect(seen).toMatch(/Short by \d+\.\d+ NEAR/);
  expect(seen).toContain("Nothing was sent");
  expect(fs.existsSync(adoptPendingPath(home))).toBe(false);
});

it("refuses an owner that cannot create sub-accounts (0x)", async () => {
  const { code, seen } = await capture("stderr", () => run(chain(null, () => null), { owner: "0x" + "ab".repeat(20) }));
  expect(code).toBe(1);
  expect(seen).toContain("only a named NEAR account can create");
});

it("refuses a scope mismatch (receiver, methods, allowance), exit 1, ledger event, pending kept", async () => {
  await run(chain(null, () => null), { timeoutSec: 1 });
  landHome();
  for (const v of [{ ...keyView, receiver_id: "evil.testnet" }, { ...keyView, method_names: [] }, { ...keyView, allowance: null }, { ...keyView, allowance: "1" }]) {
    expect(await run(chain(v, guard({}, pk)), { resume: true })).toBe(1);
  }
  expect(loadScopedKey(home)).toBeNull();
  expect(fs.existsSync(adoptPendingPath(home))).toBe(true);
  expect(readEvents({ type: "tool_call", where: (e) => e.outcome === "scope_mismatch" }, home).length).toBe(4);
});

it("refuses a full-access key and a guardian with the wrong owner", async () => {
  await run(chain(null, () => null), { timeoutSec: 1 });
  expect(await run(chain({ receiver_id: "", method_names: [], allowance: null, full_access: true }, guard({}, pk)), { resume: true })).toBe(1);
  expect(readEvents({ type: "tool_call", where: (e) => e.outcome === "full_access_refused" }, home)).toHaveLength(1);
  expect(await run(chain(keyView, guard({ owner: "other.testnet" }, pk)), { resume: true })).toBe(1);
  expect(loadScopedKey(home)).toBeNull();
});

it("keeps waiting while frozen, or while the key is not in agent_keys, or no guardian yet", async () => {
  await run(chain(null, () => null), { timeoutSec: 1 });
  landHome();
  expect(await run(chain(keyView, guard({ frozen: true }, pk)), { resume: true })).toBe(6);
  expect(await run(chain(keyView, guard({ agent_keys: [] })), { resume: true })).toBe(6);
  expect(await run(chain(keyView, () => null), { resume: true })).toBe(6);
  expect(loadScopedKey(home)).toBeNull();
});

it("a chain read error is retried, not fatal", async () => {
  await run(chain(null, () => null), { timeoutSec: 1 });
  landHome();
  let n = 0;
  const flaky: AdoptChain = { viewKey: async () => { if (n++ < 2) throw new Error("rpc down"); return keyView; }, guardian: async () => guard({}, pk)(), home: homeChain };
  expect(await run(flaky, { resume: true, timeoutSec: 30 })).toBe(0);
});

it("--resume needs a pending request for the same account; rejects mainnet accounts and bad timeouts", async () => {
  expect(await run(chain(null, () => null), { resume: true })).toBe(1);
  await run(chain(null, () => null), { timeoutSec: 1 });
  expect(await run(chain(null, () => null), { resume: true, account: "other.testnet" })).toBe(1);
  expect(await run(chain(null, () => null), { account: "alice.near" })).toBe(1);
  expect(await run(chain(null, () => null), { timeoutSec: -1 })).toBe(1);
});

it("factory guardian: the owner's sub-accounts, --owner is the one checked", async () => {
  const ext = "owner.si-test.testnet";
  accounts.set(ext, { amount: 10n * NEAR, keys: new Set() });
  const g = guard({ owner: ext, watcher: `watch.${ext}` }, pk);
  await run(chain(null, g), { owner: ext, timeoutSec: 1 });
  expect(loadAdoptPending(home)).toMatchObject({ parent: ext, bait: `deployer.${ext}`, watcher: `watch.${ext}` });
  landHome();
  expect(await run(chain(keyView, g), { owner: ext, resume: true })).toBe(0);
});

it("a decoy that cannot be planted: exit 1, pending kept for --resume, no scoped key", async () => {
  await run(chain(null, () => null), { timeoutSec: 1 });
  landHome();
  const { code, seen } = await capture("stderr", () => run(chain(keyView, guard({}, pk)), { resume: true, takeDecoy: async () => { throw new Error("rpc down"); } }));
  expect(code).toBe(1);
  expect(seen).toContain(`planting the decoy on ${BAIT} failed`);
  expect(seen).toContain("--resume");
  expect(loadScopedKey(home)).toBeNull();
  expect(fs.existsSync(adoptPendingPath(home))).toBe(true);
});
