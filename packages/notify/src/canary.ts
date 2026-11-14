/** A Thinkst Canarytokens webhook body: JSON with `canarytoken` (older) / `token` and `memo`, plus src_ip, channel, time. */
export interface CanaryHit { token: string; memo: string; src_ip?: string; channel?: string; time?: string }

/** Returns the hit when an ntfy message body is a Canarytokens webhook, otherwise null. Stand-in's own alerts are plain text and never match. */
export function parseCanary(message: string | undefined): CanaryHit | null {
  if (!message || message[0] !== "{") return null;
  let j: any;
  try { j = JSON.parse(message); } catch { return null; }
  if (!j || typeof j !== "object") return null;
  const token = j.canarytoken ?? j.token;
  if (typeof token !== "string" && typeof j.memo !== "string") return null;
  if (typeof token !== "string" && !("src_ip" in j) && !("channel" in j) && !("manage_url" in j)) return null;
  return {
    token: String(token ?? ""), memo: String(j.memo ?? ""),
    src_ip: j.src_ip ? String(j.src_ip) : undefined, channel: j.channel ? String(j.channel) : undefined, time: j.time ? String(j.time) : undefined,
  };
}
