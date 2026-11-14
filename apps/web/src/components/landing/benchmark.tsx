import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { BENCH_URL } from "./content";
import { BENCH_RESULTS as R, BENCH_ROWS } from "./bench-data";
import { RouteRow } from "./bench-row";
import { Frame, FramePanel } from "./frame";
import { EASE_OUT, Reveal, SourceLink } from "./primitives";

const day = (iso: string) => iso.slice(0, 10);

function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Stand-in"
      onClick={() => onChange(!on)}
      className="group/sw inline-flex items-center gap-3 rounded-full py-1 pr-1 pl-0 lg:pl-4 font-mono text-[12px] text-fg-muted transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg-muted"
    >
      Stand-in <span className={cn("w-6 text-left transition-colors", on ? "text-fg" : "text-trip")}>{on ? "on" : "off"}</span>
      <span
        className={cn(
          "relative h-7 w-[52px] rounded-full border transition-[background-color,border-color] duration-300",
          on ? "border-safe/50 bg-safe-soft" : "border-trip/50 bg-trip-soft",
        )}
      >
        <span
          className={cn(
            "absolute top-[3px] left-[3px] size-5 rounded-full transition-[transform,background-color] duration-300 ease-[var(--ease-out-strong)] group-active/sw:scale-95",
            on ? "translate-x-6 bg-safe" : "translate-x-0 bg-trip",
          )}
        />
      </span>
    </button>
  );
}

function Headline({ on }: { on: boolean }) {
  const reduce = useReducedMotion();
  const value = on ? `${R.realAccountDeltaNear}`.replace("-", "−") : `−${R.baselineLostNear}`;
  return (
    <div>
      <p className="font-mono text-[11px] tracking-[0.14em] text-fg-muted uppercase">
        {on ? "Real account, whole run" : `Lost across ${R.baselineThefts} routes`}
      </p>
      <div className="relative mt-3 h-[64px] overflow-hidden sm:h-[92px]">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.p
            key={value}
            initial={{ y: reduce ? 0 : "60%", opacity: 0, filter: "blur(4px)" }}
            animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
            exit={{ y: reduce ? 0 : "-60%", opacity: 0, filter: "blur(4px)" }}
            transition={{ duration: 0.45, ease: EASE_OUT }}
            className={cn(
              "absolute inset-x-0 top-0 text-[54px] leading-none font-medium tracking-[-0.04em] tabular-nums sm:text-[84px]",
              on ? "text-fg" : "text-trip",
            )}
          >
            {value}
            <span className="ml-3 text-[20px] tracking-[-0.01em] text-fg-muted sm:text-[28px]">NEAR</span>
          </motion.p>
        </AnimatePresence>
      </div>
      <p className="mt-3 max-w-[48ch] text-[14px] leading-relaxed text-fg-muted" aria-live="polite">
        {on
          ? `Gas only. Every theft hit the decoy account, and the real agent account froze within ${R.minBlocks} to ${R.maxBlocks} blocks.`
          : `Stand-in off: the same attacks against a disposable testnet account. ${R.baselineThefts} thefts landed, about 0.2 NEAR each.`}
      </p>
    </div>
  );
}

const FACTS = [
  { v: `${R.frozen}/${R.thefts}`, k: "thefts froze" },
  { v: `${R.medianBlocks}`, k: `median blocks (${R.minBlocks}–${R.maxBlocks})` },
  { v: `${R.attributedSession}`, k: "named the session" },
  { v: `${R.attributedToolCall}`, k: "named the tool call" },
];

export function Benchmark() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.3 });
  const [on, setOn] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!inView || touched || reduce) return;
    const t = setTimeout(() => setOn(true), 1600);
    return () => clearTimeout(t);
  }, [inView, touched, reduce]);

  const real = BENCH_ROWS.filter((r) => r.group === "real");
  const scripted = BENCH_ROWS.filter((r) => r.group === "scripted");
  const flip = (v: boolean) => (setTouched(true), setOn(v));

  return (
    <section id="benchmark" aria-labelledby="benchmark-title" className="relative scroll-mt-20 border-t border-line/70">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-20 sm:px-6 md:py-28 lg:px-10">
        <h2 id="benchmark-title" className="sr-only">
          Benchmark: {BENCH_ROWS.length} leak routes on testnet, with Stand-in on and off
        </h2>
        <Reveal className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <Headline on={on} />
          <div className="flex flex-col items-start gap-5 lg:items-end">
            <Switch on={on} onChange={flip} />
            <dl className="grid grid-cols-4 gap-x-5 font-mono">
              {FACTS.map((f) => (
                <div key={f.k} className={cn("transition-opacity duration-300", on ? "opacity-100" : "opacity-35")}>
                  <dt className="sr-only">{f.k}</dt>
                  <dd className="text-[20px] text-fg tabular-nums">{f.v}</dd>
                  <dd aria-hidden className="mt-0.5 text-[10px] leading-tight text-fg-faint">{f.k}</dd>
                </div>
              ))}
            </dl>
          </div>
        </Reveal>

        <div ref={ref} className="mt-10">
          <Frame>
            <FramePanel className="overflow-hidden">
              <div aria-hidden className="hidden grid-cols-[26px_minmax(0,1fr)_200px_minmax(0,230px)] gap-x-3 border-b border-line px-4 py-2 font-mono text-[10.5px] text-fg-faint lg:grid">
                <span>#</span>
                <span>route</span>
                <span>{on ? "blocks from theft to freeze" : "NEAR lost per route"}</span>
                <span className="text-right">{on ? "Stand-in on" : "Stand-in off"}</span>
              </div>
              <Group
                title="Real agents"
                meta={`Claude Code ${R.versions.claude} · ${R.versions.codex} · ${R.realRun.complete ? `run ${day(R.realRun.generatedAt)}` : "run in progress"}`}
              />
              <ol className="divide-y divide-line">
                {real.map((r, i) => (
                  <RouteRow key={r.id} r={r} on={on} index={i} />
                ))}
              </ol>
              <Group title="Scripted attacks" meta={`same hook entry point · run ${day(R.scriptedRun.generatedAt)} · ${R.scriptedRun.network}`} />
              <ol className="divide-y divide-line">
                {scripted.map((r, i) => (
                  <RouteRow key={r.id} r={r} on={on} index={i + real.length} />
                ))}
              </ol>
            </FramePanel>
          </Frame>
        </div>

        <div className="mt-5 flex flex-col gap-3 text-[13px] leading-relaxed text-fg-muted sm:flex-row sm:items-start sm:justify-between">
          <p className="max-w-3xl">
            Each route runs twice: Stand-in on, then off against a disposable account. Scripted routes replay a fixed
            attack through the real hook entry point; they prove the hook, ledger and watcher path, not that a model obeys
            an injection. <span className="font-mono text-[11px] text-decoy">S</span> session named,{" "}
            <span className="font-mono text-[11px] text-decoy">T</span> exact tool call named.
          </p>
          <SourceLink href={BENCH_URL} className="shrink-0">
            bench/results.json
          </SourceLink>
        </div>
      </div>
    </section>
  );
}

function Group({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-y border-line bg-ink-950/60 px-4 py-2.5 max-lg:first:border-t-0">
      <p className="text-[13px] font-medium text-fg">{title}</p>
      <p className="font-mono text-[10.5px] text-fg-faint">{meta}</p>
    </div>
  );
}
