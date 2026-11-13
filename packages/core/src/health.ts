import type { NetworkConfig } from "./config.ts";

/** Per-process endpoint health: a 429/5xx puts an endpoint on exponential cooldown (2 s .. 30 s). */
const cooldown = new Map<string, { until: number; strikes: number }>();
let rr = 0;

export function markFailure(url: string): void {
  const prev = cooldown.get(url)?.strikes ?? 0;
  const strikes = Math.min(prev + 1, 5);
  cooldown.set(url, { until: Date.now() + Math.min(2000 * 2 ** (strikes - 1), 30_000), strikes });
}
export function markOk(url: string): void {
  cooldown.delete(url);
}

/** Primary pool (fast endpoints) and the slow last-resort pool. */
export function endpointPools(cfg: NetworkConfig): { primary: string[]; lastResort: string[] } {
  const primary = [...new Set([cfg.rpcUrl, ...cfg.rpcFallbackUrls])];
  return { primary, lastResort: cfg.rpcLastResortUrls };
}

/**
 * Endpoints in preference order: healthy primaries rotated round-robin (spreads load across them),
 * then cooling primaries (soonest first), then the slow last resort.
 */
export function orderedEndpoints(cfg: NetworkConfig): string[] {
  const { primary, lastResort } = endpointPools(cfg);
  const now = Date.now();
  const healthy = primary.filter((u) => (cooldown.get(u)?.until ?? 0) <= now);
  const cooling = primary.filter((u) => !healthy.includes(u)).sort((a, b) => cooldown.get(a)!.until - cooldown.get(b)!.until);
  const start = healthy.length ? rr++ % healthy.length : 0;
  const rotated = [...healthy.slice(start), ...healthy.slice(0, start)];
  return [...rotated, ...cooling, ...lastResort];
}
