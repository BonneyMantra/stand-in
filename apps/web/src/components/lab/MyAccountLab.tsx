import { useEffect, useState, type ReactNode } from "react";
import { Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Frame, FramePanel, PanelBar } from "@/components/landing/frame";
import { FOCUS } from "@/components/landing/primitives";
import { Shimmer, Tag } from "@/components/app/common";
import { useNearWallet } from "@/components/owner/useNearWallet";
import { WalletControl } from "@/components/owner/WalletControl";
import { looksMainnet } from "@/lib/wallet/near";
import { canFreeze } from "@/lib/wallet/homeStore";
import { useHome } from "@/lib/tabwatcher/useTabWatcher";
import { useMyLab, useMyRun } from "@/lib/tabwatcher/useMyLab";
import { MY_LABELS, MY_STEPS } from "@/lib/tabwatcher/runSteps";
import { cn } from "@/lib/utils";
import { RunTrace } from "./RunTrace";
import { WatcherHeartbeat } from "./WatcherHeartbeat";
import { MyAccounts } from "./MyAccounts";
import { ConfirmRun, ReadyLine, RunResult, WalletLine } from "./MyRunBody";
import { InterruptedRun } from "./InterruptedRun";
import { useUnfreeze } from "./useUnfreeze";
import { AlreadyFrozen, ConnectNotice, NoGuardian, NoHome, Problems, RpcFailed, WrongNetwork } from "./MyNotices";

/**
 * /lab, "Your account": the theft-to-freeze loop on the connected owner's own guardian. The bait key in this browser plants
 * the decoy, a thief key made here spends it, the tab watcher sees it and freezes with the watcher key in this browser, and
 * the owner's wallet unfreezes. Lazy-loaded with the wallet code, so the demo tab does not carry it.
 */
export default function MyAccountLab() {
  const w = useNearWallet();
  const owner = w.status === "connected" && w.accountId && !looksMainnet(w.accountId) ? w.accountId : null;
  const home = useHome(owner);
  const { disc, pre, guardian, setGuardian, refresh } = useMyLab(owner, home);
  const { state, journal, start, reloadJournal } = useMyRun(home);
  const [confirm, setConfirm] = useState(false);
  const uf = useUnfreeze(w.wallet, owner, refresh);
  const running = state.phase === "running";

  // A real freeze is in flight: leaving would stop the watcher before it can freeze.
  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);
  useEffect(() => { if (state.phase === "done" || state.phase === "failed") refresh(); }, [state.phase, refresh]);

  const p = pre.status === "ok" ? pre.pre : null;
  const frozen = !!p?.state?.frozen;
  const ready = !!home && !!guardian && !!p && p.problems.length === 0 && !frozen && !running;
  const interrupted = journal && journal.phase === "running" && !running && home ? journal : null;
  const steps = state.phase === "idle" && journal && journal.phase !== "running" ? (journal.steps as typeof state.steps) : state.steps;
  const shownRun = state.phase === "idle" && journal && journal.phase !== "running" ? "last" : state.phase;
  const reached = state.steps.filter((s) => s.status === "ok" || s.status === "skip").length;

  const unfreeze = () => {
    if (guardian) void uf.unfreeze(guardian);
  };

  const tag = running ? <Tag tone="decoy">running</Tag> : state.phase === "done" ? <Tag tone="safe">done</Tag> : state.phase === "failed" ? <Tag tone="trip">stopped</Tag> : frozen ? <Tag tone="warn">frozen</Tag> : ready ? <Tag tone="safe">ready</Tag> : <Tag>{owner ? "not ready" : "not connected"}</Tag>;

  let body: ReactNode;
  if (w.status === "restoring") body = <div className="space-y-2" aria-label="Loading"><Shimmer className="h-4 w-2/3" /><Shimmer className="h-4 w-1/2" /></div>;
  else if (w.status !== "connected" || !w.accountId) body = <ConnectNotice connecting={w.status === "connecting"} error={w.error} onConnect={() => void w.connect()} />;
  else if (looksMainnet(w.accountId)) body = <WrongNetwork account={w.accountId} />;
  else if (disc.status === "error") body = <RpcFailed message={disc.message} onRetry={refresh} />;
  else if (disc.status !== "ok") body = <div className="space-y-2"><Shimmer className="h-4 w-2/3" /><Shimmer className="h-4 w-1/3" /></div>;
  else if (!home && !disc.guardians.length) body = <NoGuardian owner={w.accountId} />;
  else if (!home) body = <NoHome owner={w.accountId} guardians={disc.guardians} watchers={disc.watchers} />;
  else body = (
    <div className="space-y-5">
      {interrupted ? <InterruptedRun journal={interrupted} home={home} onClosed={reloadJournal} /> : null}
      {home.guardians.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2 text-[12px]" role="radiogroup" aria-label="Guardian for this run">
          <span className="text-fg-faint">guardian</span>
          {home.guardians.map((g) => (
            <button key={g} role="radio" aria-checked={g === guardian} disabled={running} onClick={() => setGuardian(g)} className={cn("h-7 rounded-md border px-2.5 font-mono text-[11.5px]", g === guardian ? "border-fg-muted bg-ink-800 text-fg" : "border-line-strong text-fg-muted hover:text-fg", FOCUS)}>{g}</button>
          ))}
        </div>
      ) : null}
      {pre.status === "error" ? <RpcFailed message={pre.message} onRetry={refresh} /> : null}
      {pre.status === "loading" && !p ? <div className="space-y-2"><Shimmer className="h-4 w-2/3" /><Shimmer className="h-4 w-1/2" /></div> : null}
      {p && !running && state.phase === "idle" && p.problems.length ? <Problems pre={p} onRetry={refresh} /> : null}
      {p && frozen && !running && state.phase === "idle" && !journal?.steps.length ? <AlreadyFrozen guardian={p.guardian} pre={p} busy={uf.busy} onUnfreeze={unfreeze} /> : null}
      {confirm && p && guardian && ready ? (
        <ConfirmRun guardian={guardian} pre={p} targets={home.guardians.filter((g) => canFreeze(home, g))} onCancel={() => setConfirm(false)} onStart={() => { setConfirm(false); void start(guardian); }} />
      ) : null}
      {uf.last && state.phase === "idle" && !journal?.steps.length ? <WalletLine entry={uf.last} /> : null}
      {p && ready && state.phase === "idle" ? <ReadyLine pre={p} /> : null}
      <div className="space-y-3">
        {shownRun === "last" ? <p className="font-mono text-[11px] tracking-[0.14em] text-fg-faint uppercase">Last run on your account · {journal?.finished_at ? new Date(journal.finished_at).toLocaleString() : ""}</p> : null}
        <RunTrace steps={steps} live={running} labels={MY_LABELS} label="Run on my account steps" />
      </div>
      {(state.phase === "done" || state.phase === "failed" || (journal?.steps.length && (frozen || uf.last))) ? (
        <RunResult state={state.phase === "idle" ? { ...state, guardian: journal?.guardian ?? guardian } : state} pre={p} busy={uf.busy} last={uf.last} onUnfreeze={unfreeze} canSign={w.status === "connected"} />
      ) : null}
    </div>
  );

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
      <Frame>
        <FramePanel className="bg-ink-950">
          <PanelBar right={tag}>lab · {owner ?? "your account"}</PanelBar>
          <div className="flex flex-col gap-4 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-[46ch] text-[13px] leading-relaxed text-fg-muted">
              Runs the real loop on your own guarded account: your bait, your watcher in this tab, your guardian. Each step links to its transaction.
            </p>
            <Button variant="invert" size="lg" onClick={() => setConfirm(true)} disabled={!ready || confirm} aria-live="polite" className={cn("h-11 min-w-[196px] gap-2 px-5 text-[14px] active:scale-[0.98]", FOCUS)} data-testid="my-run">
              {running ? <span aria-hidden className="size-2 animate-pulse rounded-full bg-trip" /> : state.phase === "idle" && !journal?.steps.length ? <Play aria-hidden className="size-4" /> : <RotateCcw aria-hidden className="size-4" />}
              {running ? `Running · ${reached} of ${MY_STEPS.length}` : state.phase === "idle" && !journal?.steps.length ? "Run on my account" : "Run again"}
            </Button>
          </div>
          <div className="p-4 sm:p-5">
            {w.status === "connected" ? (
              <div className="mb-4 flex">
                <WalletControl info={w} onConnect={() => void w.connect()} onDisconnect={() => void w.disconnect()} />
              </div>
            ) : null}
            {body}
          </div>
        </FramePanel>
      </Frame>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-1">
        <WatcherHeartbeat home={home} />
        <MyAccounts owner={owner} home={home} pre={p} thief={state.thief ?? journal?.thief.account ?? null} />
      </div>
    </div>
  );
}
