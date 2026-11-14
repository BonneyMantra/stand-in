import { motion, useReducedMotion } from "motion/react";
import { ArrowUpRight, Check, LoaderCircle, X } from "lucide-react";
import {
  Timeline, TimelineContent, TimelineHeader, TimelineIndicator, TimelineItem, TimelineSeparator, TimelineTitle,
} from "@/components/reui/timeline";
import { EASE_OUT } from "@/components/landing/primitives";
import { STEP_LABEL, shortHash, type StepId, type StepView } from "@/lib/lab/types";
import { cn } from "@/lib/utils";

/** Steps whose success is the alarm path: drawn in the trip colour. */
const ALARM: ReadonlySet<StepId> = new Set(["theft", "detect", "freeze"]);

function Indicator({ v }: { v: StepView }) {
  const alarm = ALARM.has(v.id);
  return (
    <TimelineIndicator
      className={cn(
        "grid size-5 place-items-center border transition-[background-color,border-color,color] duration-300",
        v.status === "pending" && "border-line-strong bg-ink-950 text-transparent",
        v.status === "start" && "border-fg-muted bg-ink-900 text-fg",
        v.status === "ok" && (alarm ? "border-trip bg-trip text-ink-950" : "border-fg bg-fg text-ink-950"),
        v.status === "fail" && "border-trip bg-trip-soft text-trip",
      )}
    >
      {v.status === "start" ? <LoaderCircle className="size-3 animate-spin" /> : null}
      {v.status === "ok" ? <Check className="size-3" strokeWidth={3} /> : null}
      {v.status === "fail" ? <X className="size-3" strokeWidth={3} /> : null}
    </TimelineIndicator>
  );
}

function TxLink({ hash, href, label }: { hash: string; href: string; label?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={hash}
      aria-label={`Transaction ${hash} on the explorer`}
      className="inline-flex h-6 items-center gap-1 rounded-md border border-line-strong bg-ink-900 px-2 font-mono text-[11px] text-fg-muted transition-colors hover:border-fg-faint hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg-muted"
    >
      <span className="text-fg-faint">{label ?? "tx"}</span> {shortHash(hash)}
      <ArrowUpRight aria-hidden className="size-3" />
    </a>
  );
}

function FreezeCallout({ n }: { n: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={{ opacity: 0, scale: reduce ? 1 : 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease: EASE_OUT }}
      className="mt-3 flex origin-left items-end gap-3 rounded-lg border border-trip/35 bg-trip-soft px-4 py-3"
    >
      <span className="font-mono text-[56px] leading-[0.85] font-medium tracking-[-0.04em] text-trip tabular-nums sm:text-[64px]">{n}</span>
      <span className="pb-1 text-[14px] leading-snug text-fg">
        frozen {n} block{n === 1 ? "" : "s"}
        <span className="block text-fg-muted">after the theft</span>
      </span>
    </motion.div>
  );
}

function elapsed(at: string | undefined, t0: number | null) {
  if (!at || t0 === null) return null;
  const ms = Date.parse(at) - t0;
  return Number.isFinite(ms) && ms >= 0 ? `+${(ms / 1000).toFixed(1)}s` : null;
}

export function RunTrace({ steps, live }: { steps: StepView[]; live: boolean }) {
  const reduce = useReducedMotion();
  const firstAt = steps.find((s) => s.at)?.at;
  const t0 = firstAt ? Date.parse(firstAt) : null;
  const active = steps.reduce((n, s, i) => (s.status === "pending" ? n : i + 1), 0);

  return (
    <Timeline value={active} className="pl-1" aria-label="Lab run steps">
      {steps.map((raw, i) => {
        // ntfy.sh refuses Cloudflare Workers, so the server hands the push to the page, which sends it.
        // That hand-off is the designed path, not a failure of the run.
        const v: StepView = raw.id === "notify" && raw.status === "fail" && raw.ntfy
          ? { ...raw, status: "ok", title: `Phone push sent from the visitor's browser to ntfy.sh/${raw.ntfy.topic}`, detail: "ntfy.sh refuses connections from Cloudflare Workers, so the page sends it" }
          : raw;
        const reached = v.status !== "pending";
        const time = elapsed(v.at, t0);
        return (
          <TimelineItem key={v.id} step={i + 1} className="ms-9 not-last:pb-5" aria-current={live && v.status === "start" ? "step" : undefined}>
            <TimelineHeader>
              <TimelineSeparator className="w-px bg-line-strong group-data-[orientation=vertical]/timeline:h-[calc(100%-1.25rem-0.25rem)] group-data-[orientation=vertical]/timeline:translate-y-5.5" />
              <Indicator v={v} />
              <div className="flex min-w-0 items-baseline justify-between gap-3">
                <TimelineTitle className={cn("flex min-w-0 items-baseline gap-2.5 text-[14px] transition-colors duration-300", reached ? "text-fg" : "text-fg-faint")}>
                  <span className="font-mono text-[11px] text-fg-faint tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                  <span className="min-w-0">{STEP_LABEL[v.id]}</span>
                </TimelineTitle>
                {time ? <span className="shrink-0 font-mono text-[11px] text-fg-faint tabular-nums">{time}</span> : null}
              </div>
            </TimelineHeader>
            {reached ? (
              <TimelineContent
                render={
                  <motion.div
                    initial={{ opacity: 0, y: reduce ? 0 : 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, ease: EASE_OUT }}
                  />
                }
                className="mt-1 pl-[30px] text-[13px] leading-relaxed text-fg-muted"
              >
                {v.title ? <p className={cn("[overflow-wrap:anywhere]", v.status === "fail" && "text-trip")}>{v.title}</p> : null}
                {v.detail ? <p className="mt-0.5 font-mono text-[11.5px] [overflow-wrap:anywhere] text-fg-faint">{v.detail}</p> : null}
                {v.txs.length || typeof v.block === "number" ? (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {v.txs.map((t) => (
                      <TxLink key={t.hash} {...t} />
                    ))}
                    {typeof v.block === "number" ? (
                      <span className="inline-flex h-6 items-center rounded-md border border-line px-2 font-mono text-[11px] text-fg-faint tabular-nums">
                        block {v.block.toLocaleString("en-US")}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {v.id === "freeze" && v.status === "ok" && typeof v.blocks_after_trip === "number" ? <FreezeCallout n={v.blocks_after_trip} /> : null}
              </TimelineContent>
            ) : null}
          </TimelineItem>
        );
      })}
    </Timeline>
  );
}
