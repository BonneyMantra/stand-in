import { History } from "lucide-react";
import { EmptyState, ExtLink, Panel, Tag } from "@/components/app/common";
import { shortKey } from "@/data/derive";
import { explorerTx } from "@/lib/wallet/near";

export interface TxEntry {
  id: number;
  label: string;
  status: "pending" | "ok" | "failed";
  hash?: string;
  message?: string;
  at: number;
}

const TONE = { pending: "muted", ok: "safe", failed: "trip" } as const;

/** Wallet transactions sent from this page in this visit, newest first. */
export function ActivityLog({ entries }: { entries: TxEntry[] }) {
  return (
    <Panel title="This session" icon={History} id="activity-title" bodyClassName="p-0">
      {entries.length === 0 ? (
        <EmptyState icon={History} title="No transactions yet" className="py-6">Each signed transaction appears here with its explorer link.</EmptyState>
      ) : (
        <ul className="divide-y divide-line" data-testid="activity">
          {entries.map((e) => (
            <li key={e.id} className="space-y-1 px-3.5 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs text-fg">{e.label}</span>
                <Tag tone={TONE[e.status]}>{e.status === "pending" ? "waiting" : e.status}</Tag>
              </div>
              {e.hash && <ExtLink href={explorerTx(e.hash)} className="text-[11px]">{shortKey(e.hash, 10, 6)}</ExtLink>}
              {e.message && <p className={e.status === "failed" ? "text-[11px] text-trip" : "text-[11px] text-fg-muted"}>{e.message}</p>}
              <p className="font-mono text-[10.5px] text-fg-faint">{new Date(e.at).toLocaleTimeString(undefined, { hour12: false })}</p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
