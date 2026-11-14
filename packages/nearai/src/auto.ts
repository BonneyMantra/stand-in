import { logger } from "@standin/core";
import { hasApiKey } from "./env.ts";
import { tripFromLedger } from "./evidence.ts";
import { report } from "./report.ts";

const log = logger("nearai");

export const aiEnabled = () => hasApiKey() && process.env.STANDIN_NO_AI !== "1";

/**
 * Fire-and-forget for the watcher: runs on a later tick, never throws, never awaited by the freeze path.
 * Returns immediately; failures are logged without the credential.
 */
export function reportInBackground(tripTxHash: string, home?: string): void {
  if (!aiEnabled() || !tripTxHash) return;
  setTimeout(() => {
    const trip = tripFromLedger(tripTxHash, home);
    if (!trip) { log.warn(`incident report skipped: trip ${tripTxHash} not in ledger`); return; }
    report(trip, { home }).then(
      (r) => log.info(`incident report for ${tripTxHash}: chat ${r.proof.chat_id}, proof verified=${r.proof.verified}`),
      (e) => log.warn(`incident report failed for ${tripTxHash}: ${(e as Error).message.slice(0, 200)}`),
    );
  }, 0);
}
