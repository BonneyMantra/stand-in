import type { ReactNode } from "react";
import { ArrowUpRight, Snowflake, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/app/common";
import { FOCUS } from "@/components/landing/primitives";
import type { WalletResult } from "./useUnfreeze";
import { shortHash } from "@/lib/lab/types";
import { explorerTx } from "@/lib/wallet/near";
import type { Preflight } from "@/lib/tabwatcher/preflight";
import type { MyRunState } from "@/lib/tabwatcher/run";
import { cn } from "@/lib/utils";

const Row = ({ k, children }: { k: string; children: ReactNode }) => (
  <div className="grid grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)] gap-x-3 py-1.5 text-[12.5px]">
    <dt className="text-fg-faint">{k}</dt>
    <dd className="min-w-0 font-mono text-[12px] [overflow-wrap:anywhere] text-fg-muted">{children}</dd>
  </div>
);

const Tx = ({ hash, label = "tx" }: { hash: string; label?: string }) => (
  <a href={explorerTx(hash)} target="_blank" rel="noreferrer" title={hash} className="inline-flex items-center gap-1 text-fg-muted underline-offset-4 hover:text-fg hover:underline">
    {label} {shortHash(hash)}<ArrowUpRight aria-hidden className="size-3" />
  </a>
);

/** The owner's last wallet request from this page (unfreeze), with its explorer link and what was read back. */
export function WalletLine({ entry }: { entry: WalletResult }) {
  return (
    <p className="flex flex-wrap items-center gap-2 font-mono text-[11.5px]" data-testid="my-wallet-line">
      <Tag tone={entry.status === "ok" ? "safe" : entry.status === "failed" ? "trip" : "muted"}>{entry.label} · {entry.status === "pending" ? "waiting" : entry.status}</Tag>
      {entry.hash ? <Tx hash={entry.hash} /> : null}
      {entry.message ? <span className="font-sans text-[12px] text-fg-faint">{entry.message}</span> : null}
    </p>
  );
}

/** Before a run: what was read from chain, in one line. */
export function ReadyLine({ pre }: { pre: Preflight }) {
  const s = pre.state!;
  const key = pre.watcherKey === "FullAccess" ? "full access" : "freeze only";
  return (
    <p className="font-mono text-[11.5px] leading-relaxed text-fg-faint" data-testid="my-ready">
      <span className="text-safe">ready</span> · {pre.guardian} active · {s.agent_keys.length} agent key{s.agent_keys.length === 1 ? "" : "s"} · {s.intents_keys.length} intents · watcher key {key} · blocklist report {pre.report.ok ? "on" : "CLI watcher only"}
    </p>
  );
}

/** The second press: what a real freeze does to the owner's guardian, before anything is signed. */
export function ConfirmRun({ guardian, pre, targets, onStart, onCancel }: { guardian: string; pre: Preflight; targets: string[]; onStart: () => void; onCancel: () => void }) {
  const s = pre.state!;
  const others = targets.filter((t) => t !== guardian);
  return (
    <div className="rounded-lg border border-trip/35 bg-trip-soft p-4" role="group" aria-labelledby="confirm-title" data-testid="my-confirm">
      <p id="confirm-title" className="flex items-center gap-2 text-[14px] font-medium text-fg"><TriangleAlert aria-hidden className="size-4 text-trip" />This freezes {guardian} for real</p>
      <ul className="mt-2.5 space-y-1.5 text-[13px] leading-relaxed text-fg-muted">
        <li>· {s.agent_keys.length ? `Its ${s.agent_keys.length} agent key${s.agent_keys.length === 1 ? " is" : "s are"} deleted; the agent then needs a new key (the CLI's adopt or unfreeze link).` : "It has no agent keys, so none are deleted."}</li>
        <li>· {s.intents_keys.length ? `${s.intents_keys.length} intents key${s.intents_keys.length === 1 ? " is" : "s are"} removed from ${s.intents_contract}.` : `No intents keys are registered on ${s.intents_contract}.`}</li>
        <li>· Chain Signatures (<span className="font-mono">sign_evm</span>) are refused until you unfreeze.</li>
        <li>· 0.05 NEAR leaves your bait for a throwaway thief account and is sent back at the end. About 0.003 NEAR is spent: gas, and the thief account's own storage, which a transfer cannot move.</li>
        {others.length ? <li>· Your watcher key also freezes {others.join(", ")}: it freezes every guardian it guards.</li> : null}
        <li>· Unfreezing is one transaction from your wallet, offered when the run ends.</li>
      </ul>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="invert" size="sm" onClick={onStart} className={cn("h-9 px-4", FOCUS)} data-testid="my-start">Start the run</Button>
        <Button variant="quiet" size="sm" onClick={onCancel} className={cn("h-9 border border-line-strong px-4", FOCUS)}>Cancel</Button>
      </div>
    </div>
  );
}

/** What the chain shows after the run, and the owner's way back: Unfreeze through their own wallet. */
export function RunResult({ state, pre, busy, last, onUnfreeze, canSign }: { state: MyRunState; pre: Preflight | null; busy: boolean; last: WalletResult | null; onUnfreeze: () => void; canSign: boolean }) {
  const rb = state.readback;
  const frozenNow = pre?.state?.frozen ?? rb?.frozen ?? false;
  return (
    <div className="space-y-4 border-t border-line pt-4" data-testid="my-result">
      {rb ? (
        <dl className="divide-y divide-line rounded-lg border border-line bg-ink-900/50 px-3.5" aria-label="Read back from chain">
          <Row k="frozen">{String(rb.frozen)}{rb.by ? ` · by ${rb.by}` : ""}{rb.atBlock ? ` · block ${rb.atBlock.toLocaleString("en-US")}` : ""}</Row>
          <Row k="freeze log names">{rb.decoyMatches ? "this run's decoy" : "another decoy"}{rb.theftTx ? <> · <Tx hash={rb.theftTx} label="theft" /></> : null}</Row>
          <Row k="agent keys deleted">{rb.deleted.length ? rb.deleted.map((d) => `${shortHash(d.key.replace("ed25519:", ""), 6, 4)} ${d.gone ? "gone" : "STILL ON CHAIN"}`).join(", ") : "none (it had none)"}</Row>
          <Row k="intents keys removed">{rb.intentsRemoved.length ? rb.intentsRemoved.length : "none (none registered)"}</Row>
          <Row k="Chain Signatures">{rb.frozen ? "sign_evm refused while frozen" : "allowed"}</Row>
          {state.report ? <Row k="blocklist">check = {state.report.verdict ?? "unreadable"} · <Tx hash={state.report.hash} /></Row> : null}
        </dl>
      ) : null}
      {state.phase !== "running" && (frozenNow || last) ? (
        <div className="flex flex-col gap-3 rounded-lg border border-line bg-ink-900/50 p-4 sm:flex-row sm:items-center sm:justify-between" data-testid="my-unfreeze">
          <div className="min-w-0 text-[13px] leading-relaxed text-fg-muted">
            <p className="flex items-center gap-2 text-fg"><Snowflake aria-hidden className="size-4" />{frozenNow ? `${state.guardian ?? pre?.guardian} is frozen` : `${state.guardian ?? pre?.guardian} is active again`}</p>
            <p>{frozenNow ? "Only the owner can unfreeze: one transaction from your wallet, the same call as the owner console." : "Read back from chain: frozen false. Deleted agent keys stay deleted; the CLI gives the agent a new one."}</p>
            {last ? (
              <p className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[11.5px]">
                <Tag tone={last.status === "ok" ? "safe" : last.status === "failed" ? "trip" : "muted"}>{last.status === "pending" ? "waiting" : last.status}</Tag>
                {last.hash ? <Tx hash={last.hash} /> : null}
                {last.message ? <span className="font-sans text-[12px] text-fg-faint">{last.message}</span> : null}
              </p>
            ) : null}
          </div>
          {frozenNow ? (
            <Button variant="invert" size="sm" onClick={onUnfreeze} disabled={busy || !canSign} className={cn("h-9 shrink-0 px-4", FOCUS)} data-testid="my-unfreeze-btn">
              {busy ? "Confirm in your wallet…" : "Unfreeze from your wallet"}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
