import { useCallback, useEffect, useMemo, useState } from "react";
import { loadHome, subscribeHome, type HomeRecord } from "../wallet/homeStore";
import { tabWatcherFor } from "./registry";
import type { WatchState, WatchStatus } from "./watcher";

/** The browser-held home for `owner`, re-read whenever it changes in this tab or another one. */
export function useHome(owner: string | null): HomeRecord | null {
  const [home, setHome] = useState<HomeRecord | null>(() => (owner ? loadHome(owner) : null));
  useEffect(() => {
    setHome(owner ? loadHome(owner) : null);
    if (!owner) return;
    return subscribeHome((o) => {
      if (!o || o === owner) setHome(loadHome(owner));
    });
  }, [owner]);
  return home;
}

/** A read older than this shows as stalled even before the watcher's own next attempt fails. */
export const STALL_MS = 6000;

export interface TabWatcherView {
  status: WatchStatus | null;
  /** The state as shown: `live` turns `stalled` when the last good read is older than STALL_MS. */
  shown: WatchState | "none";
  /** Seconds since the last good read. */
  age: number | null;
  start: () => void;
  stop: () => void;
}

/** Subscribes to the page's watcher for `home` and ticks once a second for the heartbeat. */
export function useTabWatcher(home: HomeRecord | null): TabWatcherView {
  const entry = useMemo(() => (home ? tabWatcherFor(home) : null), [home]);
  const [status, setStatus] = useState<WatchStatus | null>(entry?.watcher.snapshot ?? null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!entry) {
      setStatus(null);
      return;
    }
    return entry.watcher.subscribe(setStatus);
  }, [entry]);
  const running = status?.state === "live" || status?.state === "starting" || status?.state === "stalled" || status?.state === "offline";
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [running]);
  const age = status?.lastOkAt ? Math.max(0, Math.round((now - status.lastOkAt) / 1000)) : null;
  const shown: TabWatcherView["shown"] = !status ? "none" : status.state === "live" && age !== null && age * 1000 > STALL_MS ? "stalled" : status.state;
  const start = useCallback(() => entry?.watcher.start(), [entry]);
  const stop = useCallback(() => entry?.watcher.stop(), [entry]);
  return { status, shown, age, start, stop };
}
