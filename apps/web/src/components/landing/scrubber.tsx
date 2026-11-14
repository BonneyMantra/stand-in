import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

export type Stop = { label: string; sub: string };

/**
 * A stepped scrubber: a radiogroup of stops along a hairline track with a sliding thumb.
 * Arrow keys move between stops (roving tabindex); the thumb moves on transform only.
 */
export function Scrubber({
  stops,
  value,
  onChange,
  label,
  tone = "trip",
}: {
  stops: Stop[];
  value: number;
  onChange: (i: number) => void;
  label: string;
  tone?: "trip" | "fg";
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const last = stops.length - 1;
  const move = (i: number) => {
    const next = Math.max(0, Math.min(last, i));
    onChange(next);
    refs.current[next]?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") (e.preventDefault(), move(value + 1));
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") (e.preventDefault(), move(value - 1));
    if (e.key === "Home") (e.preventDefault(), move(0));
    if (e.key === "End") (e.preventDefault(), move(last));
  };
  const pct = last === 0 ? 0 : (value / last) * 100;

  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKey} className="relative select-none">
      <div className="relative mx-[7px] h-5">
        <span aria-hidden className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line-strong" />
        <span
          aria-hidden
          className={cn(
            "absolute inset-x-0 top-1/2 h-px origin-left -translate-y-1/2 transition-transform duration-500 ease-[var(--ease-out-strong)]",
            tone === "trip" ? "bg-trip" : "bg-fg",
          )}
          style={{ transform: `scaleX(${pct / 100})` }}
        />
        {stops.map((_, i) => (
          <span
            key={i}
            aria-hidden
            className={cn(
              "absolute top-1/2 size-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full border transition-colors duration-300",
              i <= value ? (tone === "trip" ? "border-trip bg-trip" : "border-fg bg-fg") : "border-line-strong bg-ink-950",
            )}
            style={{ left: `${(i / Math.max(1, last)) * 100}%` }}
          />
        ))}
        <span aria-hidden className="absolute inset-y-0 -inset-x-4 overflow-x-clip">
          <span className="absolute inset-y-0 right-4 left-4 transition-transform duration-500 ease-[var(--ease-out-strong)]" style={{ transform: `translateX(${pct}%)` }}>
            <span
              className={cn(
                "absolute top-1/2 left-0 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-ink-950",
                tone === "trip" ? "border-trip shadow-[0_0_12px_rgba(255,74,61,0.55)]" : "border-fg",
              )}
            />
          </span>
        </span>
      </div>
      <div className="mt-2 grid" style={{ gridTemplateColumns: `repeat(${stops.length}, minmax(0, 1fr))` }}>
        {stops.map((s, i) => (
          <button
            key={s.label}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={i === value}
            tabIndex={i === value ? 0 : -1}
            onClick={() => onChange(i)}
            className={cn(
              "min-w-0 rounded-sm px-0.5 py-1 font-mono text-[10.5px] leading-tight transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg-muted",
              i === 0 ? "text-left" : i === last ? "text-right" : "text-center",
              i === value ? "text-fg" : "text-fg-faint hover:text-fg-muted",
            )}
          >
            <span className="block truncate">{s.label}</span>
            <span className="block truncate text-fg-faint">{s.sub}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
