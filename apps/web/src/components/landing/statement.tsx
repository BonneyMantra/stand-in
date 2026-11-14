import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useTransform, type MotionValue } from "motion/react";

const TEXT =
  "Stand-in does not try to stop an agent from reading files. It makes sure that what it reads is bait, and that using the bait costs the thief more than it costs you.";
const WORDS = TEXT.split(" ");

function Word({ progress, from, to, children }: { progress: MotionValue<number>; from: number; to: number; children: string }) {
  const opacity = useTransform(progress, [from, to], [0.35, 1]);
  return <motion.span style={{ opacity }}>{children} </motion.span>;
}

/** A centred statement that fills in word by word as it scrolls through the viewport. */
export function Statement() {
  const ref = useRef<HTMLParagraphElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.85", "end 0.45"] });

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-16 sm:px-6 md:py-24 lg:px-10">
      <p
        ref={ref}
        className="mx-auto max-w-[820px] text-center text-[24px] leading-[1.3] font-medium tracking-[-0.015em] text-balance text-fg sm:text-[32px] sm:leading-[1.28]"
      >
        {reduce
          ? TEXT
          : WORDS.map((w, i) => (
              <Word key={i} progress={scrollYProgress} from={i / WORDS.length} to={(i + 1) / WORDS.length}>
                {w}
              </Word>
            ))}
      </p>
    </div>
  );
}
