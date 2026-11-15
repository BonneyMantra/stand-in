import { useRef, type RefObject } from "react";
import { RefreshCw, ServerCrash } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/app/common";
import { MetricStrip, type Metric } from "@/components/app/MetricStrip";
import { WalletControl } from "@/components/owner/WalletControl";
import { ActivityLog } from "@/components/owner/ActivityLog";
import { HomePanel } from "@/components/owner/HomePanel";
import { ConnectInvite } from "@/components/account/ConnectInvite";
import { NextStepCard } from "@/components/account/NextStepCard";
import { GuardiansPanel } from "@/components/account/GuardiansPanel";
import { DecoysPanel } from "@/components/account/DecoysPanel";
import { FreezesPanel } from "@/components/account/FreezesPanel";
import { ActivityPanel } from "@/components/account/ActivityPanel";
import { TabWatchSlot } from "@/components/account/TabWatchSlot";
import { useWallet } from "@/components/owner/WalletProvider";
import { useAccountTools } from "@/components/account/useAccountTools";
import { useMyAccount } from "@/data/useMyAccount";
import { fmtTime } from "@/data/derive";

export default function MyAccountPage() {
  const w = useWallet();
  const m = useMyAccount();
  const t = useAccountTools();
  const homeRef = useRef<HTMLDivElement>(null);
  const toHome = () => homeRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  const s = m.snapshot;

  return (
    <div className="space-y-4">
      <PageHeader
        title="My account"
        sub={m.owner ? <>Read from NEAR testnet for <span className="font-mono text-fg">{m.owner}</span>{s ? <> · {fmtTime(new Date(s.readAt).toISOString(), true)}</> : null}. Not sample data.</> : "Your own guardians, keys and decoys, read from NEAR testnet."}
        actions={
          <div className="flex items-center gap-2">
            {m.owner && (
              <Button variant="quiet" size="icon-sm" onClick={() => void m.refresh()} aria-label="Read the chain again" disabled={m.refreshing}>
                <RefreshCw className={m.refreshing ? "animate-spin" : undefined} aria-hidden />
              </Button>
            )}
            <WalletControl info={w} onConnect={() => void w.connect()} onDisconnect={() => void w.disconnect()} />
          </div>
        }
      />
      {w.error && (
        <Alert variant="destructive" data-testid="wallet-error">
          <AlertTitle>Wallet</AlertTitle>
          <AlertDescription><p>{w.error}</p></AlertDescription>
        </Alert>
      )}
      <Body t={t} homeRef={homeRef} toHome={toHome} />
    </div>
  );
}

function Body({ t, homeRef, toHome }: { t: ReturnType<typeof useAccountTools>; homeRef: RefObject<HTMLDivElement | null>; toHome: () => void }) {
  const w = useWallet();
  const m = useMyAccount();
  const r = m.read;
  if (r.status === "no-wallet") return <ConnectInvite connecting={w.status === "connecting"} onConnect={() => void w.connect()} />;
  if (r.status === "wrong-network") {
    return (
      <Alert variant="warning" data-testid="wrong-network">
        <AlertTitle>Wrong network</AlertTitle>
        <AlertDescription><p><span className="font-mono break-all">{r.owner}</span> is a mainnet account. Stand-in's self-serve setup runs on testnet: switch the wallet to testnet, then disconnect and connect again.</p></AlertDescription>
      </Alert>
    );
  }
  const s = m.snapshot;
  if (!s) {
    if (r.status === "error") {
      return (
        <div className="rounded-[10px] border border-line bg-ink-900">
          <EmptyState icon={ServerCrash} title="Could not read your account">
            <p data-testid="account-error">{r.error}</p>
            <Button variant="line" size="sm" onClick={() => void m.refresh()} className="mt-3"><RefreshCw aria-hidden />Try again</Button>
          </EmptyState>
        </div>
      );
    }
    return <Skeleton />;
  }
  const g = s.guardians;
  const decoys = t.decoys.filter((d) => !d.admin);
  const metrics: Metric[] = [
    { label: "Guardians", value: g.length, tone: g.some((x) => x.state.frozen) ? "trip" : g.length ? "safe" : "fg", sub: g.length ? `${g.filter((x) => x.state.frozen).length} frozen` : "none yet" },
    { label: "Agent keys", value: g.reduce((n, x) => n + x.state.agent_keys.length, 0), sub: "scoped function-call keys" },
    { label: "Intents keys", value: g.reduce((n, x) => n + x.state.intents_keys.length, 0), sub: "on the intents registry" },
    { label: "Decoys", value: decoys.length, tone: "decoy", sub: s.bait.exists ? `${decoys.filter((d) => d.signed).length} used` : "no bait yet" },
    { label: "Trips", value: t.freezes.filter((f) => f.trip).length, tone: t.freezes.some((f) => f.trip) ? "trip" : "fg", sub: `${t.freezes.length} freezes logged` },
  ];
  return (
    <>
      {r.status === "error" && <p className="text-[11px] text-warn" role="status">The last read failed ({r.error}); showing the read before it.</p>}
      {m.next && <NextStepCard step={m.next} owner={s.owner} onAddDecoy={() => void t.tools.addDecoy()} onScrollHome={toHome} />}
      <MetricStrip items={metrics} />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-4">
          <GuardiansPanel snapshot={s} />
          <div className="grid items-start gap-4 2xl:grid-cols-2">
            <DecoysPanel bait={s.bait.id} exists={s.bait.exists} decoys={t.decoys} home={m.home} canAdd={m.summary?.bait === "held"} adding={t.tools.working === "decoy"} onAdd={() => void t.tools.addDecoy()} limit={6} thefts={t.thefts} />
            <FreezesPanel freezes={t.freezes} activity={t.activityTxs} thefts={t.thefts} limit={5} />
          </div>
          <ActivityPanel read={t.activity.read} local={m.home?.txs ?? []} ctx={{ bait: s.bait.id, watcher: s.watcher.id }} onReload={() => void t.activity.reload()} />
        </div>
        <div ref={homeRef} className="min-w-0 scroll-mt-16 space-y-4">
          {m.summary && (
            <HomePanel snapshot={s} summary={m.summary} home={m.home} plan={t.plan} eth={m.eth} busy={t.busy} working={t.tools.working} note={t.tools.note}
              onCreate={() => t.plan && void t.createHome(t.plan)} onAddDecoy={() => void t.tools.addDecoy()} onExport={t.tools.exportHome} onImport={t.tools.importHome}
              slot={m.home && m.summary.watcher === "held" && m.summary.bait === "held" ? <TabWatchSlot owner={s.owner} home={m.home} /> : undefined} />
          )}
          {t.log.length > 0 && <ActivityLog entries={t.log} />}
        </div>
      </div>
    </>
  );
}

function Skeleton() {
  return (
    <div className="space-y-4" role="status" aria-busy="true" aria-label="Reading your account from testnet">
      <div className="h-[74px] animate-pulse rounded-[10px] border border-line bg-ink-900" />
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-line bg-line lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => <div key={i} className="h-[92px] animate-pulse bg-ink-900" />)}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="h-[260px] animate-pulse rounded-[10px] border border-line bg-ink-900" />
        <div className="h-[260px] animate-pulse rounded-[10px] border border-line bg-ink-900" />
      </div>
    </div>
  );
}
