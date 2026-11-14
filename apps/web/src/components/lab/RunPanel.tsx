import { Link } from "react-router";
import { CircleAlert, Clock, Play, RotateCcw, WifiOff } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import { Button } from "@/components/ui/button";
import { Frame, FramePanel, PanelBar } from "@/components/landing/frame";
import { FOCUS } from "@/components/landing/primitives";
import { Tag } from "@/components/app/common";
import type { LabRunState } from "@/lib/lab/useLabRun";
import { STEP_LABEL, STEP_ORDER, type RunRecord, type StepView } from "@/lib/lab/types";
import { cn } from "@/lib/utils";
import { RunTrace } from "./RunTrace";
import { ago } from "./RecentRuns";

function Notice({ run, latest, current }: { run: LabRunState; latest?: RunRecord; current?: StepView }) {
  const showing = latest ? ` Showing the latest finished run (${ago(latest.at)}).` : "";
  switch (run.phase) {
    case "busy":
      return (
        <Alert variant="warning" className="border-warn/30 bg-warn/5">
          <Clock />
          <AlertTitle className="line-clamp-none">Another run holds the lab</AlertTitle>
          <AlertDescription>
            The lab runs one attack at a time.{showing} {run.retryIn > 0 ? `Try again in ${run.retryIn}s.` : "The lock has expired; try again."}
          </AlertDescription>
        </Alert>
      );
    case "rate_limited":
      return (
        <Alert variant="warning" className="border-warn/30 bg-warn/5">
          <Clock />
          <AlertTitle className="line-clamp-none">Run limit reached</AlertTitle>
          <AlertDescription>
            The lab allows 3 runs per visitor every 10 minutes.{showing} {run.retryIn > 0 ? `Try again in ${run.retryIn}s.` : ""}
          </AlertDescription>
        </Alert>
      );
    case "dropped":
      return (
        <Alert variant="warning" className="border-warn/30 bg-warn/5">
          <WifiOff />
          <AlertTitle className="line-clamp-none">Live stream dropped{current ? ` during "${STEP_LABEL[current.id]}"` : ""}</AlertTitle>
          <AlertDescription>The run may still finish on the server. Recent runs below refreshes in 15 s.</AlertDescription>
        </Alert>
      );
    case "failed":
      return (
        <Alert variant="destructive" className="border-trip/40 bg-trip-soft">
          <CircleAlert />
          <AlertTitle className="line-clamp-none">The run stopped</AlertTitle>
          <AlertDescription className="[overflow-wrap:anywhere]">{run.error ?? "The lab reported an error."}</AlertDescription>
        </Alert>
      );
    case "unavailable":
      return (
        <Alert variant="destructive" className="border-trip/40 bg-trip-soft">
          <CircleAlert />
          <AlertTitle className="line-clamp-none">The hosted lab is not answering here</AlertTitle>
          <AlertDescription>
            <p>
              The lab API returned HTTP {run.unavailableStatus}. The recorded runs can still be checked on chain from{" "}
              <Link to="/verify" className="text-fg underline underline-offset-4">/verify</Link>.
            </p>
          </AlertDescription>
        </Alert>
      );
    case "network":
      return (
        <Alert variant="destructive" className="border-trip/40 bg-trip-soft">
          <WifiOff />
          <AlertTitle className="line-clamp-none">Could not reach the lab API</AlertTitle>
          <AlertDescription>Check your connection and try again.</AlertDescription>
        </Alert>
      );
    default:
      return null;
  }
}

function statusTag(run: LabRunState, showingLatest: boolean) {
  if (run.phase === "running") return <Tag tone="decoy">running</Tag>;
  if (run.phase === "done") return <Tag tone="safe">done</Tag>;
  if (run.phase === "failed") return <Tag tone="trip">failed</Tag>;
  if (run.phase === "dropped") return <Tag tone="warn">stream dropped</Tag>;
  if (showingLatest) return <Tag>latest run</Tag>;
  return <Tag>ready</Tag>;
}

export function RunPanel({ run, steps, latest, onStart }: { run: LabRunState; steps: StepView[]; latest?: RunRecord; onStart: () => void }) {
  const showingLatest = run.events.length === 0 && !!latest;
  const running = run.phase === "running";
  const waiting = (run.phase === "busy" || run.phase === "rate_limited") && run.retryIn > 0;
  const current = [...steps].reverse().find((s) => s.status !== "pending");
  const reached = steps.filter((s) => s.status === "ok").length;
  const label = running ? `Running · ${reached} of ${STEP_ORDER.length}` : waiting ? `Try again in ${run.retryIn}s` : run.phase === "idle" ? "Leak a decoy" : "Run it again";
  const runId = run.runId ?? (showingLatest ? latest?.run_id : null);

  return (
    <Frame>
      <FramePanel className="bg-ink-950">
        <PanelBar right={<>{run.mock ? <Tag tone="warn">dev mock</Tag> : null}{statusTag(run, showingLatest)}</>}>
          lab · {runId ?? "no run yet"}
        </PanelBar>
        <div className="flex flex-col gap-4 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-[44ch] text-[13px] leading-relaxed text-fg-muted">
            Runs the whole attack on NEAR testnet with the lab's own accounts. Each step links to its transaction.
          </p>
          <Button
            variant="invert"
            size="lg"
            onClick={onStart}
            disabled={running || waiting}
            aria-live="polite"
            className={cn("h-11 min-w-[176px] gap-2 px-5 text-[14px] active:scale-[0.98]", FOCUS)}
          >
            {running ? <span aria-hidden className="size-2 animate-pulse rounded-full bg-trip" /> : run.phase === "idle" ? <Play aria-hidden className="size-4" /> : <RotateCcw aria-hidden className="size-4" />}
            {label}
          </Button>
        </div>
        <div className="space-y-5 p-4 sm:p-5">
          <Notice run={run} latest={latest} current={current} />
          <RunTrace steps={steps} live={running} />
          {run.phase === "done" ? (
            <p className="border-t border-line pt-4 font-mono text-[12px] text-fg-muted">
              <span className="text-safe">done</span> · run {run.runId}
              {run.blocksToFreeze !== null ? ` · frozen in ${run.blocksToFreeze} blocks` : ""}
            </p>
          ) : null}
        </div>
      </FramePanel>
    </Frame>
  );
}
