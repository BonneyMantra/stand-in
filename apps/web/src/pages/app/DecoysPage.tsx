import { useMemo, useState } from "react";
import { KeyRound } from "lucide-react";
import { useStandin } from "@/data/useStandin";
import type { DecoyKey } from "@/data/types";
import { agentName, fmtTime, KIND_LABEL, sessionLabel, shortKey, statusMap, type DecoyStatus } from "@/data/derive";
import { DataTable, type Column } from "@/components/app/DataTable";
import { CopyText, EmptyState, PageHeader, StatusPill } from "@/components/app/common";
import { cn } from "@/lib/utils";

const FILTERS: ("all" | DecoyStatus)[] = ["all", "tripped", "exposed", "dormant"];

export default function DecoysPage() {
  const { data } = useStandin();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const status = useMemo(() => (data ? statusMap(data) : new Map<string, DecoyStatus>()), [data]);
  if (!data) return null;
  const st = (k: DecoyKey) => status.get(k.public_key) ?? "dormant";
  const rows = data.decoy.keys.filter((k) => filter === "all" || st(k) === filter);
  const count = (f: (typeof FILTERS)[number]) => (f === "all" ? data.decoy.keys.length : data.decoy.keys.filter((k) => st(k) === f).length);
  const RANK = { tripped: 2, exposed: 1, dormant: 0 };

  const cols: Column<DecoyKey>[] = [
    { id: "pk", header: "Public key", className: "w-[44%] @xl:w-[20%]", cell: (k) => <CopyText value={k.public_key} display={shortKey(k.public_key, 7, 5)} className="text-fg" /> },
    {
      id: "where", header: "Planted in", className: "w-[30%]",
      cell: (k) => (
        <span className="block min-w-0">
          <span className="block truncate text-fg">{KIND_LABEL[k.planted.kind] ?? k.planted.kind}</span>
          <span className="block truncate font-mono text-[10.5px] text-fg-faint" title={k.planted.path}>{k.planted.path}</span>
        </span>
      ),
      sort: (k) => k.planted.kind, hide: "sm",
    },
    { id: "agent", header: "Agent", hide: "md", className: "w-28", cell: (k) => <span className="text-fg-muted">{agentName(k.planted.agent)}</span>, sort: (k) => k.planted.agent },
    { id: "session", header: "Session", hide: "lg", cell: (k) => <span className="font-mono text-fg-muted">{k.planted.session_id ? sessionLabel(data, k.planted.session_id) : "–"}</span>, sort: (k) => sessionLabel(data, k.planted.session_id) },
    { id: "at", header: "Planted", hide: "lg", className: "w-24", cell: (k) => <span className="font-mono text-fg-faint">{fmtTime(k.planted.at)}</span>, sort: (k) => k.planted.at },
    { id: "status", header: "Status", className: "w-[96px] @xl:w-28", cell: (k) => <StatusPill status={st(k)} />, sort: (k) => RANK[st(k)] },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Decoys"
        sub={<>Every key below is a full-access key on <span className="font-mono text-fg">{data.decoy.account_id}</span>. None can reach the real account.</>}
      />
      <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}
            className={cn("inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring",
              filter === f ? "border-line-strong bg-ink-850 text-fg" : "border-line text-fg-muted hover:text-fg")}
          >
            {f}<span className="font-mono text-fg-faint">{count(f)}</span>
          </button>
        ))}
      </div>
      <DataTable
        caption="Planted decoy keys"
        rows={rows}
        columns={cols}
        rowKey={(k) => k.public_key}
        rowHref={(k) => { const t = data.trips.find((x) => x.decoy_public_key === k.public_key); return t ? `/app/trips/${t.tx_hash}` : undefined; }}
        rowTone={(k) => (st(k) === "tripped" ? "trip" : undefined)}
        initialSort={{ id: "status", dir: "desc" }}
        empty={<EmptyState icon={KeyRound} title={filter === "all" ? "No decoys planted" : `No ${filter} decoys`}>{filter === "all" ? <>Run <code className="font-mono text-fg">standin adopt</code> or start a guarded agent session.</> : "Try another filter."}</EmptyState>}
      />
    </div>
  );
}
