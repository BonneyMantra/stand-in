import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { FOCUS } from "./primitives";

/**
 * A segmented single-choice control on the shadcn ToggleGroup (ReUI's primitive). Radix gives the
 * radio semantics, roving tabindex and arrow/Home/End movement; selecting on focus keeps the
 * "arrow keys move and select" behaviour, and an empty value (re-clicking the active item) is ignored.
 */
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
  return (
    <ToggleGroup
      type="single"
      role="radiogroup"
      aria-label={label}
      value={String(value)}
      onValueChange={(v) => v !== "" && onChange(Number(v))}
      className={cn("inline-flex w-full rounded-lg border border-line bg-ink-950 p-[3px] sm:w-auto", className)}
    >
      {options.map((o, i) => (
        <ToggleGroupItem
          key={o.label}
          value={String(i)}
          aria-label={o.label}
          onFocus={() => i !== value && onChange(i)}
          className={cn(
            "h-8 min-w-0 flex-1 rounded-md px-3 font-mono text-[11.5px] font-normal whitespace-nowrap text-fg-muted transition-[background-color,color,scale] duration-200 hover:bg-transparent hover:text-fg active:scale-[0.98] data-[spacing=0]:rounded-md data-[state=on]:bg-ink-800 data-[state=on]:text-fg sm:flex-none",
            FOCUS,
            "focus-visible:-outline-offset-2",
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
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
