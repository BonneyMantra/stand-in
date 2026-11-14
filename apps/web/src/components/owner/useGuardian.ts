import { useCallback, useEffect, useRef, useState } from "react";
import { readGuardian, type GuardianLookup } from "@/lib/wallet/near";

export type GuardianRead =
  | { status: "idle" }
  | { status: "loading"; previous?: GuardianLookup }
  | { status: "error"; error: string }
  | { status: "ready"; lookup: GuardianLookup; readAt: number };

/** guardian.get_state for the connected account, read straight from testnet RPC. */
export function useGuardian(accountId: string | null) {
  const [read, setRead] = useState<GuardianRead>({ status: "idle" });
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    if (!accountId) { setRead({ status: "idle" }); return; }
    const n = ++seq.current;
    setRead((r) => ({ status: "loading", previous: r.status === "ready" ? r.lookup : r.status === "loading" ? r.previous : undefined }));
    try {
      const lookup = await readGuardian(accountId);
      if (n === seq.current) setRead({ status: "ready", lookup, readAt: Date.now() });
    } catch (e) {
      if (n === seq.current) setRead({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }, [accountId]);

  useEffect(() => { void refresh(); }, [refresh]);
  return { read, refresh };
}
