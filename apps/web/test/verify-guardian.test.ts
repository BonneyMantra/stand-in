import { describe, expect, it } from "vitest";
import { baitOf, findTheftTx } from "../src/lib/verify/guardian.ts";
import { ChainAnswer, type Rpc } from "../src/lib/tabwatcher/rpc.ts";

const DECOY = "ed25519:DihP5ngfsmvXcyVf6443KJaDWVgQQXKWKHfB8867jwDB";

/** Per height: the bait's key changes; a missing height answers UNKNOWN_BLOCK (a node without that block). */
function chain(byHeight: Record<number, unknown[]>, missing: number[] = []): Rpc {
  return {
    async callAt<T>(_m: string, params: unknown) {
      const h = (params as { block_id: number }).block_id;
      if (missing.includes(h)) throw new ChainAnswer("UNKNOWN_BLOCK", "UNKNOWN_BLOCK");
      return { result: { changes: byHeight[h] ?? [] } as T, endpoint: "x" };
    },
    async call<T>(m: string, p: unknown) { return (await this.callAt<T>(m, p)).result; },
  };
}

describe("a freeze record without its theft hash: the theft is read back from the bait", () => {
  it("names the bait from a tab watcher's reason, else the owner's deployer account", () => {
    expect(baitOf("tab watcher: decoy key ed25519:X on deployer.judge-p2.stranger-qa-1115a.testnet signed a transaction", "o.testnet")).toBe("deployer.judge-p2.stranger-qa-1115a.testnet");
    expect(baitOf("decoy key ed25519:X signed a transaction (T); value to y", "alice.testnet")).toBe("deployer.alice.testnet");
  });

  it("finds the decoy's own transaction a few blocks before the freeze ran (judge-p2: theft at 277770416, freeze at 277770420)", async () => {
    const rpc = chain({
      277770416: [
        { type: "access_key_update", cause: { type: "transaction_processing", tx_hash: "2juYhJ6af6NA11WRn5LuLhwgaK6Y7o7gUj725d7XNRDq" }, change: { public_key: DECOY } },
      ],
      277770418: [{ type: "access_key_update", cause: { type: "transaction_processing", tx_hash: "ADMIN_TX" }, change: { public_key: "ed25519:Admin" } }],
    }, [277770417]);
    await expect(findTheftTx("deployer.judge-p2.stranger-qa-1115a.testnet", DECOY, 277770420, rpc)).resolves.toEqual({ hash: "2juYhJ6af6NA11WRn5LuLhwgaK6Y7o7gUj725d7XNRDq", block: 277770416 });
  });

  it("a receipt-made change (AddKey) is not the theft, and nothing found is null", async () => {
    const rpc = chain({ 99: [{ type: "access_key_update", cause: { type: "receipt_processing" }, change: { public_key: DECOY } }] });
    await expect(findTheftTx("deployer.a.testnet", DECOY, 100, rpc, 5)).resolves.toBeNull();
  });
});
