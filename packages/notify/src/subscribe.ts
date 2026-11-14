import type { FetchLike } from "./publish.ts";
import { NTFY_BASE } from "./publish.ts";

export interface NtfyMessage { id: string; time: number; event: string; topic: string; title?: string; message?: string; tags?: string[] }

export interface SubscribeOpts {
  fetch?: FetchLike; base?: string; signal?: AbortSignal;
  /** backoff bounds in ms (default 1 s doubling to 60 s) */
  minDelayMs?: number; maxDelayMs?: number;
  /** resume point on reconnect (default: now) */
  since?: string;
  onError?: (e: Error) => void;
}

/** Split an NDJSON byte stream into parsed ntfy messages (keepalive/open events are dropped by the caller). */
export async function* ndjson(body: AsyncIterable<Uint8Array>): AsyncGenerator<any> {
  const dec = new TextDecoder();
  let buf = "";
  for await (const chunk of body) {
    buf += dec.decode(chunk, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try { yield JSON.parse(line); } catch { /* torn line */ }
    }
  }
}

/**
 * Stream https://ntfy.sh/<topic>/json, calling onMessage for each real message (event "message").
 * Reconnects with exponential backoff, resuming after the last message id. Resolves when `signal` aborts.
 * Never logs the topic.
 */
export async function subscribe(topic: string | undefined, onMessage: (m: NtfyMessage) => void | Promise<void>, o: SubscribeOpts = {}): Promise<void> {
  if (!topic) return;
  const f = o.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const min = o.minDelayMs ?? 1000, max = o.maxDelayMs ?? 60_000;
  let delay = min;
  let since = o.since ?? String(Math.floor(Date.now() / 1000));
  const seen = new Set<string>();
  while (!o.signal?.aborted) {
    try {
      const r = await f(`${o.base ?? NTFY_BASE}/${topic}/json?since=${encodeURIComponent(since)}`, { signal: o.signal });
      if (!r.ok || !r.body) throw new Error(`ntfy subscribe HTTP ${r.status}`);
      delay = min;
      for await (const m of ndjson(r.body)) {
        if (m.event !== "message" || seen.has(m.id)) continue;
        seen.add(m.id);
        since = m.id;
        try { await onMessage(m as NtfyMessage); } catch (e) { o.onError?.(e as Error); }
      }
    } catch (e) {
      if (o.signal?.aborted) return;
      o.onError?.(e as Error);
    }
    if (o.signal?.aborted) return;
    await new Promise<void>((res) => { const t = setTimeout(res, delay); o.signal?.addEventListener("abort", () => { clearTimeout(t); res(); }, { once: true }); });
    delay = Math.min(max, delay * 2);
  }
}
