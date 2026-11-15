import { z } from "zod";

/**
 * A run on the owner's own account, written to this browser as it goes, so that a tab closed mid-run can say truthfully what
 * happened: every hash is stored before its transaction is sent. The thief key is a throwaway testnet key that holds the
 * loot until it is returned; the decoy's secret is never stored here (the home keeps its decoys).
 */
const PREFIX = "standin.labrun.v1:";

const Step = z.object({
  id: z.string(),
  status: z.enum(["pending", "start", "ok", "fail", "skip"]),
  title: z.string().optional(),
  detail: z.string().optional(),
  at: z.string().optional(),
  block: z.number().optional(),
  blocks_after_trip: z.number().optional(),
  txs: z.array(z.object({ hash: z.string(), href: z.string(), label: z.string().optional() })),
});

export const Journal = z.object({
  v: z.literal(1),
  id: z.string(),
  owner: z.string(),
  guardian: z.string(),
  bait: z.string(),
  watcher: z.string(),
  started_at: z.string(),
  decoy_pk: z.string().optional(),
  thief: z.object({ account: z.string(), public_key: z.string(), secret_key: z.string() }),
  tx: z.record(z.string(), z.string()).default({}),
  phase: z.enum(["running", "done", "failed"]),
  /** The step that was running when the journal was last written. */
  current: z.string().optional(),
  blocks: z.number().nullable().optional(),
  steps: z.array(Step).default([]),
  finished_at: z.string().optional(),
});
export type Journal = z.infer<typeof Journal>;

function store(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readJournal(owner: string): Journal | null {
  try {
    const raw = store()?.getItem(PREFIX + owner);
    if (!raw) return null;
    const p = Journal.safeParse(JSON.parse(raw));
    return p.success && p.data.owner === owner ? p.data : null;
  } catch {
    return null;
  }
}

/** Saves the journal; false when storage refused it (the run continues, but a closed tab could not be explained). */
export function writeJournal(j: Journal): boolean {
  try {
    const s = store();
    if (!s) return false;
    s.setItem(PREFIX + j.owner, JSON.stringify(j));
    return true;
  } catch {
    return false;
  }
}

export function clearJournal(owner: string): void {
  try {
    store()?.removeItem(PREFIX + owner);
  } catch {
    // storage blocked: nothing to clear
  }
}
