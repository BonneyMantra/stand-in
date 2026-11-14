import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { StandinEventName, StandinState } from "./types";

/** live = watcher API; recorded = public/demo-state.json; error = neither reachable. */
export type Source = "loading" | "live" | "recorded" | "error";

interface StoreValue {
  source: Source;
  data: StandinState | null;
  /** Why we are on the recorded run: this host serves no watcher API (the hosted site), the watcher did not
   *  answer, or the viewer chose it. */
  fallbackReason: "none" | "unreachable" | "chosen" | null;
  error: string | null;
  /** Bumped when a live SSE `trip` arrives, so the map can play the trip moment. */
  lastTripSignal: { tx: string; n: number } | null;
  retry: () => void;
  setPreferRecorded: (v: boolean) => void;
}

const Ctx = createContext<StoreValue | null>(null);
const PREF_KEY = "standin.preferRecorded";
const EVENTS: StandinEventName[] = ["session", "exposure", "trip", "freeze", "blocklist", "bench"];

function readPref(): boolean {
  try {
    // ?source=recorded|live sets the preference for this tab, so links stay on the chosen source.
    const q = new URLSearchParams(window.location.search).get("source");
    if (q === "recorded" || q === "live") window.sessionStorage.setItem(PREF_KEY, q === "recorded" ? "1" : "0");
    if (q === "recorded") return true;
    return window.sessionStorage.getItem(PREF_KEY) === "1";
  } catch {
    return false;
  }
}

function isState(x: unknown): x is StandinState {
  const s = x as StandinState;
  return Boolean(s && typeof s === "object" && s.agent && s.decoy && Array.isArray(s.trips) && Array.isArray(s.sessions));
}

/**
 * Same rule as build-demo-state.mjs: a trip the watcher could not resolve to a tx hash, or whose freeze
 * precedes it (a reused earlier freeze), cannot be shown or linked honestly, so it is left out.
 */
function clean(s: StandinState): StandinState {
  const seen = new Set<string>();
  const trips = s.trips.filter((t) => {
    if (!t.tx_hash || seen.has(t.tx_hash)) return false;
    seen.add(t.tx_hash);
    return !t.freeze?.tx_hash || t.freeze.blocks_after_trip >= 0;
  });
  return trips.length === s.trips.length ? s : { ...s, trips };
}

/** The host has no watcher API at all: a static deploy answers /api/state with its HTML fallback page. */
class NoWatcherHere extends Error {}

async function getJson(url: string, ms: number): Promise<StandinState> {
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { accept: "application/json" } });
    if (res.ok && (res.headers.get("content-type") ?? "").includes("text/html")) throw new NoWatcherHere(url);
    if (!res.ok) throw new Error(`${url} answered ${res.status}`);
    const body: unknown = await res.json();
    if (!isState(body)) throw new Error(`${url} did not return the watcher state schema`);
    return clean(body);
  } finally {
    window.clearTimeout(timer);
  }
}

export function StandinProvider({ children }: { children: ReactNode }) {
  const [source, setSource] = useState<Source>("loading");
  const [data, setData] = useState<StandinState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fallbackReason, setFallbackReason] = useState<StoreValue["fallbackReason"]>(null);
  const [preferRecorded, setPref] = useState(readPref);
  const [attempt, setAttempt] = useState(0);
  const [lastTripSignal, setTripSignal] = useState<StoreValue["lastTripSignal"]>(null);
  const refetchTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    let es: EventSource | null = null;
    setSource("loading");

    const loadRecorded = async (reason: "none" | "unreachable" | "chosen") => {
      try {
        const rec = await getJson("/demo-state.json", 8000);
        if (cancelled) return;
        setData(rec);
        setFallbackReason(reason);
        setSource("recorded");
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
        setSource("error");
      }
    };

    const loadLive = async () => {
      try {
        const live = await getJson("/api/state", 2500);
        if (cancelled) return;
        setData(live);
        setFallbackReason(null);
        setSource("live");
        es = new EventSource("/api/events");
        const onEvent = (name: StandinEventName) => (ev: MessageEvent<string>) => {
          if (name === "trip") {
            try {
              const t = JSON.parse(ev.data) as { tx_hash?: string };
              setTripSignal((p) => ({ tx: t.tx_hash ?? "", n: (p?.n ?? 0) + 1 }));
            } catch {
              /* malformed event: the refetch below still updates state */
            }
          }
          // SSE payloads mirror /api/state objects; refetching keeps one source of truth.
          window.clearTimeout(refetchTimer.current);
          refetchTimer.current = window.setTimeout(() => {
            getJson("/api/state", 2500).then((s) => !cancelled && setData(s)).catch(() => undefined);
          }, 150);
        };
        for (const n of EVENTS) es.addEventListener(n, onEvent(n) as EventListener);
      } catch (e) {
        if (!cancelled) await loadRecorded(e instanceof NoWatcherHere ? "none" : "unreachable");
      }
    };

    if (preferRecorded) void loadRecorded("chosen");
    else void loadLive();
    return () => {
      cancelled = true;
      es?.close();
      window.clearTimeout(refetchTimer.current);
    };
  }, [preferRecorded, attempt]);

  const setPreferRecorded = useCallback((v: boolean) => {
    try {
      window.sessionStorage.setItem(PREF_KEY, v ? "1" : "0");
    } catch {
      /* storage blocked: preference lasts for this page only */
    }
    setPref(v);
  }, []);

  const value = useMemo<StoreValue>(
    () => ({ source, data, error, fallbackReason, lastTripSignal, retry: () => setAttempt((a) => a + 1), setPreferRecorded }),
    [source, data, error, fallbackReason, lastTripSignal, setPreferRecorded],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStandin(): StoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStandin must be used inside <StandinProvider>");
  return v;
}
