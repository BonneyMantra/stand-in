import { isStepId, type LabConfig, type NtfyPayload, type LabEvent, type RunRecord, type StepEvent } from "./types";

/*
 * Client for the hosted lab API (Cloudflare Pages Functions, docs/UPGRADES.md).
 * The dev-only mock (./mock) is loaded solely when `import.meta.env.DEV` is true AND the API answers 404,
 * i.e. while the backend is not running locally. Vite replaces `import.meta.env.DEV` with `false` in a
 * production build, so the mock branch and its chunk are dropped from the bundle entirely.
 */

export type RunOutcome =
  | { kind: "streamed"; ended: "done" | "error" | "dropped"; mock: boolean }
  | { kind: "busy"; retryAfterS: number }
  | { kind: "rate_limited"; retryAfterS: number }
  | { kind: "unavailable"; status: number }
  | { kind: "network" }
  | { kind: "aborted" };

function parseEvent(name: string, raw: string): LabEvent | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (name === "step" && isStepId(d.step) && typeof d.status === "string") return { type: "step", data: d as unknown as StepEvent };
  if (name === "done") return { type: "done", data: { run_id: String(d.run_id ?? ""), blocks_to_freeze: typeof d.blocks_to_freeze === "number" ? d.blocks_to_freeze : null } };
  if (name === "error") return { type: "error", data: { error: String(d.error ?? "unknown error") } };
  return null;
}

/** Reads a text/event-stream body block by block. Resolves with how the stream ended. */
async function readStream(body: ReadableStream<Uint8Array>, onEvent: (e: LabEvent) => void): Promise<"done" | "error" | "dropped"> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += dec.decode(value, { stream: true });
    const blocks = buf.split(/\r?\n\r?\n/);
    buf = blocks.pop() ?? "";
    for (const block of blocks) {
      let name = "message";
      const data: string[] = [];
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith("event:")) name = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      const ev = data.length ? parseEvent(name, data.join("\n")) : null;
      if (!ev) continue;
      onEvent(ev);
      if (ev.type !== "step") {
        await reader.cancel().catch(() => undefined);
        return ev.type;
      }
    }
    if (done) return "dropped";
  }
}

async function errorBody(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function startRun(onEvent: (e: LabEvent) => void, signal: AbortSignal): Promise<RunOutcome> {
  let res: Response;
  try {
    res = await fetch("/api/lab/run", { method: "POST", headers: { accept: "text/event-stream" }, signal });
  } catch {
    return signal.aborted ? { kind: "aborted" } : { kind: "network" };
  }
  if (import.meta.env.DEV && res.status === 404) {
    const { replayMockRun, mockScenario } = await import("./mock");
    const sc = mockScenario();
    if (sc === "busy") return { kind: "busy", retryAfterS: 20 };
    if (sc === "429") return { kind: "rate_limited", retryAfterS: 90 };
    if (sc === "network") return { kind: "network" };
    const ended = await replayMockRun(onEvent, signal);
    return signal.aborted ? { kind: "aborted" } : { kind: "streamed", ended, mock: true };
  }
  if (res.status === 409 || res.status === 429) {
    const b = await errorBody(res);
    const retryAfterS = typeof b.retry_after_s === "number" ? Math.max(1, Math.ceil(b.retry_after_s)) : 0;
    return res.status === 409 ? { kind: "busy", retryAfterS: retryAfterS || 30 } : { kind: "rate_limited", retryAfterS };
  }
  if (!res.ok || !res.body || !(res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    return { kind: "unavailable", status: res.status };
  }
  try {
    const ended = await readStream(res.body, onEvent);
    return { kind: "streamed", ended, mock: false };
  } catch {
    return signal.aborted ? { kind: "aborted" } : { kind: "streamed", ended: "dropped", mock: false };
  }
}

export type Fetched<T> = { ok: true; data: T; mock: boolean } | { ok: false; status: number };

async function getJson<T>(url: string, valid: (b: unknown) => b is T, mockKey: "runs" | "config"): Promise<Fetched<T>> {
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (import.meta.env.DEV && res.status === 404) {
      const m = await import("./mock");
      return { ok: true, data: (mockKey === "runs" ? m.mockRuns() : m.mockConfig()) as T, mock: true };
    }
    if (!res.ok) return { ok: false, status: res.status };
    const body: unknown = await res.json();
    return valid(body) ? { ok: true, data: body, mock: false } : { ok: false, status: 502 };
  } catch {
    return { ok: false, status: 0 };
  }
}

const isRuns = (b: unknown): b is { runs: RunRecord[] } => !!b && typeof b === "object" && Array.isArray((b as { runs?: unknown }).runs);
const isConfig = (b: unknown): b is LabConfig => !!b && typeof b === "object" && typeof (b as LabConfig).accounts === "object";

export const fetchRuns = (limit = 10) => getJson(`/api/lab/runs?limit=${limit}`, isRuns, "runs");

export const fetchConfig = () => getJson("/api/lab/config", isConfig, "config");

/**
 * ntfy.sh refuses connections from Cloudflare Workers, so a failed server-side `notify` hands its payload
 * to the browser (docs/UPGRADES.md, "API changes (W9)"). JSON publish to the root URL: a text/plain POST,
 * so no CORS preflight.
 */
export async function publishNtfy(p: NtfyPayload): Promise<boolean> {
  try {
    const res = await fetch("https://ntfy.sh/", {
      method: "POST",
      body: JSON.stringify({ topic: p.topic, title: p.title, message: p.message, click: p.click, priority: 5, tags: ["rotating_light"] }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
