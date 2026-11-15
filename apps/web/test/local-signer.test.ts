import { createRequire } from "node:module";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { encodeTransaction, firstFailure, sendLocalTx, signTransaction, type LocalAction, type LocalTx } from "../src/lib/wallet/localSigner.ts";
import { base58Decode, generateKeyPair, publicKeyBytes } from "../src/lib/wallet/keys.ts";

// near-api-js belongs to packages/core only; load it from there as the reference encoder.
const near = createRequire(path.join(import.meta.dirname, "../../../packages/core/package.json"))("near-api-js");

const signer = generateKeyPair();
const other = generateKeyPair().public_key;
const blockHash = sha256(new TextEncoder().encode("block"));

const cases: [string, LocalAction, () => unknown][] = [
  ["AddKey full access", { type: "AddKey", publicKey: other, permission: "FullAccess" }, () => near.actions.addFullAccessKey(near.PublicKey.from(other))],
  ["AddKey function-call with allowance", { type: "AddKey", publicKey: other, permission: { receiverId: "g.testnet", methodNames: ["freeze", "report"], allowance: 250_000_000_000_000_000_000_000n } },
    () => near.actions.addFunctionCallAccessKey(near.PublicKey.from(other), "g.testnet", ["freeze", "report"], 250_000_000_000_000_000_000_000n)],
  ["AddKey function-call without allowance", { type: "AddKey", publicKey: other, permission: { receiverId: "g.testnet", methodNames: ["freeze"], allowance: null } },
    () => near.actions.addFunctionCallAccessKey(near.PublicKey.from(other), "g.testnet", ["freeze"])],
  ["AddKey function-call with no methods", { type: "AddKey", publicKey: other, permission: { receiverId: "g.testnet", methodNames: [], allowance: null } },
    () => near.actions.addFunctionCallAccessKey(near.PublicKey.from(other), "g.testnet", [])],
  ["DeleteKey", { type: "DeleteKey", publicKey: other }, () => near.actions.deleteKey(near.PublicKey.from(other))],
  ["FunctionCall with JSON args", { type: "FunctionCall", methodName: "freeze", args: { reason: "decoy key signed é", decoy_public_key: null, tx_hash: "abc" }, gas: 100_000_000_000_000n, deposit: 1n },
    () => near.actions.functionCall("freeze", { reason: "decoy key signed é", decoy_public_key: null, tx_hash: "abc" }, 100_000_000_000_000n, 1n)],
  ["FunctionCall with raw bytes", { type: "FunctionCall", methodName: "raw", args: Uint8Array.of(1, 2, 3), gas: 5n, deposit: 0n }, () => near.actions.functionCall("raw", Uint8Array.of(1, 2, 3), 5n, 0n)],
  ["Transfer", { type: "Transfer", deposit: 200_000_000_000_000_000_000_000n }, () => near.actions.transfer(200_000_000_000_000_000_000_000n)],
  ["DeleteAccount", { type: "DeleteAccount", beneficiaryId: "deployer.judge.testnet" }, () => near.actions.deleteAccount("deployer.judge.testnet")],
];

const tx = (actions: LocalAction[], nonce = 123_456_789_012n): LocalTx => ({ signerId: "deployer.judge.testnet", publicKey: signer.public_key, nonce, receiverId: "g.testnet", blockHash, actions });
const reference = (a: unknown[], nonce = 123_456_789_012n) => near.createTransaction("deployer.judge.testnet", near.PublicKey.from(signer.public_key), "g.testnet", nonce, a, blockHash);

describe("encoding matches near-api-js", () => {
  for (const [name, action, ref] of cases) {
    it(`${name}: bytes, hash and signature`, async () => {
      const mine = signTransaction(tx([action]), signer.secret_key);
      const theirs = reference([ref()]);
      expect(Buffer.from(encodeTransaction(tx([action])))).toEqual(Buffer.from(theirs.encode()));
      const r = await near.KeyPairSigner.fromSecretKey(signer.secret_key).signTransaction(theirs);
      expect(mine.hash).toBe(near.baseEncode(r.txHash));
      expect(Buffer.from(mine.signed)).toEqual(Buffer.from(r.signedTransaction.encode()));
      // the signature verifies against the signer's public key over sha256(encoded tx)
      const encoded = encodeTransaction(tx([action]));
      const sig = mine.signed.slice(encoded.length + 1);
      expect(mine.signed[encoded.length]).toBe(0);
      expect(ed25519.verify(sig, sha256(encoded), publicKeyBytes(signer.public_key))).toBe(true);
    });
  }

  it("several actions in one transaction, as the owner console sends them", async () => {
    const acts = cases.map((c) => c[1]);
    const theirs = reference(cases.map((c) => c[2]()));
    expect(Buffer.from(encodeTransaction(tx(acts)))).toEqual(Buffer.from(theirs.encode()));
  });

  it("refuses values that do not fit and a short block hash", () => {
    expect(() => encodeTransaction(tx([{ type: "Transfer", deposit: 1n << 128n }]))).toThrow(/does not fit/);
    expect(() => encodeTransaction({ ...tx([]), blockHash: new Uint8Array(31) })).toThrow(/32 bytes/);
  });
});

describe("failure text", () => {
  const panic = { Failure: { ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: only the watcher can freeze" } } } } };
  it("reduces a contract panic to its message, from the status or from a receipt", () => {
    expect(firstFailure({ status: panic })).toBe("only the watcher can freeze");
    expect(firstFailure({ status: { SuccessReceiptId: "x" }, receipts_outcome: [{ outcome: { status: { SuccessValue: "" } } }, { outcome: { status: panic } }] })).toBe("only the watcher can freeze");
  });
  it("ignores the failed gas refund to an account the transaction deleted, and nothing else", () => {
    const gone = "thief-1.judge.testnet";
    const refund = { outcome: { executor_id: gone, status: { Failure: { ActionError: { index: 0, kind: { AccountDoesNotExist: { account_id: gone } } } } } } };
    const tx = { receiver_id: gone, actions: [{ DeleteAccount: { beneficiary_id: "deployer.judge.testnet" } }] };
    expect(firstFailure({ status: { SuccessValue: "" }, transaction: tx, receipts_outcome: [{ outcome: { executor_id: gone, status: { SuccessValue: "" } } }, refund] })).toBeUndefined();
    // the same outcome without the transaction (the lab's regression fixture shape): still a success
    expect(firstFailure({ status: { SuccessValue: "" }, transaction: {}, receipts_outcome: [{ outcome: { status: { Failure: { ActionError: { kind: { AccountDoesNotExist: {} } } } } } }] })).toBeUndefined();
    // a transfer to a missing account is a real failure
    expect(firstFailure({ status: { Failure: { ActionError: { index: 0, kind: { AccountDoesNotExist: { account_id: "nobody.testnet" } } } } } })).toContain("AccountDoesNotExist");
    // without a DeleteAccount, a failing receipt on another account still counts
    expect(firstFailure({ status: { SuccessValue: "" }, transaction: { receiver_id: "g.testnet", actions: [{ Transfer: { deposit: "1" } }] }, receipts_outcome: [{ outcome: { executor_id: "x.testnet", status: { Failure: { ActionError: { index: 0, kind: { AccountDoesNotExist: { account_id: "x.testnet" } } } } } } }] })).toContain("AccountDoesNotExist");
  });

  it("reports no failure on success and keeps non-panic failures readable", () => {
    expect(firstFailure({ status: { SuccessValue: "" }, receipts_outcome: [{ outcome: { status: { SuccessValue: "" } } }] })).toBeUndefined();
    expect(firstFailure({ status: { Failure: { ActionError: { index: 0, kind: { LackBalanceForState: { account_id: "a", amount: "5" } } } } } })).toContain("LackBalanceForState");
  });
});

describe("sendLocalTx (fetch stubbed, no network)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const reply = (result: unknown, error?: unknown) => ({ ok: true, json: async () => (error ? { error } : { result }) });
  const sendBody = (calls: unknown[][]) => calls.map((c) => JSON.parse(String((c[1] as RequestInit).body))).filter((b) => b.method === "send_tx");

  // rpc() tries every endpoint when one answers with an error, so an error answer is consumed three times.
  const x3 = <T,>(r: T) => [r, r, r];
  const unknownTx = reply(undefined, { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_TRANSACTION" } });
  /** `sends`: answers to send_tx in order; `found`: what a lookup by hash (method tx) answers (default: unknown). */
  function chain(opts: { key: unknown; sends: unknown[]; found?: unknown }) {
    const sends = [...opts.sends];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const b = JSON.parse(String(init.body));
      if (b.method === "block") return reply({ header: { hash: near.baseEncode(blockHash) } });
      if (b.method === "query") return opts.key === null ? reply(undefined, { cause: { name: "UNKNOWN_ACCESS_KEY" }, message: "access key does not exist" }) : reply(opts.key);
      if (b.method === "tx") return (opts.found ?? unknownTx) as ReturnType<typeof reply>;
      const next = sends.shift();
      if (next instanceof Error) throw next;
      return next as ReturnType<typeof reply>;
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  const calls = (f: ReturnType<typeof chain>, method: string) => f.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body))).filter((b) => b.method === method);
  const o = { signerId: "deployer.judge.testnet", secretKey: signer.secret_key, receiverId: "g.testnet", actions: [{ type: "Transfer", deposit: 1n } as LocalAction], lookup: { tries: 2, waitMs: 1 } };

  it("signs with nonce+1 and returns the hash", async () => {
    const f = chain({ key: { nonce: 41, permission: "FullAccess" }, sends: [reply({ status: { SuccessValue: "" }, receipts_outcome: [] })] });
    const r = await sendLocalTx(o);
    const sent = sendBody(f.mock.calls)[0];
    expect(sent.params.wait_until).toBe("EXECUTED_OPTIMISTIC");
    const expected = signTransaction({ ...tx(o.actions, 42n), signerId: o.signerId }, signer.secret_key);
    expect(r.hash).toBe(expected.hash);
    expect(sent.params.signed_tx_base64).toBe(Buffer.from(expected.signed).toString("base64"));
    expect(r.failure).toBeUndefined();
  });

  it("retries once on InvalidNonce, then reports a contract failure", async () => {
    const f = chain({ key: { nonce: 1, permission: "FullAccess" }, sends: [
      ...x3(reply(undefined, { name: "HANDLER_ERROR", cause: { name: "INVALID_TRANSACTION", info: { InvalidNonce: { tx_nonce: 2, ak_nonce: 9 } } } })),
      reply({ status: { Failure: { ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: already frozen" } } } } }, receipts_outcome: [] }),
    ] });
    const r = await sendLocalTx(o);
    expect(sendBody(f.mock.calls)).toHaveLength(4);
    expect(r.failure).toBe("already frozen");
  });

  it("does not retry twice, and names a key that is not on the account", async () => {
    chain({ key: null, sends: [] });
    await expect(sendLocalTx(o)).rejects.toThrow(/is not an access key on deployer\.judge\.testnet/);
    const f = chain({ key: { nonce: 1, permission: "FullAccess" }, sends: x3(reply(undefined, { cause: { info: { InvalidNonce: {} } } })).concat(x3(reply(undefined, { cause: { info: { InvalidNonce: {} } } }))) });
    await expect(sendLocalTx(o)).rejects.toThrow(/InvalidNonce/);
    expect(sendBody(f.mock.calls)).toHaveLength(6); // two attempts of three endpoints, never a third attempt
  });

  it("a lost answer is looked up by hash, never sent again (the transaction had landed)", async () => {
    const landed = { status: { SuccessValue: "" }, receipts_outcome: [] };
    const f = chain({ key: { nonce: 7, permission: "FullAccess" }, sends: x3(new TypeError("Failed to fetch")), found: reply(landed) });
    const r = await sendLocalTx(o);
    expect(r.failure).toBeUndefined();
    expect(calls(f, "send_tx").map((b) => b.params.signed_tx_base64).every((b, _i, a) => b === a[0])).toBe(true);
    expect(calls(f, "block")).toHaveLength(1); // signed once
    expect(calls(f, "tx")[0].params.tx_hash).toBe(r.hash);
  });

  it("SignerDoesNotExist after a DeleteAccount that already applied: found by hash, reported as landed", async () => {
    const del = { ...o, receiverId: o.signerId, actions: [{ type: "DeleteAccount", beneficiaryId: "deployer.judge.testnet" } as LocalAction] };
    const landed = {
      status: { SuccessValue: "" }, transaction: { receiver_id: o.signerId, actions: [{ DeleteAccount: { beneficiary_id: "deployer.judge.testnet" } }] },
      receipts_outcome: [
        { outcome: { executor_id: o.signerId, status: { SuccessValue: "" } } },
        { outcome: { executor_id: o.signerId, status: { Failure: { ActionError: { index: 0, kind: { AccountDoesNotExist: { account_id: o.signerId } } } } } } },
      ],
    };
    const f = chain({ key: { nonce: 7, permission: "FullAccess" }, sends: [reply(undefined, { name: "HANDLER_ERROR", cause: { name: "INVALID_TRANSACTION", info: { SignerDoesNotExist: { signer_id: o.signerId } } }, data: "Signer deployer.judge.testnet does not exist" })], found: reply(landed) });
    const r = await sendLocalTx(del);
    expect(r.failure).toBeUndefined();
    expect(calls(f, "block")).toHaveLength(1);
  });

  it("a lost answer with nothing on chain under its hash: the original error, no second signature", async () => {
    const f = chain({ key: { nonce: 7, permission: "FullAccess" }, sends: x3(new TypeError("Failed to fetch")) });
    await expect(sendLocalTx(o)).rejects.toThrow(/Failed to fetch/);
    expect(calls(f, "block")).toHaveLength(1);
    expect(calls(f, "tx").length).toBeGreaterThan(0);
  });

  it("base58 round trip of the block hash used here", () => {
    expect(Buffer.from(base58Decode(near.baseEncode(blockHash)))).toEqual(Buffer.from(blockHash));
  });
});
