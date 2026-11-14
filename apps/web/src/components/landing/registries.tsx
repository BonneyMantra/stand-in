import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useInView, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { txUrl } from "./content";
import { Frame, FramePanel } from "./frame";
import { ReplayButton, Reveal, SourceLink } from "./primitives";
import { FREEZE, blockLabel, short } from "./proof-data";
import { Scrubber } from "./scrubber";

const STOPS = [
  { label: "before", sub: "keys live" },
  { label: "freeze", sub: blockLabel(FREEZE.block) },
  { label: "queued intent", sub: blockLabel(FREEZE.rejectedBlock) },
];

/** Two stacked states in one grid cell, so swapping them never shifts layout. */
function Swap({ on, off, onNode, className }: { on: boolean; off: ReactNode; onNode: ReactNode; className?: string }) {
  const base = "col-start-1 row-start-1 transition-[opacity,transform] duration-300 ease-[var(--ease-out-strong)]";
  return (
    <span className={cn("grid justify-items-end", className)}>
      <span className={cn(base, on ? "translate-y-1 opacity-0" : "opacity-100")} aria-hidden={on}>
        {off}
      </span>
      <span className={cn(base, on ? "opacity-100" : "-translate-y-1 opacity-0")} aria-hidden={!on}>
        {onNode}
      </span>
    </span>
  );
}

function KeyRow({ k, role, struck, action, delay, keep }: { k: string; role: string; struck: boolean; action: string; delay: number; keep?: boolean }) {
  return (
    <li className="relative flex items-center justify-between gap-3 px-4 py-3.5 font-mono text-[11.5px]">
      <span className={cn("relative min-w-0 transition-opacity duration-300", struck && "opacity-45")} style={{ transitionDelay: `${delay}ms` }}>
        <span className="relative block max-w-full truncate text-fg sm:inline-block">
          {k}
          <span
            aria-hidden
            className="absolute inset-x-0 top-1/2 h-px origin-left bg-trip transition-transform duration-500 ease-[var(--ease-out-strong)]"
            style={{ transform: `scaleX(${struck ? 1 : 0})`, transitionDelay: `${delay}ms` }}
          />
        </span>
        <span className="block truncate text-fg-faint">{role}</span>
      </span>
      <Swap
        on={struck}
        off={<span className={keep ? "text-fg-muted" : "text-safe"}>{keep ? "held outside" : "live"}</span>}
        onNode={<span className={keep ? "text-fg-muted" : "text-trip"}>{action}</span>}
        className="shrink-0"
      />
    </li>
  );
}

function Ledger({ account, kind, children }: { account: string; kind: string; children: ReactNode }) {
  return (
    <FramePanel className="overflow-hidden">
      <div className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-3">
        <p className="truncate font-mono text-[12px] text-fg">{account}</p>
        <p className="shrink-0 font-mono text-[10.5px] text-fg-faint">{kind}</p>
      </div>
      <ul className="divide-y divide-line">{children}</ul>
    </FramePanel>
  );
}

export function Registries() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.45 });
  const [step, setStep] = useState(0);
  const [touched, setTouched] = useState(false);
  const [sweep, setSweep] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const stepRef = useRef(0);
  const go = (i: number) => {
    if (i >= 1 && stepRef.current < 1) setSweep((n) => n + 1);
    stepRef.current = i;
    setStep(i);
  };
  const clear = () => timers.current.forEach(clearTimeout);
  const play = () => {
    clear();
    go(0);
    if (reduce) return go(2);
    timers.current = [setTimeout(() => go(1), 650), setTimeout(() => go(2), 2300)];
  };

  useEffect(() => {
    if (inView && !touched) play();
    return clear;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView]);

  const struck = step >= 1;
  const rejected = step >= 2;

  return (
    <section id="registries" aria-labelledby="registries-title" className="relative scroll-mt-20 border-t border-line/70">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-20 sm:px-6 md:py-28 lg:px-10">
        <Reveal className="grid grid-cols-1 items-end gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:gap-16">
          <div>
            <p className="mb-4 font-mono text-[11px] tracking-[0.14em] text-fg-muted uppercase">The freeze</p>
            <h2 id="registries-title" className="text-[30px] leading-[1.08] font-medium tracking-[-0.025em] text-balance sm:text-[40px]">
              One call strikes both ledgers.
            </h2>
            <p className="mt-4 max-w-[52ch] text-[15px] leading-relaxed text-pretty text-fg-muted">
              A signed NEAR Intents order can wait in a queue and settle after the account keys are gone. So the freeze
              removes the agent's key from the account and from the intents registry in the same transaction.
            </p>
          </div>
          <div onPointerDown={() => (setTouched(true), clear())} onKeyDown={() => (setTouched(true), clear())}>
            <Scrubber stops={STOPS} value={step} onChange={go} label="Freeze timeline" />
          </div>
        </Reveal>

        <div ref={ref} className="mt-10">
          <Frame>
            <div className="relative grid grid-cols-1 gap-[3px] lg:grid-cols-[minmax(0,1fr)_200px_minmax(0,1fr)]">
              <Ledger account={FREEZE.agent} kind="access keys">
                <KeyRow k={short(FREEZE.agentKey, 10, 6)} role="function-call · agent" struck={struck} action="DeleteKey" delay={380} />
                <KeyRow k="owner full-access key" role="never recorded by the guardian" struck={false} action="kept" delay={0} keep />
              </Ledger>

              <FramePanel className="flex flex-col items-center justify-center gap-2 px-4 py-5 text-center">
                <span className="font-mono text-[10.5px] text-fg-faint">{blockLabel(FREEZE.block)}</span>
                <span className={cn("font-mono text-[15px] transition-colors duration-300", struck ? "text-trip" : "text-fg")}>freeze()</span>
                <span className="font-mono text-[10.5px] text-fg-muted">signed by {FREEZE.by}</span>
                <SourceLink href={txUrl(FREEZE.tx)}>{short(FREEZE.tx)}</SourceLink>
              </FramePanel>

              <Ledger account={FREEZE.intents} kind="intents public keys">
                <KeyRow k={short(FREEZE.intentsKey, 10, 6)} role={`registered for ${FREEZE.agent}`} struck={struck} action="remove_public_key" delay={380} />
              </Ledger>

              {sweep > 0 && !reduce ? (
                <motion.div
                  key={sweep}
                  aria-hidden
                  className="pointer-events-none absolute inset-0 z-10"
                  initial={{ y: "-2%", opacity: 0 }}
                  animate={{ y: "100%", opacity: [0, 1, 1, 0] }}
                  transition={{ duration: 1.1, ease: [0.77, 0, 0.175, 1], times: [0, 0.1, 0.85, 1] }}
                >
                  <span className="absolute inset-x-0 top-0 h-px bg-trip shadow-[0_0_16px_2px_rgba(255,74,61,0.55)]" />
                </motion.div>
              ) : null}
            </div>

            <FramePanel className="mt-[3px] flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 font-mono text-[11.5px]">
                <p className="text-fg">
                  execute_signed <span className="text-fg-muted">· nonce 2 · transfer</span>
                </p>
                <p className="truncate text-fg-faint">"{FREEZE.rejectedNote}", signed before the freeze</p>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "inline-flex h-7 items-center rounded-md border px-2.5 font-mono text-[11px] transition-[color,border-color,background-color,transform] duration-300 ease-[var(--ease-out-strong)]",
                    rejected ? "scale-100 border-trip/50 bg-trip-soft text-trip" : "border-line-strong text-fg-muted",
                  )}
                >
                  {rejected ? "PublicKeyNotExist" : "waiting in queue"}
                </span>
                <SourceLink href={txUrl(FREEZE.rejectedTx)} className={cn("transition-opacity", rejected ? "opacity-100" : "opacity-40")}>
                  {short(FREEZE.rejectedTx)}
                </SourceLink>
              </div>
            </FramePanel>
          </Frame>
        </div>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <p className="max-w-3xl text-[13px] leading-relaxed text-fg-muted">
            The signature on the queued intent is still valid. The registry checks whether the key is registered for the
            signer now, and it is not. On testnet the intents side is a replica of the near/intents key registry with the
            same check order.
          </p>
          <ReplayButton onClick={() => (setTouched(true), play())}>Replay the freeze</ReplayButton>
        </div>
      </div>
    </section>
  );
}
