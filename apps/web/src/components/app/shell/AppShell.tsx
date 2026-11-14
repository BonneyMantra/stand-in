import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { History, Radio, RefreshCw, ServerCrash } from "lucide-react";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useStandin } from "@/data/useStandin";
import { fmtDate } from "@/data/derive";
import { cn } from "@/lib/utils";
import { AppSidebar } from "./AppSidebar";
import { EmptyState } from "../common";

const TITLES: Record<string, string> = {
  trips: "Trips", decoys: "Decoys", sessions: "Sessions", blocklist: "Blocklist", bench: "Benchmark", owner: "Owner console",
};

export function AppShell({ children }: { children: ReactNode }) {
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
  const seg = pathname.split("/")[2];
  const crumb = seg ? TITLES[seg] ?? seg : "Overview";
  const isTrip = pathname.startsWith("/app/trips/") && pathname.split("/")[3];
  return (
    <header className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b border-line bg-ink-950/85 px-3 backdrop-blur md:px-6">
      <SidebarTrigger className="-ml-1 text-fg-muted hover:text-fg md:hidden" aria-label="Open navigation" />
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13px]">
        <span className="hidden truncate font-mono text-xs text-fg-faint sm:inline">{data?.agent.account_id ?? "stand-in"}</span>
        <span className="hidden text-fg-faint sm:inline" aria-hidden>/</span>
        {isTrip ? (
          <>
            <Link to="/app/trips" className="text-fg-muted hover:text-fg">Trips</Link>
            <span className="text-fg-faint" aria-hidden>/</span>
            <span className="truncate font-mono text-xs text-fg" aria-current="page">{decodeURIComponent(pathname.split("/")[3]).slice(0, 10)}…</span>
          </>
        ) : (
          <span className="text-fg" aria-current="page">{crumb}</span>
        )}
      </nav>
      <div className="ml-auto flex items-center gap-2">
        {source === "live" && (
          <>
            <span className="inline-flex h-6 items-center gap-1.5 rounded-md border border-safe/30 bg-safe-soft px-2 font-mono text-[11px] text-safe">
              <span className="size-1.5 animate-pulse rounded-full bg-safe" aria-hidden />live
            </span>
            <button type="button" onClick={() => setPreferRecorded(true)} className="inline-flex h-6 items-center gap-1.5 rounded-md border border-line px-2 text-[11px] text-fg-muted hover:text-fg focus-visible:ring-2 focus-visible:ring-ring outline-none">
              <History className="size-3" aria-hidden /><span className="hidden sm:inline">Recorded run</span>
            </button>
          </>
        )}
        {source === "recorded" && data && <SourcePill />}
      </div>
    </header>
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
        <span className="hidden sm:inline">{unreachable ? "Watcher unreachable" : "Live paused"}</span>
        <span className="sm:hidden" aria-hidden>{unreachable ? "offline" : "paused"}</span>
        <span className="text-fg-faint" aria-hidden>·</span>
        <span aria-hidden>recorded</span>
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
        className="inline-flex h-6 items-center gap-1.5 rounded-md border border-line px-2 text-[11px] text-fg-muted outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-ring"
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
  // The owner console reads the chain through the wallet, not the watcher: it renders whatever the watcher state.
  if (useLocation().pathname.startsWith("/app/owner")) return <>{children}</>;
  if (source === "loading") {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading watcher state">
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
