import { act, type KeySigner } from "./sign";
import { blockHeight, ChainAnswer, RpcDown, viewAccount, viewFunction, waitExecuted, type Rpc } from "./rpc";
import { firstFailure } from "../wallet/localSigner";

/** What the tab watcher did about one guardian for one trip. */
export interface FreezeResult {
  guardian: string;
  status: "sending" | "sent" | "landed" | "failed" | "skipped";
  tx_hash?: string;
  /** The block that included the freeze transaction. */
  block?: number;
  /** When it was broadcast (ms). */
  sent_at?: number;
  error?: string;
}

export interface GuardianInfo {
  frozen: boolean;
  watcher: string;
  owner: string;
}

/** The freeze path, behind one interface so the watcher's tests can replace it. */
export interface Freezer {
  /** Guardians this watcher key may freeze (checked against chain at start). */
  readonly targets: string[];
  frozen(guardian: string): Promise<boolean>;
  freeze(guardian: string, args: { reason: string; decoy_public_key: string; tx_hash: string | null }, update: (r: FreezeResult) => void): Promise<FreezeResult>;
}

export async function readGuardianInfo(rpc: Rpc, guardian: string): Promise<GuardianInfo> {
  return viewFunction<GuardianInfo>(rpc, guardian, "get_state");
}

/**
 * Freezes with the browser-held watcher key: `freeze` on the guardian, 100 TGas, deposit 0 (the guardian's own call; a
 * browser-made watcher key is a function-call key that may only call exactly this). At most one freeze per guardian is in
 * flight; a guardian already frozen on chain is skipped, never frozen twice.
 */
export class WatcherFreezer implements Freezer {
  private cache = new Map<string, { frozen: boolean; at: number }>();
  private inflight = new Map<string, Promise<FreezeResult>>();

  private rpc: Rpc;
  private signer: KeySigner;
  readonly targets: string[];

  constructor(rpc: Rpc, signer: KeySigner, targets: string[]) {
    this.rpc = rpc;
    this.signer = signer;
    this.targets = targets;
  }

  async frozen(guardian: string): Promise<boolean> {
    const c = this.cache.get(guardian);
    if (c && Date.now() - c.at < 10_000) return c.frozen;
    const s = await readGuardianInfo(this.rpc, guardian);
    this.cache.set(guardian, { frozen: s.frozen, at: Date.now() });
    return s.frozen;
  }

  /** Keeps the nonce and block hash fresh so a freeze is one signature and one broadcast. */
  async warm(): Promise<void> {
    try {
      await this.signer.warm();
    } catch (e) {
      // view_access_key says "access key … does not exist" for a missing account too: tell the two apart.
      if (e instanceof ChainAnswer && e.kind === "UNKNOWN_ACCESS_KEY" && !(await viewAccount(this.rpc, this.signer.accountId))) {
        throw new ChainAnswer("UNKNOWN_ACCOUNT", `${this.signer.accountId} does not exist`);
      }
      throw e;
    }
    await Promise.all(this.targets.map((g) => this.frozen(g).catch(() => false)));
  }

  freeze(guardian: string, args: { reason: string; decoy_public_key: string; tx_hash: string | null }, update: (r: FreezeResult) => void): Promise<FreezeResult> {
    const running = this.inflight.get(guardian);
    if (running) return running;
    const p = this.run(guardian, args, update).finally(() => this.inflight.delete(guardian));
    this.inflight.set(guardian, p);
    return p;
  }

  private async run(guardian: string, args: { reason: string; decoy_public_key: string; tx_hash: string | null }, update: (r: FreezeResult) => void): Promise<FreezeResult> {
    // "Not frozen" is trusted from the cache, so the common path costs no extra read (a stale one only costs a refused second
    // freeze). "Frozen" is read again from chain first: the owner may have unfrozen since, and skipping then would be the
    // one mistake a watcher must not make.
    if (this.cache.get(guardian)?.frozen) {
      this.cache.delete(guardian);
      const now = await this.frozen(guardian).catch(() => false);
      if (now) return { guardian, status: "skipped", error: "already frozen" };
    }
    update({ guardian, status: "sending" });
    let hash: string;
    try {
      hash = await this.signer.broadcast(guardian, [act.call("freeze", args, 100n)]);
    } catch (e) {
      return { guardian, status: "failed", error: describe(e) };
    }
    const sent_at = Date.now();
    this.cache.set(guardian, { frozen: true, at: sent_at });
    update({ guardian, status: "sent", tx_hash: hash, sent_at });
    try {
      const t = await waitExecuted(this.rpc, hash, this.signer.accountId, 60_000);
      const block = await blockHeight(this.rpc, t.transaction_outcome.block_hash);
      const failure = firstFailure(t as Parameters<typeof firstFailure>[0]);
      if (failure) {
        this.cache.delete(guardian);
        const already = /already frozen/.test(failure);
        return { guardian, status: already ? "skipped" : "failed", tx_hash: hash, block, sent_at, error: already ? "already frozen (another watcher was first)" : failure };
      }
      return { guardian, status: "landed", tx_hash: hash, block, sent_at };
    } catch (e) {
      return { guardian, status: "failed", tx_hash: hash, sent_at, error: describe(e) };
    }
  }
}

export function describe(e: unknown): string {
  if (e instanceof ChainAnswer) {
    if (e.kind === "UNKNOWN_ACCESS_KEY") return "the watcher key is not on the watcher account";
    if (/NotEnoughBalance|LackBalanceForState/.test(e.message)) return "the watcher account cannot pay the freeze's gas (100 TGas up front)";
    if (/DepositWithFunctionCall|ReceiverMismatch|MethodNameMismatch|NotEnoughAllowance/.test(e.message)) return `the watcher key may not sign this (${e.message.match(/DepositWithFunctionCall|ReceiverMismatch|MethodNameMismatch|NotEnoughAllowance/)?.[0]})`;
    return e.message.slice(0, 200);
  }
  if (e instanceof RpcDown) return e.message;
  return e instanceof Error ? e.message.slice(0, 200) : String(e);
}
