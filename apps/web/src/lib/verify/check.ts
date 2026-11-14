import claimsFile from "../../../../../docs/claims.json";
import { blockHeight, host, txStatus, viewCall, type Network } from "./rpc";

// docs/claims.json is imported at build time, so the page always ships the claims the repo makes.

export interface ClaimTx {
  hash: string;
  expect: "success" | "failure";
  match?: string;
  role: string;
  signer: string;
  receiver?: string;
  block?: number;
  note?: string;
}

export interface Claim {
  id: string;
  title: string;
  network: Network;
  link?: string;
  blocks?: { from: number; to: number; expect: number };
  view?: { network: Network; account: string; method: string; args: unknown; expect_contains: string };
  txs: ClaimTx[];
}

export const CLAIMS = (claimsFile as { claims: Claim[] }).claims;
export const CLAIMS_GENERATED_AT = (claimsFile as { generated_at?: string }).generated_at ?? null;

export type CheckState = "checking" | "verified" | "mismatch" | "unreachable";

export interface TxCheck {
  state: CheckState;
  outcome?: "success" | "failure";
  height?: number | null;
  endpoint?: string;
  why?: string;
  failureText?: string;
}

export interface ClaimCheck {
  state: CheckState;
  txs: TxCheck[];
  blocks?: { state: CheckState; diff: number | null };
  view?: { state: CheckState; text?: string; endpoint?: string };
}

export const explorerTx = (network: Network, hash: string) =>
  `https://${network === "mainnet" ? "" : "testnet."}nearblocks.io/txns/${hash}`;

/** Every error string in the final status and the receipt outcomes, for the `match` check. */
function failureText(status: unknown, receipts: { outcome: { status: unknown } }[]): string {
  const parts = [status, ...receipts.map((r) => r.outcome.status)]
    .filter((s) => s && typeof s === "object" && "Failure" in (s as object))
    .map((s) => JSON.stringify(s));
  return parts.join(" ");
}

function readableFailure(text: string): string {
  const m = text.match(/"ExecutionError":"([^"]+)"/) ?? text.match(/"([A-Za-z]+Error|[A-Za-z]+NotExist)"/);
  return m ? m[1] : text.slice(0, 160);
}

async function checkTx(network: Network, t: ClaimTx): Promise<TxCheck> {
  const r = await txStatus(network, t.hash, t.signer);
  if (!r.ok) {
    return r.reason === "not_found"
      ? { state: "mismatch", why: `No node has this tx (${r.message ?? "not found"}).` }
      : { state: "unreachable", why: `No RPC answered (${r.tried.map(host).join(", ")}).` };
  }
  const fText = failureText(r.result.status, r.result.receipts_outcome);
  const outcome: "success" | "failure" = "Failure" in r.result.status ? "failure" : "success";
  const height = await blockHeight(network, r.result.transaction_outcome.block_hash);
  const base: TxCheck = { state: "verified", outcome, height, endpoint: host(r.endpoint), failureText: fText ? readableFailure(fText) : undefined };
  if (outcome !== t.expect) return { ...base, state: "mismatch", why: `Expected ${t.expect}, chain says ${outcome}.` };
  if (t.match && !fText.includes(t.match)) return { ...base, state: "mismatch", why: `Failure does not mention "${t.match}".` };
  if (typeof t.block === "number" && typeof height === "number" && height !== t.block) {
    return { ...base, state: "mismatch", why: `Included in block ${height}, claim says ${t.block}.` };
  }
  return base;
}

const worst = (states: CheckState[]): CheckState =>
  states.includes("mismatch") ? "mismatch" : states.includes("unreachable") ? "unreachable" : states.includes("checking") ? "checking" : "verified";

/** Runs one claim's checks, reporting partial progress through `onUpdate`. Txs run one at a time to stay under RPC rate limits. */
export async function checkClaim(c: Claim, onUpdate: (r: ClaimCheck) => void): Promise<ClaimCheck> {
  const cur: ClaimCheck = {
    state: "checking",
    txs: c.txs.map(() => ({ state: "checking" })),
    blocks: c.blocks ? { state: "checking", diff: null } : undefined,
    view: c.view ? { state: "checking" } : undefined,
  };
  const push = () => onUpdate({ ...cur, txs: [...cur.txs] });
  push();
  for (let i = 0; i < c.txs.length; i++) {
    cur.txs[i] = await checkTx(c.network, c.txs[i]);
    push();
  }
  if (c.blocks) {
    const a = cur.txs[c.blocks.from]?.height;
    const b = cur.txs[c.blocks.to]?.height;
    if (typeof a === "number" && typeof b === "number") {
      const diff = b - a;
      cur.blocks = { state: diff === c.blocks.expect ? "verified" : "mismatch", diff };
    } else cur.blocks = { state: "unreachable", diff: null };
  }
  if (c.view) {
    const v = await viewCall(c.view.network, c.view.account, c.view.method, c.view.args);
    cur.view = v.ok
      ? { state: v.text.includes(c.view.expect_contains) ? "verified" : "mismatch", text: v.text, endpoint: host(v.endpoint) }
      : { state: "unreachable" };
  }
  cur.state = worst([...cur.txs.map((t) => t.state), ...(cur.blocks ? [cur.blocks.state] : []), ...(cur.view ? [cur.view.state] : [])]);
  push();
  return cur;
}
