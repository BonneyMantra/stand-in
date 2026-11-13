import { Link } from "react-router";
import { ArrowRight } from "lucide-react";
import { DASHBOARD_PATH, PROBLEM_STATS, INCIDENT, REPO_URL } from "./content";
import { BrandMark, GithubMark, focusRing } from "./nav";
import { Reveal } from "./primitives";

function ClosingCta() {
  return (
    <div className="relative overflow-hidden border-t border-line/70">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background-image:radial-gradient(var(--color-line)_1px,transparent_1px)] [background-size:14px_14px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]"
      />
      <Reveal className="relative mx-auto flex w-full max-w-[1200px] flex-col items-start gap-8 px-4 py-20 sm:px-6 lg:flex-row lg:items-end lg:justify-between md:py-28 lg:px-10">
        <h2 className="text-[32px] leading-[1.06] font-medium tracking-[-0.03em] text-balance sm:text-[44px]">
          Watch a decoy trip, <span className="block text-fg-muted">end to end.</span>
        </h2>
        <div className="flex flex-wrap gap-3">
          <Link
            to={DASHBOARD_PATH}
            className={`group/cta inline-flex h-10 items-center gap-2 rounded-md bg-fg px-4 text-[14px] font-medium text-ink-950 transition-[background-color,transform] duration-150 hover:bg-white active:scale-[0.98] ${focusRing}`}
          >
            Open the live dashboard
            <ArrowRight aria-hidden className="size-4 transition-transform duration-200 group-hover/cta:translate-x-0.5" />
          </Link>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className={`inline-flex h-10 items-center gap-2 rounded-md border border-line-strong px-4 text-[14px] text-fg transition-colors hover:bg-ink-800 ${focusRing}`}
          >
            <GithubMark className="size-4" />
            Read the code
          </a>
        </div>
      </Reveal>
    </div>
  );
}

const SOURCES = [...PROBLEM_STATS.map((s) => ({ label: s.source, href: s.href })), { label: INCIDENT.source, href: INCIDENT.href }];

export function Footer() {
  return (
    <footer>
      <ClosingCta />
      <div className="border-t border-line/70">
        <div className="mx-auto grid w-full max-w-[1200px] gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1fr_auto] lg:px-10">
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-[15px] font-medium">
              <BrandMark />
              Stand-in
            </p>
            <p className="max-w-[46ch] text-[13px] leading-relaxed text-fg-muted">
              Decoy NEAR keys for AI coding agents. Built at NEAR HACKATHON, November 2026. MIT licensed.
            </p>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className={`inline-flex items-center gap-2 rounded-sm text-[13px] text-fg-muted transition-colors hover:text-fg ${focusRing}`}
            >
              <GithubMark className="size-3.5" />
              github.com/BonneyMantra/stand-in
            </a>
          </div>
          <div>
            <p className="mb-3 font-mono text-[11px] tracking-[0.14em] text-fg-muted uppercase">Sources</p>
            <ul className="space-y-1.5">
              {SOURCES.map((s) => (
                <li key={s.href}>
                  <a
                    href={s.href}
                    target="_blank"
                    rel="noreferrer"
                    className={`rounded-sm text-[13px] text-fg-muted transition-colors hover:text-fg ${focusRing}`}
                  >
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </footer>
  );
}
