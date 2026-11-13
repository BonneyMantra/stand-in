import { TerminalSquare } from "lucide-react";
import { useStandin } from "@/data/useStandin";
import type { Session } from "@/data/types";
import { agentName, decoysFor, exposuresFor, fmtTime, sessionLabel, shortKey } from "@/data/derive";
import { DataTable, type Column } from "@/components/app/DataTable";
import { CopyText, EmptyState, PageHeader, Tag } from "@/components/app/common";

export default function SessionsPage() {
  const { data } = useStandin();
  if (!data) return null;
  const tripOf = (s: Session) => data.trips.find((t) => t.attributed_to.session_id === s.session_id);
  const cols: Column<Session>[] = [
    {
      id: "session", header: "Session", className: "w-[46%] sm:w-[26%]",
      cell: (s) => (
        <span className="block min-w-0">
          <span className="block truncate font-mono text-fg">{sessionLabel(data, s.session_id)}</span>
          <span className="block truncate font-mono text-[10.5px] text-fg-faint">{s.session_id.slice(0, 18)}…</span>
        </span>
      ),
      sort: (s) => sessionLabel(data, s.session_id),
    },
    { id: "agent", header: "Agent", className: "w-24 sm:w-28", cell: (s) => <Tag tone={s.agent === "codex" ? "muted" : "decoy"}>{agentName(s.agent)}</Tag>, sort: (s) => s.agent },
    { id: "decoy", header: "Decoys", hide: "md", cell: (s) => <span className="inline-flex items-center gap-2"><CopyText value={s.decoy_public_key} display={shortKey(s.decoy_public_key, 6, 4)} /><span className="text-fg-faint">+{Math.max(0, decoysFor(data, s.session_id).length - 1)}</span></span> },
    { id: "calls", header: "Tool calls", hide: "sm", className: "w-24 text-right", cell: (s) => <span className="font-mono text-fg tabular-nums">{s.tool_calls}</span>, sort: (s) => s.tool_calls },
    {
      id: "exp", header: "Exposures", className: "w-24 text-right",
      cell: (s) => { const n = exposuresFor(data, s.session_id).length; return <span className={n ? "font-mono text-warn" : "font-mono text-fg-faint"}>{n}</span>; },
      sort: (s) => exposuresFor(data, s.session_id).length,
    },
    { id: "trip", header: "Trip", hide: "sm", className: "w-24", cell: (s) => (tripOf(s) ? <Tag tone="trip">tripped</Tag> : <span className="text-fg-faint">–</span>), sort: (s) => (tripOf(s) ? 1 : 0) },
    { id: "start", header: "Started", hide: "lg", className: "w-24", cell: (s) => <span className="font-mono text-fg-faint">{fmtTime(s.started_at)}</span>, sort: (s) => s.started_at },
  ];
  return (
    <div className="space-y-4">
      <PageHeader title="Sessions" sub="Each Claude Code or Codex session gets its own decoys, so a leak names the session and the tool call." />
      <DataTable
        caption="Guarded agent sessions"
        rows={data.sessions}
        columns={cols}
        rowKey={(s) => s.session_id}
        rowHref={(s) => { const t = tripOf(s); return t ? `/app/trips/${t.tx_hash}` : undefined; }}
        rowTone={(s) => (tripOf(s) ? "trip" : undefined)}
        initialSort={{ id: "start", dir: "desc" }}
        empty={<EmptyState icon={TerminalSquare} title="No guarded sessions yet">Install the Claude Code plugin or launch <code className="font-mono text-fg">standin codex</code>; each new session mints a decoy and shows up here.</EmptyState>}
      />
    </div>
  );
}
