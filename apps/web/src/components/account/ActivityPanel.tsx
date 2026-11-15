import { ListTree, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, ExtLink, Panel, Shimmer, Tag } from "@/components/app/common";
import { shortKey } from "@/data/derive";
import { describeTx } from "@/data/activity";
import { activityTxs, type ActivityRead } from "@/data/useActivity";
import type { HomeTx } from "@/lib/wallet/homeStore";
import { explorerTx } from "@/lib/wallet/near";

const when = (ms: number) => (ms ? new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "");

/**
 * Every transaction on the owner's guardians, bait and watcher, from the public nearblocks indexer, each an explorer link.
 * Transactions this browser signed or had the wallet sign are listed too, so a fresh one shows before the indexer has it.
 */
export function ActivityPanel({ read, local, ctx, onReload, limit = 12 }: {
  read: ActivityRead; local: HomeTx[]; ctx: { bait: string; watcher: string }; onReload: () => void; limit?: number;
}) {
  const txs = activityTxs(read);
  const known = new Set(txs.map((t) => t.hash));
  const fresh = local.filter((t) => !known.has(t.hash)).slice(0, 5);
  return (
    <Panel title="Transactions" icon={ListTree} id="activity-title" meta="indexed by nearblocks" bodyClassName="p-0"
      actions={<Button variant="quiet" size="icon-xs" onClick={onReload} aria-label="Read transactions again" disabled={read.status === "loading"}><RefreshCw className={read.status === "loading" ? "animate-spin" : undefined} aria-hidden /></Button>}>
      {read.status === "loading" || read.status === "idle" ? (
        <div className="space-y-2 p-3.5" role="status" aria-label="Reading transactions">{[0, 1, 2].map((i) => <Shimmer key={i} className="h-5" />)}</div>
      ) : txs.length === 0 && fresh.length === 0 ? (
        <EmptyState icon={ListTree} title={read.status === "error" ? "The indexer did not answer" : "No transactions yet"} className="py-6">
          <p data-testid="activity-empty">{read.status === "error" ? `${read.error}. The state above is read from RPC and is unaffected.` : "Your guardians, bait and watcher have no transactions yet."}</p>
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line" data-testid="activity-list">
          {fresh.map((t) => (
            <li key={t.hash} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2 text-xs">
              <ExtLink href={explorerTx(t.hash)}>{shortKey(t.hash, 8, 6)}</ExtLink>
              <span className="min-w-0 flex-1 truncate text-fg-muted">{t.label}</span>
              <Tag tone="muted">signed here · indexing</Tag>
            </li>
          ))}
          {txs.slice(0, limit).map((t) => (
            <li key={t.hash} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2 text-xs" data-testid="activity-row">
              <ExtLink href={explorerTx(t.hash)}>{shortKey(t.hash, 8, 6)}</ExtLink>
              <span className="min-w-0 flex-1 truncate text-fg-muted" title={`${t.signer} → ${t.receiver}`}>
                {describeTx(t, ctx)} <span className="text-fg-faint">· {t.signer === t.receiver ? t.signer : `${t.signer} → ${t.receiver}`}</span>
              </span>
              {t.ok === false && <Tag tone="trip">failed</Tag>}
              <span className="font-mono text-[11px] text-fg-faint">{when(t.at)}</span>
            </li>
          ))}
        </ul>
      )}
      {read.status === "error" && txs.length > 0 && <p className="border-t border-line px-3.5 py-2 text-[11px] text-warn">Some accounts were not read: {read.error}.</p>}
    </Panel>
  );
}
