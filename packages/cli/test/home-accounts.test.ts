import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateKey, homeAccountIds, saveHomeKey, type GeneratedKey } from "@standin/core";
import { HomeRefusal, planHomeAccounts, type HomeChain, type KeyView } from "../src/home-accounts.ts";

const OWNER = "judge-fresh.testnet";
const GUARDIAN = "guard.judge-fresh.testnet";
const ids = homeAccountIds(OWNER);
let home = "";
let bait: GeneratedKey, watcher: GeneratedKey;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "si-ha-"));
  bait = generateKey(); watcher = generateKey();
  saveHomeKey(home, "bait", ids.bait, bait);
  saveHomeKey(home, "watcher", ids.watcher, watcher);
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

/** Both accounts exist; `keys` maps "<account>|<public key>" to that key's permission on chain. */
const chain = (keys: Record<string, KeyView>, withKeyView = true): HomeChain => ({
  account: async () => ({ amount: 10n ** 24n, storage_usage: 182n, code_hash: "1".repeat(32) }),
  fullAccess: async (id, pk) => keys[`${id}|${pk}`]?.kind === "full-access",
  ...(withKeyView ? { keyView: async (id: string, pk: string) => keys[`${id}|${pk}`] ?? null } : {}),
});
const full: KeyView = { kind: "full-access" };
const fc = (receiver_id: string, ...method_names: string[]): KeyView => ({ kind: "function-call", receiver_id, method_names });
const onChain = (b: KeyView, w: KeyView) => ({ [`${ids.bait}|${bait.public_key}`]: b, [`${ids.watcher}|${watcher.public_key}`]: w });

describe("planHomeAccounts with a function-call watcher key", () => {
  it("accepts a freeze key on the guardian being adopted", async () => {
    const plan = await planHomeAccounts(OWNER, home, chain(onChain(full, fc(GUARDIAN, "freeze"))), GUARDIAN);
    expect(plan.toCreate).toEqual([]);
    expect(plan.watcher).toMatchObject({ account_id: ids.watcher, public_key: watcher.public_key, exists: true });
  });

  it("refuses a freeze key whose receiver is another account, and names what it found", async () => {
    const e = await planHomeAccounts(OWNER, home, chain(onChain(full, fc("someone-else.testnet", "freeze"))), GUARDIAN).catch((x) => x);
    expect(e).toBeInstanceOf(HomeRefusal);
    expect(e.message).toContain(`${ids.watcher} already exists and this home holds no full-access key for it, nor a function-call key that may call freeze on ${GUARDIAN}`);
    expect(e.message).toContain("function-call key on someone-else.testnet for freeze");
  });

  it("refuses a function-call key on the guardian that cannot call freeze", async () => {
    await expect(planHomeAccounts(OWNER, home, chain(onChain(full, fc(GUARDIAN, "get_state"))), GUARDIAN)).rejects.toThrow(/nor a function-call key that may call freeze/);
  });

  it("refuses a function-call key on the bait: it needs full access to add decoys", async () => {
    const e = await planHomeAccounts(OWNER, home, chain(onChain(fc(GUARDIAN, "freeze"), full)), GUARDIAN).catch((x) => x);
    expect(e).toBeInstanceOf(HomeRefusal);
    expect(e.message).toContain(`${ids.bait} already exists and this home holds no full-access key for it, so Stand-in cannot add decoy keys to it.`);
    expect(e.message).not.toContain("freeze on");
  });

  it("without a guardian, or a chain without keyView, a function-call watcher key is still refused (the old rule)", async () => {
    const keys = onChain(full, fc(GUARDIAN, "freeze"));
    const a = await planHomeAccounts(OWNER, home, chain(keys)).catch((x) => x);
    expect(a.message).toContain(`${ids.watcher} already exists and this home holds no full-access key for it, so Stand-in cannot sign freezes with it.`);
    await expect(planHomeAccounts(OWNER, home, chain(keys, false), GUARDIAN)).rejects.toBeInstanceOf(HomeRefusal);
  });

  it("still accepts a full-access watcher key", async () => {
    const plan = await planHomeAccounts(OWNER, home, chain(onChain(full, full)), GUARDIAN);
    expect(plan.watcher.exists && plan.bait.exists).toBe(true);
  });
});
