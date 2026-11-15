import { useEffect, useRef } from "react";
import { useNearWallet } from "@/components/owner/useNearWallet";
import { guardiansOf } from "@/lib/wallet/factory";
import { listHomeOwners, loadHome } from "@/lib/wallet/homeStore";
import { looksMainnet } from "@/lib/wallet/near";

/**
 * Pre-fills "Check any guardian" for a visitor who already has a session here: the guardians their browser home watches,
 * the factory guardians the connected wallet owns, then the connected account itself. Renders nothing.
 */
export default function VerifyPrefill({ onList }: { onList: (list: { id: string; why: string }[]) => void }) {
  const w = useNearWallet();
  const cb = useRef(onList);
  useEffect(() => {
    cb.current = onList;
  }, [onList]);
  useEffect(() => {
    if (w.status === "restoring" || w.status === "connecting") return;
    let alive = true;
    const me = w.status === "connected" && w.accountId && !looksMainnet(w.accountId) ? w.accountId : null;
    (async () => {
      const out: { id: string; why: string }[] = [];
      const add = (id: string, why: string) => { if (!out.some((o) => o.id === id)) out.push({ id, why }); };
      const owners = [...new Set([...(me ? [me] : []), ...listHomeOwners()])];
      for (const o of owners) for (const g of loadHome(o)?.guardians ?? []) add(g, `watched by the browser home of ${o}`);
      if (me) {
        for (const g of await guardiansOf(me).catch(() => [] as string[])) add(g, "a factory guardian your wallet owns");
        add(me, "your connected account");
      }
      if (alive) cb.current(out.slice(0, 6));
    })();
    return () => {
      alive = false;
    };
  }, [w.status, w.accountId]);
  return null;
}
