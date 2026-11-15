import { describe, expect, it } from "vitest";
import { ChainAnswer, type Rpc } from "../src/lib/tabwatcher/rpc.ts";
import { TX_WAIT_MS, TabWatcher } from "../src/lib/tabwatcher/watcher.ts";
import { WatcherFreezer } from "../src/lib/tabwatcher/freezer.ts";
import { ADMIN, BAIT, DECOY, GUARD, fakeChain, settle } from "./tabwatcher-fake.ts";

/**
 * The guardian's freeze record is what My account and /verify show, so the freeze must carry the theft's transaction.
 * Live (15 Nov, judge-p2, freeze at block 277770420): the record had the decoy key and no tx_hash, because the freeze waited
 * a fixed 450 ms for the block read that names the transaction and that read was slower.
 */
describe("the freeze record names the theft", () => {
  it("waits for a slow block read (700 ms, slower than the old fixed 450 ms)", async () => {
    const f = fakeChain();
    f.c.changesDelayMs = 700;
    const w = new TabWatcher({ rpc: f.rpc, bait: BAIT, admin: ADMIN, freezer: f.freezer });
    await w.tick();
    f.steal("SLOW_READ");
    await w.tick();
    await settle(1200);
    expect(f.freezes.map((x) => x.args.tx_hash)).toEqual(["SLOW_READ"]);
  });

  it("asks again when a node has not seen the theft's block yet (UNKNOWN_BLOCK twice)", async () => {
    const f = fakeChain();
    let refusals = 2;
    const inner = f.rpc.callAt.bind(f.rpc);
    f.rpc.callAt = async <T,>(method: string, params: unknown, endpoint?: string) => {
      if (method === "EXPERIMENTAL_changes" && refusals > 0) { refusals--; throw new ChainAnswer("UNKNOWN_BLOCK", "UNKNOWN_BLOCK"); }
      return inner<T>(method, params, endpoint);
    };
    const w = new TabWatcher({ rpc: f.rpc, bait: BAIT, admin: ADMIN, freezer: f.freezer });
    await w.tick();
    f.steal("LAGGING_NODE");
    await w.tick();
    await settle(800);
    expect(f.freezes.map((x) => x.args.tx_hash)).toEqual(["LAGGING_NODE"]);
  });

  it("does not hold the freeze when the read is quick", async () => {
    const f = fakeChain();
    const w = new TabWatcher({ rpc: f.rpc, bait: BAIT, admin: ADMIN, freezer: f.freezer });
    await w.tick();
    f.steal();
    const t0 = Date.now();
    await w.tick();
    await settle(300);
    expect(f.freezes).toHaveLength(1);
    expect(f.freezes[0]!.at - t0).toBeLessThan(150);
  });

  it("never waits longer than TX_WAIT_MS: with block reads down it freezes without the hash", async () => {
    const f = fakeChain();
    f.c.changesDown = true;
    const w = new TabWatcher({ rpc: f.rpc, bait: BAIT, admin: ADMIN, freezer: f.freezer });
    await w.tick();
    f.steal();
    const t0 = Date.now();
    await w.tick();
    await settle(TX_WAIT_MS + 300);
    expect(f.freezes).toHaveLength(1);
    expect(f.freezes[0]!.args.tx_hash).toBeNull();
    expect(f.freezes[0]!.at - t0).toBeLessThanOrEqual(TX_WAIT_MS + 100);
  });
});

describe("WatcherFreezer: a guardian unfrozen since the last freeze is frozen again", () => {
  it("re-reads a cached 'frozen' from chain before skipping", async () => {
    let chainFrozen = true;
    const sent: string[] = [];
    const rpc: Rpc = {
      async callAt<T>(method: string, params: unknown) {
        const p = params as { method_name?: string };
        if (method === "query" && p.method_name === "get_state") {
          const body = JSON.stringify({ frozen: chainFrozen, watcher: "w", owner: "o" });
          return { result: { result: [...new TextEncoder().encode(body)] } as T, endpoint: "x" };
        }
        if (method === "tx") return { result: { status: { SuccessValue: "" }, transaction: {}, transaction_outcome: { block_hash: "B" }, receipts_outcome: [] } as T, endpoint: "x" };
        if (method === "block") return { result: { header: { height: 7 } } as T, endpoint: "x" };
        throw new Error(method);
      },
      async call<T>(m: string, p: unknown) { return (await this.callAt<T>(m, p)).result; },
    };
    const signer = { accountId: "w", broadcast: async () => { sent.push("freeze"); return "H"; }, warm: async () => {} };
    const f = new WatcherFreezer(rpc, signer as never, [GUARD]);
    await f.warm();
    // frozen on chain: skipped, nothing sent
    expect((await f.freeze(GUARD, { reason: "r", decoy_public_key: DECOY, tx_hash: null }, () => {})).status).toBe("skipped");
    expect(sent).toHaveLength(0);
    // the owner unfreezes; the cache still says frozen, but the freezer reads chain again and freezes
    chainFrozen = false;
    (f as unknown as { cache: Map<string, { frozen: boolean; at: number }> }).cache.set(GUARD, { frozen: true, at: Date.now() });
    const r = await f.freeze(GUARD, { reason: "r", decoy_public_key: DECOY, tx_hash: null }, () => {});
    expect(sent).toEqual(["freeze"]);
    expect(r).toMatchObject({ status: "landed", tx_hash: "H", block: 7 });
  });
});
