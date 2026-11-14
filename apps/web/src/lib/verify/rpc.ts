// Public NEAR JSON-RPC from the browser, with endpoint fallback. All endpoints below answer CORS
// preflights from any origin (checked 14 Nov 2026). Archival first: the claimed txs are days old.

export type Network = "testnet" | "mainnet";

export const ENDPOINTS: Record<Network, string[]> = {
  testnet: [
    "https://archival-rpc.testnet.fastnear.com",
    "https://rpc.testnet.fastnear.com",
    "https://near-testnet.drpc.org",
    "https://archival-rpc.testnet.near.org",
  ],
  mainnet: [
    "https://archival-rpc.mainnet.fastnear.com",
    "https://rpc.mainnet.fastnear.com",
    "https://near.drpc.org",
    "https://archival-rpc.mainnet.near.org",
  ],
};

export const host = (url: string) => url.replace(/^https:\/\//, "");

export type RpcResult<T> =
  | { ok: true; result: T; endpoint: string }
  | { ok: false; reason: "not_found" | "unreachable"; tried: string[]; message?: string };

type RpcError = { code?: number; message?: string; name?: string; cause?: { name?: string; info?: unknown } };

const TIMEOUT_MS = 12_000;

async function once<T>(endpoint: string, method: string, params: unknown): Promise<{ result?: T; error?: RpcError }> {
  const ctl = new AbortController();
  const t = window.setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "verify", method, params }),
      signal: ctl.signal,
    });
    if (!res.ok) return { error: { code: res.status, message: `HTTP ${res.status}` } };
    return (await res.json()) as { result?: T; error?: RpcError };
  } finally {
    window.clearTimeout(t);
  }
}

const NOT_FOUND = new Set(["UNKNOWN_TRANSACTION", "UNKNOWN_BLOCK", "UNKNOWN_ACCOUNT", "GARBAGE_COLLECTED_BLOCK"]);

/**
 * Tries each endpoint in order. Moves on after a network/CORS failure, a timeout, an HTTP error, a rate
 * limit, or a "not found" (a non-archival node may have pruned it). Returns not_found only when at least
 * one node answered "not found" and none had it; unreachable when no node answered at all.
 */
export async function rpc<T>(network: Network, method: string, params: unknown): Promise<RpcResult<T>> {
  const tried: string[] = [];
  let notFound = false;
  let message: string | undefined;
  for (const endpoint of ENDPOINTS[network]) {
    tried.push(endpoint);
    try {
      const body = await once<T>(endpoint, method, params);
      if (body.result !== undefined) return { ok: true, result: body.result, endpoint };
      const name = body.error?.cause?.name ?? body.error?.name ?? "";
      if (NOT_FOUND.has(name)) notFound = true;
      message = body.error?.message ?? name;
    } catch {
      // Network error, CORS refusal or timeout: try the next endpoint.
    }
  }
  return { ok: false, reason: notFound ? "not_found" : "unreachable", tried, message };
}

// --- Typed calls ---------------------------------------------------------------------------------

export interface TxResult {
  status: { SuccessValue?: string; SuccessReceiptId?: string; Failure?: unknown };
  transaction: { signer_id: string; receiver_id: string; hash: string };
  transaction_outcome: { block_hash: string };
  receipts_outcome: { outcome: { status: unknown } }[];
}

export const txStatus = (network: Network, hash: string, signer: string) =>
  rpc<TxResult>(network, "tx", { tx_hash: hash, sender_account_id: signer, wait_until: "NONE" });

export const blockHeight = async (network: Network, blockHash: string) => {
  const r = await rpc<{ header: { height: number } }>(network, "block", { block_id: blockHash });
  return r.ok ? r.result.header.height : null;
};

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

export async function viewCall(network: Network, account: string, method: string, args: unknown) {
  const r = await rpc<{ result: number[]; block_height: number }>(network, "query", {
    request_type: "call_function",
    finality: "final",
    account_id: account,
    method_name: method,
    args_base64: b64(JSON.stringify(args ?? {})),
  });
  if (!r.ok) return r;
  return { ...r, text: new TextDecoder().decode(new Uint8Array(r.result.result)) };
}
