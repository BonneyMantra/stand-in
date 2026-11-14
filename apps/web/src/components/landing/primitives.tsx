import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowUpRight, Check, Copy, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const EASE_OUT = [0.23, 1, 0.32, 1] as const;

/** The landing's focus treatment on shadcn/ReUI controls: a crisp offset outline instead of the soft ring. */
export const FOCUS =
  "focus-visible:ring-0 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg-muted";

/* Copy with a timed "copied" state; the timer is cleared on unmount (pattern from ReUI hero-10). */
export function useCopy(resetMs = 1800) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), resetMs);
      } catch {
        // Clipboard needs a secure context; the command stays selectable as text.
      }
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
    <section
      id={id}
      aria-labelledby={labelledBy}
      className={cn("relative scroll-mt-20 border-t border-line/70", className)}
    >
      <div className="mx-auto w-full max-w-[1200px] px-4 py-20 sm:px-6 md:py-28 lg:px-10">{children}</div>
    </section>
  );
}

/** Axiom-style section head: small mono eyebrow, a two-line heading, a muted lede. */
export function SectionHead({
  id,
  eyebrow,
  title,
  muted,
  children,
  className,
}: {
  id: string;
  eyebrow: string;
  title: string;
  muted?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Reveal className={cn("max-w-2xl", className)}>
      <p className="mb-4 font-mono text-[11px] tracking-[0.14em] text-fg-muted uppercase">{eyebrow}</p>
      <h2 id={id} className="text-[30px] leading-[1.08] font-medium tracking-[-0.025em] text-balance sm:text-[40px]">
        {title}
        {muted ? <span className="block text-fg-muted">{muted}</span> : null}
      </h2>
      {children ? (
        <div className="mt-5 space-y-3 text-[15px] leading-relaxed text-pretty text-fg-muted">{children}</div>
      ) : null}
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
