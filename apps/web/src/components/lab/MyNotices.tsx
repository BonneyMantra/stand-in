import type { ReactNode } from "react";
import { Link } from "react-router";
import { CircleAlert, Coins, KeyRound, ShieldOff, Snowflake, Wallet, WifiOff } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import { Button } from "@/components/ui/button";
import { CopyText } from "@/components/app/common";
import { FOCUS } from "@/components/landing/primitives";
import { FAUCET_URL } from "@/lib/wallet/guardianCode";
import type { Preflight, Problem } from "@/lib/tabwatcher/preflight";
import { cn } from "@/lib/utils";

const A = "text-fg underline underline-offset-4 hover:text-white";

function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="mt-1 space-y-1">
      {items.map((t, i) => (
        <li key={i} className="flex gap-2.5"><span className="font-mono text-[11px] text-fg-faint tabular-nums">{i + 1}.</span><span>{t}</span></li>
      ))}
    </ol>
  );
}

export function ConnectNotice({ connecting, error, onConnect }: { connecting: boolean; error: string | null; onConnect: () => void }) {
  return (
    <div className="space-y-4" data-testid="my-connect">
      <p className="max-w-[60ch] text-[13.5px] leading-relaxed text-fg-muted">
        Run the theft-to-freeze loop on <span className="text-fg">your own</span> guarded testnet account: your bait, your watcher and your
        guardian, signed only by keys in this browser and by your wallet. Nothing here uses an account of ours.
      </p>
      <div className="text-[13px] leading-relaxed text-fg-muted">
        <Steps items={[
          <>Connect the wallet that owns the guardian (NEAR Connect: Meteor, Intear, Nightly, Ledger, NEAR CLI).</>,
          <>A guardian and a browser home (bait <span className="font-mono text-fg">deployer.&lt;you&gt;</span>, watcher <span className="font-mono text-fg">watch.&lt;you&gt;</span>) come from <Link className={A} to="/app">My account</Link>.</>,
          <>This tab plants a decoy, a thief spends it, and your watcher in this tab freezes your guardian.</>,
        ]} />
      </div>
      {error ? <p className="text-[12.5px] text-trip">{error}</p> : null}
      <Button variant="invert" size="lg" onClick={onConnect} disabled={connecting} className={cn("h-10 gap-2 px-4 text-[13.5px]", FOCUS)}>
        <Wallet aria-hidden className="size-4" />{connecting ? "Waiting for the wallet…" : "Connect wallet"}
      </Button>
    </div>
  );
}

export function WrongNetwork({ account }: { account: string }) {
  return (
    <Alert variant="warning" className="border-warn/30 bg-warn/5">
      <CircleAlert />
      <AlertTitle className="line-clamp-none">Mainnet account</AlertTitle>
      <AlertDescription><p><span className="font-mono break-all">{account}</span> is on mainnet. The lab runs on testnet: switch the wallet to testnet, then connect again.</p></AlertDescription>
    </Alert>
  );
}

export function NoGuardian({ owner }: { owner: string }) {
  return (
    <Alert variant="info" data-testid="my-no-guardian">
      <ShieldOff />
      <AlertTitle className="line-clamp-none">No guardian on this account yet</AlertTitle>
      <AlertDescription>
        <p><span className="font-mono break-all">{owner}</span> has no Stand-in guardian, and the factory lists none it owns.</p>
        <p>Open the <Link className={A} to="/app/owner">owner console</Link> and choose <span className="text-fg">Protect this account</span> (your wallet deploys the guardian here) or <span className="text-fg">Create a guarded agent account</span> (any wallet, including Meteor and MetaMask).</p>
      </AlertDescription>
    </Alert>
  );
}

export function NoHome({ owner, guardians, watchers }: { owner: string; guardians: string[]; watchers: Record<string, string> }) {
  const own = `watch.${owner}`;
  const foreign = guardians.filter((g) => watchers[g] && watchers[g] !== own);
  if (foreign.length === guardians.length) {
    return (
      <Alert variant="info" data-testid="my-no-home">
        <KeyRound />
        <AlertTitle className="line-clamp-none">Your guardian is watched by another account</AlertTitle>
        <AlertDescription>
          <p>{foreign.map((g) => <span key={g} className="block"><span className="font-mono break-all">{g}</span> is watched by <span className="font-mono break-all">{watchers[g]}</span>.</span>)}</p>
          <p>A guardian cannot change its watcher, so a watcher in this browser (<span className="font-mono">{own}</span>) could never freeze it. Create a new guardian in <Link className={A} to="/app">My account</Link>: Protect and Create a guarded agent account both make <span className="font-mono">{own}</span> its watcher and keep its key here.</p>
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert variant="info" data-testid="my-no-home">
      <KeyRound />
      <AlertTitle className="line-clamp-none">No browser home for {owner}</AlertTitle>
      <AlertDescription>
        <p>You have {guardians.length === 1 ? "a guardian" : `${guardians.length} guardians`} (<span className="font-mono break-all">{guardians.join(", ")}</span>), but this browser holds no bait or watcher keys for {guardians.length === 1 ? "it" : "them"}. The run signs the decoy plant with the bait's key and the freeze with the watcher's key, so both must be here.</p>
        <p>In <Link className={A} to="/app">My account</Link>, create a browser home (keys made in this browser; your wallet creates <span className="font-mono">deployer.{owner}</span> and <span className="font-mono">watch.{owner}</span>) or, if <span className="font-mono">standin adopt</span> already made them, import that CLI home.</p>
      </AlertDescription>
    </Alert>
  );
}

export function RpcFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Alert variant="destructive" className="border-trip/40 bg-trip-soft" data-testid="my-rpc-error">
      <WifiOff />
      <AlertTitle className="line-clamp-none">Testnet RPC did not answer</AlertTitle>
      <AlertDescription>
        <p className="[overflow-wrap:anywhere]">{message}</p>
        <p>Nothing was sent. Check the connection or an extension that blocks RPC hosts, then try again.</p>
        <Button variant="line" size="sm" onClick={onRetry} className={cn("mt-1 h-8", FOCUS)}>Try again</Button>
      </AlertDescription>
    </Alert>
  );
}

function Funding({ p }: { p: Problem }) {
  return (
    <li className="space-y-1">
      <p>{p.text}</p>
      {p.account ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <CopyText value={p.account} className="text-[12px]" />
          <a className={cn(A, "inline-flex items-center gap-1 text-[12.5px]")} href={FAUCET_URL} target="_blank" rel="noreferrer"><Coins aria-hidden className="size-3.5" />Testnet faucet</a>
        </p>
      ) : null}
    </li>
  );
}

/** What stops a run on this guardian, each with its fix. Stand-in never funds an account of yours. */
export function Problems({ pre, onRetry }: { pre: Preflight; onRetry: () => void }) {
  const money = pre.problems.filter((p) => p.kind === "bait-low" || p.kind === "watcher-low");
  const other = pre.problems.filter((p) => !money.includes(p));
  return (
    <div className="space-y-3" data-testid="my-problems">
      {other.length ? (
        <Alert variant="destructive" className="border-trip/40 bg-trip-soft">
          <CircleAlert />
          <AlertTitle className="line-clamp-none">This guardian cannot run the loop from this browser</AlertTitle>
          <AlertDescription>
            <ul className="space-y-1">{other.map((p) => <li key={p.kind + p.text}>{p.text}</li>)}</ul>
            <p>Fix it in <Link className={A} to="/app">My account</Link> or the <Link className={A} to="/app/owner">owner console</Link>, then check again.</p>
            <Button variant="line" size="sm" onClick={onRetry} className={cn("mt-1 h-8", FOCUS)}>Check again</Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {money.length ? (
        <Alert variant="warning" className="border-warn/30 bg-warn/5" data-testid="my-low-balance">
          <Coins />
          <AlertTitle className="line-clamp-none">Not enough NEAR for a run</AlertTitle>
          <AlertDescription>
            <ul className="space-y-2">{money.map((p) => <Funding key={p.kind} p={p} />)}</ul>
            <p>Send testnet NEAR to {money.length === 1 ? "that account" : "those accounts"} from your wallet or the faucet, then check again. Stand-in never funds your accounts.</p>
            <Button variant="line" size="sm" onClick={onRetry} className={cn("mt-1 h-8", FOCUS)}>Check again</Button>
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

export function AlreadyFrozen({ guardian, pre, busy, onUnfreeze }: { guardian: string; pre: Preflight; busy: boolean; onUnfreeze: () => void }) {
  const last = pre.state?.freeze_log.at(-1);
  return (
    <Alert variant="warning" className="border-warn/30 bg-warn/5" data-testid="my-frozen">
      <Snowflake />
      <AlertTitle className="line-clamp-none">{guardian} is frozen</AlertTitle>
      <AlertDescription>
        <p>A run needs an active guardian to freeze.{last ? ` The last freeze was at block ${Number(last.at_block).toLocaleString("en-US")} by ${last.by}.` : ""} Unfreeze is one transaction from your wallet.</p>
        <Button variant="line" size="sm" onClick={onUnfreeze} disabled={busy} className={cn("mt-1 h-8", FOCUS)}>{busy ? "Waiting for the wallet…" : "Unfreeze from your wallet"}</Button>
      </AlertDescription>
    </Alert>
  );
}

