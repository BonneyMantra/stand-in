import type { ComponentProps, ReactNode } from "react";
import { Frame as ReuiFrame, FramePanel as ReuiFramePanel } from "@/components/reui/frame";
import { cn } from "@/lib/utils";

/*
 * The ReUI Pro `frame` primitive (src/components/reui/frame.tsx), themed for the landing: a 14px
 * outer hairline frame with a 3px inset and concentric 10px inner panels on the ink tokens.
 * Panel padding is zeroed so each section sets its own, panels size to content (`fit`), and
 * overflow stays visible so glows and thumbs are not clipped. A consumer className still wins.
 */
export function Frame({ className, ...props }: ComponentProps<typeof ReuiFrame>) {
  return (
    <ReuiFrame
      className={cn(
        "bg-ink-900/60 [--frame-radius:14px] [--frame-panel-px-base:0px] [--frame-panel-py-base:0px]",
        className,
      )}
      {...props}
    />
  );
}

export function FramePanel({ className, ...props }: ComponentProps<typeof ReuiFramePanel>) {
  return <ReuiFramePanel fit className={cn("overflow-visible shadow-none", className)} {...props} />;
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
