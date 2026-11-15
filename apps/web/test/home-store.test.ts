import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  canFreeze, freezeOnly, listHomeOwners, loadHome, newHome, recordHomeTx, removeHome, saveHome, setHomeStorage, updateHome, type KeyValueStore,
} from "../src/lib/wallet/homeStore.ts";
import { generateKeyPair, keyMatches, publicKeyOf } from "../src/lib/wallet/keys.ts";

class MemStore implements KeyValueStore {
  m = new Map<string, string>();
  fail = false;
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { if (this.fail) throw new Error("SecurityError"); return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { if (this.fail) throw new Error("QuotaExceededError"); this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

const OWNER = "judge-fresh.testnet";
let mem: MemStore;
beforeEach(() => { mem = new MemStore(); setHomeStorage(mem); });
afterEach(() => setHomeStorage(null));

describe("keys", () => {
  it("generates NEAR-format ed25519 pairs whose public half derives from the secret", () => {
    const k = generateKeyPair();
    expect(k.public_key).toMatch(/^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/);
    expect(publicKeyOf(k.secret_key)).toBe(k.public_key);
    expect(keyMatches(k.secret_key, k.public_key)).toBe(true);
    expect(keyMatches(k.secret_key, generateKeyPair().public_key)).toBe(false);
    expect(keyMatches("ed25519:not-a-key")).toBe(false);
  });

  it("agrees with the CLI's near-api-js keys both ways (CLI secret -> browser, browser secret -> CLI)", async () => {
    const core = await import("../../../packages/core/src/rpc.ts");
    const cli = core.generateKey();
    expect(publicKeyOf(cli.secret_key)).toBe(cli.public_key);
    const web = generateKeyPair();
    expect(core.publicKeyOf(web.secret_key)).toBe(web.public_key);
  });
});

describe("homeStore", () => {
  it("returns null for an owner with no home", () => {
    expect(loadHome(OWNER)).toBeNull();
  });

  it("round-trips a new home: bait, watcher (freeze-only on one guardian) and guardians", () => {
    const h = newHome(OWNER, OWNER);
    expect(saveHome(h)).toBe(true);
    const back = loadHome(OWNER)!;
    expect(back.bait.account_id).toBe(`deployer.${OWNER}`);
    expect(back.watcher.account_id).toBe(`watch.${OWNER}`);
    expect(back.bait.secret_key).toBe(h.bait.secret_key);
    expect(back.watcher.scope).toEqual({ kind: "function-call", receiver_id: OWNER, method_names: ["freeze"] });
    expect(back.guardians).toEqual([OWNER]);
    expect(listHomeOwners()).toEqual([OWNER]);
  });

  it("refuses a record whose secret does not match its public key", () => {
    const h = newHome(OWNER, OWNER);
    expect(saveHome({ ...h, bait: { ...h.bait, public_key: generateKeyPair().public_key } })).toBe(false);
    expect(loadHome(OWNER)).toBeNull();
  });

  it("ignores a stored record for a different owner or with a broken shape", () => {
    const h = newHome(OWNER, OWNER);
    mem.setItem(`standin.home.v1:${OWNER}`, JSON.stringify({ ...h, owner: "someone-else.testnet" }));
    expect(loadHome(OWNER)).toBeNull();
    mem.setItem(`standin.home.v1:${OWNER}`, "{not json");
    expect(loadHome(OWNER)).toBeNull();
  });

  it("reads blocked storage as no home and reports a failed save", () => {
    mem.fail = true;
    expect(loadHome(OWNER)).toBeNull();
    expect(saveHome(newHome(OWNER, OWNER))).toBe(false);
    expect(listHomeOwners()).toEqual([]);
  });

  it("updates, records transactions newest first, and removes", () => {
    saveHome(newHome(OWNER, OWNER));
    recordHomeTx(OWNER, { hash: "A", label: "create", at: 1 });
    recordHomeTx(OWNER, { hash: "B", label: "decoy", at: 2 });
    recordHomeTx(OWNER, { hash: "A", label: "create", at: 1 });
    expect(loadHome(OWNER)!.txs.map((t) => t.hash)).toEqual(["A", "B"]);
    const d = generateKeyPair();
    updateHome(OWNER, (h) => ({ ...h, decoys: [{ ...d, added_at: "2026-11-15T06:00:00Z" }] }));
    expect(loadHome(OWNER)!.decoys[0]!.public_key).toBe(d.public_key);
    expect(removeHome(OWNER)).toBe(true);
    expect(loadHome(OWNER)).toBeNull();
  });

  it("canFreeze: a freeze-only key covers exactly its receiver; a full key covers its listed guardians", () => {
    const h = newHome(OWNER, OWNER);
    expect(canFreeze(h, OWNER)).toBe(true);
    expect(canFreeze(h, `agent.guard.si-project-5289.testnet`)).toBe(false);
    const full = { ...h, watcher: { ...h.watcher, scope: { kind: "full-access" as const } }, guardians: [OWNER, "a.guard.si-project-5289.testnet"] };
    expect(canFreeze(full, "a.guard.si-project-5289.testnet")).toBe(true);
    expect(freezeOnly("x.testnet")).toEqual({ kind: "function-call", receiver_id: "x.testnet", method_names: ["freeze"] });
  });
});
