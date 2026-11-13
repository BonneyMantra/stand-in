import type { StandinState, Trip } from "@/data/types";
import { agentName, alreadyFrozen, exposuresFor, sessionLabel, sessionOf, shortHash, tripAttestation, tripTime } from "@/data/derive";

export type RowTone = "muted" | "decoy" | "warn" | "trip" | "safe" | "pending";

export interface WfRow {
  id: string;
  depth: number;
  label: string;
  sub?: string;
  tone: RowTone;
  start: number; // ms since t0
  end: number;
  note: string;
  approx?: boolean;
  failed?: boolean;
}

export interface Waterfall {
  rows: WfRow[];
  span: number;
  tripAt: number;
  otherCalls: number;
}

/** Turns one trip into waterfall rows from real ledger/API timestamps. On-chain rows without a
 *  recorded wall-clock time are placed after the last known event and flagged `approx`. */
export function buildWaterfall(s: StandinState, t: Trip): Waterfall {
  const sess = sessionOf(s, t.attributed_to.session_id);
  const exps = exposuresFor(s, t.attributed_to.session_id).sort((a, b) => a.at.localeCompare(b.at));
  const tripIso = tripTime(s, t);
  const freezeIso = s.recorded?.freeze_times[t.tx_hash];
  const times = [sess?.started_at, ...exps.map((e) => e.at), tripIso, freezeIso].filter(Boolean).map((x) => new Date(x!).getTime());
  const t0 = times.length ? Math.min(...times) : 0;
  const ms = (iso?: string) => (iso ? new Date(iso).getTime() - t0 : undefined);
  const lastKnown = times.length ? Math.max(...times) - t0 : 0;

  const rows: WfRow[] = [];
  if (sess) {
    rows.push({
      id: "session", depth: 0, tone: "decoy", label: `${agentName(sess.agent)} session`, sub: sessionLabel(s, sess.session_id),
      start: 0, end: Math.max(lastKnown, 1), note: `${sess.tool_calls} tool calls`,
    });
  }
  // One row per tool call that carried a decoy (pre/post can both expose; collapse by tool_use_id).
  const calls = new Map<string, typeof exps>();
  for (const e of exps) calls.set(e.tool_use_id, [...(calls.get(e.tool_use_id) ?? []), e]);
  for (const [id, es] of calls) {
    const leaked = id === t.attributed_to.tool_use_id;
    const at = ms(es[0].at) ?? 0;
    let cmd = es[0].tool_input_summary;
    try {
      const parsed = JSON.parse(cmd) as { command?: string; file_path?: string };
      cmd = parsed.command ?? parsed.file_path ?? cmd;
    } catch {
      /* summary is plain text */
    }
    rows.push({
      id, depth: 1, tone: leaked ? "trip" : "warn", failed: leaked,
      label: es[0].tool_name, sub: cmd.length > 80 ? `${cmd.slice(0, 79)}…` : cmd,
      start: at, end: at + 120, note: leaked ? "leaked the decoy" : `decoy in ${es.map((e) => e.where.replace("_", " ")).join(" + ")}`,
    });
  }
  if (!calls.size && t.attributed_to.tool_use_id === "") {
    rows.push({ id: "no-call", depth: sess ? 1 : 0, tone: "muted", label: sess ? "no tool call observed" : "decoy planted by standin adopt", sub: t.attributed_to.path, start: 0, end: 1, note: "attributed by decoy location" });
  }

  const tripStart = ms(tripIso) ?? lastKnown + 1500;
  rows.push({
    id: "trip", depth: 0, tone: "trip", failed: true, label: "Decoy used on chain", sub: `block ${t.block_height.toLocaleString()} · ${shortHash(t.tx_hash)}`,
    start: tripStart, end: tripStart + 200, note: t.attacker_account, approx: !tripIso,
  });
  if (t.freeze.tx_hash) {
    const pre = alreadyFrozen(t);
    const fEnd = ms(freezeIso) ?? tripStart + Math.max(1, t.freeze.blocks_after_trip) * 1000;
    rows.push({
      id: "freeze", depth: 0, tone: pre ? "muted" : "safe", label: pre ? "Agent already frozen" : "Freeze landed",
      sub: `block ${t.freeze.block_height.toLocaleString()} · ${shortHash(t.freeze.tx_hash)}`,
      start: pre ? tripStart : tripStart, end: Math.max(fEnd, tripStart + 300),
      note: pre ? `freeze was at block ${t.freeze.block_height}` : `${t.freeze.blocks_after_trip} blocks`, approx: !freezeIso,
    });
  }
  const blEnd = rows.at(-1)!.end;
  const att = tripAttestation(s, t);
  const attAt = att.entry?.attested_at ? ms(att.entry.attested_at) : undefined;
  const nearby = attAt !== undefined && attAt > blEnd && attAt < blEnd * 4;
  rows.push({
    id: "blocklist", depth: 0, tone: att.state === "attested" ? "safe" : att.state === "listed" ? "muted" : "pending", label: "Blocklist entry",
    sub: att.state === "attested" ? `attested via OutLayer · evidence ${shortHash(att.entry?.evidence_tx ?? t.tx_hash)}` : att.state === "listed" ? `attacker already listed via ${shortHash(att.entry!.evidence_tx)}` : "OutLayer verdict not recorded",
    start: nearby ? attAt! - 300 : blEnd, end: nearby ? attAt! : blEnd + Math.max(400, blEnd * 0.06),
    note: att.state === "attested" ? "attested" : att.state === "listed" ? "already listed" : "pending", approx: att.state === "pending",
  });
  const span = Math.max(...rows.map((r) => r.end)) * 1.04;
  return { rows, span, tripAt: tripStart, otherCalls: Math.max(0, (sess?.tool_calls ?? 0) - calls.size) };
}
