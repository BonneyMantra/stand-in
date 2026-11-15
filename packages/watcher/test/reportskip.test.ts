import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { generateKey, loadNetworkConfig, readEvents } from "@standin/core";
import { TripHandler } from "../src/trip.ts";

const WATCH = "watch.judge-fresh.testnet", BAIT = "deployer.judge-fresh.testnet", GUARDIAN = "guard.judge-fresh.testnet";
let dir = "";
let methods: string[] = [];

/** The watcher's access-key permission as the chain would report it; every RPC is answered here, nothing leaves the process. */
function chain(permission: unknown) {
  methods = [];
  vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
    const b = JSON.parse(String(init.body));
    methods.push(`${b.method}:${b.params?.request_type ?? ""}`);
    const result = b.params?.request_type === "view_access_key" ? { nonce: 7, permission, block_height: 1, block_hash: "11111111111111111111111111111111" } : {};
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: b.id, result }), { status: 200, headers: { "content-type": "application/json" } });
  }));
}

function handler() {
  const keysDir = path.join(dir, "keys");
  fs.mkdirSync(keysDir, { recursive: true });
  for (const id of [BAIT, WATCH]) fs.writeFileSync(path.join(keysDir, `${id}.json`), JSON.stringify({ account_id: id, private_key: generateKey().secret_key }));
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({
    network: "testnet", accounts: { agent: GUARDIAN, project: "p.testnet", decoy: BAIT, watcher: WATCH, registry: "reg.testnet", intents: "i.testnet", attacker: "a.testnet" },
  }));
  return new TripHandler(loadNetworkConfig(path.join(dir, "config.json")), dir) as any;
}
const tx = { hash: "H1", signer_id: BAIT, public_key: "ed25519:x", receiver_id: "thief.testnet", actions: [] };
const skipped = () => readEvents({ type: "tool_call" }, dir).filter((e: any) => e.outcome === "report_skipped_function_call_key");

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "si-rs-")); delete process.env.STANDIN_NO_REPORT; });
afterEach(() => { vi.unstubAllGlobals(); fs.rmSync(dir, { recursive: true, force: true }); });

it("skips the blocklist report when the watcher's key is a function-call key: a ledger event each time, one chain read", async () => {
  chain({ FunctionCall: { allowance: null, receiver_id: GUARDIAN, method_names: ["freeze"] } });
  const h = handler();
  await h.reportToRegistry(tx, "thief.testnet");
  await h.reportToRegistry({ ...tx, hash: "H2" }, "thief.testnet");
  expect(skipped().map((e: any) => e.trip_tx_hash)).toEqual(["H1", "H2"]);
  expect(methods.filter((m) => m === "query:view_access_key")).toHaveLength(1); // cached after the first read
  expect(methods.every((m) => m === "query:view_access_key")).toBe(true); // no balance read, no report broadcast
});

it("does not treat a full-access watcher key as function-call", async () => {
  chain("FullAccess");
  expect(await handler().holdsFunctionCallKey()).toBe(false);
});
