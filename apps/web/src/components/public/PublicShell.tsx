import { useEffect, type ReactNode } from "react";
import { BrandMark, GithubMark, Nav, focusRing } from "@/components/landing/nav";
import { REPO_URL } from "@/components/landing/content";
import { cn } from "@/lib/utils";

/** Shell for the public proof pages (/lab, /verify): the landing nav, a page head and a slim footer. */
export function PublicShell({ title, children }: { title: string; children: ReactNode }) {
  useEffect(() => {
    document.title = title;
  }, [title]);
  return (
    <div className="min-h-svh overflow-x-clip bg-ink-950 text-fg">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-fg px-3 py-2 text-ink-950 focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <Nav />
      <main id="main" className="relative">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[420px] [background-image:radial-gradient(var(--color-line)_1px,transparent_1px)] [background-size:14px_14px] [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)] opacity-70"
        />
        <div className="relative mx-auto w-full max-w-[1200px] px-4 pt-12 pb-20 sm:px-6 sm:pt-16 lg:px-10">{children}</div>
      </main>
      <footer className="border-t border-line/70">
        <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-4 px-4 py-8 sm:px-6 lg:px-10">
          <p className="flex items-center gap-2 text-[13px] text-fg-muted">
            <BrandMark className="size-4" />
            Stand-in · decoy NEAR keys for AI coding agents
          </p>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className={`inline-flex items-center gap-2 rounded-sm text-[13px] text-fg-muted transition-colors hover:text-fg ${focusRing}`}
          >
            <GithubMark className="size-3.5" />
            Read the code
          </a>
        </div>
      </footer>
    </div>
  );
}

/** Axiom-style page head: mono eyebrow with a status dot, a two-tone h1, a muted lede. */
export function PageHead({
  eyebrow,
  title,
  muted,
  children,
  dot = "safe",
}: {
  eyebrow: string;
  title: string;
  muted?: string;
  children?: ReactNode;
  dot?: "safe" | "trip" | "decoy";
}) {
  return (
    <header className="max-w-2xl">
      <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-line-strong bg-ink-900/70 px-3 py-1 font-mono text-[11px] text-fg-muted">
        <i className={cn("size-1.5 rounded-full", dot === "safe" ? "bg-safe" : dot === "trip" ? "bg-trip" : "bg-decoy")} />
        {eyebrow}
      </p>
      <h1 className="text-[34px] leading-[1.04] font-medium tracking-[-0.03em] text-balance sm:text-[48px]">
        {title}
        {muted ? <span className="block text-fg-muted">{muted}</span> : null}
      </h1>
      {children ? <div className="mt-5 space-y-3 text-[15px] leading-relaxed text-pretty text-fg-muted">{children}</div> : null}
    </header>
  );
}
