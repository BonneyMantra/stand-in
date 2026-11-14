import { readEvents, type LedgerEvent } from "@standin/core";
import { redactDeep } from "./redact.ts";

export interface Trip {
  tx_hash: string; block_height: number; decoy_public_key: string; attacker_account: string;
  attributed_to: { session_id?: string; agent?: string; tool_name?: string; tool_use_id?: string; path?: string };
  freeze?: Record<string, any>; blocklist?: Record<string, any>;
}

/** Rebuild one trip (the API's trips[] shape) from the ledger events under `home`. */
export function tripFromLedger(txHash: string, home?: string): Trip | null {
  const trips = readEvents({ type: "trip", where: (e) => e.tx_hash === txHash }, home);
  const t = trips.at(-1);
  if (!t) return null;
  const f = readEvents({ type: "freeze", where: (e) => e.trip_tx_hash === txHash }, home).at(-1);
  const b = readEvents({ type: "blocklist", where: (e) => e.trip_tx_hash === txHash }, home).at(-1);
  return {
    tx_hash: String(t.tx_hash), block_height: Number(t.block_height ?? 0), decoy_public_key: String(t.decoy_public_key ?? ""),
    attacker_account: String(t.attacker_account ?? ""), attributed_to: { ...(t.attributed_to ?? {}) },
    freeze: f?.freeze, blocklist: b?.blocklist,
  };
}

/**
 * The redacted evidence packet sent to the model. Only public facts: hashes, block heights, the decoy PUBLIC key,
 * ids and a tool_input_summary. Every string passes `redact` (key material, sk- tokens, home paths).
 */
export function buildEvidence(trip: Trip, home?: string): Record<string, unknown> {
  const sid = trip.attributed_to?.session_id ?? "";
  const session: LedgerEvent | undefined = sid ? readEvents({ type: "session_started", where: (e) => e.session_id === sid }, home).at(0) : undefined;
  const exposure = readEvents({
    type: "exposure",
    where: (e) => (trip.attributed_to?.tool_use_id ? e.tool_use_id === trip.attributed_to.tool_use_id : e.decoy_public_key === trip.decoy_public_key),
  }, home).at(-1);
  const toolCalls = sid ? readEvents({ type: "tool_call", where: (e) => e.session_id === sid && e.phase !== "post" }, home).length : 0;
  const f = trip.freeze ?? {};
  return redactDeep({
    network: "near-testnet",
    trip: {
      tx_hash: trip.tx_hash, block_height: trip.block_height, decoy_public_key: trip.decoy_public_key, attacker_account: trip.attacker_account || "unknown",
    },
    attribution: {
      session_id: sid || "unknown", agent_kind: trip.attributed_to?.agent || session?.agent || "unknown",
      tool_name: trip.attributed_to?.tool_name || exposure?.tool_name || "unknown",
      tool_use_id: trip.attributed_to?.tool_use_id || exposure?.tool_use_id || "unknown",
      tool_input_summary: String(exposure?.tool_input_summary ?? "").slice(0, 500) || "not recorded",
      exposure_where: String(exposure?.where ?? "") || "not recorded",
      key_planted_in: { kind: trip.attributed_to?.path ? "file" : "unknown", path: trip.attributed_to?.path ?? "" },
      session_tool_calls_before_trip: toolCalls,
    },
    response: {
      freeze_tx_hash: f.tx_hash ?? "", freeze_block_height: f.block_height ?? 0, blocks_from_trip_to_freeze: f.blocks_after_trip ?? null,
      agent_keys_deleted: (f.deleted_keys ?? []).length, intents_keys_removed: (f.intents_keys_removed ?? []).length,
      blocklisted: Boolean(trip.blocklist?.attested || trip.blocklist?.tx_hash), blocklist_tx_hash: trip.blocklist?.tx_hash ?? "",
    },
  }) as Record<string, unknown>;
}
