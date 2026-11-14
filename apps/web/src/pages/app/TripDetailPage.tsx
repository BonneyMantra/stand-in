import { Link, useParams } from "react-router";
import { ArrowLeft, FileSearch, Link2 } from "lucide-react";
import { useStandin } from "@/data/useStandin";
import { accountUrl, agentName, alreadyFrozen, sessionLabel, shortHash, shortKey, tripAttestation, txUrl } from "@/data/derive";
import { MetricStrip, type Metric } from "@/components/app/MetricStrip";
import { WaterfallView } from "@/components/app/trip/WaterfallView";
import { buildWaterfall } from "@/components/app/trip/buildRows";
import { IncidentReportPanel } from "@/components/app/trip/IncidentReport";
import { CopyText, EmptyState, ExtLink, KV, PageHeader, Panel, PreviewTag, Tag } from "@/components/app/common";

export default function TripDetailPage() {
  const { tx = "" } = useParams();
  const { data } = useStandin();
  if (!data) return null;
  const trip = data.trips.find((t) => t.tx_hash === tx);
  if (!trip) {
    return (
      <div className="rounded-[10px] border border-line bg-ink-900">
        <EmptyState icon={FileSearch} title="Trip not found">
          <p>No trip with tx <span className="font-mono text-fg">{shortHash(tx)}</span> in this {data.recorded ? "recorded run" : "watcher state"}.</p>
          <Link to="/app/trips" className="mt-3 inline-block text-fg underline underline-offset-4">Back to trips</Link>
        </EmptyState>
      </div>
    );
  }

  const wf = buildWaterfall(data, trip);
  const att = tripAttestation(data, trip);
  const pre = alreadyFrozen(trip);
  const metrics: Metric[] = [
    { label: "Blocks to freeze", value: pre ? "–" : trip.freeze.blocks_after_trip, unit: pre ? undefined : "blocks", tone: pre ? "fg" : trip.freeze.blocks_after_trip <= 3 ? "safe" : "warn", sub: pre ? "account was already frozen" : `#${trip.block_height} → #${trip.freeze.block_height}` },
    { label: "Agent keys deleted", value: trip.freeze.deleted_keys.length, tone: "trip", sub: "function-call keys" },
    { label: "Intents keys removed", value: trip.freeze.intents_keys_removed.length, tone: "trip", sub: "intents registry" },
    { label: "Attacker", value: <span className="block max-w-full truncate text-sm leading-8" title={trip.attacker_account}>{trip.attacker_account}</span>, tone: "trip", sub: "received the decoy's funds" },
    { label: "Attestation", value: att.state === "listed" ? "listed" : att.state, tone: att.state === "pending" ? "fg" : "safe", preview: att.state === "pending", sub: att.state === "listed" ? "attacker listed via another trip" : "OutLayer TEE verdict" },
  ];
  const a = trip.attributed_to;

  return (
    <div className="space-y-4">
      <Link to="/app/trips" className="inline-flex items-center gap-1.5 text-xs text-fg-muted hover:text-fg"><ArrowLeft className="size-3.5" aria-hidden />Trips</Link>
      <PageHeader
        title={pre ? "Decoy used after freeze" : `Frozen ${trip.freeze.blocks_after_trip} blocks after the decoy was used`}
        sub={a.session_id
          ? <>Leaked by <span className="text-fg">{a.tool_name || "the session-env decoy"}</span> in {agentName(a.agent)} session <span className="font-mono text-fg">{sessionLabel(data, a.session_id)}</span></>
          : <>Decoy planted by <span className="text-fg">standin adopt</span> at <span className="font-mono text-fg">{a.path || "an adopted location"}</span> was used on chain</>}
        actions={<div className="flex flex-wrap gap-2"><Tag tone="trip">tripped</Tag>{pre && <Tag>already frozen</Tag>}</div>}
      />
      <MetricStrip items={metrics} />
      <WaterfallView wf={wf} />
      <IncidentReportPanel report={data.incident_reports?.filter((r) => r.trip_tx_hash === trip.tx_hash).at(-1)} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Attribution" icon={FileSearch} id="attr-title">
          <KV k="session" v={a.session_id ? <CopyText value={a.session_id} display={a.session_id.slice(0, 18) + "…"} /> : "none (adopted key location)"} />
          <KV k="agent" v={agentName(a.agent)} />
          <KV k="tool" v={a.tool_name || (a.session_id ? "none (session-env decoy)" : "none")} />
          <KV k="tool_use_id" v={a.tool_use_id ? <CopyText value={a.tool_use_id} /> : "–"} />
          <KV k="decoy planted at" v={<span title={a.path}>{a.path}</span>} />
          <KV k="decoy key" v={<CopyText value={trip.decoy_public_key} display={shortKey(trip.decoy_public_key, 8, 6)} />} />
        </Panel>
        <Panel title="On chain" icon={Link2} id="chain-title">
          <KV k="decoy tx" v={<ExtLink href={txUrl(trip.tx_hash)}>{shortHash(trip.tx_hash)}</ExtLink>} />
          <KV k="freeze tx" v={trip.freeze.tx_hash ? <ExtLink href={txUrl(trip.freeze.tx_hash)}>{shortHash(trip.freeze.tx_hash)}</ExtLink> : "–"} />
          <KV k="attacker" v={<ExtLink href={accountUrl(trip.attacker_account)}>{trip.attacker_account}</ExtLink>} />
          <KV k="blocklist entry" v={att.entry ? <ExtLink href={txUrl(att.entry.evidence_tx)}>{att.state === "attested" ? "attested" : "listed"} · evidence {shortHash(att.entry.evidence_tx)}</ExtLink> : trip.blocklist.tx_hash ? <ExtLink href={txUrl(trip.blocklist.tx_hash)}>{shortHash(trip.blocklist.tx_hash)}</ExtLink> : <span className="inline-flex items-center gap-2">not posted <PreviewTag title="Registry report + OutLayer execution not run in this recording" /></span>} />
          <KV k="OutLayer execution" v={trip.blocklist.outlayer_execution ? <ExtLink href={trip.blocklist.outlayer_execution.startsWith("http") ? trip.blocklist.outlayer_execution : txUrl(trip.blocklist.outlayer_execution)}>{shortHash(trip.blocklist.outlayer_execution)}</ExtLink> : <span className="inline-flex items-center gap-2">pending <PreviewTag /></span>} />
          {data.recorded?.contract_proof && (
            <div className="mt-2 border-t border-line pt-2">
              <p className="text-[11px] text-fg-faint">Contract proof (separate guardian test on the same accounts)</p>
              <KV k="freeze by watcher key" v={<ExtLink href={txUrl(data.recorded.contract_proof.freeze_tx)}>{shortHash(data.recorded.contract_proof.freeze_tx)}</ExtLink>} />
              <KV k="intent after freeze: PublicKeyNotExist" v={<ExtLink href={txUrl(data.recorded.contract_proof.public_key_not_exist_tx)}>{shortHash(data.recorded.contract_proof.public_key_not_exist_tx)}</ExtLink>} />
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
