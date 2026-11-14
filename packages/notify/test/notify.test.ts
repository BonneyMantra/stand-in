import { describe, expect, it } from "vitest";
import { PushGuard, buildPayload, parseCanary, publish, subscribe } from "../src/index.ts";

const sink = () => { const calls: any[] = []; return { calls, fetch: async (_u: string, init: any) => { calls.push(JSON.parse(init.body)); return { ok: true, status: 200, text: async () => "" }; } }; };

describe("publish", () => {
  it("builds the UPGRADES.md payload with Freeze now / Ignore buttons", () => {
    const p: any = buildPayload("t1", { title: "x", message: "y", replyTopic: "r1", click: "https://e/x" });
    expect(p).toMatchObject({ topic: "t1", priority: 5, click: "https://e/x" });
    expect(p.actions.map((a: any) => [a.label, a.body, a.method, a.url])).toEqual([
      ["Freeze now", "freeze", "POST", "https://ntfy.sh/r1"], ["Ignore", "ignore", "POST", "https://ntfy.sh/r1"]]);
  });
  it("no topic -> no request; no reply topic -> no actions (lab topic is read-only)", async () => {
    const s = sink();
    expect(await publish(undefined, { title: "a", message: "b" }, { fetch: s.fetch })).toBe(false);
    expect(await publish("t", { title: "a", message: "b" }, { fetch: s.fetch, guard: new PushGuard() })).toBe(true);
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0].actions).toBeUndefined();
  });
  it("one push per event key and a hard budget", async () => {
    const s = sink(); const guard = new PushGuard(2);
    const go = (k: string) => publish("t", { title: "a", message: "b" }, { fetch: s.fetch, guard, dedupeKey: k });
    expect(await go("e1")).toBe(true);
    expect(await go("e1")).toBe(false);
    expect(await go("e2")).toBe(true);
    expect(await go("e3")).toBe(false);
    expect(s.calls).toHaveLength(2);
  });
  it("a failing ntfy never throws", async () => {
    expect(await publish("t", { title: "a", message: "b" }, { guard: new PushGuard(), fetch: async () => { throw new Error("down"); } })).toBe(false);
  });
});

describe("subscribe", () => {
  const stream = (lines: string[]) => ({ ok: true, status: 200, text: async () => "", body: (async function* () { for (const l of lines) yield new TextEncoder().encode(l); })() });
  it("streams messages across chunks, skips keepalives, reconnects with backoff and resumes after the last id", async () => {
    const ac = new AbortController(); const urls: string[] = []; const got: string[] = [];
    let n = 0;
    const f: any = async (u: string) => {
      urls.push(u); n++;
      if (n === 1) return stream(['{"event":"open"}\n{"id":"a1","event":"mess', 'age","message":"freeze"}\n{"event":"keepalive"}\n']);
      if (n === 2) throw new Error("network down");
      if (n === 3) return stream(['{"id":"b2","event":"message","message":"ignore"}\n']);
      ac.abort(); return stream([]);
    };
    await subscribe("topicX", (m) => { got.push(m.message!); }, { fetch: f, signal: ac.signal, minDelayMs: 1, maxDelayMs: 4 });
    expect(got).toEqual(["freeze", "ignore"]);
    expect(urls[2]).toContain("since=a1");
    expect(urls.every((u) => u.includes("/topicX/json"))).toBe(true);
  });
  it("no topic -> returns immediately", async () => { await subscribe(undefined, () => { throw new Error("no"); }); });
});

describe("parseCanary", () => {
  it("accepts a Canarytokens webhook body and rejects our own alerts", () => {
    const hit = parseCanary(JSON.stringify({ channel: "HTTP", token: "abc123", memo: "standin session 7f3a", src_ip: "1.2.3.4", time: "2026-11-14 10:00:00 (UTC)" }));
    expect(hit).toMatchObject({ token: "abc123", memo: "standin session 7f3a", src_ip: "1.2.3.4" });
    expect(parseCanary("Decoy used on chain: si-attacker.testnet")).toBeNull();
    expect(parseCanary("freeze")).toBeNull();
    expect(parseCanary('{"foo":1}')).toBeNull();
  });
});
