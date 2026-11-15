import { useCallback, useEffect, useRef, useState } from "react";
import { readActivity, type ActivityTx } from "./activity";

export type ActivityRead = { status: "idle" | "loading" } | { status: "error"; error: string; txs: ActivityTx[] } | { status: "ready"; txs: ActivityTx[] };

/**
 * Transactions on `accounts` from the nearblocks indexer, merged newest first. Read one account at a time (the indexer
 * rate-limits), again when `key` changes; an account that fails keeps the others.
 */
export function useActivity(accounts: string[], key = 0) {
  const [read, setRead] = useState<ActivityRead>({ status: "idle" });
  const seq = useRef(0);
  const ids = accounts.join(",");
  const load = useCallback(async (fresh: boolean) => {
    const list = ids ? ids.split(",") : [];
    if (!list.length) { setRead({ status: "ready", txs: [] }); return; }
    const n = ++seq.current;
    setRead((r) => (r.status === "ready" ? r : { status: "loading" }));
    const all = new Map<string, ActivityTx>();
    let error = "";
    for (const id of list) {
      try {
        for (const t of await readActivity(id, { fresh })) all.set(t.hash, t);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
    }
    if (n !== seq.current) return;
    const txs = [...all.values()].sort((a, b) => b.block - a.block);
    setRead(error && !txs.length ? { status: "error", error, txs } : error ? { status: "error", error, txs } : { status: "ready", txs });
  }, [ids]);
  useEffect(() => { void load(key > 0); }, [load, key]);
  return { read, reload: () => load(true) };
}

export const activityTxs = (r: ActivityRead): ActivityTx[] => (r.status === "ready" || r.status === "error" ? r.txs : []);
