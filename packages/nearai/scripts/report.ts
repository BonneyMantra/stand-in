// node --import tsx packages/nearai/scripts/report.ts <trip_tx_hash> [--ledger <path>] [--model <id>]
// Reads the trip (and its session/exposure context) from --ledger (default: $STANDIN_HOME), writes the
// incident_report event to $STANDIN_HOME's ledger. Prints the report and a proof summary; never the API credential.
import path from "node:path";
import { standinHome } from "@standin/core";
import { report, tripFromLedger } from "../src/index.ts";

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const hash = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
if (!hash) { process.stderr.write("usage: report.ts <trip_tx_hash> [--ledger <path>] [--model <id>]\n"); process.exit(2); }

const ledger = flag("--ledger");
const readHome = ledger ? path.dirname(path.resolve(ledger)) : undefined;
const trip = tripFromLedger(hash, readHome);
if (!trip) { process.stderr.write(`trip ${hash} not found in ${ledger ?? standinHome()}\n`); process.exit(1); }

const ev = await report(trip, { home: standinHome(), model: flag("--model") });
const { proof } = ev;
process.stdout.write(JSON.stringify({
  trip_tx_hash: ev.trip_tx_hash, model: ev.model, report: ev.report,
  proof: { chat_id: proof.chat_id, verified: proof.verified, signing_address: proof.signing_address, signature_kind: proof.signature_kind, checks: proof.checks, unverified: proof.unverified, billing: proof.billing },
}, null, 2) + "\n");
