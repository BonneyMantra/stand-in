import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { readAccountSnapshot, type AccountSnapshot } from "./account";
import { homeSummary, nextStep, type HomeSummary, type NextStep } from "./accountDerive";
import { loadHomeRecord, subscribeHome, type HomeRecord } from "@/lib/wallet/homeStore";
import { isEthAccount, looksMainnet } from "@/lib/wallet/near";
import { useWallet } from "@/components/owner/WalletProvider";

export type AccountRead =
  | { status: "no-wallet" }
  | { status: "restoring" }
  | { status: "wrong-network"; owner: string }
  | { status: "loading"; owner: string }
  | { status: "error"; owner: string; error: string; previous?: AccountSnapshot }
  | { status: "ready"; owner: string; snapshot: AccountSnapshot };

interface Value {
  read: AccountRead;
  owner: string | null;
  eth: boolean;
  home: HomeRecord | null;
  snapshot: AccountSnapshot | null;
  summary: HomeSummary | null;
  next: NextStep | null;
  refreshing: boolean;
  refresh: () => Promise<void>;
  /** read again now and once more a few seconds later (a node can lag a transaction by a block or two) */
  refreshSoon: () => void;
}

const Ctx = createContext<Value | null>(null);
const POLL_MS = 20_000;

/** The connected owner's own state from chain, shared by every My account page; polls while the tab is visible. */
export function MyAccountProvider({ children }: { children: ReactNode }) {
  const w = useWallet();
  const owner = w.status === "connected" && w.accountId && !looksMainnet(w.accountId) ? w.accountId : null;
  const [read, setRead] = useState<AccountRead>({ status: "restoring" });
  const [home, setHome] = useState<HomeRecord | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    setHome(owner ? loadHomeRecord(owner) : null);
    if (!owner) return;
    return subscribeHome((o) => { if (o === owner) setHome(loadHomeRecord(owner)); });
  }, [owner]);

  const refresh = useCallback(async () => {
    if (!owner) return;
    const n = ++seq.current;
    setRefreshing(true);
    setRead((r) => (r.status === "ready" && r.owner === owner ? r : { status: "loading", owner }));
    try {
      const snapshot = await readAccountSnapshot(owner, loadHomeRecord(owner)?.guardians ?? []);
      if (n === seq.current) setRead({ status: "ready", owner, snapshot });
    } catch (e) {
      if (n === seq.current) setRead((r) => ({ status: "error", owner, error: e instanceof Error ? e.message : String(e), previous: r.status === "ready" ? r.snapshot : undefined }));
    } finally {
      if (n === seq.current) setRefreshing(false);
    }
  }, [owner]);

  useEffect(() => {
    if (w.status === "restoring" || w.status === "connecting") { setRead((r) => (r.status === "ready" ? r : { status: "restoring" })); return; }
    if (w.status !== "connected" || !w.accountId) { setRead({ status: "no-wallet" }); return; }
    if (looksMainnet(w.accountId)) { setRead({ status: "wrong-network", owner: w.accountId }); return; }
    void refresh();
    const t = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, POLL_MS);
    return () => window.clearInterval(t);
  }, [w.status, w.accountId, refresh]);

  const refreshSoon = useCallback(() => {
    void refresh();
    window.setTimeout(() => void refresh(), 4000);
  }, [refresh]);

  const snapshot = read.status === "ready" ? read.snapshot : read.status === "error" ? read.previous ?? null : null;
  const eth = !!owner && isEthAccount(owner);
  const value = useMemo<Value>(() => ({
    read, owner, eth, home, snapshot, refreshing, refresh, refreshSoon,
    summary: snapshot ? homeSummary(snapshot, home) : null,
    next: snapshot ? nextStep(snapshot, home, eth) : null,
  }), [read, owner, eth, home, snapshot, refreshing, refresh, refreshSoon]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMyAccount(): Value {
  const v = useContext(Ctx);
  if (!v) throw new Error("useMyAccount outside MyAccountProvider");
  return v;
}
