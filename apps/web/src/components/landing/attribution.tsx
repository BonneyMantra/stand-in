import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { Frame, FramePanel, PanelBar } from "./frame";
import { EASE_OUT, Reveal, Section, SectionHead } from "./primitives";

type Tone = "neutral" | "tool" | "trip" | "chain" | "safe";
type Row = { depth: 0 | 1; label: string; meta?: string; start: number; end: number; tone: Tone; note?: string };

// Mirrors bench route 07 (cat ~/.near-credentials, then POST to a remote host); axis spans that run's 9 s.
const ROWS: Row[] = [
  { depth: 0, label: "claude · s_4f2a", meta: "Claude Code", start: 0, end: 100, tone: "neutral" },
  { depth: 1, label: "Read", meta: "README.md", start: 4, end: 12, tone: "tool" },
  { depth: 1, label: "Bash", meta: "cat ~/.near-credentials", start: 14, end: 24, tone: "trip", note: "decoy in output" },
  { depth: 1, label: "Bash", meta: "curl -X POST …/collect", start: 27, end: 40, tone: "trip", note: "decoy in input" },
  { depth: 0, label: "on-chain", meta: "NEAR testnet", start: 44, end: 100, tone: "neutral" },
  { depth: 1, label: "Transfer", meta: "signed by decoy key", start: 46, end: 58, tone: "trip", note: "trip" },
  { depth: 1, label: "freeze", meta: "guardian · block +1", start: 60, end: 72, tone: "chain" },
  { depth: 1, label: "DeleteKey", meta: "agent + intents keys · block +2", start: 72, end: 84, tone: "chain" },
  { depth: 1, label: "report", meta: "blocklist · TEE verdict", start: 86, end: 98, tone: "safe" },
];

const BAR: Record<Tone, string> = {
  neutral: "bg-line-strong",
  tool: "bg-fg-faint",
  trip: "bg-trip",
  chain: "bg-fg-muted",
  safe: "bg-safe",
};

const STATS = [
  { k: "Session", v: "s_4f2a" },
  { k: "Tool calls", v: "3" },
  { k: "Exposures", v: "2", trip: true },
  { k: "Freeze", v: "block +2" },
];

function Waterfall() {
  const reduce = useReducedMotion();
  return (
    <Frame>
      <FramePanel className="overflow-hidden">
        <PanelBar right={<span className="text-trip">tripped</span>}>
          trips <span className="text-fg-faint">/</span> <span className="text-fg">trace</span>
        </PanelBar>
        <dl className="grid grid-cols-2 border-b border-line sm:grid-cols-4">
          {STATS.map((s, i) => (
            <div key={s.k} className={cn("px-4 py-3", i % 2 === 1 && "border-l border-line", i >= 2 && "border-t border-line sm:border-t-0", i === 2 && "sm:border-l")}>
              <dt className="font-mono text-[10.5px] text-fg-muted">{s.k}</dt>
              <dd className={cn("mt-1 font-mono text-[15px]", s.trip ? "text-trip" : "text-fg")}>{s.v}</dd>
            </div>
          ))}
        </dl>

        <div className="grid grid-cols-[minmax(0,1fr)] font-mono text-[11px] sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="hidden border-b border-line px-4 py-2 text-fg-muted sm:block">steps</div>
          <div className="relative hidden border-b border-l border-line px-4 py-2 text-fg-muted sm:flex sm:justify-between">
            <span>0s</span>
            <span>3s</span>
            <span>6s</span>
            <span>9s</span>
          </div>

          {ROWS.map((r, i) => (
            <div key={i} className="contents">
              <div
                className={cn(
                  "flex min-w-0 items-center gap-2 px-4 pt-2.5 sm:py-2.5",
                  r.depth === 1 && "pl-8",
                  r.depth === 0 && i > 0 && "mt-1 border-t border-line pt-3 sm:mt-0",
                )}
              >
                <i className={cn("size-1.5 shrink-0 rounded-full", BAR[r.tone])} aria-hidden />
                <span className={cn("shrink-0", r.tone === "trip" ? "text-trip" : "text-fg")}>{r.label}</span>
                {r.meta ? <span className="truncate text-fg-muted">{r.meta}</span> : null}
              </div>
              <div
                className={cn(
                  "relative flex items-center px-4 pt-1.5 pb-2.5 sm:border-l sm:border-line sm:py-2.5",
                  r.depth === 0 && i > 0 && "sm:border-t sm:border-t-line",
                )}
              >
                <div className="relative h-4 w-full">
                  <motion.span
                    className={cn("absolute inset-y-0.5 origin-left rounded-[3px]", BAR[r.tone], r.depth === 0 && "opacity-50")}
                    style={{ left: `${r.start}%`, width: `${r.end - r.start}%` }}
                    initial={{ scaleX: reduce ? 1 : 0 }}
                    whileInView={{ scaleX: 1 }}
                    viewport={{ once: true, margin: "-15% 0px" }}
                    transition={{ duration: 0.5, delay: reduce ? 0 : 0.1 + i * 0.06, ease: EASE_OUT }}
                  />
                  {r.note ? (
                    <span
                      className={cn(
                        "absolute top-1/2 -translate-y-1/2 pl-2 text-[10px] whitespace-nowrap",
                        r.tone === "trip" ? "text-trip" : "text-fg-muted",
                      )}
                      style={{ left: `${Math.min(r.end, 74)}%` }}
                    >
                      {r.note}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      </FramePanel>
    </Frame>
  );
}

export function Attribution() {
  return (
    <Section id="attribution" labelledBy="attribution-title">
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
        <SectionHead
          id="attribution-title"
          eyebrow="Attribution"
          title="One account, many keys."
          muted="The key says where it leaked."
          className="lg:pt-6"
        >
          <p>
            A NEAR account can hold many access keys. Stand-in puts every decoy on one bait account, one key per place
            it planted it, so the key that signs the drain points to a single file or session.
          </p>
          <p>
            Hooks in Claude Code and Codex record where a decoy showed up in a tool's input or output. When the key
            trips, the dashboard joins the two: this session, this tool call, this block.
          </p>
          <p className="text-fg">On EVM this cannot work: there, a key is the account.</p>
        </SectionHead>
        <Reveal delay={0.08}>
          <Waterfall />
        </Reveal>
      </div>
    </Section>
  );
}
