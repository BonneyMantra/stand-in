import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { viewAccount, type AccountView } from "@/lib/wallet/guardianCode";
import { homeAccountsOf, readHomeAccount, type HomeAccountState } from "@/lib/wallet/homeAccounts";
import type { AdoptRequest } from "@/lib/wallet/deeplink";

export type HomeRead =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; accounts: HomeAccountState[]; signer: AccountView | null };

/**
 * What exists on chain for an adopt link's home accounts, and the signer's balance: read when the link opens, again after
 * every wallet answer (`reloadKey`), so a partly landed request offers only what is still missing.
 */
export function useHomeAccounts(req: AdoptRequest | null, signerId: string | null, reloadKey: number) {
  const [read, setRead] = useState<HomeRead>({ status: "idle" });
  const seq = useRef(0);
  const wanted = useMemo(() => (req ? homeAccountsOf(req) : []), [req]);

  const reload = useCallback(async () => {
    if (!req) { setRead({ status: "idle" }); return; }
    const n = ++seq.current;
    setRead((r) => (r.status === "ready" ? r : { status: "loading" }));
    try {
      const [accounts, signer] = await Promise.all([Promise.all(wanted.map(readHomeAccount)), signerId ? viewAccount(signerId) : Promise.resolve(null)]);
      if (n === seq.current) setRead({ status: "ready", accounts, signer });
    } catch (e) {
      if (n === seq.current) setRead({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }, [req, wanted, signerId]);

  useEffect(() => { void reload(); }, [reload, reloadKey]);
  return { read, reload };
}
