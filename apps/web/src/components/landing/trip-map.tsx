import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { Frame, FramePanel, PanelBar } from "./frame";
import { LAND, MAP_COLS, MAP_ROWS } from "./world-map";
import { BAIT_ACCOUNT, DECOYS, REAL_ACCOUNT, THIEF, TRIPPED } from "./trip-data";
import { TripEvents } from "./trip-events";
import { EASE_OUT } from "./primitives";

const CELL = 10;
const W = MAP_COLS * CELL;
const H = MAP_ROWS * CELL;
const px = (col: number) => col * CELL + CELL / 2;
const py = (row: number) => row * CELL + CELL / 2;

// Phase timeline (ms from loop start). 0 idle, 1 trip, 2 line to thief, 3..7 one event row each.
const SCHEDULE = [0, 1600, 2050, 2500, 3100, 3700, 4400, 5000];
const LOOP_MS = 10500;
export const FINAL_PHASE = SCHEDULE.length - 1;

function useTripPhase(active: boolean, reduce: boolean) {
  const [phase, setPhase] = useState(reduce ? FINAL_PHASE : 0);
  useEffect(() => {
    if (reduce) {
      setPhase(FINAL_PHASE);
      return;
    }
    if (!active) return;
    let timers: ReturnType<typeof setTimeout>[] = [];
    const run = () => {
      timers = SCHEDULE.map((t, i) => setTimeout(() => setPhase(i), t));
      timers.push(setTimeout(run, LOOP_MS));
    };
    run();
    return () => timers.forEach(clearTimeout);
  }, [active, reduce]);
  return phase;
}

export function TripMap() {
  const reduce = useReducedMotion() ?? false;
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-10% 0px" });
  const phase = useTripPhase(inView, reduce);
  const tripped = phase >= 1;
  const frozen = phase >= 4;

  const dots = useMemo(() => {
    const out: { x: number; y: number }[] = [];
    LAND.forEach((line, r) => {
      for (let c = 0; c < line.length; c++) if (line[c] === "#") out.push({ x: px(c), y: py(r) });
    });
    return out;
  }, []);

  const trip = DECOYS.find((d) => d.id === TRIPPED)!;
  const [x1, y1, x2, y2] = [px(trip.col), py(trip.row), px(THIEF.col), py(THIEF.row)];
  const arc = `M ${x1} ${y1} Q ${(x1 + x2) / 2} ${Math.min(y1, y2) - 70} ${x2} ${y2}`;

  return (
    <Frame ref={ref} className="shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9)]">
      <FramePanel className="overflow-hidden">
        <PanelBar
          right={
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] transition-colors duration-300",
                frozen ? "border-trip/40 bg-trip-soft text-trip" : "border-line-strong text-fg-muted",
              )}
            >
              <i className={cn("size-1.5 rounded-full", frozen ? "bg-trip" : "bg-safe")} />
              {frozen ? "frozen" : "watching"}
            </span>
          }
        >
          stand-in <span className="text-fg-faint">/</span> {REAL_ACCOUNT} <span className="text-fg-faint">/</span>{" "}
          <span className="text-fg">decoys</span>
        </PanelBar>

        <div className="grid lg:grid-cols-[1fr_300px]">
          <div className="relative border-line lg:border-r">
            <div className="flex items-center justify-between gap-3 px-4 pt-3 font-mono text-[11px] text-fg-muted">
              <span>
                {DECOYS.length} decoy keys on <span className="text-fg">{BAIT_ACCOUNT}</span>
              </span>
              <span className="hidden sm:inline">one account · one key per location</span>
            </div>

            {/* Below sm the map is cropped to the trip (decoy to thief) so the scene stays legible. */}
            <div className="relative overflow-hidden">
            <div className="relative -ml-[64%] aspect-[88/32] w-[190%] sm:mx-auto sm:w-full sm:max-w-[880px]">
              <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 size-full" aria-hidden>
                <g className="fill-fg-faint" opacity={0.55}>
                  {dots.map((d, i) => (
                    <circle key={i} cx={d.x} cy={d.y} r={1.5} />
                  ))}
                </g>

                <motion.path
                  d={arc}
                  fill="none"
                  className="stroke-trip"
                  strokeWidth={1.5}
                  strokeDasharray="3 4"
                  initial={false}
                  animate={{ pathLength: phase >= 2 ? 1 : 0, opacity: phase >= 2 ? 1 : 0 }}
                  transition={{ duration: reduce ? 0 : 0.6, ease: EASE_OUT }}
                />

                {DECOYS.map((d) => {
                  const hit = d.id === TRIPPED && tripped;
                  return (
                    <g key={d.id} transform={`translate(${px(d.col)} ${py(d.row)})`}>
                      {hit && !reduce ? (
                        <motion.circle
                          key={`ring-${phase >= 1}`}
                          r={6}
                          className="fill-none stroke-trip"
                          strokeWidth={1}
                          initial={{ scale: 1, opacity: 0.9 }}
                          animate={{ scale: 4.5, opacity: 0 }}
                          transition={{ duration: 1.4, ease: "easeOut", repeat: Infinity, repeatDelay: 0.4 }}
                        />
                      ) : null}
                      <circle r={hit ? 9 : 7} className={hit ? "fill-trip/15" : "fill-decoy/10"} />
                      <circle
                        r={hit ? 4 : 3}
                        className={cn("transition-colors duration-200", hit ? "fill-trip" : "fill-decoy")}
                      />
                    </g>
                  );
                })}

                <motion.g
                  initial={false}
                  animate={{ opacity: phase >= 2 ? 1 : 0 }}
                  transition={{ duration: 0.3, delay: phase >= 2 && !reduce ? 0.45 : 0 }}
                  transform={`translate(${x2} ${y2})`}
                >
                  <rect x={-5} y={-5} width={10} height={10} className="fill-ink-950 stroke-trip" strokeWidth={1.5} />
                  <path d="M -2.5 -2.5 L 2.5 2.5 M 2.5 -2.5 L -2.5 2.5" className="stroke-trip" strokeWidth={1.3} />
                </motion.g>
              </svg>

              {/* HTML labels keep a fixed type size at every width; most hide below sm. */}
              {DECOYS.map((d) => {
                const hit = d.id === TRIPPED && tripped;
                return (
                  <span
                    key={d.id}
                    className={cn(
                      "absolute ml-2.5 -translate-y-1/2 rounded-sm bg-ink-900/85 px-1 font-mono text-[10.5px] whitespace-nowrap transition-colors duration-200",
                      d.mobile ? "block" : "hidden sm:block",
                      hit ? "text-trip" : "text-fg-muted",
                    )}
                    style={{ left: `${((d.col + 0.5) / MAP_COLS) * 100}%`, top: `${((d.row + 0.5) / MAP_ROWS) * 100}%` }}
                  >
                    {d.label}
                  </span>
                );
              })}
              <span
                className={cn(
                  "absolute mt-2.5 -translate-x-[85%] rounded-sm sm:-translate-x-1/2 bg-ink-900/85 px-1 font-mono text-[10.5px] whitespace-nowrap text-trip transition-opacity duration-300",
                  phase >= 2 ? "opacity-100" : "opacity-0",
                )}
                style={{ left: `${((THIEF.col + 0.5) / MAP_COLS) * 100}%`, top: `${((THIEF.row + 0.5) / MAP_ROWS) * 100}%` }}
              >
                {THIEF.label}
              </span>
            </div>

              <AnimatePresence>
                {frozen ? (
                  <motion.div
                    key="chip"
                    initial={{ opacity: 0, y: reduce ? 0 : 6, scale: reduce ? 1 : 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, transition: { duration: 0.2 } }}
                    transition={{ duration: 0.35, ease: EASE_OUT }}
                    className="absolute bottom-3 left-3 inline-flex items-center gap-2 rounded-md border border-trip/40 bg-ink-950/90 px-2.5 py-1.5 font-mono text-[11px] text-fg backdrop-blur sm:bottom-5 sm:left-5"
                  >
                    <i className="size-1.5 rounded-full bg-trip" />
                    Frozen in 2 blocks
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          </div>

          <TripEvents phase={phase} />
        </div>
      </FramePanel>
    </Frame>
  );
}
