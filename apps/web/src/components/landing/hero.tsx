import { motion, useReducedMotion } from "motion/react";
import { Link } from "react-router";
import { EXAMPLE_PATH, OWNER_PATH, SETUP_PROMPT } from "./content";
import { AccentLink, Bleed, lineBtn, quietBtn } from "./cta";
import { CopyIcon, EASE_OUT, useCopy } from "./primitives";
import { TripMap } from "./trip-map";

/* Axiom's hero streaks: thin diagonal light lines in the top-right. One of them carries the page's
   single moving light, a glint that travels it on a 3.6s loop (CSS, off under reduced motion). */
const STREAKS = [
  { top: "6%", right: "-6%", w: 520, o: 0.4, red: false },
  { top: "14%", right: "6%", w: 360, o: 0.3, red: true },
  { top: "22%", right: "-2%", w: 640, o: 0.6, red: true, glint: true },
  { top: "31%", right: "14%", w: 300, o: 0.3, red: false },
  { top: "40%", right: "2%", w: 460, o: 0.16, red: false },
];

function Streaks() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[720px] overflow-hidden">
      <div className="absolute top-[-160px] right-[-120px] size-[620px] rounded-full bg-[radial-gradient(closest-side,rgba(255,74,61,0.08),transparent)]" />
      {STREAKS.map((s, i) => (
        <span
          key={i}
          className="absolute h-px origin-right -rotate-[38deg]"
          style={{ top: s.top, right: s.right, width: s.w }}
        >
          <span
            className="absolute inset-0"
            style={{
              opacity: s.o,
              background: `linear-gradient(90deg, transparent, ${s.red ? "rgba(255,74,61,0.9)" : "rgba(237,237,240,0.8)"} 70%, transparent)`,
            }}
          />
          {s.glint ? (
            <span
              className="streak-glint absolute top-1/2 left-0 h-[2px] w-[22%] -translate-y-1/2 rounded-full"
              style={{
                background: "linear-gradient(90deg, transparent, rgba(255,214,208,0.95) 70%, #fff, transparent)",
                boxShadow: "0 0 14px 2px rgba(255,74,61,0.55), 0 0 40px 6px rgba(255,74,61,0.18)",
              }}
            />
          ) : null}
        </span>
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
    <section aria-labelledby="hero-title" className="relative overflow-x-clip">
      <Streaks />
      <div className="relative mx-auto w-full max-w-[1200px] px-4 pt-20 pb-8 sm:px-6 sm:pt-28 lg:px-10 lg:pt-32">
        <motion.h1
          id="hero-title"
          {...rise(0)}
          className="max-w-[900px] text-[40px] leading-[1.02] font-medium tracking-[-0.015em] text-balance sm:text-[56px] lg:text-[64px] lg:leading-[64px]"
        >
          Your agent can read your keys. <span className="sm:block">Make sure they're fake.</span>
        </motion.h1>

        <motion.p
          {...rise(0.08, 10)}
          className="mt-6 max-w-[576px] text-[15px] leading-[22.5px] text-pretty text-white/[0.63]"
        >
          Stand-in gives AI coding agents decoy NEAR keys. When one leaks and gets used, the real account freezes
          on-chain within about three blocks (measured on testnet). Connect your testnet wallet: one approval protects
          your own account.
        </motion.p>

        <motion.div {...rise(0.14, 8)} className="mt-8 flex flex-wrap items-center gap-3">
          <AccentLink to={OWNER_PATH}>Protect your account</AccentLink>
          <Link to={EXAMPLE_PATH} className={lineBtn}>See an example</Link>
          <button type="button" onClick={() => copy(SETUP_PROMPT)} className={quietBtn}>
            <CopyIcon copied={copied} />
            <span className="relative">
              <span className={copied ? "invisible" : ""}>Copy the agent setup prompt</span>
              <span className={`absolute inset-0 ${copied ? "" : "invisible"}`}>Prompt copied</span>
            </span>
          </button>
          <span className="sr-only" aria-live="polite">
            {copied ? "Setup prompt copied. Paste it into Claude Code or Codex." : ""}
          </span>
        </motion.div>
      </div>

      <motion.div {...rise(0.24, 18)} className="relative mx-auto w-full max-w-[1200px] px-4 pb-8 sm:px-6 lg:px-10">
        <Bleed className="mt-6 sm:mt-10 lg:-ml-6">
          <TripMap />
        </Bleed>
      </motion.div>
    </section>
  );
}
