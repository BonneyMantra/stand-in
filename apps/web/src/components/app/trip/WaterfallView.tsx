import { motion, useReducedMotion } from "motion/react";
import { GitBranch, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Panel, PreviewTag } from "../common";
import type { RowTone, Waterfall } from "./buildRows";

const BAR: Record<RowTone, string> = {
  muted: "bg-fg-faint/40",
  decoy: "bg-decoy/25 border border-decoy/40",
  warn: "bg-warn/70",
  trip: "bg-trip",
  safe: "bg-safe/80",
  pending: "border border-dashed border-fg-faint bg-[repeating-linear-gradient(135deg,transparent_0_4px,var(--color-line-strong)_4px_5px)]",
};
const LEGEND: [RowTone, string][] = [["decoy", "session"], ["warn", "exposure"], ["trip", "leak / trip"], ["safe", "freeze"], ["pending", "pending"]];

function ticks(span: number): number[] {
  const steps = [250, 500, 1000, 2000, 5000, 10000, 30000, 60000, 300000];
  const step = steps.find((s) => span / s <= 6) ?? 600000;
  const out: number[] = [];
  for (let v = 0; v <= span; v += step) out.push(v);
  return out;
}
const fmtMs = (v: number) => (v >= 60000 ? `${(v / 60000).toFixed(1)}m` : v >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}s` : `${v}ms`);

/** Agent Trace Waterfall Inspector, adapted: monochrome rows on a time axis, the leaking tool
 *  call and the on-chain use in red, the freeze in green, the playhead at the trip. */
export function WaterfallView({ wf }: { wf: Waterfall }) {
  const reduce = useReducedMotion();
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / wf.span) * 100))}%`;
  const tk = ticks(wf.span);
  return (
    <Panel title="Trace" icon={GitBranch} id="trace-title" bodyClassName="p-0" meta="ledger record times · session start = 0">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] text-xs md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <div className="border-r border-b border-line px-3.5 py-2 text-[11px] text-fg-faint">Steps</div>
        <div className="relative h-[33px] border-b border-line">
          {tk.map((v) => (
            <span key={v} className="absolute top-2 -translate-x-1/2 font-mono text-[10.5px] text-fg-faint first:translate-x-1" style={{ left: pct(v) }}>{fmtMs(v)}</span>
          ))}
        </div>

        {wf.rows.map((r, i) => (
          <div key={r.id} className="contents">
            <div className={cn("flex min-w-0 items-center gap-2 border-r border-line py-2 pr-3", r.depth ? "pl-8" : "pl-3.5", r.failed && "bg-trip-soft")}>
              {r.depth > 0 && <span className="-ml-4 h-3 w-3 shrink-0 rounded-bl border-b border-l border-line-strong" aria-hidden />}
              {r.failed && <X className="size-3 shrink-0 text-trip" aria-label="failure step" />}
              <div className="min-w-0">
                <p className={cn("truncate font-medium", r.failed ? "text-fg" : "text-fg-muted")}>{r.label}</p>
                {r.sub && <p className="truncate font-mono text-[10.5px] text-fg-faint" title={r.sub}>{r.sub}</p>}
              </div>
            </div>
            <div className={cn("relative min-h-[46px]", r.failed && "bg-trip-soft")}>
              {tk.map((v) => <span key={v} className="absolute inset-y-0 w-px bg-line/70" style={{ left: pct(v) }} aria-hidden />)}
              <span className="absolute inset-y-0 w-px bg-trip/45" style={{ left: pct(wf.tripAt) }} aria-hidden />
              <motion.div
                className={cn("absolute top-1/2 h-3.5 -translate-y-1/2 rounded-[4px]", BAR[r.tone])}
                style={{ left: pct(r.start), width: `max(6px, ${pct(r.end - r.start)})`, transformOrigin: "left" }}
                initial={reduce ? false : { scaleX: 0, opacity: 0 }}
                animate={{ scaleX: 1, opacity: 1 }}
                transition={{ duration: 0.35, delay: reduce ? 0 : Math.min(i * 0.06, 0.4), ease: [0.23, 1, 0.32, 1] }}
              />
              <span
                className={cn("absolute top-1/2 -translate-y-1/2 pl-2 font-mono text-[10.5px] whitespace-nowrap", r.end / wf.span > 0.72 && r.start / wf.span < 0.3 ? (r.tone === "safe" || r.tone === "trip" ? "text-ink-950" : "text-fg-muted") : r.tone === "trip" ? "text-trip" : r.tone === "safe" ? "text-safe" : "text-fg-faint")}
                style={r.end / wf.span <= 0.72 ? { left: pct(r.end) } : r.start / wf.span >= 0.3 ? { right: `calc(100% - ${pct(r.start)} + 8px)` } : { left: `calc(${pct(r.start)} + 6px)` }}
              >
                {r.note}
                {r.approx && <span className="ml-1.5 align-middle"><PreviewTag title="Position estimated: no recorded wall-clock time for this step" /></span>}
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className="relative">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line px-3.5 py-2.5 text-[11px] text-fg-faint">
          {LEGEND.map(([tone, l]) => (
            <span key={l} className="inline-flex items-center gap-1.5"><span className={cn("h-2 w-3 rounded-sm", BAR[tone])} aria-hidden />{l}</span>
          ))}
          {wf.otherCalls > 0 && <span className="ml-auto font-mono">+{wf.otherCalls} tool calls without a decoy (not shown)</span>}
        </div>
      </div>
    </Panel>
  );
}
