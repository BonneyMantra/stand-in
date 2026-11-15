import { heightsBetween, usesIn, type KeyUse, type RawChange } from "./detect";
import { ChainAnswer, sleep, type Rpc } from "./rpc";

/**
 * The CLI watcher's rule (detect.ts usesIn) over every block after `from` up to `to`: which bait keys signed a transaction,
 * and which transaction. `find(pk)` resolves the moment the block holding that key's use has been read, so a freeze waits
 * only as long as its own theft takes to read, not for the whole range.
 */
export class BlockScan {
  readonly all: Promise<KeyUse[]>;
  private found: KeyUse[] = [];
  private done = false;
  private waiters: { pk: string; resolve: (u: KeyUse | null) => void }[] = [];
  private rpc: Rpc;
  private bait: string;
  private admin: string;

  constructor(rpc: Rpc, bait: string, admin: string, from: number, to: number) {
    this.rpc = rpc;
    this.bait = bait;
    this.admin = admin;
    this.all = this.run(heightsBetween(from, to, 60));
  }

  /** The first use of `pk` in the range, or null once every block was read without one. */
  find(pk: string): Promise<KeyUse | null> {
    const hit = this.found.find((u) => u.public_key === pk);
    if (hit || this.done) return Promise.resolve(hit ?? null);
    return new Promise((resolve) => this.waiters.push({ pk, resolve }));
  }

  private async run(heights: number[]): Promise<KeyUse[]> {
    for (let i = 0; i < heights.length; i += 8) {
      await Promise.all(heights.slice(i, i + 8).map(async (h) => {
        const uses = await this.changesAt(h);
        this.found.push(...uses);
        this.waiters = this.waiters.filter((w) => {
          const u = uses.find((x) => x.public_key === w.pk);
          if (u) w.resolve(u);
          return !u;
        });
      }));
    }
    this.done = true;
    for (const w of this.waiters) w.resolve(null);
    this.waiters = [];
    return this.found;
  }

  /**
   * One block's key changes, hedged across endpoints. A balanced public endpoint can route to a node that has not seen the
   * newest block yet, which answers UNKNOWN_BLOCK, so that answer is asked again a few times before the height counts as
   * skipped (no block was produced at it).
   */
  private async changesAt(height: number): Promise<KeyUse[]> {
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const r = await this.rpc.callAt<{ changes: RawChange[] }>("EXPERIMENTAL_changes", { changes_type: "all_access_key_changes", account_ids: [this.bait], block_id: height });
        return usesIn(r.result.changes ?? [], height, this.admin);
      } catch (e) {
        if (e instanceof ChainAnswer && e.kind !== "UNKNOWN_BLOCK") return [];
        await sleep(e instanceof ChainAnswer ? 100 : 200);
      }
    }
    return [];
  }
}
