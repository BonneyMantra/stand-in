import { useMemo } from "react";
import { PageHead, PublicShell } from "@/components/public/PublicShell";
import { Frame, FramePanel, PanelBar } from "@/components/landing/frame";
import { RunPanel } from "@/components/lab/RunPanel";
import { PhoneCard } from "@/components/lab/PhoneCard";
import { RecentRuns, ago } from "@/components/lab/RecentRuns";
import { foldSteps, type LabConfig } from "@/lib/lab/types";
import { useLabRun } from "@/lib/lab/useLabRun";

/** The public lab topic (docs/UPGRADES.md, STANDIN_LAB_NTFY_TOPIC); the API's config wins when it answers. */
const LAB_TOPIC = "standin-lab-09d9a8";

function LastFreeze({ n, when }: { n: number | null; when: string | null }) {
  return (
    <div className="p-4">
      <p className="font-mono text-[11px] tracking-[0.14em] text-fg-muted uppercase">Last freeze</p>
      {n === null ? (
        <p className="mt-3 text-[13px] text-fg-faint">No finished run yet.</p>
      ) : (
        <>
          <p className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-[44px] leading-none font-medium tracking-[-0.04em] text-trip tabular-nums">{n}</span>
            <span className="text-[14px] text-fg">block{n === 1 ? "" : "s"} after the theft</span>
          </p>
          {when ? <p className="mt-2 font-mono text-[11px] text-fg-faint">{when}</p> : null}
        </>
      )}
    </div>
  );
}

function Accounts({ config }: { config: LabConfig | null }) {
  if (!config) return null;
  const rows = [
    ["agent", config.accounts.agent],
    ["decoy", config.accounts.decoy],
    ["thief", config.accounts.thief],
  ] as const;
  const base = config.explorer.replace(/\/$/, "");
  return (
    <dl className="space-y-1 border-t border-line p-4 font-mono text-[11.5px]">
      {rows.map(([k, v]) => (
        <div key={k} className="flex min-w-0 items-baseline justify-between gap-3">
          <dt className="shrink-0 text-fg-faint">{k}</dt>
          <dd className="min-w-0 truncate">
            <a href={`${base}/address/${v}`} target="_blank" rel="noreferrer" title={v} className="text-fg-muted underline-offset-4 hover:text-fg hover:underline">
              {v}
            </a>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function LabPage() {
  const { run, runs, config, start, refreshRuns } = useLabRun();
  const latest = runs.status === "ok" ? runs.runs[0] : undefined;
  const showLatest = run.events.length === 0 && (run.phase === "busy" || run.phase === "rate_limited");
  const steps = useMemo(() => {
    const views = foldSteps(showLatest && latest ? latest.steps : run.events);
    if (showLatest || !run.relay) return views;
    // The server could not reach ntfy.sh, so this browser published the push (docs/UPGRADES.md, W9).
    const { state, topic } = run.relay;
    return views.map((v) =>
      v.id !== "notify" ? v : {
        ...v,
        status: state === "sent" ? ("ok" as const) : state === "sending" ? ("start" as const) : ("fail" as const),
        title: state === "sent" ? `Published from your browser to ntfy.sh/${topic}` : state === "sending" ? "Publishing the push from your browser…" : "The browser could not publish the push either",
        detail: `Server-side publish failed: ${v.detail ?? v.title ?? "no detail"}`,
      },
    );
  }, [showLatest, latest, run.events, run.relay]);

  const freezeStep = foldSteps(run.events).find((s) => s.id === "freeze");
  const liveN = run.blocksToFreeze ?? freezeStep?.blocks_after_trip ?? null;
  const last = liveN !== null ? { n: liveN, when: "this run" } : latest ? { n: latest.blocks_to_freeze, when: `latest run · ${ago(latest.at)}` } : { n: null, when: null };

  return (
    <PublicShell title="Lab · Stand-in">
      <PageHead eyebrow="Hosted attack lab · NEAR testnet" title="Leak a decoy yourself." muted="Watch the freeze land on chain." dot="trip">
        <p>
          One click plants a decoy key, leaks it through a simulated agent session and lets a thief spend it. Stand-in's watcher sees the decoy
          used and freezes the agent account with its function-call key. Every transaction opens in the explorer.
        </p>
      </PageHead>

      <div className="mt-10 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <RunPanel run={run} steps={steps} latest={showLatest ? latest : undefined} onStart={start} />
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1">
          <Frame>
            <FramePanel className="bg-ink-950">
              <LastFreeze n={last.n} when={last.when} />
              <Accounts config={config} />
            </FramePanel>
          </Frame>
          <Frame>
            <FramePanel className="bg-ink-950">
              <PanelBar>phone alert</PanelBar>
              <PhoneCard topic={config?.ntfy_topic || LAB_TOPIC} />
            </FramePanel>
          </Frame>
        </div>
      </div>

      <RecentRuns state={runs} onRefresh={() => void refreshRuns()} />
    </PublicShell>
  );
}
