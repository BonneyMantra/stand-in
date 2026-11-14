// Watcher API schema, exactly as docs/BRIEF.md defines `GET /api/state` (served by
// packages/watcher on 127.0.0.1:4317, proxied by Vite at /api). Extra fields the watcher adds
// (SSE `trip_tx_hash`) and the recorded-run metadata live in separate optional types below.

export type Network = "testnet" | "mainnet";
export type PlantKind = "near-credentials" | "dotenv" | "shell-history" | "session-env";
export type AgentKind = "claude-code" | "codex" | "manual";

export interface AgentState {
  account_id: string;
  frozen: boolean;
  agent_keys: string[];
  intents_keys: string[];
}

export interface Planted {
  kind: PlantKind;
  path: string;
  agent: AgentKind;
  session_id: string;
  cwd: string;
  at: string;
}

export interface DecoyKey {
  public_key: string;
  planted: Planted;
}

export interface DecoyState {
  account_id: string;
  balance_yocto: string;
  keys: DecoyKey[];
}

export interface Session {
  session_id: string;
  agent: string;
  cwd: string;
  started_at: string;
  decoy_public_key: string;
  tool_calls: number;
}

export interface Exposure {
  at: string;
  session_id: string;
  agent: string;
  tool_name: string;
  tool_input_summary: string;
  tool_use_id: string;
  decoy_public_key: string;
  where: string;
}

export interface Attribution {
  session_id: string;
  agent: string;
  tool_name: string;
  tool_use_id: string;
  path: string;
}

export interface Freeze {
  tx_hash: string;
  block_height: number;
  blocks_after_trip: number;
  deleted_keys: string[];
  intents_keys_removed: string[];
}

export interface TripBlocklist {
  tx_hash: string;
  outlayer_execution: string;
  attested: boolean;
}

export interface Trip {
  tx_hash: string;
  block_height: number;
  decoy_public_key: string;
  attacker_account: string;
  attributed_to: Attribution;
  freeze: Freeze;
  blocklist: TripBlocklist;
}

export interface BlocklistEntry {
  account_id: string;
  evidence_tx: string;
  decoy_public_key: string;
  attested_at: string;
  /** Recorded-run only: entry not yet posted/attested on chain. Rendered with a "preview" tag. */
  preview?: boolean;
}

export interface BenchSummary {
  routes: number;
  detected: number;
  attributed: number;
  median_blocks_to_freeze: number;
}

export interface ChainSig {
  evm_address: string;
  chain_id: number;
  path: string;
  last_sign: { tx_hash: string; at: string; ok: boolean };
  blocked_after_freeze: { tx_hash: string; error: string };
}

export interface IncidentReport {
  trip_tx_hash: string;
  at: string;
  model: string;
  report: {
    summary: string; root_cause: string; leaked_via: string; blast_radius: string;
    actions_taken: string[]; recommended_next_steps: string[]; confidence: "low" | "medium" | "high";
  };
  proof: {
    chat_id: string; signature: string; signing_address: string; signing_algo: string; signature_kind: string;
    attestation: { fetched_at: string; nonce: string; verified: boolean; gateway?: { tee_type?: string; gpu_evidence_present?: boolean } };
    verified: boolean;
    checks: { name: string; ok: boolean; detail?: string }[];
    unverified: { what: string; reason: string }[];
    billing?: { prompt_tokens: number; completion_tokens: number; usd: number };
  };
}

export interface StandinState {
  network: Network;
  agent: AgentState;
  decoy: DecoyState;
  sessions: Session[];
  exposures: Exposure[];
  trips: Trip[];
  blocklist: BlocklistEntry[];
  bench: BenchSummary;
  /** Optional: Chain Signatures proof (guardian.sign_evm through the NEAR MPC signer). */
  chainsig?: ChainSig;
  /** Optional: private incident reports written by a NEAR AI Cloud TEE model, one per trip. */
  incident_reports?: IncidentReport[];
  /** Present only in public/demo-state.json (the recorded run), never in the live API. */
  recorded?: RecordedMeta;
}

/** SSE event names served at /api/events. Payloads are the objects above. */
export type StandinEventName = "session" | "exposure" | "trip" | "freeze" | "blocklist" | "bench";

// ── Recorded-run metadata (built by build-demo-state.mjs from real artifacts) ──

export interface BenchRoute {
  route: string;
  name: string;
  kind: string;
  mode: string;
  theft_succeeded: boolean;
  /** "run", "error", or "not run: <reason>"; only "run" routes count in the scores. */
  status: string;
  detected: boolean;
  exposure_detected: boolean;
  attributed_session: boolean;
  attributed_tool: boolean;
  blocks_to_freeze: number | null;
  keys_deleted: number;
}

export interface RecordedMeta {
  recorded_at: string;
  source: string;
  bench_generated_at?: string;
  watcher_snapshot_at?: string | null;
  accounts: Record<string, string>;
  trip_times: Record<string, string>;
  freeze_times: Record<string, string>;
  session_routes: Record<string, string>;
  deleted_agent_keys: string[];
  removed_intents_keys: string[];
  contract_proof: { freeze_tx: string; public_key_not_exist_tx: string };
  bench_routes: BenchRoute[];
  baseline_routes: { route: string; name: string; theft_succeeded: boolean }[];
}
