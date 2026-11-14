import fs from "node:fs";
import path from "node:path";
import { standinHome } from "./config.ts";

/** Chain Signatures proof ledger: append-only NDJSON at $STANDIN_HOME/chainsig.ndjson (kept apart from ledger.ndjson). */
export interface ChainsigEvent {
  type: "sign" | "blocked";
  at: string;
  evm_address: string;
  chain_id: number;
  path: string;
  ok?: boolean;
  tx_hash?: string;
  via?: "deleted-agent-key" | "owner-key";
  error?: string;
}

export const chainsigLedgerPath = (home = standinHome()) => path.join(home, "chainsig.ndjson");

export function appendChainsig(ev: Omit<ChainsigEvent, "at"> & { at?: string }, home = standinHome()): ChainsigEvent {
  const full = { ...ev, at: ev.at ?? new Date().toISOString() } as ChainsigEvent;
  const p = chainsigLedgerPath(home);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, JSON.stringify(full) + "\n");
  return full;
}

export function readChainsig(home = standinHome()): ChainsigEvent[] {
  const p = chainsigLedgerPath(home);
  if (!fs.existsSync(p)) return [];
  const out: ChainsigEvent[] = [];
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e && (e.type === "sign" || e.type === "blocked")) out.push(e);
    } catch { /* torn line */ }
  }
  return out;
}

/** The optional `chainsig` object of GET /api/state, or undefined when no proof has been recorded. */
export function chainsigState(home = standinHome()) {
  const evs = readChainsig(home);
  if (!evs.length) return undefined;
  const sign = evs.filter((e) => e.type === "sign").at(-1);
  const blockedAll = evs.filter((e) => e.type === "blocked");
  const blocked = blockedAll.filter((e) => e.via === "owner-key").at(-1) ?? blockedAll.at(-1);
  const ref = (sign ?? blocked)!;
  return {
    evm_address: ref.evm_address,
    chain_id: ref.chain_id,
    path: ref.path,
    last_sign: { tx_hash: sign?.tx_hash ?? "", at: sign?.at ?? "", ok: Boolean(sign?.ok) },
    blocked_after_freeze: { tx_hash: blocked?.tx_hash ?? "", error: blocked?.error ?? "" },
  };
}
