import { Link } from "react-router";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight } from "lucide-react";
import { DASHBOARD_PATH, SETUP_PROMPT } from "./content";
import { CopyIcon, EASE_OUT, useCopy } from "./primitives";
import { focusRing } from "./nav";
import { TripMap } from "./trip-map";

/* Axiom's hero streaks: thin diagonal light lines in the top-right. Static, decorative. */
const STREAKS = [
  { top: "6%", right: "-6%", w: 520, o: 0.55, red: false },
  { top: "14%", right: "6%", w: 360, o: 0.35, red: true },
  { top: "22%", right: "-2%", w: 640, o: 0.25, red: false },
  { top: "31%", right: "14%", w: 300, o: 0.4, red: true },
  { top: "40%", right: "2%", w: 460, o: 0.18, red: false },
];

function Streaks() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[720px] overflow-hidden">
      <div className="absolute top-[-160px] right-[-120px] size-[620px] rounded-full bg-[radial-gradient(closest-side,rgba(255,74,61,0.10),transparent)]" />
      {STREAKS.map((s, i) => (
        <span
          key={i}
          className="absolute h-px origin-right -rotate-[38deg]"
          style={{
            top: s.top,
            right: s.right,
            width: s.w,
            opacity: s.o,
            background: `linear-gradient(90deg, transparent, ${s.red ? "rgba(255,74,61,0.9)" : "rgba(237,237,240,0.8)"} 70%, transparent)`,
            boxShadow: s.red ? "0 0 12px rgba(255,74,61,0.6)" : "0 0 10px rgba(237,237,240,0.25)",
          }}
        />
      ))}
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-ink-950" />
    </div>
  );
}

export function Hero() {
  const reduce = useReducedMotion();
  const { copied, copy } = useCopy(2200);
  const rise = (delay: number, y = 12) => ({
    initial: { opacity: 0, y: reduce ? 0 : y },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.6, delay: reduce ? 0 : delay, ease: EASE_OUT },
  });

  return (
    <section aria-labelledby="hero-title" className="relative overflow-hidden">
      <Streaks />
      <div className="relative mx-auto w-full max-w-[1200px] px-4 pt-14 pb-16 sm:px-6 sm:pt-20 lg:px-10 lg:pt-20">
        <motion.p
          {...rise(0, 0)}
          className="mb-6 inline-flex items-center gap-2 rounded-full border border-line-strong bg-ink-900/70 px-3 py-1 font-mono text-[11px] text-fg-muted"
        >
          <i className="size-1.5 rounded-full bg-safe" />
          Live on NEAR testnet · Free and open source
        </motion.p>

        <motion.h1
          id="hero-title"
          {...rise(0)}
          className="text-[36px] leading-[1.05] font-medium tracking-[-0.035em] text-balance sm:text-[56px] lg:text-[66px]"
        >
          Your agent can read your keys.{" "}
          <span className="block text-fg-muted">Make sure they're fake.</span>
        </motion.h1>

        <motion.p
          {...rise(0.09, 10)}
          className="mt-6 max-w-[58ch] text-[16px] leading-relaxed text-pretty text-fg-muted sm:text-[17px]"
        >
          Stand-in gives AI coding agents decoy NEAR keys. When one leaks and gets used, the real account freezes
          on-chain within about two blocks, and the dashboard names the session and the tool call that leaked it.
        </motion.p>

        <motion.div {...rise(0.16, 8)} className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            to={DASHBOARD_PATH}
            className={`group/cta inline-flex h-10 items-center gap-2 rounded-md bg-fg px-4 text-[14px] font-medium text-ink-950 transition-[background-color,transform] duration-150 hover:bg-white active:scale-[0.98] ${focusRing}`}
          >
            Open the live dashboard
            <ArrowRight
              aria-hidden
              className="size-4 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover/cta:translate-x-0.5"
            />
          </Link>
          <button
            type="button"
            onClick={() => copy(SETUP_PROMPT)}
            className={`inline-flex h-10 items-center gap-2 rounded-md border border-line-strong bg-ink-900/80 px-4 text-[14px] text-fg transition-[background-color,transform] duration-150 hover:bg-ink-800 active:scale-[0.98] ${focusRing}`}
          >
            <CopyIcon copied={copied} />
            <span className="relative">
              <span className={copied ? "invisible" : ""}>Copy setup prompt</span>
              <span className={`absolute inset-0 ${copied ? "" : "invisible"}`}>Prompt copied</span>
            </span>
          </button>
          <span className="sr-only" aria-live="polite">
            {copied ? "Setup prompt copied. Paste it into Claude Code or Codex." : ""}
          </span>
          <span className="hidden font-mono text-[11px] text-fg-muted lg:inline">
            paste it into Claude Code or Codex
          </span>
        </motion.div>

        <motion.div {...rise(0.26, 18)} className="mt-12 sm:mt-14">
          <TripMap />
        </motion.div>
      </div>
    </section>
  );
}
