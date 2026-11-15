import { useCallback, useEffect, useRef, useState } from "react";
import { planBrowserHome, type HomePlan } from "@/lib/wallet/homePlan";
import { subscribeHome } from "@/lib/wallet/homeStore";

export type HomePlanRead = { status: "idle" } | { status: "loading" } | { status: "error"; error: string } | { status: "ready"; plan: HomePlan };

/** The home part of the next wallet request for `owner` (read from chain), refreshed when the stored home changes. */
export function useHomePlan(owner: string | null, guardian: string | null, reloadKey = 0) {
  const [read, setRead] = useState<HomePlanRead>({ status: "idle" });
  const seq = useRef(0);
  const reload = useCallback(async () => {
    if (!owner || !guardian) { setRead({ status: "idle" }); return; }
    const n = ++seq.current;
    setRead((r) => (r.status === "ready" ? r : { status: "loading" }));
    try {
      const plan = await planBrowserHome(owner, guardian);
      if (n === seq.current) setRead({ status: "ready", plan });
    } catch (e) {
      if (n === seq.current) setRead({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }, [owner, guardian]);
  useEffect(() => { void reload(); }, [reload, reloadKey]);
  useEffect(() => subscribeHome((o) => { if (o === owner) void reload(); }), [owner, reload]);
  return { read, reload };
}
