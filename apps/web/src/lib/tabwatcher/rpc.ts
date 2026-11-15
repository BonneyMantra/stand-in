/**
 * Browser JSON-RPC for the tab watcher and the lab's own-account run. drpc first; FastNEAR and rpc.testnet.near.org have
 * each answered HTTP 429 to some IPs (14 and 15 Nov), so a node that fails, times out or rate-limits is skipped and cooled
 * down. An answer from the chain itself (unknown account, key or block, a refused transaction) is final: ChainAnswer.
 */
export const TAB_RPCS: readonly string[] = ["https://near-testnet.drpc.org", "https://rpc.testnet.fastnear.com", "https://rpc.testnet.near.org"];

export type ChainKind =
  | "UNKNOWN_ACCOUNT" | "UNKNOWN_ACCESS_KEY" | "UNKNOWN_BLOCK" | "UNKNOWN_TRANSACTION" | "NO_CONTRACT_CODE" | "CONTRACT_ERROR"
  | "INVALID_TRANSACTION";

/** The chain answered: asking another node would not change it. */
export class ChainAnswer extends Error {
  readonly kind: ChainKind;
  constructor(kind: ChainKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

/** No endpoint answered at all (network, CORS, rate limits, timeouts). */
export class RpcDown extends Error {}

const KINDS: [RegExp, ChainKind][] = [
  [/UNKNOWN_ACCESS_KEY|access key .* does not exist/i, "UNKNOWN_ACCESS_KEY"],
  [/UNKNOWN_ACCOUNT|account .* does not exist/i, "UNKNOWN_ACCOUNT"],
  [/UNKNOWN_BLOCK|GARBAGE_COLLECTED_BLOCK/, "UNKNOWN_BLOCK"],
  [/UNKNOWN_TRANSACTION/, "UNKNOWN_TRANSACTION"],
  [/NO_CONTRACT_CODE|CodeDoesNotExist/, "NO_CONTRACT_CODE"],
  [/MethodNotFound|CONTRACT_EXECUTION_ERROR|wasm execution failed|FunctionCallError/, "CONTRACT_ERROR"],
  [/INVALID_TRANSACTION|InvalidTransaction|InvalidNonce|InvalidAccessKeyError|NotEnoughBalance|LackBalanceForState|Expired/, "INVALID_TRANSACTION"],
];

export function chainKind(text: string): ChainKind | null {
  for (const [re, kind] of KINDS) if (re.test(text)) return kind;
  return null;
}

export const host = (url: string) => url.replace(/^https:\/\//, "");

export type FetchLike = (url: string, init: RequestInit) => Promise<Pick<Response, "ok" | "status" | "json">>;

export interface Rpc {
  callAt<T>(method: string, params: unknown, endpoint?: string): Promise<{ result: T; endpoint: string }>;
  call<T>(method: string, params: unknown): Promise<T>;
  /** Sends to every endpoint at once (broadcasts); optional, `call` is used without it. */
  callAll?<T>(method: string, params: unknown): Promise<T>;
}

/** One endpoint's failure that another endpoint may not share (network, timeout, HTTP error, rate limit). */
class NodeFail extends Error {}

export class TabRpc implements Rpc {
  readonly urls: readonly string[];
  private fetcher: FetchLike;
  private timeoutMs: number;
  private hedgeMs: number;
  /** Endpoints that just failed or rate-limited go last until this time. */
  private cool = new Map<string, number>();

  /**
   * `hedgeMs`: when an endpoint has not answered in this time, the next one is asked too and the first answer wins, so one
   * slow node cannot hold a read for the whole timeout.
   */
  constructor(urls: readonly string[] = TAB_RPCS, fetcher: FetchLike = (u, i) => fetch(u, i), timeoutMs = 8000, hedgeMs = 1500) {
    this.urls = urls;
    this.fetcher = fetcher;
    this.timeoutMs = timeoutMs;
    this.hedgeMs = hedgeMs;
  }

  /** The configured order, with endpoints that failed in the last 30 s moved to the end. */
  private order(): string[] {
    const now = Date.now();
    const ok = this.urls.filter((u) => (this.cool.get(u) ?? 0) <= now);
    return [...ok, ...this.urls.filter((u) => !ok.includes(u))];
  }

  private async once<T>(url: string, method: string, params: unknown): Promise<T> {
    let body: { result?: T & { error?: unknown }; error?: unknown };
    try {
      const res = await this.fetcher(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "tab", method, params }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) throw new NodeFail(`${host(url)} answered HTTP ${res.status}`);
      body = (await res.json()) as typeof body;
    } catch (e) {
      this.cool.set(url, Date.now() + 30_000);
      throw e instanceof NodeFail ? e : new NodeFail(`${host(url)}: ${e instanceof Error ? e.message : String(e)}`);
    }
    const inner = body.result && typeof body.result === "object" && "error" in body.result ? body.result.error : undefined;
    const err = body.error ?? inner;
    if (err === undefined) {
      this.cool.delete(url);
      return body.result as T;
    }
    const text = typeof err === "string" ? err : JSON.stringify(err);
    const kind = chainKind(text);
    if (kind) throw new ChainAnswer(kind, text.slice(0, 400));
    this.cool.set(url, Date.now() + 30_000);
    throw new NodeFail(`${host(url)}: ${text.slice(0, 160)}`);
  }

  /**
   * Asks the endpoints in order (or only `endpoint`), hedged: a node that fails hands over at once, a slow one after
   * `hedgeMs`. The first answer wins; a chain answer (ChainAnswer) is an answer.
   */
  callAt<T>(method: string, params: unknown, endpoint?: string): Promise<{ result: T; endpoint: string }> {
    const order = endpoint ? [endpoint] : this.order();
    return new Promise((resolve, reject) => {
      let next = 0, pending = 0, done = false, last = "";
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        if (!done && pending === 0 && next >= order.length) {
          done = true;
          reject(new RpcDown(last ? `No testnet RPC answered (last: ${last})` : "No testnet RPC answered"));
        }
      };
      const launch = () => {
        clearTimeout(timer);
        if (done || next >= order.length) return finish();
        const url = order[next++]!;
        pending++;
        if (next < order.length) timer = setTimeout(launch, this.hedgeMs);
        this.once<T>(url, method, params).then(
          (result) => {
            pending--;
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve({ result, endpoint: url });
          },
          (e) => {
            pending--;
            if (done) return;
            if (e instanceof ChainAnswer) {
              done = true;
              clearTimeout(timer);
              reject(e);
              return;
            }
            last = e instanceof Error ? e.message : String(e);
            launch();
          },
        );
      };
      launch();
    });
  }

  async call<T>(method: string, params: unknown): Promise<T> {
    return (await this.callAt<T>(method, params)).result;
  }

  /** The same request to every endpoint at once (a signed transaction: every copy has the same hash). First answer wins. */
  async callAll<T>(method: string, params: unknown): Promise<T> {
    try {
      return await Promise.any(this.urls.map((u) => this.once<T>(u, method, params)));
    } catch (e) {
      const errors = e instanceof AggregateError ? e.errors : [e];
      const chain = errors.find((x) => x instanceof ChainAnswer);
      throw chain ?? new RpcDown(`No testnet RPC accepted it (${errors.map((x) => (x instanceof Error ? x.message : String(x))).join("; ").slice(0, 300)})`);
    }
  }
}

// --- Typed reads --------------------------------------------------------------------------------------

const b64json = (o: unknown) => btoa(JSON.stringify(o));

export async function viewFunction<T>(rpc: Rpc, accountId: string, method: string, args: unknown = {}, finality = "optimistic"): Promise<T> {
  const r = await rpc.call<{ result: number[] }>("query", {
    request_type: "call_function", finality, account_id: accountId, method_name: method, args_base64: b64json(args),
  });
  return JSON.parse(new TextDecoder().decode(new Uint8Array(r.result))) as T;
}

export interface AccountView { amount: bigint; storageUsage: bigint; codeHash: string; blockHeight: number }

export async function viewAccount(rpc: Rpc, accountId: string): Promise<AccountView | null> {
  try {
    const r = await rpc.call<{ amount: string; storage_usage: number; code_hash: string; block_height: number }>("query", {
      request_type: "view_account", finality: "optimistic", account_id: accountId,
    });
    return { amount: BigInt(r.amount), storageUsage: BigInt(r.storage_usage), codeHash: r.code_hash, blockHeight: r.block_height };
  } catch (e) {
    if (e instanceof ChainAnswer && e.kind === "UNKNOWN_ACCOUNT") return null;
    throw e;
  }
}

/** Balance minus the storage it locks (1 NEAR per 100 kB). */
export const spendable = (a: AccountView) => {
  const free = a.amount - a.storageUsage * 10n ** 19n;
  return free > 0n ? free : 0n;
};

export type KeyPermission = "FullAccess" | { FunctionCall: { allowance: string | null; receiver_id: string; method_names: string[] } };

export async function viewAccessKey(rpc: Rpc, accountId: string, publicKey: string): Promise<{ nonce: bigint; permission: KeyPermission; block_height: number } | null> {
  try {
    const r = await rpc.call<{ nonce: number | string; permission: KeyPermission; block_height: number }>("query", {
      request_type: "view_access_key", finality: "optimistic", account_id: accountId, public_key: publicKey,
    });
    return { nonce: BigInt(r.nonce), permission: r.permission, block_height: r.block_height };
  } catch (e) {
    if (e instanceof ChainAnswer && (e.kind === "UNKNOWN_ACCESS_KEY" || e.kind === "UNKNOWN_ACCOUNT")) return null;
    throw e;
  }
}

export interface TxView {
  final_execution_status?: string;
  status: { SuccessValue?: string; Failure?: unknown } | string;
  transaction: { hash: string; signer_id: string; receiver_id: string; public_key: string; actions: unknown[] };
  transaction_outcome: { block_hash: string };
  receipts_outcome: { outcome: { status: unknown } }[];
}

/** Every receipt has a final status (SuccessValue, SuccessReceiptId or Failure). */
export const executed = (t: TxView) =>
  typeof t.status === "object" && [t.status, ...t.receipts_outcome.map((r) => r.outcome.status)].every((s) => !!s && typeof s === "object");

/** The transaction as soon as a node has it (wait_until NONE answers at once), or null while none knows it yet. */
export async function txStatus(rpc: Rpc, hash: string, signer: string): Promise<TxView | null> {
  try {
    const r = await rpc.call<TxView>("tx", { tx_hash: hash, sender_account_id: signer, wait_until: "NONE" });
    return r.transaction_outcome?.block_hash ? r : null;
  } catch (e) {
    if (e instanceof ChainAnswer && e.kind === "UNKNOWN_TRANSACTION") return null;
    throw e;
  }
}

/** Polls until the transaction is included and executed; throws after `ms`. */
export async function waitExecuted(rpc: Rpc, hash: string, signer: string, ms = 60_000): Promise<TxView> {
  const until = Date.now() + ms;
  for (;;) {
    const t = await txStatus(rpc, hash, signer).catch((e) => (e instanceof RpcDown ? null : Promise.reject(e)));
    if (t && executed(t)) return t;
    if (Date.now() > until) throw new RpcDown(`Transaction ${hash.slice(0, 10)}… was not seen executed within ${Math.round(ms / 1000)} s`);
    await sleep(400);
  }
}

export async function blockHeight(rpc: Rpc, blockHash: string): Promise<number> {
  return (await rpc.call<{ header: { height: number } }>("block", { block_id: blockHash })).header.height;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
