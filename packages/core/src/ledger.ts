import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { standinHome } from "./config.ts";

export const EVENT_TYPES = [
  "decoy_planted", "session_started", "tool_call", "exposure", "trip", "freeze", "blocklist", "bench", "incident_report",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Every ledger line: {type, at, ...free-form payload}. Payload shapes are in API.md. */
export const ledgerEventSchema = z
  .object({ type: z.enum(EVENT_TYPES), at: z.string() })
  .passthrough();
export type LedgerEvent = z.infer<typeof ledgerEventSchema> & Record<string, any>;

export function ledgerPath(home = standinHome()): string {
  return path.join(home, "ledger.ndjson");
}

/** Append one event (O_APPEND, single write per line). Returns the stored event. */
export function appendEvent(
  type: EventType,
  payload: Record<string, unknown> = {},
  home = standinHome(),
): LedgerEvent {
  const ev = ledgerEventSchema.parse({ ...payload, type, at: (payload.at as string) ?? new Date().toISOString() });
  const p = ledgerPath(home);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, JSON.stringify(ev) + "\n");
  return ev as LedgerEvent;
}

export function readEvents(
  filter?: { type?: EventType | EventType[]; where?: (e: LedgerEvent) => boolean },
  home = standinHome(),
): LedgerEvent[] {
  const p = ledgerPath(home);
  if (!fs.existsSync(p)) return [];
  const types = filter?.type ? ([] as string[]).concat(filter.type) : null;
  const out: LedgerEvent[] = [];
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = ledgerEventSchema.parse(JSON.parse(line)) as LedgerEvent;
      if (types && !types.includes(e.type)) continue;
      if (filter?.where && !filter.where(e)) continue;
      out.push(e);
    } catch {
      /* skip torn or foreign line */
    }
  }
  return out;
}

/** Latest decoy_planted event for a decoy public key (key -> where it was planted / which session). */
export function findPlanted(publicKey: string, home = standinHome()): LedgerEvent | undefined {
  const all = readEvents({ type: "decoy_planted", where: (e) => e.public_key === publicKey }, home);
  return all[all.length - 1];
}

/** Count prior interactions with a counterparty (tool_call events naming it). */
export function interactionCount(accountId: string, home = standinHome()): number {
  return readEvents({ type: "tool_call", where: (e) => JSON.stringify(e).includes(`"${accountId}"`) }, home).length;
}
