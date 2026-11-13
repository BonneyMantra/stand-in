import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/*
 * Adapted from the ReUI Pro `frame` primitive: an outer hairline frame with a 3px inset that holds
 * one or more concentric inner panels. Trimmed to the two variants this page uses and re-pointed
 * at the Stand-in ink/line tokens instead of shadcn muted/card.
 */
export function Frame({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="frame"
      className={cn(
        "relative flex flex-col gap-[3px] rounded-[14px] border border-line bg-ink-900/60 p-[3px]",
        className,
      )}
      {...props}
    />
  );
}

export function FramePanel({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="frame-panel"
      className={cn("relative rounded-[10px] border border-line bg-ink-900", className)}
      {...props}
    />
  );
}

/** Window chrome strip used on product shots: three muted dots and a mono path. */
export function PanelBar({
  children,
  right,
  className,
}: {
  children: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-10 items-center justify-between gap-3 border-b border-line px-3 font-mono text-[11px] text-fg-muted",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span aria-hidden className="flex gap-1">
          <i className="size-2 rounded-full bg-line-strong" />
          <i className="size-2 rounded-full bg-line-strong" />
          <i className="size-2 rounded-full bg-line-strong" />
        </span>
        <span className="truncate">{children}</span>
      </div>
      {right ? <div className="flex shrink-0 items-center gap-2">{right}</div> : null}
    </div>
  );
}
