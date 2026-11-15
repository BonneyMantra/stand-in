import { useCallback, useRef, useState, type RefObject } from "react";
import type { NearWalletBase } from "@hot-labs/near-connect";
import { BatchStopped, readableError, type TxOutcome } from "@/lib/wallet/connector";
import type { TxEntry } from "./ActivityLog";

type Send<T> = (wallet: NearWalletBase, accountId: string) => Promise<T>;
const LANDED = "Landed on testnet. State read again from chain.";

/**
 * The owner console's wallet requests and their log. A missing answer is never read as "nothing was sent": the wallet may
 * have broadcast first (Meteor Web reported "Cannot read properties of undefined" after create_guardian had landed, 15 Nov),
 * so every part without an answer is looked up on chain before it is reported.
 */
export function useOwnerTx(wallet: RefObject<NearWalletBase | null>, accountId: string | null, refresh: () => Promise<void>) {
  const [log, setLog] = useState<TxEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const nextId = useRef(1);
  const add = (label: string) => {
    const id = nextId.current++;
    setLog((l) => [{ id, label, status: "pending", message: "Confirm in your wallet", at: Date.now() }, ...l]);
    return id;
  };
  const patch = (id: number, p: Partial<TxEntry>) => setLog((l) => l.map((e) => (e.id === id ? { ...e, ...p } : e)));

  const run = useCallback(async (label: string, send: Send<TxOutcome>, landed?: () => Promise<boolean>) => {
    const w = wallet.current;
    if (!w || !accountId) return null;
    const id = add(label);
    setBusy(true);
    try {
      const out = await send(w, accountId);
      if (out.failure) patch(id, { status: "failed", hash: out.hash || undefined, message: readableError(out.failure) });
      else patch(id, { status: "ok", hash: out.hash, message: LANDED });
      return out.failure ? null : out;
    } catch (e) {
      const msg = readableError(e);
      const rejected = /rejected in the wallet/.test(msg);
      const onChain = !rejected && landed ? await landed().catch(() => false) : false;
      if (onChain) patch(id, { status: "ok", message: "Landed on testnet: the wallet gave no result, so this was confirmed by reading the chain." });
      else patch(id, { status: "failed", message: rejected || !landed ? msg : `${msg} Nothing new was found on chain.` });
      return onChain ? { hash: "" } : null;
    } finally {
      setBusy(false);
      await refresh();
    }
  }, [wallet, accountId, refresh]);

  /**
   * Several transactions in one wallet request, one log row each. Parts the wallet answered are reported as answered; every
   * other part is read from chain, so a partly landed request shows exactly what landed. Returns each part's outcome.
   */
  const runBatch = useCallback(async (labels: string[], send: Send<TxOutcome[]>, landed: (() => Promise<boolean>)[]) => {
    const w = wallet.current;
    if (!w || !accountId) return labels.map(() => null);
    const ids = [...labels].reverse().map(add).reverse();
    setBusy(true);
    let outs: TxOutcome[] = [];
    let error: unknown = null;
    try {
      outs = await send(w, accountId);
    } catch (e) {
      error = e;
      if (e instanceof BatchStopped) outs = e.done;
    }
    const msg = error ? readableError(error instanceof BatchStopped ? error.reason : error) : "";
    // Per part, a rejection only speaks for that part: earlier ones in the same request may have landed.
    const why = /rejected in the wallet/.test(msg) ? "Rejected in the wallet." : msg;
    const result: (TxOutcome | null)[] = [];
    for (let i = 0; i < labels.length; i++) {
      const o = outs[i];
      if (o) {
        patch(ids[i]!, o.failure ? { status: "failed", hash: o.hash || undefined, message: readableError(o.failure) } : { status: "ok", hash: o.hash, message: LANDED });
        result.push(o.failure ? null : o);
        continue;
      }
      const on = await landed[i]!().catch(() => false);
      if (on) patch(ids[i]!, { status: "ok", message: "Landed on testnet: confirmed by reading the chain (the wallet gave no result for it)." });
      else patch(ids[i]!, { status: "failed", message: error ? `${why} Not on chain.` : "The wallet did not send this one. Not on chain." });
      result.push(on ? { hash: "" } : null);
    }
    setBusy(false);
    await refresh();
    return result;
  }, [wallet, accountId, refresh]);

  const reset = useCallback(() => setLog([]), []);
  return { log, busy, run, runBatch, reset };
}
