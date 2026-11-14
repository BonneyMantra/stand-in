import { RefreshCw, ServerCrash, ShieldCheck, ShieldQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyText, EmptyState, ExtLink, KV, Panel, Shimmer, Tag } from "@/components/app/common";
import { shortKey } from "@/data/derive";
import { explorerAccount, explorerTx, type GuardianLookup, type GuardianState } from "@/lib/wallet/near";
import type { GuardianRead } from "./useGuardian";

const NO_GUARDIAN: Record<Exclude<GuardianLookup["kind"], "guardian">, string> = {
  "missing-account": "This account does not exist on testnet.",
  "no-contract": "This account has no contract, so no guardian is watching it.",
  "not-guardian": "This account runs a contract, but it is not a Stand-in guardian.",
};

export function NoGuardian({ accountId, lookup }: { accountId: string; lookup: Exclude<GuardianLookup, { kind: "guardian" }> }) {
  return (
    <EmptyState icon={ShieldQuestion} title="No guardian on this account" className="py-8">
      <p data-testid="no-guardian">{NO_GUARDIAN[lookup.kind]}{lookup.kind === "not-guardian" ? ` (${lookup.detail})` : ""}</p>
      <p className="mt-2">
        {lookup.kind === "no-contract"
          ? "The panel above deploys the guardian on it from your wallet. Agents then get scoped keys, and the full-access key stays in your wallet."
          : "The guardian runs on the guarded account itself, so it can only be deployed on an account with no other contract."}
      </p>
      <p className="mt-2">
        The guardian's owner is the account itself, so this console can only act for an account whose full-access key is in the connected
        wallet. Connected: <span className="font-mono text-fg">{accountId}</span>.
      </p>
    </EmptyState>
  );
}

function Keys({ title, keys }: { title: string; keys: string[] }) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 border-b border-line px-3.5 py-2">
        <h3 className="text-xs font-medium text-fg">{title}</h3>
        <span className="font-mono text-[11px] text-fg-faint">{keys.length}</span>
      </div>
      {keys.length === 0 ? (
        <p className="px-3.5 py-3 text-xs text-fg-faint">None registered.</p>
      ) : (
        <ul className="divide-y divide-line">
          {keys.map((k) => (
            <li key={k} className="flex min-w-0 items-center gap-2 px-3.5 py-2">
              <span className="size-1.5 shrink-0 rounded-full bg-safe" aria-hidden />
              <CopyText value={k} display={shortKey(k, 8, 6)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StateBody({ s }: { s: GuardianState }) {
  const last = s.freeze_log[s.freeze_log.length - 1];
  return (
    <>
      <div className="px-3.5 py-1.5">
        <KV k="owner" v={s.owner} />
        <KV k="watcher" v={s.watcher} />
        <KV k="intents registry" v={s.intents_contract} />
        <KV k="freezes logged" v={s.freeze_log.length} />
      </div>
      <div className="grid divide-y divide-line border-t border-line lg:grid-cols-2 lg:divide-x lg:divide-y-0">
        <Keys title="Agent keys" keys={s.agent_keys} />
        <Keys title="Intents keys" keys={s.intents_keys} />
      </div>
      {last && (
        <div className="space-y-1 border-t border-line px-3.5 py-2.5">
          <p className="text-[11px] text-fg-faint">Latest freeze · block {last.at_block} · by <span className="font-mono">{last.by}</span></p>
          <p className="text-xs break-words text-fg">{last.reason || "(no reason given)"}</p>
          <p className="text-[11px] text-fg-muted">
            {last.deleted_keys.length} agent key{last.deleted_keys.length === 1 ? "" : "s"} deleted · {last.intents_keys_removed.length} intents key{last.intents_keys_removed.length === 1 ? "" : "s"} removed
            {last.tx_hash ? <> · decoy tx <ExtLink href={explorerTx(last.tx_hash)}>{shortKey(last.tx_hash, 6, 4)}</ExtLink></> : null}
          </p>
        </div>
      )}
    </>
  );
}

export function GuardianPanel({ accountId, read, onRefresh }: { accountId: string; read: GuardianRead; onRefresh: () => void }) {
  const lookup = read.status === "ready" ? read.lookup : read.status === "loading" ? read.previous : undefined;
  const g = lookup?.kind === "guardian" ? lookup.state : null;
  return (
    <Panel
      title="Guardian" icon={ShieldCheck} id="guardian-title" bodyClassName="p-0"
      meta={<ExtLink href={explorerAccount(accountId)} className="text-fg-faint">{accountId}</ExtLink>}
      actions={
        <>
          {g && <Tag tone={g.frozen ? "trip" : "safe"}><span data-testid="guardian-status">{g.frozen ? "frozen" : "active"}</span></Tag>}
          <Button variant="quiet" size="icon-xs" onClick={onRefresh} aria-label="Read state again" disabled={read.status === "loading"}>
            <RefreshCw className={read.status === "loading" ? "animate-spin" : undefined} aria-hidden />
          </Button>
        </>
      }
    >
      {read.status === "error" ? (
        <EmptyState icon={ServerCrash} title="Could not read the guardian" className="py-8">
          <p data-testid="rpc-error">{read.error}</p>
          <Button variant="line" size="sm" onClick={onRefresh} className="mt-3"><RefreshCw aria-hidden />Try again</Button>
        </EmptyState>
      ) : !lookup ? (
        <div className="space-y-2 p-3.5" aria-busy="true" aria-label="Reading guardian state">
          {[0, 1, 2, 3].map((i) => <Shimmer key={i} className="h-5" />)}
        </div>
      ) : lookup.kind !== "guardian" ? (
        <NoGuardian accountId={accountId} lookup={lookup} />
      ) : (
        <StateBody s={lookup.state} />
      )}
    </Panel>
  );
}
