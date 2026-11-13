import type { DecoyKey, Exposure, Session, StandinState, Trip } from "./types";

export type DecoyStatus = "dormant" | "exposed" | "tripped";

export const NEARBLOCKS = "https://testnet.nearblocks.io";
export const txUrl = (hash: string) => `${NEARBLOCKS}/txns/${hash}`;
export const accountUrl = (id: string) => `${NEARBLOCKS}/address/${id}`;
export const blockUrl = (h: number) => `${NEARBLOCKS}/blocks/${h}`;

export function decoyStatus(s: StandinState, pk: string): DecoyStatus {
  if (s.trips.some((t) => t.decoy_public_key === pk)) return "tripped";
  if (s.exposures.some((e) => e.decoy_public_key === pk)) return "exposed";
  return "dormant";
}

export function statusMap(s: StandinState): Map<string, DecoyStatus> {
  const m = new Map<string, DecoyStatus>();
  for (const k of s.decoy.keys) m.set(k.public_key, "dormant");
  for (const e of s.exposures) m.set(e.decoy_public_key, "exposed");
  for (const t of s.trips) m.set(t.decoy_public_key, "tripped");
  return m;
}

/** A freeze whose block is not after the trip block means the account was already frozen. */
export const alreadyFrozen = (t: Trip) => t.freeze.blocks_after_trip <= 0 && t.freeze.block_height > 0;

export function medianBlocks(s: StandinState): number | null {
  const v = s.trips.map((t) => t.freeze.blocks_after_trip).filter((b) => b > 0).sort((a, b) => a - b);
  if (v.length) return v[Math.floor((v.length - 1) / 2)];
  return s.bench.median_blocks_to_freeze > 0 ? s.bench.median_blocks_to_freeze : null;
}

export function sessionOf(s: StandinState, id: string): Session | undefined {
  return s.sessions.find((x) => x.session_id === id);
}

export function exposuresFor(s: StandinState, sessionId: string): Exposure[] {
  return s.exposures.filter((e) => e.session_id === sessionId);
}

export function decoysFor(s: StandinState, sessionId: string): DecoyKey[] {
  return s.decoy.keys.filter((k) => k.planted.session_id === sessionId);
}

/** Recorded runs know which bench route a session belonged to; live sessions show their cwd. */
export function sessionLabel(s: StandinState, id: string): string {
  const route = s.recorded?.session_routes[id];
  if (route) return route;
  const sess = sessionOf(s, id);
  const base = sess?.cwd.split("/").filter(Boolean).at(-1);
  return base ? `${base} · ${id.slice(0, 8)}` : id ? id.slice(0, 8) : "standin adopt";
}

export function tripTime(s: StandinState, t: Trip): string | undefined {
  return s.recorded?.trip_times[t.tx_hash];
}

// ── formatting ──

export function shortKey(pk: string, head = 6, tail = 4): string {
  const raw = pk.replace(/^ed25519:/, "");
  if (raw.length <= head + tail + 1) return raw;
  return `${raw.slice(0, head)}…${raw.slice(-tail)}`;
}

export const shortHash = (h: string) => (h.length > 12 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h);

export function yoctoToNear(y: string): string {
  try {
    const v = BigInt(y || "0");
    const whole = v / 10n ** 24n;
    const frac = ((v % 10n ** 24n) / 10n ** 20n).toString().padStart(4, "0");
    return `${whole}.${frac}`;
  } catch {
    return "0";
  }
}

const tz = (() => {
  try {
    return new Intl.DateTimeFormat(undefined, { timeZoneName: "short" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
})();

export function fmtTime(iso: string, withZone = false): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "–";
  const t = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  return withZone && tz ? `${t} ${tz}` : t;
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "–";
  const day = d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  return tz ? `${day}, ${fmtTime(iso)} ${tz}` : `${day}, ${fmtTime(iso)}`;
}

export function agentName(a: string): string {
  if (a === "claude-code") return "Claude Code";
  if (a === "codex") return "Codex";
  if (a === "manual") return "standin adopt";
  return a || "unknown";
}

export const KIND_LABEL: Record<string, string> = {
  "near-credentials": "~/.near-credentials",
  dotenv: ".env",
  "shell-history": "shell history",
  "session-env": "session env",
};

/** Bins ISO timestamps into n buckets across their own span, for sparklines. */
export function histogram(times: string[], n = 24): number[] {
  const ts = times.map((t) => new Date(t).getTime()).filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
  const out = new Array<number>(n).fill(0);
  if (!ts.length) return out;
  const lo = ts[0];
  const span = Math.max(1, ts[ts.length - 1] - lo);
  for (const t of ts) out[Math.min(n - 1, Math.floor(((t - lo) / span) * n))] += 1;
  return out;
}

export type Attestation = { state: "attested" | "listed" | "pending"; entry?: StandinState["blocklist"][number] };

/** Attested when the registry holds an entry whose evidence is this trip; "listed" when the
 *  attacker is already blocklisted through another trip; otherwise pending. */
export function tripAttestation(s: StandinState, t: Trip): Attestation {
  const real = s.blocklist.filter((b) => b.account_id === t.attacker_account && b.attested_at && !b.preview);
  const own = real.find((b) => b.evidence_tx === t.tx_hash);
  if (own || t.blocklist.attested) return { state: "attested", entry: own ?? real[0] };
  if (real.length) return { state: "listed", entry: real[0] };
  return { state: "pending" };
}
