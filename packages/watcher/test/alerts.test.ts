import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { appendEvent, loadNetworkConfig, readEvents } from "@standin/core";
import { alertFor, startAlerts } from "../src/alerts.ts";

const cfg = loadNetworkConfig();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const home = () => fs.mkdtempSync(path.join(os.tmpdir(), "si-al-"));
const ok = { ok: true, status: 200, text: async () => "" };
const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o) + "\n");

it("maps trip / freeze / incident_report to phone alerts", () => {
  const t: any = alertFor({ type: "trip", at: "", tx_hash: "H1", attacker_account: "thief.testnet", block_height: 5 }, cfg, "rep");
  expect(t.alert.message).toBe("Decoy used on chain: thief.testnet");
  expect(t.alert.replyTopic).toBe("rep");
  const f: any = alertFor({ type: "freeze", at: "", freeze: { tx_hash: "H2", blocks_after_trip: 3, deleted_keys: ["k"], intents_keys_removed: [] } }, cfg);
  expect(f.alert.message).toBe("Frozen in 3 blocks: 1 agent keys deleted, intents keys removed");
  expect(alertFor({ type: "incident_report", at: "", trip_tx_hash: "H1", report: { summary: "s" } }, cfg)!.alert.title).toMatch(/Incident/);
  expect(alertFor({ type: "bench", at: "" }, cfg)).toBeNull();
});

it("pushes each ledger event once", async () => {
  const h = home(); const posts: any[] = [];
  const a = startAlerts({ cfg, home: h, handler: { manualFreeze: async () => null }, pollMs: 20, env: { STANDIN_NTFY_TOPIC: "tt" },
    fetch: (async (_u: string, init: any) => { if (init?.body) posts.push(JSON.parse(init.body)); else await new Promise(() => {}); return ok; }) as any });
  appendEvent("trip", { tx_hash: "H1", attacker_account: "thief.testnet", block_height: 5 }, h);
  appendEvent("freeze", { freeze: { tx_hash: "H2", blocks_after_trip: 2, deleted_keys: ["k"], intents_keys_removed: [] } }, h);
  await sleep(200); a.stop();
  expect(posts.map((p) => p.title)).toEqual(["Decoy key used", "Account frozen"]);
});

it("reply topic: freeze calls the manual freeze path, ignore is recorded", async () => {
  const h = home(); const reasons: string[] = [];
  const msgs = [{ id: "1", event: "message", message: "freeze" }, { id: "2", event: "message", message: "ignore" }];
  const a = startAlerts({ cfg, home: h, handler: { manualFreeze: async (r) => { reasons.push(r); } }, env: { STANDIN_NTFY_REPLY_TOPIC: "rr" },
    fetch: (async () => ({ ...ok, body: (async function* () { for (const m of msgs) yield enc(m); await new Promise(() => {}); })() })) as any });
  await sleep(100); a.stop();
  expect(reasons).toHaveLength(1);
  expect(readEvents({ type: "tool_call" }, h).map((e) => e.outcome)).toEqual(["ignored"]);
});

const canary = JSON.stringify({ channel: "HTTP", token: "abc", memo: "standin s1", src_ip: "9.9.9.9" });
const canaryFetch = (): any => async () => ({ ...ok, body: (async function* () { yield enc({ id: "c1", event: "message", message: canary }); await new Promise(() => {}); })() });

it("canary webhook on the owner topic: ledger event + preemptive freeze", async () => {
  const h = home(); let froze = 0;
  const a = startAlerts({ cfg, home: h, handler: { manualFreeze: async () => { froze++; } }, env: { STANDIN_NTFY_TOPIC: "tt" }, fetch: canaryFetch() });
  await sleep(100); a.stop();
  expect(froze).toBe(1);
  expect(readEvents({ type: "canary" }, h)[0]).toMatchObject({ token: "abc", memo: "standin s1" });
});

it("STANDIN_CANARY_FREEZE=0 records the hit but does not freeze", async () => {
  const h = home(); let froze = 0;
  const a = startAlerts({ cfg, home: h, handler: { manualFreeze: async () => { froze++; } }, env: { STANDIN_NTFY_TOPIC: "tt", STANDIN_CANARY_FREEZE: "0" }, fetch: canaryFetch() });
  await sleep(100); a.stop();
  expect(froze).toBe(0);
  expect(readEvents({ type: "canary" }, h)).toHaveLength(1);
});

it("no topics -> inert", async () => {
  let calls = 0;
  const a = startAlerts({ cfg, home: home(), handler: { manualFreeze: async () => null }, env: {}, fetch: (async () => { calls++; return ok; }) as any });
  await sleep(50); a.stop();
  expect(calls).toBe(0);
});
