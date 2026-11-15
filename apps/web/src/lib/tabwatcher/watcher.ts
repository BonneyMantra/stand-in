import { diffSnapshots, freezeArgs, heightsBetween, missingSnapshot, snapshotOf, tripId, usesIn, type KeyUse, type RawChange, type RawKeyList, type Snapshot, type Trip } from "./detect";
import type { FreezeResult, Freezer } from "./freezer";
import { ChainAnswer, RpcDown, sleep, type Rpc } from "./rpc";

export type WatchState = "starting" | "live" | "stalled" | "offline" | "stopped" | "error";

export interface WatchTrip extends Trip {
  freezes: FreezeResult[];
}

export interface WatchStatus {
  state: WatchState;
  bait: string;
  targets: string[];
  /** Height of the last successful read of the bait's keys. */
  lastBlock: number | null;
  lastOkAt: number | null;
  /** Height of the first read: anything signed after it is caught. */
  armedAt: number | null;
  startedAt: number | null;
  endpoint: string | null;
  /** stalled/offline: the last RPC failure; error: why the watcher cannot run. */
  error: string | null;
  checks: number;
  trips: WatchTrip[];
}

export interface WatcherOpts {
  rpc: Rpc;
  bait: string;
  /** The bait's own key (plants and deletes decoys): never a theft. */
  admin: string;
  freezer: Freezer;
  intervalMs?: number;
  stallMs?: number;
  now?: () => number;
  online?: () => boolean;
  /** Runs before the first read (the freezer's warm-up). A chain answer (missing key or account) stops the watcher. */
  prepare?: () => Promise<void>;
}

/** How long a freeze waits for the changes scan to name the theft's transaction before it goes without it. */
const SCAN_GRACE_MS = 450;

/**
 * The in-tab watcher. Every tick reads the bait's key list once; a nonce that grew (detect.ts) is a theft and freezes every
 * guardian this watcher key may freeze. It only watches while this tab runs: closing or freezing the tab stops it, which is
 * why the CLI watcher (`standin dev up --home DIR`) exists for always-on protection.
 */
export class TabWatcher {
  private status: WatchStatus;
  private prev: Snapshot | null = null;
  private running = false;
  private seen = new Set<string>();
  private listeners = new Set<(s: WatchStatus) => void>();
  private tripListeners = new Set<(t: WatchTrip) => void>();
  private readonly now: () => number;

  private o: WatcherOpts;

  constructor(o: WatcherOpts) {
    this.o = o;
    this.now = o.now ?? Date.now;
    this.status = { state: "stopped", bait: o.bait, targets: o.freezer.targets, lastBlock: null, lastOkAt: null, armedAt: null, startedAt: null, endpoint: null, error: null, checks: 0, trips: [] };
  }

  get snapshot(): WatchStatus {
    return this.status;
  }

  subscribe(fn: (s: WatchStatus) => void): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  onTrip(fn: (t: WatchTrip) => void): () => void {
    this.tripListeners.add(fn);
    return () => this.tripListeners.delete(fn);
  }

  private set(p: Partial<WatchStatus>) {
    this.status = { ...this.status, ...p };
    for (const fn of this.listeners) fn(this.status);
  }

  /** Starts the loop (idempotent); the status says when it is armed (`live`) or why it cannot run (`error`). */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.prev = null;
    this.set({ state: "starting", startedAt: this.now(), armedAt: null, error: null });
    void this.loop();
  }

  stop(): void {
    this.running = false;
    this.set({ state: "stopped" });
  }

  get isRunning() {
    return this.running;
  }

  /** Resolves when a read at or after `height` has been compared (the watcher has seen that block's state). */
  async seenHeight(height: number, timeoutMs = 30_000): Promise<number> {
    const until = this.now() + timeoutMs;
    while (this.now() < until) {
      if (this.status.state === "error" || this.status.state === "stopped") throw new Error(this.status.error ?? "the tab watcher stopped");
      if (this.prev && this.prev.height >= height) return this.prev.height;
      await sleep(100);
    }
    throw new RpcDown(`the tab watcher did not read block ${height} within ${timeoutMs / 1000} s`);
  }

  private async loop() {
    const interval = this.o.intervalMs ?? 500;
    while (this.running && this.o.prepare) {
      try {
        await this.o.prepare();
        break;
      } catch (e) {
        if (e instanceof ChainAnswer) {
          this.running = false;
          this.set({ state: "error", error: e.kind === "UNKNOWN_ACCESS_KEY" ? "The watcher key in this browser is not on the watcher account." : e.kind === "UNKNOWN_ACCOUNT" ? "The watcher account does not exist on testnet yet." : e.message });
          return;
        }
        const since = this.status.startedAt ?? this.now();
        if (this.now() - since >= (this.o.stallMs ?? 6000)) this.set({ state: this.o.online?.() === false ? "offline" : "stalled", error: e instanceof Error ? e.message : String(e) });
        await sleep(interval * 2);
      }
    }
    while (this.running) {
      await this.tick();
      if (!this.running) break;
      await sleep(interval);
    }
  }

  /** One read and comparison. Public for tests. */
  async tick(): Promise<void> {
    const stallMs = this.o.stallMs ?? 6000;
    let snap: Snapshot;
    let endpoint: string;
    try {
      const r = await this.readKeys();
      snap = r.snap;
      endpoint = r.endpoint;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const since = this.status.lastOkAt ?? this.status.startedAt ?? this.now();
      if (this.now() - since >= stallMs) this.set({ state: this.o.online?.() === false ? "offline" : "stalled", error: msg });
      return;
    }
    const checks = this.status.checks + 1;
    const lastBlock = Math.max(this.status.lastBlock ?? 0, snap.height);
    if (!this.prev) {
      this.prev = snap;
      this.set({ state: "live", armedAt: snap.height, lastBlock, lastOkAt: this.now(), endpoint, error: null, checks });
      return;
    }
    const a = this.prev;
    const d = diffSnapshots(a, snap, this.o.admin);
    this.set({ state: "live", lastBlock, lastOkAt: this.now(), endpoint, error: null, checks });
    if (!d) return; // a node behind the last read: nothing is concluded from it
    this.prev = snap;
    if (!d.used.length && !d.suspects.length) return;
    const scan = this.scan(a.height, snap.height, endpoint);
    for (const pk of d.used) void this.trip(pk, snap, "key state", scan);
    if (d.suspects.length) {
      const uses = await scan.catch(() => [] as KeyUse[]);
      for (const u of uses) if (d.suspects.includes(u.public_key)) void this.trip(u.public_key, snap, "changes", Promise.resolve(uses));
    }
  }

  private async readKeys(): Promise<{ snap: Snapshot; endpoint: string }> {
    try {
      const r = await this.o.rpc.callAt<RawKeyList>("query", { request_type: "view_access_key_list", finality: "optimistic", account_id: this.o.bait });
      return { snap: snapshotOf(r.result), endpoint: r.endpoint };
    } catch (e) {
      if (!(e instanceof ChainAnswer && e.kind === "UNKNOWN_ACCOUNT")) throw e;
      const b = await this.o.rpc.callAt<{ header: { height: number; hash: string } }>("block", { finality: "optimistic" });
      return { snap: missingSnapshot(b.result.header.height, b.result.header.hash), endpoint: b.endpoint };
    }
  }

  /** The CLI's rule over every block after `from` up to `to`, read from the node that served the key list. */
  private async scan(from: number, to: number, endpoint: string): Promise<KeyUse[]> {
    const heights = heightsBetween(from, to, 60);
    const out: KeyUse[] = [];
    for (let i = 0; i < heights.length; i += 8) {
      const batch = heights.slice(i, i + 8);
      const found = await Promise.all(batch.map((h) => this.changesAt(h, endpoint)));
      for (const f of found) out.push(...f);
    }
    return out;
  }

  /**
   * One block's key changes. A public endpoint balances over several nodes, and one that has not seen the newest block yet
   * answers UNKNOWN_BLOCK, so that answer is asked again a few times (any endpoint) before the height counts as skipped.
   */
  private async changesAt(height: number, endpoint: string): Promise<KeyUse[]> {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const r = await this.o.rpc.callAt<{ changes: RawChange[] }>(
          "EXPERIMENTAL_changes", { changes_type: "all_access_key_changes", account_ids: [this.o.bait], block_id: height }, attempt === 0 ? endpoint : undefined,
        );
        return usesIn(r.result.changes ?? [], height, this.o.admin);
      } catch (e) {
        if (e instanceof ChainAnswer && e.kind !== "UNKNOWN_BLOCK") return [];
        await sleep(e instanceof ChainAnswer ? 100 : 200);
      }
    }
    return []; // a skipped height (no block was produced at it), or no node answered
  }

  private async trip(pk: string, snap: Snapshot, via: Trip["via"], scan: Promise<KeyUse[]>) {
    const t0 = this.now();
    // Wait briefly for the transaction hash so the guardian's freeze log links the theft; never longer than SCAN_GRACE_MS.
    const early = await Promise.race([scan.catch(() => [] as KeyUse[]), sleep(SCAN_GRACE_MS).then(() => null)]);
    const use = early?.find((u) => u.public_key === pk) ?? null;
    const id = tripId(pk, snap.keys.get(pk), use?.tx_hash ?? null);
    if (this.seen.has(id) || (use?.tx_hash && this.seen.has(tripId(pk, snap.keys.get(pk), null)))) return;
    this.seen.add(id);
    this.seen.add(tripId(pk, snap.keys.get(pk), null));
    const trip: WatchTrip = {
      id, public_key: pk, tx_hash: use?.tx_hash ?? null, theft_block: use?.height ?? null,
      detected_at_block: snap.height, detected_at: t0, via, freezes: this.status.targets.map((g) => ({ guardian: g, status: "sending" as const })),
    };
    const put = (p: Partial<WatchTrip>) => {
      Object.assign(trip, p);
      this.set({ trips: [{ ...trip }, ...this.status.trips.filter((x) => x.id !== trip.id)].slice(0, 20) });
      for (const fn of this.tripListeners) fn({ ...trip });
    };
    put({});
    const args = freezeArgs(trip, this.o.bait);
    const results = this.status.targets.map((g, i) =>
      this.o.freezer.freeze(g, args, (r) => put({ freezes: trip.freezes.map((f, j) => (j === i ? r : f)) })).then((r) => {
        put({ freezes: trip.freezes.map((f, j) => (j === i ? r : f)) });
        return r;
      }),
    );
    // The scan finishes in the background and fills in the theft's transaction and block for the trace.
    if (!use) {
      void scan.then((uses) => {
        const u = uses.find((x) => x.public_key === pk);
        if (u) put({ tx_hash: u.tx_hash, theft_block: u.height });
      }).catch(() => undefined);
    }
    await Promise.all(results);
  }
}
