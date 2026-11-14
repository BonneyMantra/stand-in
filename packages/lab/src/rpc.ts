// Minimal JSON-RPC client over fetch with endpoint rotation and backoff (public RPCs rate-limit).
export const DEFAULT_RPCS = ["https://near-testnet.drpc.org", "https://test.rpc.fastnear.com"];

export class RpcError extends Error {
  constructor(message: string, public data?: unknown) { super(message); }
}

export class Rpc {
  private i = 0;
  calls = 0;
  constructor(private urls: string[] = DEFAULT_RPCS, private timeoutMs = 12000) {}

  async call<T = any>(method: string, params: unknown, tries = 5): Promise<T> {
    let last: unknown;
    for (let n = 0; n < tries; n++) {
      const url = this.urls[(this.i + n) % this.urls.length]!;
      try {
        this.calls++;
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: "lab", method, params }),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (res.status === 429 || res.status >= 500) throw new RpcError(`http ${res.status}`);
        const j: any = await res.json();
        if (j.error) {
          const msg = JSON.stringify(j.error.cause ?? j.error.data ?? j.error.message ?? j.error);
          // protocol-level answers (bad tx) are final; rate limits, timeouts and a node that has not seen a block yet rotate
          if (/rate|limit|too many|timeout|UNKNOWN_BLOCK|UNAVAILABLE/i.test(msg)) throw new RpcError(msg);
          throw Object.assign(new RpcError(msg.slice(0, 400), j.error), { final: true });
        }
        this.i = (this.i + n) % this.urls.length;
        return j.result as T;
      } catch (e: any) {
        if (e?.final) throw e;
        last = e;
        await new Promise((r) => setTimeout(r, Math.min(150 * 2 ** n, 1500)));
      }
    }
    throw new RpcError(`rpc unavailable: ${(last as Error)?.message ?? "unknown"}`);
  }
}
