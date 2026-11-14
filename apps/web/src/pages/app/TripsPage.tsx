import { Zap } from "lucide-react";
import { useStandin } from "@/data/useStandin";
import type { Trip } from "@/data/types";
import { agentName, alreadyFrozen, fmtTime, sessionLabel, shortHash, tripTime } from "@/data/derive";
import { DataTable, type Column } from "@/components/app/DataTable";
import { EmptyState, PageHeader, Tag } from "@/components/app/common";

export default function TripsPage() {
  const { data } = useStandin();
  if (!data) return null;
  const cols: Column<Trip>[] = [
    {
      id: "tx", header: "Decoy tx", className: "w-[30%] @xl:w-[22%]",
      cell: (t) => <span className="font-mono text-fg">{shortHash(t.tx_hash)}</span>, sort: (t) => t.block_height,
    },
    {
      id: "freeze", header: "Freeze", className: "w-[30%] @xl:w-[18%]",
      cell: (t) => alreadyFrozen(t) ? <Tag>already frozen</Tag> : t.freeze.tx_hash ? <Tag tone="safe">{t.freeze.blocks_after_trip} blocks</Tag> : <Tag tone="warn">pending</Tag>,
      sort: (t) => (alreadyFrozen(t) ? 999 : t.freeze.blocks_after_trip),
    },
    { id: "attacker", header: "Attacker", hide: "md", cell: (t) => <span className="font-mono text-trip">{t.attacker_account}</span> },
    {
      id: "leak", header: "Leaked by", className: "w-[40%] @xl:w-auto",
      cell: (t) => (
        <span className="block truncate text-fg-muted">
          <span className="text-fg">{t.attributed_to.tool_name || "session env"}</span> · {agentName(t.attributed_to.agent)} · <span className="font-mono">{sessionLabel(data, t.attributed_to.session_id)}</span>
        </span>
      ),
    },
    { id: "when", header: "Seen", hide: "lg", className: "w-24", cell: (t) => <span className="font-mono text-fg-faint">{tripTime(data, t) ? fmtTime(tripTime(data, t)!) : `#${t.block_height}`}</span> },
  ];
  return (
    <div className="space-y-4">
      <PageHeader title="Trips" sub="A trip is any transaction signed by a decoy key. Each one freezes the agent account and names the leak." />
      <DataTable
        caption="Trips"
        rows={[...data.trips].reverse()}
        columns={cols}
        rowKey={(t) => t.tx_hash}
        rowHref={(t) => `/app/trips/${t.tx_hash}`}
        rowTone={(t) => (alreadyFrozen(t) ? undefined : "trip")}
        empty={<EmptyState icon={Zap} title="No trips">No decoy key has signed a transaction. The {data.decoy.keys.length} planted decoys are dormant or only exposed.</EmptyState>}
      />
    </div>
  );
}
