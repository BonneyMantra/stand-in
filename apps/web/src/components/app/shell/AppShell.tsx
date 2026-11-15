import { useEffect, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { History, Radio, RefreshCw, ServerCrash } from "lucide-react";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useStandin } from "@/data/useStandin";
import { useMyAccount } from "@/data/useMyAccount";
import { fmtDate } from "@/data/derive";
import { cn } from "@/lib/utils";
import { AppSidebar } from "./AppSidebar";
import { EmptyState } from "../common";

const TITLES: Record<string, string> = {
  trips: "Trips and freezes", decoys: "Decoys", bench: "Benchmark", owner: "Owner console",
};
const EXAMPLE_TITLES: Record<string, string> = { trips: "Trips", decoys: "Decoys", sessions: "Sessions", blocklist: "Blocklist" };

/** The recorded testnet run lives under /app/example; the benchmark also reads it. Everything else is the owner's own data. */
export const isExamplePath = (p: string) => p === "/app/example" || p.startsWith("/app/example/");
const usesRecorded = (p: string) => isExamplePath(p) || p.startsWith("/app/bench");

export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <TooltipProvider delayDuration={200}>
      <SidebarProvider className="bg-ink-950">
        <a href="#app-main" className="sr-only z-50 rounded bg-fg px-3 py-2 text-ink-950 focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
          Skip to content
        </a>
        <AppSidebar />
        <SidebarInset className="min-w-0 bg-ink-950">
          <Header />
          <main id="app-main" className="mx-auto w-full max-w-[1400px] min-w-0 flex-1 px-4 pt-4 pb-16 md:px-6">
            {isExamplePath(pathname) && <ExampleBanner />}
            <Gate>{children}</Gate>
          </main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}

function Header() {
  const { source, setPreferRecorded, data } = useStandin();
  const { pathname } = useLocation();
  const parts = pathname.split("/");
  const example = isExamplePath(pathname);
  const seg = example ? parts[3] : parts[2];
  const crumb = example ? (seg ? EXAMPLE_TITLES[seg] ?? "Not found" : "Overview") : seg ? TITLES[seg] ?? "Not found" : "My account";
  const tripTx = example && seg === "trips" ? parts[4] : undefined;
  const recorded = usesRecorded(pathname);
  useEffect(() => {
    const tx = tripTx ? decodeURIComponent(tripTx) : "";
    document.title = `${tx ? `Trip ${tx.slice(0, 8)}…` : crumb}${example ? " · Example" : ""} · Stand-in`;
  }, [crumb, tripTx, example]);
  return (
    <header className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b border-line bg-ink-950/85 px-3 backdrop-blur md:px-6">
      <SidebarTrigger className="-ml-1 text-fg-muted hover:text-fg md:hidden" aria-label="Open navigation" />
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13px]">
        {example ? (
          <>
            <Link to="/app/example" className="shrink-0 text-fg-muted hover:text-fg">Example</Link>
            <span className="text-fg-faint" aria-hidden>/</span>
          </>
        ) : <OwnerCrumb />}
        {tripTx ? (
          <>
            <Link to="/app/example/trips" className="text-fg-muted hover:text-fg">Trips</Link>
            <span className="text-fg-faint" aria-hidden>/</span>
            <span className="truncate font-mono text-xs text-fg" aria-current="page">{decodeURIComponent(tripTx).slice(0, 10)}…</span>
          </>
        ) : (
          <span className="truncate text-fg" aria-current="page">{crumb}</span>
        )}
      </nav>
      <div className={cn("ml-auto flex items-center gap-2", !recorded && "hidden")}>
        {source === "live" && (
          <>
            <span className="inline-flex h-6 items-center gap-1.5 rounded-md border border-safe/30 bg-safe-soft px-2 font-mono text-[11px] text-safe">
              <span className="size-1.5 animate-pulse rounded-full bg-safe" aria-hidden />live
            </span>
            <button type="button" onClick={() => setPreferRecorded(true)} aria-label="Show the recorded run" className="inline-flex h-6 items-center gap-1.5 rounded-md border border-line px-2 text-[11px] whitespace-nowrap text-fg-muted hover:text-fg focus-visible:ring-2 focus-visible:ring-ring outline-none">
              <History className="size-3" aria-hidden /><span className="hidden sm:inline">Recorded run</span>
            </button>
          </>
        )}
        {source === "recorded" && data && <SourcePill />}
      </div>
    </header>
  );
}

/** The connected account, or nothing: the crumb names whose data the page shows. */
function OwnerCrumb() {
  const { owner } = useMyAccount();
  if (!owner) return null;
  return (
    <>
      <span className="hidden max-w-[260px] truncate font-mono text-xs text-fg-faint lg:inline">{owner}</span>
      <span className="hidden text-fg-faint lg:inline" aria-hidden>/</span>
    </>
  );
}

/** Every Example page says what it is: a recorded run on the project's own accounts, not the visitor's account. */
function ExampleBanner() {
  return (
    <div role="note" className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[10px] border border-decoy/30 bg-decoy/10 px-3.5 py-2.5 text-xs text-fg-muted" data-testid="example-banner">
      <span className="inline-flex h-5 items-center rounded-md border border-decoy/40 px-1.5 font-mono text-[11px] text-decoy">example</span>
      <p className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        A recorded testnet run on the project's own accounts: real transactions, but not your account.
      </p>
      <Link to="/app" className="shrink-0 font-medium text-fg underline-offset-4 hover:underline">See your own account</Link>
    </div>
  );
}

/** Recorded-run state as a top-bar pill (was a full-width banner): amber when the watcher is
 *  unreachable, neutral when the user paused live; the retry / back-to-live action sits beside it. */
function SourcePill() {
  const { data, fallbackReason, retry, setPreferRecorded } = useStandin();
  const when = data?.recorded ? fmtDate(data.recorded.recorded_at) : "";
  const unreachable = fallbackReason === "unreachable";
  const detail = `Recorded testnet run${when ? ` · ${when}` : ""}: real ledger events and tx hashes; values not yet measured carry a preview tag`;
  const action = unreachable ? "Retry live" : "Back to live";
  if (fallbackReason === "none") {
    // The hosted site has no watcher: the recorded run is what it serves, not a degraded state.
    return (
      <>
        <span role="status" title={detail} className="inline-flex h-6 items-center gap-1.5 rounded-full border border-line-strong px-2.5 font-mono text-[11px] whitespace-nowrap text-fg-muted">
          <History className="size-3" aria-hidden />
          <span aria-hidden>recorded<span className="hidden sm:inline"> testnet</span> run</span>
          <span className="sr-only">This site has no watcher of its own. {detail}. Run pnpm standin dev up locally for live data.</span>
        </span>
        {when && <span className="hidden font-mono text-[11px] text-fg-faint lg:inline">{when}</span>}
      </>
    );
  }
  return (
    <>
      <span
        role="status"
        title={detail}
        className={cn(
          "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 font-mono text-[11px] whitespace-nowrap",
          unreachable ? "border-warn/30 bg-warn/10 text-warn" : "border-line-strong text-fg-muted",
        )}
      >
        {unreachable ? <span className="size-1.5 rounded-full bg-warn" aria-hidden /> : <History className="size-3" aria-hidden />}
        <span aria-hidden>{unreachable ? "watcher offline" : "live paused"}</span>
        <span className="text-fg-faint" aria-hidden>·</span>
        <span aria-hidden>recorded run</span>
        <span className="sr-only">
          {unreachable ? "The watcher at 127.0.0.1:4317 did not answer. " : "Live watcher paused by you. "}
          {detail}.
        </span>
      </span>
      {when && <span className="hidden font-mono text-[11px] text-fg-faint lg:inline">{when}</span>}
      <button
        type="button"
        onClick={() => (unreachable ? retry() : setPreferRecorded(false))}
        aria-label={action}
        className="inline-flex h-6 items-center gap-1.5 rounded-md border border-line px-2 text-[11px] whitespace-nowrap text-fg-muted outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-ring"
      >
        {unreachable ? <RefreshCw className="size-3" aria-hidden /> : <Radio className="size-3" aria-hidden />}
        <span className="hidden sm:inline">{action}</span>
      </button>
    </>
  );
}

/** Page-level loading and error states; pages render only with data. */
function Gate({ children }: { children: ReactNode }) {
  const { source, error, retry } = useStandin();
  // The owner's own pages read the chain through the wallet, not the recorded run: they render whatever its state.
  if (!usesRecorded(useLocation().pathname)) return <>{children}</>;
  if (source === "loading") {
    return (
      <div className="space-y-4" role="status" aria-busy="true" aria-label="Loading watcher state">
        <div className="h-6 w-48 animate-pulse rounded bg-ink-850" />
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-line bg-line md:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-[92px] animate-pulse bg-ink-900" />)}
        </div>
        <div className="h-[380px] animate-pulse rounded-[10px] border border-line bg-ink-900" />
      </div>
    );
  }
  if (source === "error") {
    return (
      <div className="mt-10 rounded-[10px] border border-line bg-ink-900">
        <EmptyState icon={ServerCrash} title="No watcher and no recorded run">
          <p>The watcher at 127.0.0.1:4317 did not answer and /demo-state.json could not be loaded{error ? ` (${error})` : ""}.</p>
          <p className="mt-2">Start it with <code className="font-mono text-fg">pnpm standin dev up</code>, then retry.</p>
          <button type="button" onClick={retry} className="mt-4 inline-flex h-8 items-center gap-2 rounded-md bg-fg px-3 text-xs font-medium text-ink-950 outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <RefreshCw className="size-3.5" aria-hidden />Retry
          </button>
        </EmptyState>
      </div>
    );
  }
  return <>{children}</>;
}
