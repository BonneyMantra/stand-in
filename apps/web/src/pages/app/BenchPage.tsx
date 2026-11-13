import { Crosshair, FlaskConical, Fingerprint, Snowflake, Split } from "lucide-react";
import { useStandin } from "@/data/useStandin";
import type { BenchRoute } from "@/data/types";
import { fmtDate } from "@/data/derive";
import { BenchCard, BlocksChart, RouteCells } from "@/components/app/bench/BenchCards";
import { DataTable, type Column } from "@/components/app/DataTable";
import { EmptyState, PageHeader, Panel, Tag } from "@/components/app/common";

const TARGET_BLOCKS = 3;
const yes = (v: boolean) => (v ? <Tag tone="safe">yes</Tag> : <Tag>no</Tag>);

export default function BenchPage() {
  const { data } = useStandin();
  if (!data) return null;
  const b = data.bench;
  const allRoutes = data.recorded?.bench_routes ?? [];
  const routes = allRoutes.filter((r) => r.status === "run");
  const notRun = allRoutes.length - routes.length;
  const baseline = data.recorded?.baseline_routes ?? [];
  const toolExact = routes.filter((r) => r.attributed_tool).length;
  const med = b.median_blocks_to_freeze > 0 ? b.median_blocks_to_freeze : null;

  const cols: Column<BenchRoute>[] = [
    {
      id: "route", header: "Attack route", className: "w-[52%] sm:w-[36%]",
      cell: (r) => (
        <span className="block min-w-0">
          <span className="block truncate font-mono text-fg">{r.route}</span>
          <span className="block truncate text-[11px] text-fg-faint">{r.name}</span>
        </span>
      ),
      sort: (r) => r.route,
    },
    { id: "kind", header: "Run", hide: "lg", className: "w-24", cell: (r) => <Tag tone={r.kind === "scripted" ? "muted" : "decoy"}>{r.kind}</Tag> },
    { id: "det", header: "Detected", className: "w-24", cell: (r) => (r.status === "run" ? yes(r.detected) : <Tag tone="warn">{r.status.replace(/^not run: /, "not run · ")}</Tag>), sort: (r) => Number(r.detected) },
    { id: "ses", header: "Session", hide: "sm", className: "w-24", cell: (r) => yes(r.attributed_session), sort: (r) => Number(r.attributed_session) },
    { id: "tool", header: "Tool call", hide: "md", className: "w-24", cell: (r) => yes(r.attributed_tool), sort: (r) => Number(r.attributed_tool) },
    {
      id: "blocks", header: "Blocks", hide: "sm", className: "w-28",
      cell: (r) => r.blocks_to_freeze !== null && r.blocks_to_freeze > 0
        ? <span className={r.blocks_to_freeze <= TARGET_BLOCKS ? "font-mono text-safe" : "font-mono text-warn"}>{r.blocks_to_freeze} <span className="text-fg-faint">/ ≤{TARGET_BLOCKS}</span></span>
        : <span className="font-mono text-fg-faint" title={r.blocks_to_freeze !== null ? "Account was already frozen by an earlier route" : "No on-chain use"}>{r.blocks_to_freeze !== null ? "already frozen" : "–"}</span>,
      sort: (r) => r.blocks_to_freeze ?? 999,
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Benchmark"
        sub={data.recorded ? <>Attack suite against sandboxed sessions · results generated {fmtDate(data.recorded.bench_generated_at ?? data.recorded.recorded_at)}{notRun ? ` · ${notRun} route${notRun === 1 ? "" : "s"} not run` : ""}</> : "Summary from the watcher's bench events"}
      />
      <div className="grid gap-4 md:grid-cols-3">
        <BenchCard icon={Crosshair} title="Detection" sub="leak seen as exposure or trip" value={b.detected} target={b.routes} label="detected / routes" pass={b.routes ? b.detected === b.routes : null}
          legend={[["detected", b.detected, "bg-safe"], ["missed", b.routes - b.detected]]}>
          {routes.length ? <RouteCells routes={routes} pick={(r) => r.detected} /> : <p className="text-xs text-fg-faint">{b.routes} routes in the last bench event.</p>}
        </BenchCard>
        <BenchCard icon={Fingerprint} title="Attribution" sub="session and exact tool call named" value={b.attributed} target={b.routes} label="session / routes" pass={b.routes ? b.attributed === b.routes : null}
          legend={[["session named", b.attributed, "bg-safe"], ["tool call exact", routes.length ? toolExact : "–", "bg-decoy"]]}>
          {routes.length ? <RouteCells routes={routes} pick={(r) => r.attributed_session} /> : null}
        </BenchCard>
        <BenchCard icon={Snowflake} title="Time to freeze" sub="decoy tx block → freeze tx block" value={med ?? "–"} target={`${TARGET_BLOCKS} blk`} label="median / target" pass={med === null ? null : med <= TARGET_BLOCKS}
          legend={[["median", med ?? "–", "bg-safe"], ["fresh freezes measured", routes.filter((r) => (r.blocks_to_freeze ?? 0) > 0).length]]}>
          {routes.length ? <BlocksChart routes={routes} target={TARGET_BLOCKS} /> : null}
        </BenchCard>
      </div>

      {allRoutes.length ? (
        <DataTable caption="Per-route benchmark results, Stand-in on" rows={allRoutes} columns={cols} rowKey={(r) => r.route} />
      ) : (
        <div className="rounded-[10px] border border-line bg-ink-900/60">
          <EmptyState icon={FlaskConical} title="Per-route results not in the live API">The watcher serves only the bench summary. Run the suite, then open the recorded run for every route.</EmptyState>
        </div>
      )}

      <Panel title="Stand-in off vs on" icon={Split} id="baseline-title" meta="same routes, same leaks">
        {baseline.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div><p className="text-xs text-fg-faint">Off: thefts that succeeded</p><p className="mt-1 font-mono text-2xl text-trip">{baseline.filter((r) => r.theft_succeeded).length} / {baseline.length}</p></div>
            <div><p className="text-xs text-fg-faint">On: leaks detected</p><p className="mt-1 font-mono text-2xl text-safe">{routes.filter((r) => r.detected).length} / {routes.length}</p></div>
          </div>
        ) : (
          <EmptyState icon={Split} title="Baseline not run in this recording" className="py-6">
            The Stand-in-off pass of the same routes has not been recorded yet. Nothing is shown until it runs.
          </EmptyState>
        )}
      </Panel>
    </div>
  );
}
