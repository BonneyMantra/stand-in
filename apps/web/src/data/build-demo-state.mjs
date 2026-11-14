// Builds apps/web/public/demo-state.json (the "recorded testnet run" the dashboard falls back to)
// from real artifacts only: the bench ledger, bench/results.json, config/testnet.json and the
// tx hashes recorded in contracts/README.md. Usage (from the repo root):
//   node apps/web/src/data/build-demo-state.mjs [ledger.ndjson ...]
// It also merges the live watcher's on-chain state (attested blocklist entries, trips it froze, the
// adopt decoys) when 127.0.0.1:4317 answers, saving a path-redacted copy to watcher-snapshot.json so the
// build is reproducible offline.
// Values that do not exist yet are left empty or marked `preview: true`; nothing is invented.
// Private key material is stripped: any long base58 string that is not a public key is redacted.
import fs from "node:fs";
import path from "node:path";

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../..");
// Default ledgers: the bench run plus every W3 watcher proof run (each a real decoy tx → freeze).
const sandboxDir = path.join(repo, ".sandbox");
const ledgerFiles = process.argv.length > 2 ? process.argv.slice(2) : [
  path.join(sandboxDir, "bench/.standin/ledger.ndjson"),
  ...fs.readdirSync(sandboxDir).filter((d) => d.startsWith("w3-proof-")).sort()
    .map((d) => path.join(sandboxDir, d, ".standin/ledger.ndjson")).filter((f) => fs.existsSync(f)),
];
const cfg = JSON.parse(fs.readFileSync(path.join(repo, "config/testnet.json"), "utf8"));
// BENCH_RESULTS=<file> picks a results.json other than bench/results.json (e.g. a committed run).
const benchFile = process.env.BENCH_RESULTS ?? path.join(repo, "bench/results.json");
const bench = JSON.parse(fs.readFileSync(benchFile, "utf8"));
const events = ledgerFiles.flatMap((f) => fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)))
  .sort((a, b) => String(a.at ?? "").localeCompare(String(b.at ?? "")));

const SANDBOX = path.join(repo, ".sandbox") + "/";
const redact = (s) => String(s ?? "").replace(/(ed25519:)?[1-9A-HJ-NP-Za-km-z]{60,}/g, "<redacted>");
/** Sandbox paths become home-relative (each bench route runs in its own sandbox HOME). */
function homePath(p) {
  const s = String(p ?? "");
  if (!s.startsWith(SANDBOX)) return redact(s.replace(repo + "/", ""));
  const rest = s.slice(SANDBOX.length);
  const i = rest.indexOf("/");
  return i < 0 ? "~" : "~/" + rest.slice(i + 1);
}
function routeOf(p) {
  const s = String(p ?? "");
  if (!s.startsWith(SANDBOX)) return "";
  return s.slice(SANDBOX.length).split("/")[0].replace(/-(on|off)$/, "");
}

// ── live watcher snapshot (optional) ──
const snapFile = path.join(repo, "apps/web/src/data/watcher-snapshot.json");
let live = null;
try {
  const res = await fetch("http://127.0.0.1:4317/api/state", { signal: AbortSignal.timeout(4000) });
  const raw = await res.json();
  const redactPaths = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === "path" || k === "cwd") && typeof v === "string" ? homePath(v) : v));
  live = { snapshot_at: new Date().toISOString(), ...redactPaths(raw) };
  fs.writeFileSync(snapFile, JSON.stringify(live, null, 1) + "\n");
} catch {
  if (fs.existsSync(snapFile)) live = JSON.parse(fs.readFileSync(snapFile, "utf8"));
}

const planted = events.filter((e) => e.type === "decoy_planted");
const started = events.filter((e) => e.type === "session_started");
const calls = events.filter((e) => e.type === "tool_call" && e.phase === "pre");
const exposuresRaw = events.filter((e) => e.type === "exposure");
// The same trip can land in two ledgers (bench and a proof run share the watcher): keep the richer one.
const tripsRaw = [...events.filter((e) => e.type === "trip").reduce((m, e) => {
  const prev = m.get(e.tx_hash);
  if (!prev || (!prev.attributed_to?.agent && e.attributed_to?.agent)) m.set(e.tx_hash, e);
  return m;
}, new Map()).values()];
const freezes = events.filter((e) => e.type === "freeze");

const keys = planted.map((e) => ({
  public_key: e.public_key,
  planted: { kind: e.kind, path: homePath(e.path), agent: e.agent || "manual", session_id: e.session_id || "", cwd: homePath(e.cwd), at: e.at },
}));

const sessions = started.map((e) => ({
  session_id: e.session_id, agent: e.agent, cwd: homePath(e.cwd), started_at: e.at,
  decoy_public_key: e.decoy_public_key,
  tool_calls: calls.filter((c) => c.session_id === e.session_id).length,
}));

const exposures = exposuresRaw.map((e) => ({
  at: e.at, session_id: e.session_id, agent: e.agent, tool_name: e.tool_name,
  tool_input_summary: redact(e.tool_input_summary), tool_use_id: e.tool_use_id,
  decoy_public_key: e.decoy_public_key, where: e.where,
}));

const benchTrips = tripsRaw.map((t) => {
  const f = freezes.find((x) => x.trip_tx_hash === t.tx_hash)?.freeze;
  return {
    tx_hash: t.tx_hash, block_height: t.block_height, decoy_public_key: t.decoy_public_key,
    attacker_account: t.attacker_account,
    attributed_to: { ...t.attributed_to, path: homePath(t.attributed_to?.path) },
    freeze: f ?? { tx_hash: "", block_height: 0, blocks_after_trip: 0, deleted_keys: [], intents_keys_removed: [] },
    // The OutLayer report was not run in this recording (STANDIN_NO_REPORT); left empty, not invented.
    blocklist: { tx_hash: "", outlayer_execution: "", attested: false },
    at: t.at,
  };
});

const liveTrips = (live?.trips ?? []).filter((t) => !benchTrips.some((b) => b.tx_hash === t.tx_hash)).map((t) => ({ ...t, at: undefined }));
// A trip both sources saw: the watcher has the freeze/attribution the bench ledger may lack.
for (const b of benchTrips) {
  const l = (live?.trips ?? []).find((t) => t.tx_hash === b.tx_hash);
  if (!l) continue;
  if (!b.freeze.tx_hash) b.freeze = l.freeze;
  if (!b.attributed_to.path && !b.attributed_to.session_id) b.attributed_to = l.attributed_to;
  if (l.blocklist?.attested) b.blocklist = l.blocklist;
}
// Same rule as bench/: a freeze that precedes its trip is a reused earlier freeze, not this trip's, so the
// trip is dropped (killed bench runs left such rows); rows without a trip tx hash are dropped too.
const trips = [...benchTrips, ...liveTrips].filter((t) => t.tx_hash && (!t.freeze?.tx_hash || t.freeze.blocks_after_trip >= 0));
for (const k of live?.decoy?.keys ?? []) if (!keys.some((x) => x.public_key === k.public_key)) keys.push(k);

// Agent key state after the run: everything the freeze deleted is gone, the account is frozen.
const lastFreeze = liveTrips.at(-1)?.freeze ?? freezes.at(-1)?.freeze;
const sumOn = bench.stand_in_on ?? [];
const blocked = new Set(bench.summary?.routes_blocked_auth ?? []);
const liveBlocklist = (live?.blocklist ?? []).filter((b) => b.attested_at);

const state = {
  network: cfg.network,
  agent: { account_id: cfg.accounts.agent, frozen: Boolean(lastFreeze), agent_keys: [], intents_keys: [] },
  decoy: {
    account_id: cfg.accounts.decoy,
    balance_yocto: BigInt(Math.round((bench.preflight?.decoy_balance_near_after ?? 0) * 1e6)).toString() + "0".repeat(18),
    keys,
  },
  sessions, exposures,
  trips: trips.map(({ at, ...t }) => t),
  blocklist: [
    // On-chain registry entries the live watcher read back (attested by OutLayer).
    ...liveBlocklist,
    // Real attacker and evidence tx; the registry report + OutLayer attestation has not run yet.
    ...trips.slice(0, 1).filter((t) => !liveBlocklist.some((b) => b.account_id === t.attacker_account)).map((t) => ({ account_id: t.attacker_account, evidence_tx: t.tx_hash, decoy_public_key: t.decoy_public_key, attested_at: "", preview: true })),
  ],
  bench: {
    routes: bench.summary?.routes_run ?? sumOn.length, detected: bench.summary?.detected ?? 0,
    attributed: bench.summary?.attributed_session ?? 0, median_blocks_to_freeze: bench.summary?.median_blocks_to_freeze ?? 0,
  },
  // Chain Signatures proof (packages/chainsig prove run), as the live watcher served it.
  ...(live?.chainsig ? { chainsig: live.chainsig } : {}),
  recorded: {
    recorded_at: started[0]?.at ?? bench.generated_at,
    source: `bench ledger + ${benchFile.startsWith(repo + "/") ? path.relative(repo, benchFile) : `bench results (${path.basename(benchFile)})`} (testnet)`,
    bench_generated_at: bench.generated_at,
    accounts: cfg.accounts,
    trip_times: Object.fromEntries(trips.filter((t) => t.at).map((t) => [t.tx_hash, t.at])),
    watcher_snapshot_at: live?.snapshot_at ?? null,
    freeze_times: Object.fromEntries(freezes.map((f) => [f.trip_tx_hash, f.at])),
    session_routes: Object.fromEntries(started.map((e) => [e.session_id, routeOf(e.cwd)])),
    deleted_agent_keys: lastFreeze?.deleted_keys ?? [],
    removed_intents_keys: lastFreeze?.intents_keys_removed ?? [],
    contract_proof: {
      freeze_tx: "EFrvBZmt53PYB9cD1AuZ3hYQvdVpatuMqMCCqTmJwzXv",
      public_key_not_exist_tx: "2CNYoa89ey8Sguv3JyqGjNuYCBLmfVE1vu9NdP57rHYZ",
    },
    bench_routes: sumOn.map((r) => ({
      route: r.route, name: r.name, kind: r.kind, mode: r.mode, theft_succeeded: Boolean(r.theft_succeeded),
      status: blocked.has(r.route) ? "not run: agent auth" : r.error ? "error" : "run",
      detected: Boolean(r.score?.trip_detected || r.score?.exposure_detected),
      exposure_detected: Boolean(r.score?.exposure_detected),
      attributed_session: Boolean(r.score?.trip_attributed_session || r.score?.attributed_session_via_exposure),
      attributed_tool: Boolean(r.score?.trip_attributed_tool_use_id || r.score?.attributed_exact),
      blocks_to_freeze: typeof r.score?.blocks_to_freeze === "number" ? r.score.blocks_to_freeze : null,
      keys_deleted: r.score?.keys_deleted ?? 0,
    })),
    baseline_routes: (bench.baseline_off ?? []).map((r) => ({ route: r.route, name: r.name, theft_succeeded: r.theft_succeeded })),
  },
};

const out = path.join(repo, "apps/web/public/demo-state.json");
fs.writeFileSync(out, JSON.stringify(state, null, 1) + "\n");
const blob = fs.readFileSync(out, "utf8");
if (/private_key"\s*:\s*"ed25519:[1-9A-HJ-NP-Za-km-z]{60,}/.test(blob)) throw new Error("private key material leaked");
process.stdout.write(`wrote ${out}: ${keys.length} decoys, ${sessions.length} sessions, ${exposures.length} exposures, ${trips.length} trips, ${state.blocklist.length} blocklist (live snapshot: ${live ? "yes" : "no"})\n`);
