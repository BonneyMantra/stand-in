import { useCallback, useEffect, useRef, useState } from "react";
import { fetchConfig, fetchRuns, publishNtfy, startRun } from "./api";
import type { LabConfig, NtfyPayload, RunRecord, StepEvent } from "./types";

export type Phase = "idle" | "running" | "done" | "failed" | "dropped" | "busy" | "rate_limited" | "unavailable" | "network";

export interface LabRunState {
  phase: Phase;
  events: StepEvent[];
  runId: string | null;
  blocksToFreeze: number | null;
  error: string | null;
  unavailableStatus: number | null;
  retryIn: number;
  mock: boolean;
  /** The browser-side publish of a push the server could not deliver. */
  relay: { state: "sending" | "sent" | "failed"; topic: string } | null;
}

export type RunsState = { status: "loading" } | { status: "ok"; runs: RunRecord[]; mock: boolean } | { status: "error"; code: number };

const INITIAL: LabRunState = {
  phase: "idle", events: [], runId: null, blocksToFreeze: null, error: null, unavailableStatus: null, retryIn: 0, mock: false, relay: null,
};

export function useLabRun() {
  const [run, setRun] = useState<LabRunState>(INITIAL);
  const [runs, setRuns] = useState<RunsState>({ status: "loading" });
  const [config, setConfig] = useState<LabConfig | null>(null);
  const ctl = useRef<AbortController | null>(null);
  const timers = useRef<number[]>([]);
  const relayed = useRef<string | null>(null);

  const relay = useCallback(async (runId: string, p: NtfyPayload) => {
    if (relayed.current === runId) return;
    relayed.current = runId;
    setRun((r) => ({ ...r, relay: { state: "sending", topic: p.topic } }));
    const ok = await publishNtfy(p);
    setRun((r) => (r.runId === runId ? { ...r, relay: { state: ok ? "sent" : "failed", topic: p.topic } } : r));
  }, []);

  const refreshRuns = useCallback(async () => {
    const r = await fetchRuns(10);
    setRuns(r.ok ? { status: "ok", runs: r.data.runs, mock: r.mock } : { status: "error", code: r.status });
  }, []);

  useEffect(() => {
    void refreshRuns();
    void fetchConfig().then((c) => c.ok && setConfig(c.data));
    const pending = timers.current;
    return () => {
      ctl.current?.abort();
      pending.forEach((t) => window.clearTimeout(t));
    };
  }, [refreshRuns]);

  // Busy countdown: one tick per second until the lock's TTL has passed.
  useEffect(() => {
    if ((run.phase !== "busy" && run.phase !== "rate_limited") || run.retryIn <= 0) return;
    const t = window.setTimeout(() => {
      setRun((r) => ({ ...r, retryIn: Math.max(0, r.retryIn - 1) }));
      if (run.retryIn === 1) void refreshRuns();
    }, 1000);
    return () => window.clearTimeout(t);
  }, [run.phase, run.retryIn, refreshRuns]);

  const later = useCallback((ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);

  const start = useCallback(async () => {
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    setRun({ ...INITIAL, phase: "running" });
    const outcome = await startRun((e) => {
      if (e.type === "step" && e.data.step === "notify" && e.data.status === "fail" && e.data.ntfy) void relay(e.data.run_id, e.data.ntfy);
      setRun((r) => {
        if (e.type === "step") return { ...r, runId: e.data.run_id || r.runId, events: [...r.events, e.data] };
        if (e.type === "done") return { ...r, runId: e.data.run_id || r.runId, blocksToFreeze: e.data.blocks_to_freeze };
        return { ...r, error: e.data.error };
      });
    }, c.signal);
    if (c.signal.aborted || outcome.kind === "aborted") return;
    switch (outcome.kind) {
      case "streamed": {
        const phase = outcome.ended === "done" ? "done" : outcome.ended === "error" ? "failed" : "dropped";
        setRun((r) => ({ ...r, phase, mock: outcome.mock }));
        // A dropped stream may still finish server-side; it shows up in Recent runs once stored.
        void refreshRuns();
        if (phase === "dropped") later(15_000, () => void refreshRuns());
        break;
      }
      case "busy":
        setRun({ ...INITIAL, phase: "busy", retryIn: outcome.retryAfterS });
        void refreshRuns();
        break;
      case "rate_limited":
        setRun({ ...INITIAL, phase: "rate_limited", retryIn: outcome.retryAfterS });
        void refreshRuns();
        break;
      case "unavailable":
        setRun({ ...INITIAL, phase: "unavailable", unavailableStatus: outcome.status });
        break;
      case "network":
        setRun({ ...INITIAL, phase: "network" });
        break;
    }
  }, [later, refreshRuns, relay]);

  return { run, runs, config, start, refreshRuns };
}
