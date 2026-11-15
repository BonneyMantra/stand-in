import { useEffect, useRef, useState } from "react";
import { useInView, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { INSTALL } from "./content";
import { Frame, FramePanel, PanelBar } from "./frame";
import { CommandLine, H2, LEDE, ReplayButton, Reveal } from "./primitives";
import { LiveLink } from "./cta";
import { BEATS, HOOKS, type Line } from "./agents-script";

const STEP_MS = 1300;

const TONE: Record<Line["t"], string> = {
  cmd: "text-fg",
  out: "text-fg-muted",
  hook: "text-decoy",
  hit: "text-trip",
  deny: "text-warn",
};

function Terminal({ who, version, prompt, at }: { who: "claude" | "codex"; version: string; prompt: string; at: number }) {
  const lines = BEATS.flatMap((b, bi) => b[who].map((l, li) => ({ ...l, bi, key: `${bi}-${li}` })));
  const lastShown = lines.filter((l) => l.bi <= at).at(-1)?.key;
  return (
    <Frame className="min-w-0">
      <FramePanel className="overflow-hidden">
        <PanelBar right={<span className="text-fg-faint">{version}</span>}>
          {who === "claude" ? "Claude Code" : "Codex"} <span className="text-fg-faint">·</span> ~/code/near-payments-agent
        </PanelBar>
        <ol className="space-y-0.5 px-4 py-4 font-mono text-[11.5px] leading-[1.55]">
          {lines.map((l, i) => {
            const shown = l.bi <= at;
            return (
              <li
                key={l.key}
                aria-hidden={!shown}
                className={cn(
                  i > 0 && lines[i - 1]!.bi !== l.bi && "pt-2.5",
                  "flex min-w-0 gap-2 transition-[opacity,transform] duration-300 ease-[var(--ease-out-strong)]",
                  shown ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
                )}
                style={{ transitionDelay: shown ? `${(i % 3) * 120}ms` : "0ms" }}
              >
                <span aria-hidden className="w-3 shrink-0 text-fg-faint select-none">
                  {l.t === "cmd" ? prompt : l.hook ? "↳" : ""}
                </span>
                <span className={cn("min-w-0 break-words", TONE[l.t])}>
                  {l.hook ? <span className="mr-2 rounded-[3px] border border-current/30 px-1 text-[10px]">{l.hook}</span> : null}
                  <span className={l.hook ? "text-fg-muted" : undefined}>{l.text}</span>
                  {l.key === lastShown ? <span aria-hidden className="ml-1 inline-block h-3.5 w-[6px] translate-y-[2px] animate-pulse bg-fg-muted" /> : null}
                </span>
              </li>
            );
          })}
        </ol>
      </FramePanel>
    </Frame>
  );
}

function HookRail({ at }: { at: number }) {
  const current = BEATS[Math.max(0, at)]?.hook;
  return (
    <ol aria-label="Hook sequence" className="relative grid grid-cols-2 gap-2 sm:grid-cols-4">
      {HOOKS.map((h) => {
        const idx = BEATS.findIndex((b) => b.hook === h);
        const done = idx <= at;
        const live = current === h;
        return (
          <li
            key={h}
            aria-current={live ? "step" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-md border px-3 py-2 font-mono text-[11px] transition-[border-color,color,background-color] duration-300",
              live ? "border-decoy/60 bg-decoy/10 text-fg" : done ? "border-line-strong text-fg-muted" : "border-line text-fg-faint",
            )}
          >
            <i aria-hidden className={cn("size-1.5 shrink-0 rounded-full transition-colors", live ? "bg-decoy" : done ? "bg-fg-muted" : "bg-line-strong")} />
            <span className="truncate">{h}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function Agents() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.35 });
  const [at, setAt] = useState(-1);
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (!inView) return;
    if (reduce) return setAt(BEATS.length - 1);
    setAt(0);
    const t = BEATS.slice(1).map((_, i) => setTimeout(() => setAt(i + 1), (i + 1) * STEP_MS));
    return () => t.forEach(clearTimeout);
  }, [inView, reduce, run]);

  const done = at >= BEATS.length - 1;

  return (
    <section id="agents" aria-labelledby="agents-title" className="relative scroll-mt-20">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-16 sm:px-6 md:py-24 lg:px-10">
        <Reveal className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 id="agents-title" className={H2}>
              Two agents. One set of hooks.
            </h2>
          </div>
          <div className="max-w-[470px]">
          <p className={LEDE}>
            Each session gets its own decoys at start, and every prompt, tool input and tool output is checked for them. No
            prompt changes; the agent keeps working with a key scoped to your contract.
          </p>
            <LiveLink to="/app/example/sessions" className="mt-5">See the recorded sessions</LiveLink>
          </div>
        </Reveal>

        <div ref={ref} className="mt-10 space-y-3">
          <HookRail at={at} />
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Terminal who="claude" version="v2.1.325" prompt=">" at={at} />
            <Terminal who="codex" version="codex-cli 0.169.0" prompt="$" at={at} />
          </div>
          <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
            <p className={cn("text-[13px] leading-relaxed text-fg-muted transition-opacity duration-500", done ? "opacity-100" : "opacity-0")}>
              When a decoy later signs on-chain, the watcher matches its key to these exposures: this session, this tool call.
            </p>
            <ReplayButton onClick={() => (setAt(-1), setRun((n) => n + 1))}>Replay</ReplayButton>
          </div>
        </div>

        <Reveal delay={0.05} className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
          {[
            { k: "Claude Code", lines: INSTALL.claude, p: "$" },
            { k: "Codex", lines: INSTALL.codex, p: "$" },
            { k: "Adopt the account (your wallet signs)", lines: INSTALL.cli, p: "$" },
          ].map((g) => (
            <div key={g.k} className="min-w-0">
              <p className="mb-2.5 text-[13px] font-medium text-fg">{g.k}</p>
              <div className="space-y-2">
                {g.lines.map((l) => (
                  <CommandLine key={l} command={l} prompt={g.p} />
                ))}
              </div>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
