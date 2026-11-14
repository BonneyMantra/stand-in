import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { fetchRuns } from "@/lib/lab/api";
import { cn } from "@/lib/utils";
import { PROBLEM_STATS, INCIDENT, REPO_URL } from "./content";
import { AccentLink, lineBtn } from "./cta";
import { BrandMark, GithubMark, focusRing } from "./nav";
import { Reveal } from "./primitives";

function ClosingCta() {
  return (
    <Reveal className="mx-auto flex w-full max-w-[1200px] flex-col items-center px-4 py-24 text-center sm:px-6 md:py-32 lg:px-10">
      <h2 className="max-w-[640px] text-[34px] leading-[1.12] font-medium tracking-[-0.02em] text-balance sm:text-[48px] sm:leading-[56px]">
        Watch a decoy trip, end to end.
      </h2>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <AccentLink to="/lab">Leak a decoy in the lab</AccentLink>
        <a href={REPO_URL} target="_blank" rel="noreferrer" className={lineBtn}>
          <GithubMark className="size-3.5" />
          Read the code
        </a>
      </div>
    </Reveal>
  );
}

/** "Lab online" only when the hosted lab API really answered (dev mocks don't count); otherwise just "testnet". */
function LabStatus() {
  const [online, setOnline] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    fetchRuns(1).then((r) => live && setOnline(r.ok && !r.mock));
    return () => {
      live = false;
    };
  }, []);
  return (
    <p className="flex items-center gap-2 font-mono text-[11px] text-fg-muted" role="status">
      <span aria-hidden className={cn("size-1.5 rounded-full", online ? "bg-safe shadow-[0_0_8px_rgba(61,220,151,0.7)]" : "bg-fg-faint")} />
      {online ? "Lab online · NEAR testnet" : "NEAR testnet"}
    </p>
  );
}

const SOURCES = [...PROBLEM_STATS.map((s) => ({ label: s.source, href: s.href })), { label: INCIDENT.source, href: INCIDENT.href }];

const PRODUCT = [
  { to: "/app", label: "Dashboard" },
  { to: "/lab", label: "Lab" },
  { to: "/verify", label: "Verify" },
  { to: "/app/owner", label: "Owner console" },
];

const PAGE = [
  { href: "/#how", label: "How it works" },
  { href: "/#attribution", label: "Attribution" },
  { href: "/#blocklist", label: "Blocklist" },
  { href: "/#benchmark", label: "Benchmark" },
];

const linkCls = `rounded-sm text-[13px] text-fg-muted transition-colors hover:text-fg ${focusRing}`;

function Col({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-4 font-mono text-[11px] tracking-[0.12em] text-fg-faint uppercase">{title}</p>
      <ul className="space-y-2.5">{children}</ul>
    </div>
  );
}

export function Footer() {
  return (
    <footer>
      <ClosingCta />
      <div className="mx-auto grid w-full max-w-[1200px] grid-cols-2 gap-x-8 gap-y-12 px-4 pt-12 pb-10 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1.6fr] lg:px-10">
        <div className="col-span-2 space-y-4 md:col-span-1">
          <p className="flex items-center gap-2 text-[15px] font-medium">
            <BrandMark />
            Stand-in
          </p>
          <p className="max-w-[34ch] text-[13px] leading-relaxed text-fg-muted">
            Decoy NEAR keys for AI coding agents. Built at NEAR HACKATHON, November 2026. MIT licensed.
          </p>
          <LabStatus />
        </div>
        <Col title="Product">
          {PRODUCT.map((p) => (
            <li key={p.to}>
              <Link to={p.to} className={linkCls}>
                {p.label}
              </Link>
            </li>
          ))}
        </Col>
        <Col title="On this page">
          {PAGE.map((p) => (
            <li key={p.href}>
              <a href={p.href} className={linkCls}>
                {p.label}
              </a>
            </li>
          ))}
        </Col>
        <div className="col-span-2 md:col-span-1">
          <Col title="Sources">
            {SOURCES.map((s) => (
              <li key={s.href}>
                <a href={s.href} target="_blank" rel="noreferrer" className={linkCls}>
                  {s.label}
                </a>
              </li>
            ))}
          </Col>
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-[1200px] items-center justify-between gap-4 px-4 pb-10 sm:px-6 lg:px-10">
        <a href={REPO_URL} target="_blank" rel="noreferrer" className={cn("inline-flex items-center gap-2", linkCls)}>
          <GithubMark className="size-3.5" />
          github.com/BonneyMantra/stand-in
        </a>
      </div>
    </footer>
  );
}
