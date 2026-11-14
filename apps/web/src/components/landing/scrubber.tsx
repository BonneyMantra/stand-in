import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { FOCUS } from "./primitives";

export type Stop = { label: string; sub: string };

/**
 * A stepped scrubber: a hairline track with a sliding thumb over a shadcn ToggleGroup of stops
 * (ReUI's primitive). Radix gives radio semantics and roving focus (arrows, Home/End, no wrap);
 * selecting on focus keeps "arrow keys move and select". The thumb moves on transform only.
 * ReUI Stepper was considered: it has no sliding thumb, so the track stays custom.
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
  const last = stops.length - 1;
  const pct = last === 0 ? 0 : (value / last) * 100;

  return (
    <div className="relative select-none">
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
      <ToggleGroup
        type="single"
        role="radiogroup"
        aria-label={label}
        loop={false}
        value={String(value)}
        onValueChange={(v) => v !== "" && onChange(Number(v))}
        className="mt-2 grid w-full items-stretch"
        style={{ gridTemplateColumns: `repeat(${stops.length}, minmax(0, 1fr))` }}
      >
        {stops.map((s, i) => (
          <ToggleGroupItem
            key={s.label}
            value={String(i)}
            onFocus={() => i !== value && onChange(i)}
            className={cn(
              "block h-auto w-full min-w-0 rounded-sm px-0.5 py-1 font-mono text-[10.5px] leading-tight font-normal whitespace-normal transition-colors hover:bg-transparent data-[spacing=0]:rounded-sm data-[state=on]:bg-transparent",
              FOCUS,
              i === 0 ? "text-left" : i === last ? "text-right" : "text-center",
              i === value ? "text-fg data-[state=on]:text-fg" : "text-fg-faint hover:text-fg-muted",
            )}
          >
            <span className="block truncate">{s.label}</span>
            <span className="block truncate text-fg-faint">{s.sub}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}
