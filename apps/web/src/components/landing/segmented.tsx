import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

/** A segmented radiogroup: roving tabindex, arrow keys move and select, Home/End jump. */
export function Segmented({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: { label: string; short?: string }[];
  value: number;
  onChange: (i: number) => void;
  label: string;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const last = options.length - 1;
  const move = (i: number) => {
    const next = (i + options.length) % options.length;
    onChange(next);
    refs.current[next]?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    const map: Record<string, number> = { ArrowRight: value + 1, ArrowDown: value + 1, ArrowLeft: value - 1, ArrowUp: value - 1, Home: 0, End: last };
    if (e.key in map) {
      e.preventDefault();
      move(map[e.key]!);
    }
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKey}
      className={cn("inline-flex w-full rounded-lg border border-line bg-ink-950 p-[3px] sm:w-auto", className)}
    >
      {options.map((o, i) => (
        <button
          key={o.label}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={i === value}
          aria-label={o.label}
          tabIndex={i === value ? 0 : -1}
          onClick={() => onChange(i)}
          className={cn(
            "h-8 min-w-0 flex-1 rounded-md px-3 font-mono text-[11.5px] whitespace-nowrap transition-[background-color,color] duration-200 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-fg-muted active:scale-[0.98] sm:flex-none",
            i === value ? "bg-ink-800 text-fg" : "text-fg-muted hover:text-fg",
          )}
        >
          {o.short ? (
            <>
              <span className="sm:hidden">{o.short}</span>
              <span className="hidden sm:inline">{o.label}</span>
            </>
          ) : (
            o.label
          )}
        </button>
      ))}
    </div>
  );
}
