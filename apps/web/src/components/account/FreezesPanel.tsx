import { FileLock2, Snowflake } from "lucide-react";
import { CopyText, EmptyState, ExtLink, Panel, Tag } from "@/components/app/common";
import { blockUrl, shortKey } from "@/data/derive";
import type { FreezeView } from "@/data/accountDerive";
import { freezeTxFor, type ActivityTx } from "@/data/activity";
import { explorerTx } from "@/lib/wallet/near";

/**
 * Trips and freezes from each guardian's on-chain freeze_log (at most the last 50 per guardian, as the contract keeps them):
 * who froze (your watcher or you), why, the decoy and its theft, the keys deleted. The freeze transaction itself is not in
 * the contract's state; it is matched from the indexer by block.
 */
export function FreezesPanel({ freezes, activity, limit }: { freezes: FreezeView[]; activity: ActivityTx[]; limit?: number }) {
  const shown = limit ? freezes.slice(0, limit) : freezes;
  const trips = freezes.filter((f) => f.trip).length;
  return (
    <Panel title="Trips and freezes" icon={Snowflake} id="freezes-title" meta={`${trips} trip${trips === 1 ? "" : "s"} · ${freezes.length} freeze${freezes.length === 1 ? "" : "s"}`} bodyClassName="p-0">
      {freezes.length === 0 ? (
        <EmptyState icon={Snowflake} title="No freezes yet" className="py-8">
          <p data-testid="freezes-empty">Nothing has used a decoy against your guardians, and you have not frozen one. When a decoy signs, your watcher's freeze appears here from chain.</p>
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line" data-testid="freezes">
          {shown.map((f) => {
            const ftx = freezeTxFor(activity, f.guardian, Number(f.at_block));
            return (
              <li key={`${f.guardian}-${f.at_block}`} className="space-y-1.5 px-3.5 py-2.5" data-testid="freeze-row">
                <div className="flex flex-wrap items-center gap-2">
                  <Tag tone={f.trip ? "trip" : "muted"}>{f.trip ? "trip" : "manual freeze"}</Tag>
                  <span className="min-w-0 font-mono text-xs text-fg [overflow-wrap:anywhere]">{f.guardian}</span>
                  <span className="text-[11px] text-fg-faint">by {f.byRole === "watcher" ? "your watcher" : f.byRole === "owner" ? "you (owner)" : f.by}</span>
                </div>
                <p className="text-xs break-words text-fg-muted">{f.reason || "(no reason given)"}</p>
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-faint">
                  <span>block <ExtLink href={blockUrl(Number(f.at_block))} className="text-[11px]">{f.at_block}</ExtLink></span>
                  {ftx && <span>freeze tx <ExtLink href={explorerTx(ftx.hash)} className="text-[11px]">{shortKey(ftx.hash, 6, 4)}</ExtLink></span>}
                  {f.trip_tx && <span>theft <ExtLink href={explorerTx(f.trip_tx)} className="text-[11px]">{shortKey(f.trip_tx, 6, 4)}</ExtLink></span>}
                  {f.decoy_public_key && <span className="inline-flex items-center gap-1">decoy <CopyText value={f.decoy_public_key} display={shortKey(f.decoy_public_key, 6, 4)} className="text-[11px]" /></span>}
                  <span>{f.deleted_keys.length} agent key{f.deleted_keys.length === 1 ? "" : "s"} deleted · {f.intents_keys_removed.length} intents key{f.intents_keys_removed.length === 1 ? "" : "s"} removed</span>
                </p>
              </li>
            );
          })}
          {limit && freezes.length > limit && <li className="px-3.5 py-2 text-[11px] text-fg-faint">{freezes.length - limit} more on Trips and freezes.</li>}
        </ul>
      )}
      <p className="flex items-start gap-2 border-t border-line px-3.5 py-2.5 text-[11px] leading-relaxed text-fg-faint" data-testid="report-cli-only">
        <FileLock2 className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>Incident report: CLI only. For a trip on your own account, the private NEAR AI Cloud report is written by the CLI watcher on your machine (<code className="font-mono">standin dev up</code> with your own NEAR AI key). This site never calls NEAR AI.</span>
      </p>
    </Panel>
  );
}
