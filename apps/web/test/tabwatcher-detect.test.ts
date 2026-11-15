import { describe, expect, it } from "vitest";
import { diffSnapshots, freezeArgs, heightsBetween, snapshotOf, usesIn, type Snapshot } from "../src/lib/tabwatcher/detect.ts";
import { ChainAnswer, chainKind } from "../src/lib/tabwatcher/rpc.ts";
import { TabWatcher } from "../src/lib/tabwatcher/watcher.ts";
import { implicitAccountOf } from "../src/lib/tabwatcher/sign.ts";
import { ADMIN, BAIT, DECOY, GUARD, OTHER, fakeChain, fresh, settle } from "./tabwatcher-fake.ts";

const snap = (height: number, keys: [string, bigint][]): Snapshot => ({ height, hash: `h${height}`, missing: false, keys: new Map(keys) });

describe("diffSnapshots: a nonce that grew is a theft (the CLI's rule read from key state)", () => {
  const a = snap(100, [[ADMIN, 50n], [DECOY, fresh(90)]]);
  it("a known decoy whose nonce grew is used; the admin key never is", () => {
    const d = diffSnapshots(a, snap(103, [[ADMIN, 51n], [DECOY, fresh(90) + 1n]]), ADMIN);
    expect(d).toEqual({ used: [DECOY], suspects: [] });
  });
  it("nothing changed: no use", () => {
    expect(diffSnapshots(a, snap(101, [[ADMIN, 50n], [DECOY, fresh(90)]]), ADMIN)).toEqual({ used: [], suspects: [] });
  });
  it("a new key with a fresh nonce (a plant) is only a suspect; one that already signed is used", () => {
    const d = diffSnapshots(a, snap(104, [[ADMIN, 51n], [DECOY, fresh(90)], [OTHER, fresh(102)]]), ADMIN);
    expect(d).toEqual({ used: [], suspects: [OTHER] });
    const e = diffSnapshots(a, snap(104, [[ADMIN, 51n], [DECOY, fresh(90)], [OTHER, fresh(102) + 1n]]), ADMIN);
    expect(e).toEqual({ used: [OTHER], suspects: [] });
  });
  it("a key that vanished (it may have deleted itself) is a suspect, so its blocks are scanned", () => {
    expect(diffSnapshots(a, snap(102, [[ADMIN, 50n]]), ADMIN)).toEqual({ used: [], suspects: [DECOY] });
  });
  it("a read from a node behind the last one concludes nothing", () => {
    expect(diffSnapshots(a, snap(99, [[DECOY, fresh(90) + 5n]]), ADMIN)).toBeNull();
    expect(diffSnapshots(a, snap(100, [[DECOY, fresh(90) + 5n]]), ADMIN)).toBeNull();
  });
  it("parses view_access_key_list", () => {
    const s = snapshotOf({ block_height: 7, block_hash: "x", keys: [{ public_key: DECOY, access_key: { nonce: 277733544000001 } }] });
    expect(s.keys.get(DECOY)).toBe(277733544000001n);
    expect(s.height).toBe(7);
  });
});

describe("usesIn: EXPERIMENTAL_changes filtered exactly like packages/watcher followKeyChanges", () => {
  const changes = [
    { type: "access_key_update", cause: { type: "transaction_processing", tx_hash: "THEFT" }, change: { public_key: DECOY } },
    { type: "access_key_update", cause: { type: "transaction_processing", tx_hash: "PLANT" }, change: { public_key: ADMIN } },
    { type: "access_key_update", cause: { type: "receipt_processing" }, change: { public_key: OTHER } },
    { type: "access_key_deletion", cause: { type: "receipt_processing" }, change: { public_key: DECOY } },
  ];
  it("keeps only transactions signed by a non-admin key", () => {
    expect(usesIn(changes, 42, ADMIN)).toEqual([{ public_key: DECOY, tx_hash: "THEFT", height: 42 }]);
  });
  it("heightsBetween is exclusive of the start, inclusive of the end, capped", () => {
    expect(heightsBetween(10, 13)).toEqual([11, 12, 13]);
    expect(heightsBetween(10, 500, 5)).toHaveLength(5);
    expect(heightsBetween(10, 10)).toEqual([]);
  });
  it("freeze arguments stay within the guardian's 500-byte reason", () => {
    const f = freezeArgs({ public_key: DECOY, tx_hash: "T".repeat(44) }, "x".repeat(600));
    expect(f.reason.length).toBeLessThanOrEqual(500);
    expect(f).toMatchObject({ decoy_public_key: DECOY, tx_hash: "T".repeat(44) });
  });
});

describe("TabWatcher: armed before the theft, freezes once, misses nothing across a stall", () => {
  it("arms on the first read, then a decoy use freezes the guardian with the theft's tx hash", async () => {
    const f = fakeChain();
    const w = new TabWatcher({ rpc: f.rpc, bait: BAIT, admin: ADMIN, freezer: f.freezer });
    await w.tick();
    expect(w.snapshot.state).toBe("live");
    expect(w.snapshot.armedAt).toBe(100);
    f.steal();
    await w.tick();
    await settle();
    expect(f.freezes).toHaveLength(1);
    expect(f.freezes[0]).toMatchObject({ guardian: GUARD, args: { tx_hash: "THEFT", decoy_public_key: DECOY } });
    const t = w.snapshot.trips[0]!;
    expect(t).toMatchObject({ public_key: DECOY, tx_hash: "THEFT", theft_block: 101, via: "key state" });
    expect(t.freezes[0]).toMatchObject({ status: "landed", tx_hash: "FREEZE" });
    // the same use read again is not a second trip
    f.c.height += 1;
    await w.tick();
    await settle();
    expect(f.freezes).toHaveLength(1);
  });

  it("an admin-key transaction (planting or deleting a decoy) is never a trip", async () => {
    const f = fakeChain();
    const w = new TabWatcher({ rpc: f.rpc, bait: BAIT, admin: ADMIN, freezer: f.freezer });
    await w.tick();
    f.c.height += 1;
    f.c.keys.set(ADMIN, 51n);
    f.c.keys.set(OTHER, fresh(f.c.height));
    f.c.changes.set(f.c.height, [{ type: "access_key_update", cause: { type: "transaction_processing", tx_hash: "PLANT" }, change: { public_key: ADMIN } }]);
    await w.tick();
    await settle();
    expect(f.freezes).toHaveLength(0);
    expect(w.snapshot.trips).toHaveLength(0);
  });

  it("a decoy planted and used between two reads is caught by the block scan", async () => {
    const f = fakeChain();
    const w = new TabWatcher({ rpc: f.rpc, bait: BAIT, admin: ADMIN, freezer: f.freezer });
    await w.tick();
    f.c.height += 2;
    // planted with a fresh-looking nonce and used with a crafted one: only the changes show the use
    f.c.keys.set(OTHER, fresh(f.c.height) + 1_000_000n);
    f.c.changes.set(f.c.height, [{ type: "access_key_update", cause: { type: "transaction_processing", tx_hash: "CRAFTED" }, change: { public_key: OTHER } }]);
    await w.tick();
    await settle();
    expect(f.freezes.map((x) => x.args.tx_hash)).toEqual(["CRAFTED"]);
  });

  it("goes stalled when RPC stops answering, and the first good read after it still catches a theft from the gap", async () => {
    const f = fakeChain();
    let now = 1_000;
    const w = new TabWatcher({ rpc: f.rpc, bait: BAIT, admin: ADMIN, freezer: f.freezer, now: () => now, stallMs: 5000, online: () => true });
    await w.tick();
    f.c.down = true;
    now += 2000;
    await w.tick();
    expect(w.snapshot.state).toBe("live");
    now += 4000;
    await w.tick();
    expect(w.snapshot.state).toBe("stalled");
    expect(w.snapshot.error).toMatch(/No testnet RPC answered/);
    f.steal("DURING_STALL");
    f.c.height += 30;
    f.c.down = false;
    await w.tick();
    await settle();
    expect(w.snapshot.state).toBe("live");
    expect(f.freezes.map((x) => x.args.tx_hash)).toEqual(["DURING_STALL"]);
  });

  it("offline when the browser says so", async () => {
    const f = fakeChain();
    let now = 0;
    const w = new TabWatcher({ rpc: f.rpc, bait: BAIT, admin: ADMIN, freezer: f.freezer, now: () => now, stallMs: 100, online: () => false });
    await w.tick();
    f.c.down = true;
    now = 500;
    await w.tick();
    expect(w.snapshot.state).toBe("offline");
  });

  it("seenHeight resolves only after a read at or past the given block", async () => {
    const f = fakeChain();
    const w = new TabWatcher({ rpc: f.rpc, bait: BAIT, admin: ADMIN, freezer: f.freezer });
    w.start();
    const p = w.seenHeight(103, 5000);
    f.c.height = 103;
    await expect(p).resolves.toBeGreaterThanOrEqual(103);
    w.stop();
  });

  it("a watcher key missing on chain stops it with a readable error", async () => {
    const f = fakeChain();
    const w = new TabWatcher({ rpc: f.rpc, bait: BAIT, admin: ADMIN, freezer: f.freezer, prepare: async () => { throw new ChainAnswer("UNKNOWN_ACCESS_KEY", "x"); } });
    w.start();
    await settle();
    expect(w.snapshot.state).toBe("error");
    expect(w.snapshot.error).toMatch(/watcher key/);
  });
});

describe("helpers", () => {
  it("classifies chain answers", () => {
    expect(chainKind('{"cause":{"name":"UNKNOWN_BLOCK"}}')).toBe("UNKNOWN_BLOCK");
    expect(chainKind("access key ed25519:abc does not exist while viewing")).toBe("UNKNOWN_ACCESS_KEY");
    expect(chainKind("rate limited")).toBeNull();
  });
  it("a thief's implicit account is the hex of its public key", () => {
    expect(implicitAccountOf("ed25519:11111111111111111111111111111111")).toBe("00".repeat(32));
    expect(implicitAccountOf("ed25519:DzEhdSDEPbXBkv2J1kNNoPPgkw7G6dkK98c1t5JhuLJ3")).toMatch(/^[0-9a-f]{64}$/);
  });
});
