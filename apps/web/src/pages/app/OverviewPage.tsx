import { useStandin } from "@/data/useStandin";
import { histogram, medianBlocks } from "@/data/derive";
import { MetricStrip, type Metric } from "@/components/app/MetricStrip";
import { DecoyMap } from "@/components/app/map/DecoyMap";
import { TripFeed } from "@/components/app/TripFeed";
import { AgentKeysPanel } from "@/components/app/AgentKeysPanel";
import { PageHeader } from "@/components/app/common";

export default function OverviewPage() {
  const { data, source } = useStandin();
  if (!data) return null;
  const med = medianBlocks(data);
  const attested = data.blocklist.filter((b) => !b.preview && b.attested_at).length;
  const pending = data.blocklist.length - attested;
  const metrics: Metric[] = [
    { label: "Decoys planted", value: data.decoy.keys.length, tone: "decoy", spark: histogram(data.decoy.keys.map((k) => k.planted.at)), sub: `on ${data.decoy.account_id}` },
    { label: "Sessions guarded", value: data.sessions.length, spark: histogram(data.sessions.map((s) => s.started_at)), sub: `${data.sessions.filter((s) => s.agent === "codex").length} Codex · ${data.sessions.filter((s) => s.agent === "claude-code").length} Claude Code` },
    { label: "Exposures", value: data.exposures.length, tone: data.exposures.length ? "warn" : "fg", spark: histogram(data.exposures.map((e) => e.at)), sub: "decoy seen in a tool call" },
    { label: "Trips", value: data.trips.length, tone: data.trips.length ? "trip" : "fg", sub: data.trips.length ? `thief: ${data.trips.at(-1)!.attacker_account}` : "no decoy used on chain" },
    { label: "Median blocks to freeze", value: med ?? "–", tone: med !== null && med <= 3 ? "safe" : "fg", unit: "blocks", sub: "target ≤ 3 · decoy tx → freeze tx" },
    { label: "Attested blocklist", value: attested, tone: attested ? "safe" : "fg", sub: pending ? `${pending} awaiting OutLayer attestation` : "OutLayer TEE verdicts" },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Overview"
        sub={data.agent.frozen ? "A decoy was used on chain. The agent account is frozen and its keys are gone." : "Every decoy is a tripwire. Nothing has touched the real account."}
      />
      <MetricStrip items={metrics} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <DecoyMap state={data} />
        <div className="relative min-w-0"><TripFeed state={data} live={source === "live"} /></div>
      </div>
      <AgentKeysPanel state={data} />
    </div>
  );
}
