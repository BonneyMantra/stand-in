import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";

/** The trip moment, in order: decoy node pulses → line draws to the thief → freeze counts
 *  up in blocks → agent account frozen. Reduced motion jumps straight to the end state. */
export type ReplayPhase = "idle" | "pulse" | "line" | "count" | "frozen";

const BLOCK_MS = 650;

export function useTripReplay(blocks: number, autoplayKey: string | null) {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<ReplayPhase>("frozen");
  const [block, setBlock] = useState(blocks);
  const timers = useRef<number[]>([]);

  const clear = () => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
  };

  const play = useCallback(() => {
    clear();
    if (reduce || blocks <= 0) {
      setPhase("frozen");
      setBlock(blocks);
      return;
    }
    const at = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));
    setPhase("pulse");
    setBlock(0);
    at(700, () => setPhase("line"));
    at(1450, () => setPhase("count"));
    for (let b = 1; b <= blocks; b++) at(1450 + b * BLOCK_MS, () => setBlock(b));
    at(1450 + blocks * BLOCK_MS + 250, () => setPhase("frozen"));
  }, [blocks, reduce]);

  // Autoplay once per key (a new live trip, or the first view of the overview).
  const played = useRef<string | null>(null);
  useEffect(() => {
    if (!autoplayKey || played.current === autoplayKey) return;
    played.current = autoplayKey;
    const t = window.setTimeout(play, 400);
    return () => window.clearTimeout(t);
  }, [autoplayKey, play]);

  useEffect(() => clear, []);
  return { phase, block, play, running: phase !== "frozen" && phase !== "idle" };
}
