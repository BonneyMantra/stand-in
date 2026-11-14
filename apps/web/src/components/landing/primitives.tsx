import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowUpRight, Check, Copy, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const EASE_OUT = [0.23, 1, 0.32, 1] as const;

/** The landing's focus treatment on shadcn/ReUI controls: a crisp offset outline instead of the soft ring. */
export const FOCUS =
  "focus-visible:ring-0 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg-muted";

/** Legacy copy path for browsers that refuse navigator.clipboard (insecure context, denied permission). */
function copyBySelection(text: string): boolean {
  const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    ta.remove();
    back?.focus({ preventScroll: true });
  }
}

/* Copy with a timed "copied" state; the timer is cleared on unmount (pattern from ReUI hero-10). */
export function useCopy(resetMs = 1800) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const copy = useCallback(
    async (text: string) => {
      let ok = false;
      try {
        await navigator.clipboard.writeText(text);
        ok = true;
      } catch {
        // The async Clipboard API needs a secure context and permission; fall back to a selected textarea.
        ok = copyBySelection(text);
      }
      if (!ok) return;
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), resetMs);
    },
    [resetMs],
  );
  return { copied, copy };
}

export function CopyIcon({ copied }: { copied: boolean }) {
  return (
    <span className="relative inline-flex size-3.5" aria-hidden>
      <Copy
        className={cn(
          "absolute inset-0 size-3.5 transition-[opacity,transform] duration-200 ease-[var(--ease-out-strong)]",
          copied ? "scale-50 opacity-0" : "scale-100 opacity-100",
        )}
      />
      <Check
        className={cn(
          "absolute inset-0 size-3.5 text-safe transition-[opacity,transform] duration-200 ease-[var(--ease-out-strong)]",
          copied ? "scale-100 opacity-100" : "scale-50 opacity-0",
        )}
      />
    </span>
  );
}

/** A copyable command line: `$`-less, mono, with a keyboard-reachable copy button. */
export function CommandLine({ command, prompt = ">" }: { command: string; prompt?: string }) {
  const { copied, copy } = useCopy();
  return (
    <div className="group flex items-center gap-3 rounded-md border border-line bg-ink-950 py-1.5 pr-1.5 pl-3 font-mono text-[12.5px]">
      <span aria-hidden className="text-fg-faint select-none">
        {prompt}
      </span>
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-fg [scrollbar-width:none]">
        {command}
      </code>
      <Button
        variant="quiet"
        size="icon-sm"
        onClick={() => copy(command)}
        aria-label={copied ? `Copied: ${command}` : `Copy command: ${command}`}
        className={cn("size-7", FOCUS)}
      >
        <CopyIcon copied={copied} />
      </Button>
      <span className="sr-only" aria-live="polite">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </div>
  );
}

/** Mono outline "replay" control shared by the animated sections. */
export function ReplayButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <Button
      variant="quiet"
      size="sm"
      onClick={onClick}
      className={cn("h-8 gap-2 self-start border border-line-strong px-3 font-mono text-[11px] active:scale-[0.98]", FOCUS)}
    >
      <RotateCcw aria-hidden data-icon="inline-start" className="size-3.5" />
      {children}
    </Button>
  );
}

/** One-shot fade + small rise when the block scrolls into view. Opacity only under reduced motion. */
export function Reveal({
  children,
  className,
  delay = 0,
  y = 12,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: reduce ? 0 : y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -12% 0px" }}
      transition={{ duration: 0.55, delay: reduce ? 0 : delay, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  );
}

/** Lede copy, Axiom proportions: 15/22.5 at 63% white. */
export const LEDE = "text-[15px] leading-[22.5px] text-pretty text-white/[0.63]";
/** Section heading: 40/500 at -1px; one colour, no greyed second line. */
export const H2 = "text-[30px] leading-[1.1] font-medium tracking-[-0.025em] text-balance text-fg sm:text-[40px] sm:leading-[1.1]";

/** A landing section: 96px of air above and below, no hairline between sections. */
export function Section({
  id,
  children,
  className,
  labelledBy,
}: {
  id?: string;
  children: ReactNode;
  className?: string;
  labelledBy?: string;
}) {
  return (
    <section id={id} aria-labelledby={labelledBy} className={cn("relative scroll-mt-20", className)}>
      <div className="mx-auto w-full max-w-[1200px] px-4 py-16 sm:px-6 md:py-24 lg:px-10">{children}</div>
    </section>
  );
}

/** Axiom-style section head: one heading (a second line stays the same colour), a lede, one live link. */
export function SectionHead({
  id,
  title,
  second,
  children,
  live,
  className,
}: {
  id: string;
  title: string;
  second?: string;
  children?: ReactNode;
  live?: ReactNode;
  className?: string;
}) {
  return (
    <Reveal className={cn("max-w-[470px]", className)}>
      <h2 id={id} className={H2}>
        {title}
        {second ? <span className="block">{second}</span> : null}
      </h2>
      {children ? <div className={cn("mt-5 space-y-3", LEDE)}>{children}</div> : null}
      {live ? <div className="mt-6">{live}</div> : null}
    </Reveal>
  );
}

export function SourceLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "inline-flex items-center gap-1 font-mono text-[11px] text-fg-muted underline-offset-4 transition-colors hover:text-fg hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg-muted",
        className,
      )}
    >
      {children}
      <ArrowUpRight aria-hidden className="size-3" />
    </a>
  );
}
