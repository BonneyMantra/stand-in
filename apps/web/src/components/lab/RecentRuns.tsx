import { History, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FOCUS } from "@/components/landing/primitives";
import type { RunsState } from "@/lib/lab/useLabRun";
import { foldSteps, shortHash, type RunRecord } from "@/lib/lab/types";
import { cn } from "@/lib/utils";

export function ago(iso: string, now = Date.now()) {
  const s = Math.round((now - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s)) return "";
  if (s < 60) return `${Math.max(0, s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function TxCell({ run, step }: { run: RunRecord; step: "theft" | "freeze" }) {
  const v = foldSteps(run.steps).find((s) => s.id === step);
  const tx = v?.txs[0];
  if (!tx) return <span className="text-fg-faint">none</span>;
  return (
    <a
      href={tx.href}
      target="_blank"
      rel="noreferrer"
      title={tx.hash}
      className="rounded-sm text-fg-muted underline-offset-4 hover:text-fg hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg-muted"
    >
      {shortHash(tx.hash)}
    </a>
  );
}

const COLS = "md:grid-cols-[110px_minmax(0,1fr)_150px_120px_120px]";

function Row({ run }: { run: RunRecord }) {
  const n = run.blocks_to_freeze;
  const result = (
    <span className={n === null ? "text-fg-faint" : "text-trip"}>
      {n === null ? "no freeze" : `frozen in ${n} block${n === 1 ? "" : "s"}`}
    </span>
  );
  return (
    <li className="border-t border-line px-4 py-3 font-mono text-[12px] first:border-t-0">
      <div className={cn("hidden items-center gap-x-4 md:grid", COLS)}>
        <span className="text-fg-muted">{ago(run.at)}</span>
        <span className="truncate text-fg-faint" title={run.run_id}>{run.run_id}</span>
        {result}
        <TxCell run={run} step="theft" />
        <TxCell run={run} step="freeze" />
      </div>
      <div className="space-y-1 md:hidden">
        <div className="flex justify-between gap-3"><span className="text-fg-muted">{ago(run.at)}</span>{result}</div>
        <p className="truncate text-fg-faint">{run.run_id}</p>
        <div className="flex justify-between gap-3 text-fg-faint">
          <span>theft <TxCell run={run} step="theft" /></span>
          <span>freeze <TxCell run={run} step="freeze" /></span>
        </div>
      </div>
    </li>
  );
}

export function RecentRuns({ state, onRefresh }: { state: RunsState; onRefresh: () => void }) {
  return (
    <section aria-labelledby="runs-title" className="mt-14">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <p className="mb-2 font-mono text-[11px] tracking-[0.14em] text-fg-muted uppercase">Recent runs</p>
          <h2 id="runs-title" className="text-[22px] leading-tight font-medium tracking-[-0.02em]">Every run, from anyone</h2>
        </div>
        <Button variant="quiet" size="sm" onClick={onRefresh} className={cn("h-8 gap-2 border border-line-strong px-3 font-mono text-[11px]", FOCUS)}>
          <RefreshCw aria-hidden className="size-3.5" />
          Refresh
        </Button>
      </div>
      <div className="overflow-hidden rounded-[14px] border border-line bg-ink-900/60 p-[3px]">
        <div className="rounded-[10px] border border-line bg-ink-950">
          <div className={cn("hidden gap-x-4 md:grid", COLS, " border-b border-line px-4 py-2 font-mono text-[10.5px] tracking-wide text-fg-faint uppercase")}>
            <span>When</span><span>Run</span><span>Result</span><span>Theft tx</span><span>Freeze tx</span>
          </div>
          {state.status === "loading" ? (
            <p className="px-4 py-6 font-mono text-[12px] text-fg-faint">Loading runs…</p>
          ) : state.status === "error" ? (
            <p className="px-4 py-6 text-[13px] text-fg-muted">
              Could not load recent runs{state.code ? ` (HTTP ${state.code})` : " (network error)"}.
            </p>
          ) : state.runs.length === 0 ? (
            <div className="flex items-center gap-3 px-4 py-6 text-[13px] text-fg-muted">
              <History aria-hidden className="size-4 text-fg-faint" />
              No runs stored yet. Yours will be the first.
            </div>
          ) : (
            <ul>
              {state.runs.map((r) => (
                <Row key={r.run_id} run={r} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
