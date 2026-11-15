import { describe, expect, it } from "vitest";
import { parseDeepLink } from "../src/lib/wallet/deeplink.ts";
import { readOutcome, readableError } from "../src/lib/wallet/connector.ts";

const KEY = "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp";
const ok = { op: "unfreeze", account: "wallet-owner.si-project-5289.testnet", agent_key: KEY, receiver: "si-project-5289.testnet", methods: "record_deploy", allowance: "250000000000000000000000" };
const q = (o: Record<string, string>) => "?" + new URLSearchParams(o).toString();
const problems = (o: Record<string, string>) => { const r = parseDeepLink(q(o)); return r.kind === "invalid" ? r.problems.join(" | ") : r.kind; };

describe("approve-agent-key deep link", () => {
  it("no op is a plain visit", () => expect(parseDeepLink("").kind).toBe("none"));
  it("accepts the CLI's link and decodes it", () => {
    const r = parseDeepLink(q(ok));
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.req.methods).toEqual(["record_deploy"]);
      expect(r.req.allowance).toBe(250000000000000000000000n);
    }
  });
  it("empty methods means any method", () => {
    const r = parseDeepLink(q({ ...ok, methods: "" }));
    expect(r.kind === "ok" && r.req.methods).toEqual([]);
  });
  it("accepts exactly 1 NEAR, refuses more and refuses 0 (unlimited)", () => {
    expect(problems({ ...ok, allowance: "1000000000000000000000000" })).toBe("ok");
    expect(problems({ ...ok, allowance: "1000000000000000000000001" })).toMatch(/above 1 NEAR/);
    expect(problems({ ...ok, allowance: "0" })).toMatch(/unlimited/);
    expect(problems({ ...ok, allowance: "1e24" })).toMatch(/whole number/);
    expect(problems({ ...ok, allowance: "-5" })).toMatch(/whole number/);
  });
  it("refuses bad account ids, keys and method names", () => {
    expect(problems({ ...ok, account: "Wallet-Owner.testnet" })).toMatch(/account/);
    expect(problems({ ...ok, receiver: "a" })).toMatch(/receiver/);
    expect(problems({ ...ok, agent_key: "ed25519:abc" })).toMatch(/agent_key/);
    expect(problems({ ...ok, agent_key: "secp256k1:" + KEY.slice(8) })).toMatch(/agent_key/);
    expect(problems({ ...ok, agent_key: KEY.replace("6", "0") })).toMatch(/agent_key/);
    expect(problems({ ...ok, methods: "record_deploy,<script>" })).toMatch(/not a method name/);
    expect(problems({ ...ok, methods: "a,a" })).toMatch(/repeats/);
    expect(problems({ ...ok, op: "freeze" })).toMatch(/op/);
  });
  it("refuses missing and repeated fields", () => {
    const { receiver: _r, ...rest } = ok;
    expect(problems(rest)).toMatch(/receiver is missing/);
    expect(parseDeepLink(q(ok) + "&account=evil.testnet").kind).toBe("invalid");
  });
});

describe("wallet outcomes and errors", () => {
  it("reads the hash and a contract panic", () => {
    const o = { transaction: { hash: "H1" }, status: { Failure: { ActionError: { kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: owner only" } } } } } };
    expect(readOutcome(o)).toEqual({ hash: "H1", failure: "owner only" });
    expect(readableError(readOutcome(o).failure)).toMatch(/owner only/);
  });
  it("maps wallet rejection and a closed wallet", () => {
    expect(readableError(new Error("User rejected the request"))).toMatch(/rejected/);
    expect(readableError(new Error("Wallet closed"))).toMatch(/closed/);
    // A closed window never claims "nothing was sent": the wallet may have broadcast first; the page then reads the chain.
    const closed = readableError(new Error("User closed the window before completing the action"));
    expect(closed).toMatch(/window closed before it reported a result/);
    expect(closed).not.toMatch(/Nothing was sent/);
    expect(readableError("already frozen")).toBe("The guardian is already frozen.");
  });
  it("names a receipt ActionError instead of showing its JSON (create_guardian with a taken name, live 15 Nov)", () => {
    const o = {
      transaction: { hash: "Anopy4iQQeWwADJyNjzHiUAaJ8FN6DRW87bT3y3PoWio" }, status: { SuccessValue: "bnVsbA==" },
      receipts_outcome: [{ outcome: { status: { Failure: { ActionError: { index: 0, kind: { AccountAlreadyExists: { account_id: "agent-2321.guard.si-project-5289.testnet" } } } } } } }],
    };
    const msg = readableError(readOutcome(o).failure);
    expect(msg).toBe("agent-2321.guard.si-project-5289.testnet already exists on testnet: pick another name. A failed create refunds the deposit; only gas was spent.");
    expect(msg).not.toContain("{");
    expect(readableError('{"Failure":{"ActionError":{"index":0,"kind":{"DeleteKeyDoesNotExist":{}}}}}')).toBe("The transaction failed on chain (DeleteKeyDoesNotExist). Nothing else changed.");
    // create_guardian from an owner whose spendable balance was below the deposit (live, 15 Nov): the RPC's raw refusal
    expect(readableError('{"info":{},"name":"INVALID_TRANSACTION"}')).toMatch(/cannot pay its deposit and gas\. It did not land\./);
  });
});

describe("link built the way the CLI builds it (standin unfreeze --wallet ownerUrl)", () => {
  it("parses encodeURIComponent-joined params, including an empty methods list", () => {
    const e = encodeURIComponent;
    const build = (methods: string[]) => "?" + [["op", "unfreeze"], ["account", ok.account], ["agent_key", KEY], ["receiver", ok.receiver], ["methods", methods.join(",")], ["allowance", "250000000000000000000000"]]
      .map(([a, b]) => `${a}=${e(b!)}`).join("&");
    const two = parseDeepLink(build(["record_deploy", "ping"]));
    expect(two.kind === "ok" && two.req.methods).toEqual(["record_deploy", "ping"]);
    const none = parseDeepLink(build([]));
    expect(none.kind === "ok" && none.req.methods).toEqual([]);
  });
});
