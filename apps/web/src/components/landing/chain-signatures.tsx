import { useEffect, useRef, useState } from "react";
import { useInView, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { txUrl } from "./content";
import { Frame, FramePanel } from "./frame";
import { Reveal, SourceLink } from "./primitives";
import { CHAINSIG as C, blockLabel, short } from "./proof-data";
import { Segmented } from "./segmented";

type Mode = 0 | 1 | 2;
type Node = { gate: string; title: (m: Mode) => string; sub: (m: Mode) => string };

const NODES: Node[] = [
  {
    gate: "signer",
    title: (m) => (m === 2 ? "owner key" : m === 1 ? "stolen agent key" : "agent key"),
    sub: (m) => (m === 2 ? "full access, never in the agent's reach" : m === 1 ? "deleted by the freeze" : "function-call key, sign_evm only"),
  },
  { gate: "layer 1 · NEAR", title: () => "access-key check", sub: () => `is the key still on ${C.agent}?` },
  { gate: "layer 2 · guardian", title: () => "guardian.sign_evm", sub: (m) => (m === 0 ? "not frozen: forwards the request" : "frozen flag set") },
  { gate: "NEAR MPC", title: () => C.mpc, sub: () => `derives the key from (${C.agent}, ${C.path})` },
  { gate: C.chain, title: () => short(C.evmAddress, 6, 4), sub: () => "the signature recovers to this address" },
];

/** Index of the node the request stops at, or the last node when it gets through. */
const STOP: Record<Mode, number> = { 0: 4, 1: 1, 2: 2 };

const RESULT: Record<Mode, { tone: "safe" | "trip"; head: string; body: string; tx?: string; block?: number }> = {
  0: {
    tone: "safe",
    head: "signed",
    body: `MPC signature over payload ${short(C.payload, 8, 6)}, verified by recovery to ${short(C.evmAddress, 6, 4)}.`,
    tx: C.signedTx,
    block: C.signedBlock,
  },
  1: {
    tone: "trip",
    head: C.stolenError,
    body: "The chain rejects the transaction before inclusion. No transaction hash exists.",
  },
  2: { tone: "trip", head: "refused", body: `"${C.ownerError}"`, tx: C.ownerRefusedTx, block: C.ownerRefusedBlock },
};

const MODES = [
  { label: "Before the freeze", short: "Before" },
  { label: "Stolen key, after", short: "Stolen key" },
  { label: "Owner, after", short: "Owner" },
];

function Connector({ lit, delay }: { lit: boolean; delay: number }) {
  return (
    <div aria-hidden className="relative mx-auto h-7 w-px lg:mx-0 lg:h-px lg:w-full lg:self-center">
      <span className="absolute inset-0 bg-line-strong" />
      <span
        className={cn(
          "absolute inset-0 bg-fg transition-[scale] duration-300 ease-linear max-lg:origin-top lg:origin-left",
          lit ? "max-lg:scale-y-100 lg:scale-x-100" : "max-lg:scale-y-0 lg:scale-x-0",
        )}
        style={{ transitionDelay: lit ? `${delay}ms` : "0ms" }}
      />
    </div>
  );
}

function NodeCard({ n, i, mode }: { n: Node; i: number; mode: Mode }) {
  const stop = STOP[mode];
  const reached = i <= stop;
  const blocked = reached && i === stop && mode !== 0;
  const done = mode === 0 && i === 4;
  return (
    <FramePanel
      className={cn(
        "flex h-full flex-col justify-between gap-3 lg:min-h-[124px] px-3.5 py-3.5 transition-[opacity,border-color,background-color] duration-300",
        reached ? "opacity-100" : "opacity-40",
        blocked && "border-trip/60 bg-trip-soft",
        done && "border-safe/45",
      )}
      style={{ transitionDelay: reached ? `${i * 240}ms` : "0ms" }}
    >
      <div className="flex items-center justify-between gap-2 font-mono text-[10px] text-fg-faint">
        <span className="truncate">{n.gate}</span>
        <span className={cn("size-1.5 shrink-0 rounded-full", blocked ? "bg-trip" : done ? "bg-safe" : reached ? "bg-fg" : "bg-line-strong")} />
      </div>
      <div className="min-w-0">
        <p className={cn("font-mono text-[12.5px] break-all", blocked ? "text-trip" : "text-fg")}>{n.title(mode)}</p>
        <p className="mt-1 text-[12px] leading-snug text-fg-muted">{n.sub(mode)}</p>
      </div>
    </FramePanel>
  );
}

export function ChainSignatures() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  const [mode, setMode] = useState<Mode>(0);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!inView || touched || reduce) return;
    const t = [setTimeout(() => setMode(1), 3600), setTimeout(() => setMode(2), 7200)];
    return () => t.forEach(clearTimeout);
  }, [inView, touched, reduce]);

  const pick = (m: number) => {
    setTouched(true);
    setMode(m as Mode);
  };
  const res = RESULT[mode];
  const frozen = mode !== 0;

  return (
    <section id="chain-signatures" aria-labelledby="chainsig-title" className="relative scroll-mt-20 overflow-hidden border-t border-line/70">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-trip/40 to-transparent" />
      <div className="mx-auto w-full max-w-[1200px] px-4 py-20 sm:px-6 md:py-28 lg:px-10">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="mb-4 font-mono text-[11px] tracking-[0.14em] text-fg-muted uppercase">Chain Signatures</p>
          <h2 id="chainsig-title" className="text-[30px] leading-[1.08] font-medium tracking-[-0.025em] text-balance sm:text-[40px]">
            One decoy trip.
            <span className="block text-fg-muted">Every chain goes dark.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-[56ch] text-[15px] leading-relaxed text-pretty text-fg-muted">
            The agent signs Ethereum transactions through the NEAR MPC network, by way of its guardian contract. The same
            freeze that deletes its NEAR keys shuts that path behind two independent checks.
          </p>
        </Reveal>

        <div ref={ref} className="mt-12">
          <Frame>
            <FramePanel className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
              <Segmented options={MODES} value={mode} onChange={pick} label="Who asks for a signature" />
              <div className="flex min-w-0 items-center gap-2.5 px-1 font-mono text-[11px]">
                <span className={cn("size-1.5 shrink-0 rounded-full transition-colors", frozen ? "bg-trip" : "bg-line-strong")} />
                <span className={cn("truncate transition-colors", frozen ? "text-fg" : "text-fg-faint")}>
                  freeze() {blockLabel(C.freezeBlock)} by {C.watcher}
                </span>
                <SourceLink href={txUrl(C.freezeTx)} className={cn("shrink-0 transition-opacity", frozen ? "opacity-100" : "opacity-40")}>
                  {short(C.freezeTx)}
                </SourceLink>
              </div>
            </FramePanel>

            <div className="mt-[3px] rounded-[10px] border border-line bg-ink-950/60 px-3 py-5 sm:px-5 lg:py-8">
              <ol className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)_24px_minmax(0,1fr)_24px_minmax(0,1fr)_24px_minmax(0,1fr)]">
                {NODES.map((n, i) => (
                  <li key={n.gate} className="contents">
                    {i > 0 ? <Connector lit={i <= STOP[mode]} delay={i * 240 - 120} /> : null}
                    <div className="h-full" aria-current={i === STOP[mode] ? "step" : undefined}>
                      <NodeCard n={n} i={i} mode={mode} />
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <FramePanel aria-live="polite" className="mt-[3px] flex flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="min-w-0 text-[13px] leading-relaxed text-fg-muted">
                <span className={cn("mr-2 font-mono text-[12px]", res.tone === "safe" ? "text-safe" : "text-trip")}>{res.head}</span>
                {res.body}
              </p>
              {res.tx ? (
                <SourceLink href={txUrl(res.tx)} className="shrink-0">
                  {blockLabel(res.block!)} · {short(res.tx)}
                </SourceLink>
              ) : (
                <span className="shrink-0 font-mono text-[11px] text-fg-faint">no tx: rejected at the RPC</span>
              )}
            </FramePanel>
          </Frame>
        </div>

        <p className="mx-auto mt-5 max-w-3xl text-center text-[13px] leading-relaxed text-fg-muted">
          Planned, not yet run: broadcasting to Sepolia. The derived address held 0 wei at proof time, so the signed
          transaction was built and checked by signature recovery but not sent.{" "}
          <SourceLink href={C.explorer}>address on Etherscan</SourceLink>
        </p>
      </div>
    </section>
  );
}
