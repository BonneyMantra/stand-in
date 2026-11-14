import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkOnChain, parseAccount } from "../src/components/landing/blocklist-check.ts";

const THIEF = "si-w2atk-25769.testnet";
const REGISTRY = "blocklist.si-ol-25769.testnet";

type Call = { url: string; method: string; params: Record<string, unknown> };
let calls: Call[] = [];

/** A fake RPC: `answer` maps one JSON-RPC request to a result, an error, or a network failure. */
function stubRpc(answer: (c: Call) => { result?: unknown; error?: unknown } | "network") {
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { method: string; params: Record<string, unknown> };
    const c = { url, method: body.method, params: body.params };
    calls.push(c);
    const a = answer(c);
    if (a === "network") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: "verify", ...a }), { status: 200 });
  });
}

const viewResult = (v: unknown) => ({ result: { result: [...new TextEncoder().encode(JSON.stringify(v))], block_height: 1 } });
const unknownAccount = { error: { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_ACCOUNT" }, message: "Server error" } };

beforeEach(() => {
  calls = [];
});
afterEach(() => vi.unstubAllGlobals());

describe("landing blocklist check: input", () => {
  it("empty or blank input asks for an account", () => {
    expect(parseAccount("")).toEqual({ ok: false, verdict: { kind: "empty" } });
    expect(parseAccount("   ")).toEqual({ ok: false, verdict: { kind: "empty" } });
  });
  it("rejects what is not a NEAR account id", () => {
    expect(parseAccount("Bad Account!")).toEqual({ ok: false, verdict: { kind: "invalid", input: "Bad Account!" } });
    expect(parseAccount("a")).toMatchObject({ ok: false });
    expect(parseAccount("x".repeat(65))).toMatchObject({ ok: false });
  });
  it("trims and lowercases a valid id", () => {
    expect(parseAccount("  SI-W2ATK-25769.TESTNET ")).toEqual({ ok: true, account: THIEF });
  });
});

describe("landing blocklist check: chain", () => {
  it("asks the registry's check view on drpc first", async () => {
    stubRpc(() => viewResult({ verdict: "block", reasons: ["drained"] }));
    await checkOnChain(THIEF);
    expect(calls[0].url).toBe("https://near-testnet.drpc.org");
    expect(calls[0].params).toMatchObject({ request_type: "call_function", account_id: REGISTRY, method_name: "check" });
  });
  it("the recorded thief listed on chain shows the full recorded proof, marked live", async () => {
    stubRpc(() => viewResult({ verdict: "block", reasons: ["drained"] }));
    expect(await checkOnChain(THIEF)).toEqual({ kind: "block", live: true });
  });
  it("another listed account shows the registry's own reason", async () => {
    stubRpc(() => viewResult({ verdict: "block", reasons: ["received funds from a decoy key", "attested"] }));
    expect(await checkOnChain("si-attacker-5289.testnet")).toEqual({
      kind: "listed", account: "si-attacker-5289.testnet", reason: "received funds from a decoy key; attested",
    });
  });
  it("an unlisted account that exists is clear", async () => {
    stubRpc((c) => (c.params.request_type === "view_account" ? { result: { amount: "1" } } : viewResult({ verdict: "allow", reasons: [] })));
    expect(await checkOnChain("si-project-5289.testnet")).toEqual({ kind: "clear", account: "si-project-5289.testnet", exists: true });
  });
  it("an unknown account is a warn, read from one node only", async () => {
    stubRpc((c) => (c.params.request_type === "view_account" ? unknownAccount : viewResult({ verdict: "allow", reasons: [] })));
    expect(await checkOnChain("nobody-xyz-123.testnet")).toEqual({ kind: "clear", account: "nobody-xyz-123.testnet", exists: false });
    expect(calls.filter((c) => c.params.request_type === "view_account")).toHaveLength(1);
  });
  it("no RPC answering is unreachable, except the recorded thief which falls back to the recorded entry", async () => {
    stubRpc(() => "network");
    expect(await checkOnChain("si-project-5289.testnet")).toEqual({ kind: "unreachable", account: "si-project-5289.testnet" });
    expect(await checkOnChain(THIEF)).toEqual({ kind: "block", live: false });
  });
});
