import type { ReactNode } from "react";
import { Link } from "react-router";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * Axiom's action language, on Stand-in's one accent (the trip red, deepened for filled buttons).
 * Primary: 36px tall, 13px/500, 6px radius, 0 12px padding. Secondary: same box, hairline outline.
 * "See it live" links: 14/500 in the accent with a sliding arrow, one per section.
 */
const RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg-muted";

export const accentBtn = cn(
  "group/cta inline-flex h-9 items-center gap-1.5 rounded-[6px] bg-cta px-3 text-[13px] font-medium text-white",
  "transition-[background-color,transform] duration-150 ease-[var(--ease-out-strong)] hover:bg-cta-hover active:scale-[0.97]",
  RING,
);

export const lineBtn = cn(
  "inline-flex h-9 items-center gap-1.5 rounded-[6px] border border-line-strong bg-ink-950 px-3 text-[13px] font-medium text-fg",
  "transition-[background-color,border-color,transform] duration-150 ease-[var(--ease-out-strong)] hover:border-fg-faint hover:bg-ink-850 active:scale-[0.97]",
  RING,
);

/** Tertiary: no box until hover, for an action beside the two main ones. */
export const quietBtn = cn(
  "inline-flex h-9 items-center gap-1.5 rounded-[6px] px-2 text-[13px] font-medium text-fg-muted",
  "transition-[color,background-color] duration-150 ease-[var(--ease-out-strong)] hover:bg-ink-850 hover:text-fg",
  RING,
);

function Arrow() {
  return (
    <ArrowRight
      aria-hidden
      className="size-3.5 transition-transform duration-200 ease-[var(--ease-out-strong)] group-hover/cta:translate-x-0.5"
    />
  );
}

export function AccentLink({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  return (
    <Link to={to} className={cn(accentBtn, className)}>
      {children}
      <Arrow />
    </Link>
  );
}

/** One per section: the route where the thing the section describes actually runs. */
export function LiveLink({ to, children = "See it live", className }: { to: string; children?: ReactNode; className?: string }) {
  return (
    <Link
      to={to}
      className={cn(
        "group/cta inline-flex items-center gap-1.5 rounded-sm text-[14px] font-medium text-trip transition-colors hover:text-[#ff6a5f]",
        RING,
        className,
      )}
    >
      {children}
      <Arrow />
    </Link>
  );
}

/**
 * A product shot that runs off the right edge of the viewport, Axiom style. Its left edge stays on the
 * content column; the right margin cancels the container's padding and the gutter beyond it. The
 * bottom fades out so the shot dissolves into the page instead of ending on a hard line.
 */
export function Bleed({ children, className, fade = true }: { children: ReactNode; className?: string; fade?: boolean }) {
  return (
    <div
      className={cn(
        "-mr-4 min-w-0 sm:-mr-6 lg:mr-[min(-40px,calc(560px-50vw))]",
        fade && "[mask-image:linear-gradient(to_bottom,#000_75%,transparent)]",
        className,
      )}
    >
      {children}
    </div>
  );
}
