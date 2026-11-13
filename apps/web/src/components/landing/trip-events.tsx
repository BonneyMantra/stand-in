import { cn } from "@/lib/utils";
import { TRIP_EVENTS, type TripEvent } from "./trip-data";

const DOT: Record<TripEvent["tone"], string> = {
  trip: "bg-trip",
  fg: "bg-fg",
  safe: "bg-safe",
  decoy: "bg-decoy",
};

/** The right rail of the hero shot. Rows are always laid out, so revealing them never shifts layout. */
export function TripEvents({ phase }: { phase: number }) {
  const shown = phase - 2; // phase 3 reveals row 0
  return (
    <div className="border-t border-line lg:border-t-0">
      <div className="flex items-center justify-between px-4 pt-3 pb-2 font-mono text-[11px] text-fg-muted">
        <span>trip timeline</span>
        <span className={cn("transition-colors", phase >= 1 ? "text-trip" : "text-fg-faint")}>
          {phase >= 1 ? "1 decoy tripped" : "no trips"}
        </span>
      </div>
      <ol className="relative px-4 pb-4" aria-label="Trip timeline">
        <span aria-hidden className="absolute top-2 bottom-6 left-[19px] w-px bg-line" />
        {TRIP_EVENTS.map((e, i) => {
          const on = i < shown;
          return (
            <li
              key={e.title}
              className={cn(
                "relative grid grid-cols-[14px_1fr] gap-3 py-2 transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]",
                on ? "translate-y-0 opacity-100" : "translate-y-1 opacity-[0.18]",
              )}
            >
              <span className="relative z-10 mt-1.5 flex size-[7px] items-center justify-center justify-self-center rounded-full ring-4 ring-ink-900">
                <i className={cn("size-[7px] rounded-full", on ? DOT[e.tone] : "bg-line-strong")} />
              </span>
              <div className="min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <p className={cn("truncate text-[13px]", e.tone === "trip" && on ? "text-trip" : "text-fg")}>
                    {e.title}
                  </p>
                  <span className="shrink-0 font-mono text-[10px] text-fg-faint">{e.at}</span>
                </div>
                <p className="truncate font-mono text-[11px] text-fg-muted">{e.detail}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
