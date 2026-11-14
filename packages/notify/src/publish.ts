export interface Alert {
  title: string;
  message: string;
  tags?: string[];
  /** URL opened when the notification is tapped (explorer or dashboard) */
  click?: string;
  /** adds "Freeze now" / "Ignore" buttons that publish to this reply topic */
  replyTopic?: string;
  priority?: 1 | 2 | 3 | 4 | 5;
}

export type FetchLike = (url: string, init?: any) => Promise<{ ok: boolean; status: number; body?: any; text(): Promise<string> }>;
export const NTFY_BASE = process.env.STANDIN_NTFY_BASE ?? "https://ntfy.sh";

/** The ntfy JSON publish body (docs/UPGRADES.md "Phone alert format"). */
export function buildPayload(topic: string, a: Alert, base = NTFY_BASE) {
  const body: Record<string, unknown> = {
    topic, title: a.title, message: a.message, tags: a.tags ?? ["rotating_light"], priority: a.priority ?? 5,
  };
  if (a.click) body.click = a.click;
  if (a.replyTopic) {
    const url = `${base}/${a.replyTopic}`;
    body.actions = [
      { action: "http", label: "Freeze now", url, method: "POST", body: "freeze", clear: true },
      { action: "http", label: "Ignore", url, method: "POST", body: "ignore", clear: true },
    ];
  }
  return body;
}

/** In-process guard: one push per key, and a hard cap per sliding window (ntfy anonymous limit is 250 per 12 h per IP). */
export class PushGuard {
  private seen = new Set<string>();
  private sent: number[] = [];
  constructor(private max = 60, private windowMs = 12 * 3600_000) {}
  allow(key: string, now = Date.now()): boolean {
    if (this.seen.has(key)) return false;
    this.sent = this.sent.filter((t) => now - t < this.windowMs);
    if (this.sent.length >= this.max) return false;
    this.seen.add(key);
    this.sent.push(now);
    return true;
  }
}
const defaultGuard = new PushGuard();

export interface PublishOpts { fetch?: FetchLike; base?: string; dedupeKey?: string; guard?: PushGuard; timeoutMs?: number }

/** Publish one alert. Never throws; returns true when ntfy accepted it. No topic, a duplicate or an exhausted budget -> false. */
export async function publish(topic: string | undefined, alert: Alert, o: PublishOpts = {}): Promise<boolean> {
  if (!topic) return false;
  if (!(o.guard ?? defaultGuard).allow(`${topic}|${o.dedupeKey ?? alert.title + "|" + alert.message}`)) return false;
  const f = o.fetch ?? (globalThis.fetch as unknown as FetchLike);
  try {
    const r = await f(o.base ?? NTFY_BASE, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(buildPayload(topic, alert, o.base)), signal: AbortSignal.timeout(o.timeoutMs ?? 8000),
    });
    return r.ok;
  } catch {
    return false; // a notify failure never propagates
  }
}
