import { useEffect } from "react";
import { motion, useReducedMotion } from "motion/react";
import { CircleAlert, Pause, Play, WifiOff } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import { Button } from "@/components/ui/button";
import { Frame, FramePanel, PanelBar } from "@/components/landing/frame";
import { FOCUS } from "@/components/landing/primitives";
import { Tag } from "@/components/app/common";
import { shortHash } from "@/lib/lab/types";
import { explorerTx } from "@/lib/wallet/near";
import type { HomeRecord } from "@/lib/wallet/homeStore";
import { useTabWatcher, type TabWatcherView } from "@/lib/tabwatcher/useTabWatcher";
import type { WatchTrip } from "@/lib/tabwatcher/watcher";
import { host } from "@/lib/tabwatcher/rpc";
import { cn } from "@/lib/utils";

export const TAB_ONLY = "Protection is live while this tab is open; export to the CLI for always-on.";

const STATE: Record<TabWatcherView["shown"], { label: string; tone: "safe" | "warn" | "trip" | "muted" }> = {
  none: { label: "no home", tone: "muted" },
  starting: { label: "starting", tone: "muted" },
  live: { label: "live", tone: "safe" },
  stalled: { label: "stalled", tone: "warn" },
  offline: { label: "offline", tone: "warn" },
  stopped: { label: "stopped", tone: "muted" },
  error: { label: "cannot run", tone: "trip" },
};

function Pulse({ beat, tone }: { beat: number; tone: "safe" | "warn" | "trip" | "muted" }) {
  const reduce = useReducedMotion();
  const color = tone === "safe" ? "bg-safe" : tone === "warn" ? "bg-warn" : tone === "trip" ? "bg-trip" : "bg-fg-faint";
  return (
    <span aria-hidden className="relative grid size-2.5 shrink-0 place-items-center">
      {!reduce && tone === "safe" ? (
        <motion.i key={beat} initial={{ scale: 1, opacity: 0.55 }} animate={{ scale: 2.6, opacity: 0 }} transition={{ duration: 0.7, ease: "easeOut" }} className={cn("absolute inset-0 rounded-full", color)} />
      ) : null}
      <i className={cn("relative size-2 rounded-full", color)} />
    </span>
  );
}

function TripLine({ t }: { t: WatchTrip }) {
  const landed = t.freezes.filter((f) => f.status === "landed");
  return (
    <li className="space-y-1 border-t border-line py-2.5 first:border-t-0">
      <p className="text-[12.5px] text-fg">
        <span className="text-trip">Decoy used</span> · block {(t.theft_block ?? t.detected_at_block).toLocaleString("en-US")}
      </p>
      <p className="font-mono text-[11px] [overflow-wrap:anywhere] text-fg-faint">{shortHash(t.public_key.replace("ed25519:", ""), 8, 4)}{t.tx_hash ? <> · <a className="underline-offset-4 hover:text-fg hover:underline" href={explorerTx(t.tx_hash)} target="_blank" rel="noreferrer">tx {shortHash(t.tx_hash)}</a></> : null}</p>
      {t.freezes.map((f) => (
        <p key={f.guardian} className="font-mono text-[11px] [overflow-wrap:anywhere] text-fg-muted">
          {f.status === "landed" ? <span className="text-safe">frozen</span> : f.status === "failed" ? <span className="text-trip">freeze failed</span> : f.status === "skipped" ? <span>skipped</span> : <span>freezing…</span>} {f.guardian}
          {f.tx_hash ? <> · <a className="underline-offset-4 hover:text-fg hover:underline" href={explorerTx(f.tx_hash)} target="_blank" rel="noreferrer">tx {shortHash(f.tx_hash)}</a></> : null}
          {f.error ? <span className="text-fg-faint"> · {f.error}</span> : null}
        </p>
      ))}
      {landed.length && t.theft_block !== null && landed[0]!.block !== undefined ? (
        <p className="font-mono text-[11px] text-trip">{landed[0]!.block! - t.theft_block} blocks from theft to freeze</p>
      ) : null}
    </li>
  );
}

/**
 * The in-tab watcher's status: a heartbeat with the last block it read, a stalled or offline state when RPC stops answering,
 * what it watches and freezes, and its recent trips. Reusable: it takes a browser-held home and owns no other state.
 */
export function WatcherHeartbeat({ home, className, autoStart = true }: { home: HomeRecord | null; className?: string; autoStart?: boolean }) {
  const v = useTabWatcher(home);
  // A page that shows the watcher runs it: protection is on while the tab is open. Stop stays one click away.
  const { start } = v;
  const hasHome = !!home;
  useEffect(() => {
    if (autoStart && hasHome) start();
  }, [autoStart, hasHome, start]);
  const s = v.status;
  const st = STATE[v.shown];
  const running = v.shown === "live" || v.shown === "starting" || v.shown === "stalled" || v.shown === "offline";
  const scope = home?.watcher.scope;
  return (
    <Frame className={className}>
      <FramePanel className="bg-ink-950" aria-label="Tab watcher status">
        <PanelBar right={<Tag tone={st.tone}>{st.label}</Tag>}>tab watcher</PanelBar>
        <div className="space-y-3 p-4">
          <p className="text-[13px] leading-relaxed text-fg" data-testid="tab-only">{TAB_ONLY}</p>
          {home ? (
            <>
              <div className="rounded-lg border border-line bg-ink-900/60 px-3 py-2.5" aria-live="polite">
                <div className="flex items-center gap-2.5">
                  <Pulse beat={s?.checks ?? 0} tone={running ? st.tone : "muted"} />
                  <span className="text-[12px] text-fg-muted">last block checked</span>
                  <span className="ml-auto font-mono text-[13px] text-fg tabular-nums" data-testid="hb-block">{s?.lastBlock ? s.lastBlock.toLocaleString("en-US") : "none yet"}</span>
                </div>
                <p className="mt-1 pl-5 font-mono text-[11px] text-fg-faint tabular-nums">
                  {v.age !== null ? `${v.age} s ago` : running ? "first read…" : "not watching"}
                  {s?.checks ? ` · ${s.checks} reads` : ""}
                  {s?.endpoint ? ` · ${host(s.endpoint)}` : ""}
                </p>
              </div>
              <dl className="space-y-1 font-mono text-[11.5px]">
                <div className="flex min-w-0 items-baseline justify-between gap-3"><dt className="shrink-0 text-fg-faint">bait</dt><dd className="min-w-0 truncate text-fg-muted" title={home.bait.account_id}>{home.bait.account_id}</dd></div>
                <div className="flex min-w-0 items-baseline justify-between gap-3"><dt className="shrink-0 text-fg-faint">signs as</dt><dd className="min-w-0 truncate text-fg-muted" title={home.watcher.account_id}>{home.watcher.account_id}</dd></div>
                <div className="flex min-w-0 items-baseline justify-between gap-3"><dt className="shrink-0 text-fg-faint">freezes</dt><dd className="min-w-0 truncate text-fg-muted" title={(s?.targets ?? []).join(", ")}>{(s?.targets ?? []).join(", ") || "no guardian"}</dd></div>
                <div className="flex min-w-0 items-baseline justify-between gap-3"><dt className="shrink-0 text-fg-faint">key</dt><dd className="min-w-0 truncate text-fg-muted">{scope?.kind === "function-call" ? `function-call: ${scope.method_names.join(", ")}` : "full access (CLI import)"}</dd></div>
              </dl>
              {v.shown === "stalled" || v.shown === "offline" ? (
                <Alert variant="warning" className="border-warn/30 bg-warn/5">
                  <WifiOff />
                  <AlertTitle className="line-clamp-none">{v.shown === "offline" ? "This browser is offline" : `RPC has not answered for ${v.age ?? "a few"} s`}</AlertTitle>
                  <AlertDescription>
                    <p>Still retrying. A decoy used meanwhile is caught on the next good read: a key's nonce never goes back, so no block is skipped.</p>
                    {s?.error ? <p className="font-mono text-[11px] [overflow-wrap:anywhere] text-fg-faint">{s.error}</p> : null}
                  </AlertDescription>
                </Alert>
              ) : null}
              {v.shown === "error" ? (
                <Alert variant="destructive" className="border-trip/40 bg-trip-soft">
                  <CircleAlert />
                  <AlertTitle className="line-clamp-none">The tab watcher cannot run</AlertTitle>
                  <AlertDescription><p className="[overflow-wrap:anywhere]">{s?.error}</p></AlertDescription>
                </Alert>
              ) : null}
              {s?.trips.length ? <ul aria-label="Trips seen by this tab">{s.trips.slice(0, 3).map((t) => <TripLine key={t.id} t={t} />)}</ul> : null}
              <div className="flex flex-wrap items-center gap-2">
                <Button variant={running ? "quiet" : "line"} size="sm" onClick={running ? v.stop : v.start} className={cn("h-8 gap-1.5 border border-line-strong font-mono text-[12px]", FOCUS)} data-testid="hb-toggle">
                  {running ? <Pause aria-hidden className="size-3.5" /> : <Play aria-hidden className="size-3.5" />}
                  {running ? "Stop watching" : v.shown === "error" ? "Try again" : "Start watching"}
                </Button>
                <code className="min-w-0 truncate font-mono text-[11px] text-fg-faint" title="Always-on: the CLI watcher with this home exported">standin dev up --home DIR</code>
              </div>
            </>
          ) : (
            <p className="text-[12.5px] leading-relaxed text-fg-muted">No bait and watcher keys in this browser yet, so there is nothing to watch.</p>
          )}
        </div>
      </FramePanel>
    </Frame>
  );
}
