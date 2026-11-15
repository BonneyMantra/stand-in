import { useCallback, useState, type RefObject } from "react";
import type { NearWalletBase } from "@hot-labs/near-connect";
import { readableError, sendUnfreeze } from "@/lib/wallet/connector";
import { readGuardian } from "@/lib/wallet/near";
import { recordHomeTx } from "@/lib/wallet/homeStore";
import { sleep } from "@/lib/tabwatcher/rpc";

export interface WalletResult { label: string; status: "pending" | "ok" | "failed"; hash?: string; message?: string }

/** Is `guardian` active on chain? Read twice, 3 s apart: a node can lag the block that just unfroze it. */
async function readsActive(guardian: string): Promise<boolean> {
  for (let i = 0; i < 2; i++) {
    const r = await readGuardian(guardian).catch(() => null);
    if (r?.kind === "guardian" && !r.state.frozen) return true;
    if (i === 0) await sleep(3000);
  }
  return false;
}

/**
 * The lab's Unfreeze: the owner console's shared `sendUnfreeze` in the owner's own wallet, then the guardian read back from
 * chain. A wallet that gives no answer is never reported as "nothing was sent": the chain is read first.
 */
export function useUnfreeze(wallet: RefObject<NearWalletBase | null>, owner: string | null, onDone: () => void) {
  const [last, setLast] = useState<WalletResult | null>(null);
  const [busy, setBusy] = useState(false);

  const unfreeze = useCallback(async (guardian: string) => {
    const w = wallet.current;
    if (!w || !owner) return;
    setBusy(true);
    setLast({ label: "unfreeze", status: "pending", message: "Confirm in your wallet" });
    try {
      const out = await sendUnfreeze(w, owner, guardian);
      if (out.failure) {
        setLast({ label: "unfreeze", status: "failed", hash: out.hash || undefined, message: readableError(out.failure) });
      } else {
        if (out.hash) recordHomeTx(owner, { hash: out.hash, label: "lab run: unfreeze (wallet)", at: Date.now() });
        const active = await readsActive(guardian);
        setLast({ label: "unfreeze", status: "ok", hash: out.hash, message: active ? "Landed; read back from chain: frozen false." : "Landed; the chain does not show it unfrozen yet. Read it again in a moment." });
      }
    } catch (e) {
      const msg = readableError(e);
      const landed = !/rejected in the wallet/.test(msg) && (await readsActive(guardian));
      setLast(landed
        ? { label: "unfreeze", status: "ok", message: "Landed: the wallet gave no result, so this was confirmed by reading the chain." }
        : { label: "unfreeze", status: "failed", message: msg });
    } finally {
      setBusy(false);
      onDone();
    }
  }, [wallet, owner, onDone]);

  return { unfreeze, busy, last };
}
