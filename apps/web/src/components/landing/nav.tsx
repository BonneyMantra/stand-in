import { Link, NavLink } from "react-router";
import { DASHBOARD_PATH, REPO_URL } from "./content";
import { AccentLink } from "./cta";

export function BrandMark({ className = "size-5" }: { className?: string }) {
  // Two offset key-cards: the outline is the decoy, the filled one the real key kept out of reach.
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden>
      <rect x="1.5" y="5.5" width="11" height="11" rx="2.5" className="fill-none stroke-fg-muted" strokeWidth="1.3" />
      <rect x="7.5" y="3.5" width="11" height="11" rx="2.5" className="fill-fg" />
      <circle cx="13" cy="9" r="1.9" className="fill-trip" />
    </svg>
  );
}

export function GithubMark({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

// Section anchors resolve against the landing page, so they also work from /lab and /verify.
const LINKS = [
  { href: "/#how", label: "How it works" },
  { href: "/#attribution", label: "Attribution" },
  { href: "/#blocklist", label: "Blocklist" },
  { href: "/#benchmark", label: "Benchmark" },
];

/** Public proof pages: shown at every width (the section anchors collapse below lg). */
const PAGES = [
  { to: "/lab", label: "Lab" },
  { to: "/verify", label: "Verify" },
];

export const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg-muted";

export function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b border-line/50 bg-ink-950/75 backdrop-blur-md supports-[backdrop-filter]:bg-ink-950/60">
      <nav
        aria-label="Primary"
        className="mx-auto flex h-14 w-full max-w-[1200px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-10"
      >
        <Link to="/" className={`flex shrink-0 items-center gap-2 rounded-md text-[15px] font-medium tracking-tight whitespace-nowrap ${focusRing}`}>
          <BrandMark />
          Stand-in
        </Link>

        <ul className="flex min-w-0 items-center gap-0.5 sm:gap-1">
          {LINKS.map((l) => (
            <li key={l.href} className="hidden lg:block">
              <a
                href={l.href}
                className={`rounded-md px-3 py-1.5 text-[13px] text-fg-muted transition-colors hover:bg-ink-800 hover:text-fg ${focusRing}`}
              >
                {l.label}
              </a>
            </li>
          ))}
          {PAGES.map((p) => (
            <li key={p.to}>
              <NavLink
                to={p.to}
                className={({ isActive }) =>
                  `rounded-md px-2 py-1.5 text-[13px] transition-colors hover:bg-ink-800 hover:text-fg sm:px-3 ${isActive ? "text-fg" : "text-fg-muted"} ${focusRing}`
                }
              >
                {p.label}
              </NavLink>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-1 sm:gap-2">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="Stand-in on GitHub"
            className={`inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-[13px] text-fg-muted transition-colors hover:bg-ink-800 hover:text-fg ${focusRing}`}
          >
            <GithubMark className="size-4" />
            <span className="hidden sm:inline">GitHub</span>
          </a>
          <AccentLink to={DASHBOARD_PATH}>My account</AccentLink>
        </div>
      </nav>
    </header>
  );
}
