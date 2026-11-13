import { FileJson } from "lucide-react";
import { cn } from "@/lib/utils";
import { BENCH_URL } from "./content";
import { BENCH_RESULTS, BENCH_ROUTES, type BenchSnapshot } from "./bench-data";
import { Frame, FramePanel, PanelBar } from "./frame";
import { Reveal, Section, SectionHead, SourceLink } from "./primitives";

function Metrics({ r }: { r: BenchSnapshot }) {
  const cells = [
    { k: "Detected", v: `${r.detected} / ${r.routesRun}` },
    { k: "Session named", v: `${r.attributedSession} / ${r.routesRun}` },
    { k: "Exact tool call", v: `${r.attributedToolCall} / ${r.routesRun}` },
    { k: "Median blocks to freeze", v: r.medianBlocksToFreeze === null ? "n/a" : String(r.medianBlocksToFreeze) },
    { k: "Thefts without Stand-in", v: `${r.baselineThefts} / ${r.baselineRoutes}` },
    { k: "Real account change", v: r.realAccountDeltaNear === null ? "n/a" : `${r.realAccountDeltaNear} NEAR` },
  ];
  return (
    <div className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-3">
      {cells.map((c) => (
        <div key={c.k} className="bg-ink-900 px-4 py-4">
          <p className="font-mono text-[10.5px] text-fg-muted">{c.k}</p>
          <p className="mt-1 font-mono text-[20px] text-fg tabular-nums">{c.v}</p>
        </div>
      ))}
    </div>
  );
}

function EmptyResults() {
  return (
    <div className="flex flex-col items-start gap-3 border-b border-line px-5 py-6 sm:flex-row sm:items-center">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-dashed border-line-strong text-fg-muted">
        <FileJson className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] text-fg">Results publish from bench/results.json</p>
        <p className="mt-0.5 text-[13px] text-fg-muted">
          No full run yet. Each route runs with Stand-in on and again with it off, against a disposable account.
        </p>
      </div>
      <SourceLink href={BENCH_URL} className="shrink-0">
        bench/ on GitHub
      </SourceLink>
    </div>
  );
}

export function Benchmark() {
  const real = BENCH_ROUTES.filter((r) => r.kind === "real").length;
  return (
    <Section id="benchmark" labelledBy="benchmark-title">
      <SectionHead
        id="benchmark-title"
        eyebrow="Benchmark"
        title={`${BENCH_ROUTES.length} ways a key leaks.`}
        muted="Each one run on testnet."
      >
        <p>
          {real} routes drive real Claude Code and Codex sessions into a prompt injection. The rest replay a fixed attack
          through the same hook entry point, then measure whether the leak was seen, attributed and frozen.
        </p>
      </SectionHead>

      <Reveal delay={0.05} className="mt-12">
        <Frame>
          <FramePanel className="overflow-hidden">
            <PanelBar
              right={
                <span>{BENCH_RESULTS ? `run ${BENCH_RESULTS.generatedAt.slice(0, 10)} · ${BENCH_RESULTS.network}` : "awaiting run"}</span>
              }
            >
              bench <span className="text-fg-faint">/</span> <span className="text-fg">routes</span>
            </PanelBar>
            {BENCH_RESULTS ? <Metrics r={BENCH_RESULTS} /> : <EmptyResults />}
            <ol className="grid grid-cols-1 font-mono text-[12px] lg:grid-cols-2">
              {BENCH_ROUTES.map((r, i) => (
                <li
                  key={r.id}
                  className={cn(
                    "flex items-center gap-3 border-line px-4 py-2.5",
                    i > 0 && "border-t",
                    i === 1 && "lg:border-t-0",
                    i % 2 === 1 && "lg:border-l",
                  )}
                >
                  <span className="text-fg-faint">{r.id}</span>
                  <span className="min-w-0 flex-1 text-fg lg:truncate" title={r.name}>
                    {r.name}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded border px-1.5 py-0.5 text-[10px]",
                      r.kind === "real" ? "border-decoy/40 text-decoy" : "border-line-strong text-fg-muted",
                    )}
                  >
                    {r.agent ?? "scripted"}
                  </span>
                </li>
              ))}
            </ol>
          </FramePanel>
        </Frame>
      </Reveal>
    </Section>
  );
}
