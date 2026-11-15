// Event and record shapes of the hosted lab API (contract: docs/UPGRADES.md, "Lab API").

export const STEP_ORDER = ["plant", "leak", "theft", "detect", "freeze", "notify", "reset"] as const;
export type StepId = (typeof STEP_ORDER)[number];

export const STEP_LABEL: Record<StepId, string> = {
  plant: "Plant a decoy key",
  leak: "Leak it through an agent session",
  theft: "Thief spends with the decoy",
  detect: "Watcher sees the decoy used",
  freeze: "Freeze the agent account",
  notify: "Push to the lab phone topic",
  reset: "Reset the lab",
};

export type StepStatus = "start" | "ok" | "fail";

/** One `event: step` payload. */
export interface StepEvent {
  run_id: string;
  step: StepId;
  status: StepStatus;
  at: string;
  title: string;
  detail?: string;
  tx_hash?: string;
  block?: number;
  explorer?: string;
  blocks_after_trip?: number;
  /** On `reset`: every tx the reset sent (unfreeze, add_agent_key, return_loot, delete_decoy_key). */
  txs?: { label?: string; tx_hash: string; explorer?: string }[];
  /** On a failed `notify`: the push the server could not deliver, for the browser to publish. */
  ntfy?: NtfyPayload;
  detected_at_block?: number;
  detection?: string;
}

export interface NtfyPayload {
  topic: string;
  title: string;
  message: string;
  click?: string;
}

export interface DoneEvent {
  run_id: string;
  blocks_to_freeze: number | null;
}

export type LabEvent =
  | { type: "step"; data: StepEvent }
  | { type: "done"; data: DoneEvent }
  | { type: "error"; data: { error: string } };

export interface RunRecord {
  run_id: string;
  at: string;
  blocks_to_freeze: number | null;
  steps: StepEvent[];
}

export interface LabConfig {
  network: string;
  accounts: { agent: string; decoy: string; thief: string };
  ntfy_topic: string;
  explorer: string;
}

/** A step as the trace shows it: the latest status plus every tx it produced. `skip`: not run, with the reason as title. */
export interface StepViewOf<Id extends string> {
  id: Id;
  status: StepStatus | "pending" | "skip";
  title?: string;
  detail?: string;
  at?: string;
  block?: number;
  txs: { hash: string; href: string; label?: string }[];
  blocks_after_trip?: number;
  ntfy?: NtfyPayload;
}

export type StepView = StepViewOf<StepId>;

export const isStepId = (s: unknown): s is StepId => typeof s === "string" && (STEP_ORDER as readonly string[]).includes(s);

const TESTNET_TX = "https://testnet.nearblocks.io/txns/";

export function txHref(e: { tx_hash?: string; explorer?: string }): string {
  if (e.explorer && /^https:\/\//.test(e.explorer)) return e.explorer;
  return `${TESTNET_TX}${e.tx_hash ?? ""}`;
}

/** Folds a list of step events (live or from a stored run) into one view per step. */
export function foldSteps(events: StepEvent[]): StepView[] {
  const views = new Map<StepId, StepView>(STEP_ORDER.map((id) => [id, { id, status: "pending", txs: [] }]));
  for (const e of events) {
    const v = views.get(e.step);
    if (!v) continue;
    v.status = e.status;
    v.title = e.title || v.title;
    v.detail = e.detail ?? v.detail;
    v.at = e.at;
    v.block = e.block ?? v.block;
    if (typeof e.blocks_after_trip === "number") v.blocks_after_trip = e.blocks_after_trip;
    if (e.ntfy) v.ntfy = e.ntfy;
    const txs = [...(e.txs ?? []), ...(e.tx_hash ? [{ tx_hash: e.tx_hash, explorer: e.explorer, label: undefined }] : [])];
    for (const t of txs) {
      if (!t.tx_hash || v.txs.some((x) => x.hash === t.tx_hash)) continue;
      v.txs.push({ hash: t.tx_hash, href: txHref(t), label: t.label?.replace(/_/g, " ") });
    }
  }
  return STEP_ORDER.map((id) => views.get(id)!);
}

export const shortHash = (h: string, head = 6, tail = 4) => (h.length > head + tail + 1 ? `${h.slice(0, head)}…${h.slice(-tail)}` : h);
