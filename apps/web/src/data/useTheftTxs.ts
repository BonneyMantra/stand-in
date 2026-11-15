import { useEffect, useMemo, useRef, useState } from "react";
import { baitOf, findTheftTx } from "@/lib/verify/guardian";
import type { FreezeView } from "./accountDerive";

/** hash: the theft read back from the bait; none: not found in the blocks before the freeze; unreachable: RPC failed. */
export type TheftLookup = { status: "loading" } | { status: "found"; hash: string } | { status: "none" } | { status: "unreachable" };
export const freezeKey = (f: Pick<FreezeView, "guardian" | "at_block">) => `${f.guardian}@${f.at_block}`;

/**
 * Older freeze records name the decoy but carry no transaction hash (the freeze went out before the theft's block was
 * read). The theft is read back from the bait's key changes before the freeze block, the same lookup /verify uses
 * (lib/verify/guardian.ts findTheftTx), once per record.
 */
export function useTheftTxs(freezes: FreezeView[], owner: string | null): Record<string, TheftLookup> {
  const wanted = useMemo(
    () => (owner ? freezes.filter((f) => f.trip && !f.trip_tx && f.decoy_public_key) : []),
    [freezes, owner],
  );
  const [found, setFound] = useState<Record<string, TheftLookup>>({});
  // Records already answered (found or none) or being read are not read again on the next poll.
  const settled = useRef(new Set<string>());
  useEffect(() => {
    if (!owner) return;
    let alive = true;
    const todo = wanted.filter((f) => !settled.current.has(freezeKey(f)));
    for (const f of todo) settled.current.add(freezeKey(f));
    (async () => {
      for (const f of todo) {
        const k = freezeKey(f);
        setFound((m) => ({ ...m, [k]: { status: "loading" } }));
        try {
          const t = await findTheftTx(baitOf(f.reason, owner), f.decoy_public_key!, Number(f.at_block));
          setFound((m) => ({ ...m, [k]: t ? { status: "found", hash: t.hash } : { status: "none" } }));
        } catch {
          settled.current.delete(k); // read again on the next poll
          if (alive) setFound((m) => ({ ...m, [k]: { status: "unreachable" } }));
        }
      }
    })();
    return () => { alive = false; };
  }, [wanted, owner]);
  return found;
}
