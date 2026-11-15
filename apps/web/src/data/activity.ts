/**
 * Transactions that touched an account, from the public nearblocks indexer (testnet). The chain state on My account
 * comes from RPC; this only adds the transaction hashes RPC cannot list (a freeze's own transaction, decoy additions,
 * thefts), each one an explorer link. The indexer is rate-limited: results are cached per account for a minute and a
 * refusal is reported, never retried in a loop.
 */

export const NEARBLOCKS_API = "https://api-testnet.nearblocks.io/v1";

export interface ActivityTx {
  hash: string;
  signer: string;
  receiver: string;
  methods: string[];
  /** action kinds when there is no method (CREATE_ACCOUNT, TRANSFER, ADD_KEY…) */
  actions: string[];
  block: number;
  at: number;
  ok: boolean | null;
}

type Raw = {
  transaction_hash: string; signer_account_id: string; receiver_account_id: string;
  block?: { block_height?: number }; block_timestamp?: string;
  actions?: { action?: string; method?: string | null }[]; outcomes?: { status?: boolean | null };
};

export function toActivity(r: Raw): ActivityTx {
  const acts = r.actions ?? [];
  return {
    hash: r.transaction_hash, signer: r.signer_account_id, receiver: r.receiver_account_id,
    methods: acts.map((a) => a.method).filter((m): m is string => !!m),
    actions: acts.map((a) => String(a.action ?? "")).filter(Boolean),
    block: Number(r.block?.block_height ?? 0),
    at: r.block_timestamp ? Number(BigInt(r.block_timestamp) / 1_000_000n) : 0,
    ok: r.outcomes?.status ?? null,
  };
}

const cache = new Map<string, { at: number; txs: ActivityTx[] }>();
const TTL = 60_000;

export async function readActivity(accountId: string, opts: { fresh?: boolean; fetcher?: typeof fetch } = {}): Promise<ActivityTx[]> {
  const hit = cache.get(accountId);
  if (hit && !opts.fresh && Date.now() - hit.at < TTL) return hit.txs;
  const f = opts.fetcher ?? fetch;
  const res = await f(`${NEARBLOCKS_API}/account/${encodeURIComponent(accountId)}/txns-only?per_page=25&order=desc`, { signal: AbortSignal.timeout(10_000) });
  if (res.status === 429) throw new Error("the nearblocks indexer is rate-limiting this browser; try again in a minute");
  if (!res.ok) throw new Error(`the nearblocks indexer answered HTTP ${res.status}`);
  const j = (await res.json()) as { txns?: Raw[] };
  const txs = (j.txns ?? []).map(toActivity);
  cache.set(accountId, { at: Date.now(), txs });
  return txs;
}

/** What a transaction did, in a few words. */
export function describeTx(t: ActivityTx, ctx: { bait: string; watcher: string }): string {
  if (t.actions.includes("DEPLOY_CONTRACT")) return `contract deployed${t.methods.length ? ` + ${t.methods.join(" + ")}` : ""}`;
  if (t.methods.length) return t.methods.join(" + ");
  if (t.signer === ctx.bait && t.receiver === ctx.bait) return t.actions.includes("ADD_KEY") ? "decoy key added" : t.actions.join(" + ").toLowerCase();
  if (t.signer === ctx.bait) return "signed by a bait key (a decoy used)";
  if (t.actions.includes("CREATE_ACCOUNT")) return "account created";
  return t.actions.join(" + ").toLowerCase().replaceAll("_", " ") || "transaction";
}

/**
 * The freeze transaction behind a freeze_log record: a `freeze` call to the guardian included at, or one or two blocks
 * before, the block the record names (the receipt can execute a block after inclusion).
 */
export function freezeTxFor(txs: ActivityTx[], guardian: string, atBlock: number): ActivityTx | null {
  return txs.find((t) => t.receiver === guardian && t.methods.includes("freeze") && t.block <= atBlock && atBlock - t.block <= 3) ?? null;
}
