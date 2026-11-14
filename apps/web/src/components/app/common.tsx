import { useState, type ReactNode } from "react";
import { Check, Copy, ExternalLink, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Frame, FrameHeader, FramePanel } from "@/components/reui/frame";
import type { DecoyStatus } from "@/data/derive";

/** ReUI Frame (card-38 / chart-2 framing) adapted: hairline frame, icon-tile header, dense panel. */
export function Panel({
  title, icon: Icon, meta, actions, children, className, bodyClassName, id,
}: {
  title: ReactNode; icon?: LucideIcon; meta?: ReactNode; actions?: ReactNode; children: ReactNode;
  className?: string; bodyClassName?: string; id?: string;
}) {
  return (
    <Frame spacing="sm" className={cn("bg-ink-900/60 [--frame-radius:var(--radius-panel)] min-w-0", className)} aria-labelledby={id}>
      <FrameHeader className="flex-row items-center gap-2">
        {Icon && (
          <span className="grid size-6 place-items-center rounded-md border border-line bg-ink-850 text-fg-muted">
            <Icon className="size-3.5" aria-hidden />
          </span>
        )}
        <h2 id={id} className="shrink-0 text-[13px] font-medium whitespace-nowrap text-fg">{title}</h2>
        {meta && <span className="truncate text-xs text-fg-faint">{meta}</span>}
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </FrameHeader>
      <FramePanel className={cn("bg-ink-950 shadow-none", bodyClassName)}>{children}</FramePanel>
    </Frame>
  );
}

const STATUS_STYLE: Record<DecoyStatus, string> = {
  dormant: "border-line-strong text-fg-muted",
  exposed: "border-warn/30 bg-warn/10 text-warn",
  tripped: "border-trip/40 bg-trip-soft text-trip",
};

export function StatusPill({ status }: { status: DecoyStatus }) {
  return (
    <span className={cn("inline-flex h-5 items-center gap-1.5 rounded-full border px-2 font-mono text-[11px]", STATUS_STYLE[status])}>
      <span className={cn("size-1.5 rounded-full", status === "dormant" ? "bg-fg-faint" : status === "exposed" ? "bg-warn" : "bg-trip")} aria-hidden />
      {status}
    </span>
  );
}

export function Tag({ tone = "muted", children, className }: { tone?: "muted" | "safe" | "trip" | "warn" | "decoy"; children: ReactNode; className?: string }) {
  const tones = {
    muted: "border-line-strong text-fg-muted",
    safe: "border-safe/30 bg-safe-soft text-safe",
    trip: "border-trip/40 bg-trip-soft text-trip",
    warn: "border-warn/30 bg-warn/10 text-warn",
    decoy: "border-decoy/30 bg-decoy/10 text-decoy",
  };
  return <span className={cn("inline-flex h-5 shrink-0 items-center gap-1 rounded-md border px-1.5 font-mono text-[11px] whitespace-nowrap", tones[tone], className)}>{children}</span>;
}

/** Marks a value that has not been measured/posted yet. Never shown on measured numbers. */
export function PreviewTag({ title = "Not measured yet; shown so the layout is complete" }: { title?: string }) {
  return (
    <span title={title} className="inline-flex h-4 items-center rounded border border-dashed border-fg-faint px-1 font-mono text-[10px] tracking-wide text-fg-faint uppercase">
      preview
    </span>
  );
}

export function CopyText({ value, display, className }: { value: string; display?: ReactNode; className?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      window.setTimeout(() => setDone(false), 1200);
    } catch {
      setDone(false);
    }
  };
  return (
    <Button
      variant="bare"
      size="bare"
      onClick={copy}
      title={value}
      aria-label={`Copy ${value}`}
      className={cn("group inline-flex max-w-full shrink items-center justify-start gap-1.5 rounded font-mono text-xs whitespace-normal text-fg-muted outline-none transition-none hover:text-fg focus-visible:ring-2 focus-visible:ring-ring", className)}
    >
      <span className="truncate">{display ?? value}</span>
      {done ? <Check className="size-3 shrink-0 text-safe" aria-hidden /> : <Copy className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-70 group-focus-visible:opacity-70" aria-hidden />}
      <span className="sr-only" aria-live="polite">{done ? "Copied" : ""}</span>
    </Button>
  );
}

export function ExtLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={cn("inline-flex items-center gap-1 font-mono text-xs text-fg-muted underline-offset-4 outline-none hover:text-fg hover:underline focus-visible:ring-2 focus-visible:ring-ring rounded", className)}>
      {children}
      <ExternalLink className="size-3 shrink-0 opacity-60" aria-hidden />
    </a>
  );
}

export function EmptyState({ icon: Icon, title, children, className }: { icon: LucideIcon; title: string; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-10 text-center", className)}>
      <span className="grid size-9 place-items-center rounded-lg border border-line bg-ink-900 text-fg-faint">
        <Icon className="size-4" aria-hidden />
      </span>
      <p className="text-sm font-medium text-fg">{title}</p>
      {children && <div className="max-w-sm text-xs leading-relaxed text-fg-muted">{children}</div>}
    </div>
  );
}

export function Shimmer({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-ink-850", className)} aria-hidden />;
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight text-fg">{title}</h1>
        {sub && <p className="mt-0.5 text-[13px] text-fg-muted">{sub}</p>}
      </div>
      {actions}
    </div>
  );
}

/** Small mono key/value row used in metric strips and detail panels. */
export function KV({ k, v, className }: { k: ReactNode; v: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 items-baseline justify-between gap-3 py-1.5 text-xs", className)}>
      <span className="shrink-0 text-fg-faint">{k}</span>
      <span className="min-w-0 truncate text-right font-mono text-fg-muted">{v}</span>
    </div>
  );
}
