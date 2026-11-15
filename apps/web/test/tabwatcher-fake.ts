// A scripted chain for the tab watcher's tests (imported by tabwatcher-*.test.ts; not a test file itself).
import { ChainAnswer, RpcDown, type Rpc } from "../src/lib/tabwatcher/rpc.ts";
import type { FreezeResult, Freezer } from "../src/lib/tabwatcher/freezer.ts";

export const ADMIN = "ed25519:Admin1111111111111111111111111111111111111111";
export const DECOY = "ed25519:Decoy1111111111111111111111111111111111111111";
export const OTHER = "ed25519:Other1111111111111111111111111111111111111111";
export const BAIT = "deployer.owner-qa.testnet";
export const GUARD = "owner-qa.testnet";

/** NEAR gives a new key the nonce (height - 1) * 10^6. */
export const fresh = (h: number) => BigInt(h - 1) * 1_000_000n;
export const settle = (ms = 450) => new Promise((r) => setTimeout(r, ms));

/**
 * Key-list reads and per-block changes, with switches: `down` (no node answers), `changesDelayMs` (every block read is
 * that slow, like a busy page or a far node), `changesDown` (block reads never answer).
 */
export function fakeChain() {
  const c = {
    height: 100,
    keys: new Map<string, bigint>([[ADMIN, 50n], [DECOY, fresh(90)]]),
    changes: new Map<number, unknown[]>(),
    down: false,
    changesDelayMs: 0,
    changesDown: false,
    reads: 0,
  };
  const rpc: Rpc = {
    async callAt<T>(method: string, params: unknown) {
      if (c.down) throw new RpcDown("No testnet RPC answered (last: test)");
      const p = params as { block_id?: number };
      if (method === "query") {
        c.reads++;
        return { result: { block_height: c.height, block_hash: `h${c.height}`, keys: [...c.keys].map(([public_key, n]) => ({ public_key, access_key: { nonce: String(n) } })) } as T, endpoint: "https://test" };
      }
      if (method === "EXPERIMENTAL_changes") {
        if (c.changesDown) throw new RpcDown("No testnet RPC answered (last: test)");
        if (c.changesDelayMs) await settle(c.changesDelayMs);
        if (p.block_id! > c.height) throw new ChainAnswer("UNKNOWN_BLOCK", "UNKNOWN_BLOCK");
        return { result: { changes: c.changes.get(p.block_id!) ?? [] } as T, endpoint: "https://test" };
      }
      throw new Error(`unexpected ${method}`);
    },
    async call<T>(method: string, params: unknown) {
      return (await this.callAt<T>(method, params)).result;
    },
  };
  const freezes: { guardian: string; args: { tx_hash: string | null; decoy_public_key: string }; at: number }[] = [];
  const freezer: Freezer = {
    targets: [GUARD],
    frozen: async () => false,
    freeze: async (guardian, args) => {
      freezes.push({ guardian, args, at: Date.now() });
      const r: FreezeResult = { guardian, status: "landed", tx_hash: "FREEZE", block: c.height + 2 };
      return r;
    },
  };
  /** The decoy signs a transaction included at the next height. */
  const steal = (hash = "THEFT") => {
    c.height += 1;
    c.keys.set(DECOY, c.keys.get(DECOY)! + 1n);
    c.changes.set(c.height, [{ type: "access_key_update", cause: { type: "transaction_processing", tx_hash: hash }, change: { public_key: DECOY } }]);
  };
  return { c, rpc, freezer, freezes, steal };
}
