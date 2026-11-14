import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDeepLink, unfreezeLinkFor } from "../src/lib/wallet/deeplink.ts";
import { GUARDIAN_CODE_BYTES, GUARDIAN_CODE_HASH, base58Encode, codeHash, nearShort, quoteStorage } from "../src/lib/wallet/guardianCode.ts";

const KEY = "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp";
const ok = {
  op: "adopt", account: "fresh-owner.si-project-5289.testnet", watcher: "si-watch-5289.testnet", intents: "si-intents-5289.testnet",
  agent_key: KEY, receiver: "si-project-5289.testnet", methods: "record_deploy,ping", allowance: "250000000000000000000000",
};
const q = (o: Record<string, string>) => "?" + new URLSearchParams(o).toString();
const problems = (o: Record<string, string>) => { const r = parseDeepLink(q(o)); return r.kind === "invalid" ? r.problems.join(" | ") : r.kind; };

describe("adopt deep link (standin adopt --wallet)", () => {
  it("accepts the CLI's link and decodes every field", () => {
    const r = parseDeepLink(q(ok));
    expect(r.kind).toBe("adopt");
    if (r.kind !== "adopt") return;
    expect(r.req).toEqual({ ...ok, methods: ["record_deploy", "ping"], allowance: 250000000000000000000000n });
  });
  it("empty methods means any method on the receiver", () => {
    const r = parseDeepLink(q({ ...ok, methods: "" }));
    expect(r.kind === "adopt" && r.req.methods).toEqual([]);
  });
  it("parses encodeURIComponent-joined params", () => {
    const e = encodeURIComponent;
    const r = parseDeepLink("?" + Object.entries(ok).map(([a, b]) => `${a}=${e(b)}`).join("&"));
    expect(r.kind).toBe("adopt");
  });
  it("allowance: 1 yocto and exactly 1 NEAR pass; 0, above 1 NEAR and non-integers are refused", () => {
    expect(problems({ ...ok, allowance: "1" })).toBe("adopt");
    expect(problems({ ...ok, allowance: "1000000000000000000000000" })).toBe("adopt");
    expect(problems({ ...ok, allowance: "1000000000000000000000001" })).toMatch(/above 1 NEAR/);
    expect(problems({ ...ok, allowance: "0" })).toMatch(/unlimited/);
    expect(problems({ ...ok, allowance: "01" })).toMatch(/whole number/);
    expect(problems({ ...ok, allowance: "0.5" })).toMatch(/whole number/);
  });
  it("refuses bad account ids for account, watcher, intents and receiver", () => {
    expect(problems({ ...ok, account: "Fresh.testnet" })).toMatch(/^account:/);
    expect(problems({ ...ok, watcher: "x" })).toMatch(/^watcher:/);
    expect(problems({ ...ok, intents: "bad..testnet" })).toMatch(/^intents:/);
    expect(problems({ ...ok, receiver: "a".repeat(65) })).toMatch(/^receiver:/);
  });
  it("refuses a key whose receiver is the guardian account itself (adopt and unfreeze)", () => {
    expect(problems({ ...ok, receiver: ok.account })).toMatch(/^receiver: the agent key may not call the guardian account itself/);
    const { watcher: _w, intents: _i, ...u } = { ...ok, op: "unfreeze", receiver: ok.account };
    expect(problems(u)).toMatch(/may not call the guardian account itself/);
  });
  it("refuses a mainnet account", () => {
    expect(problems({ ...ok, account: "someone.near" })).toMatch(/mainnet/);
  });
  it("refuses malformed keys and methods", () => {
    expect(problems({ ...ok, agent_key: "ed25519:abc" })).toMatch(/agent_key/);
    expect(problems({ ...ok, agent_key: KEY.slice(8) })).toMatch(/agent_key/);
    expect(problems({ ...ok, methods: "ping,<img>" })).toMatch(/not a method name/);
    expect(problems({ ...ok, methods: "ping,ping" })).toMatch(/repeats/);
  });
  it("refuses missing and repeated fields, naming each", () => {
    const { watcher: _w, intents: _i, ...rest } = ok;
    const p = problems(rest);
    expect(p).toMatch(/watcher is missing/);
    expect(p).toMatch(/intents is missing/);
    expect(problems(ok as Record<string, string>)).toBe("adopt");
    expect(parseDeepLink(q(ok) + "&watcher=evil.testnet")).toMatchObject({ kind: "invalid", op: "adopt" });
    expect(parseDeepLink(q(ok) + "&op=adopt")).toMatchObject({ kind: "invalid", op: null });
  });
  it("unknown op is refused; op=unfreeze still parses as before", () => {
    expect(parseDeepLink(q({ ...ok, op: "deploy" }))).toMatchObject({ kind: "invalid", op: null });
    const { watcher: _w, intents: _i, ...unfreeze } = { ...ok, op: "unfreeze" };
    expect(parseDeepLink(q(unfreeze)).kind).toBe("ok");
  });
  it("builds the unfreeze route for the same key", () => {
    const r = parseDeepLink(q(ok));
    if (r.kind !== "adopt") throw new Error("expected adopt");
    const back = parseDeepLink(unfreezeLinkFor(r.req).replace("/app/owner", ""));
    expect(back.kind === "ok" && back.req.agent_key).toBe(KEY);
    expect(back.kind === "ok" && back.req.methods).toEqual(["record_deploy", "ping"]);
  });
});

describe("pinned guardian code", () => {
  it("the committed wasm hashes to the pinned code hash (sha256, base58)", async () => {
    const bytes = new Uint8Array(readFileSync(new URL("../public/guardian/standin_guardian.wasm", import.meta.url)));
    expect(bytes.length).toBe(GUARDIAN_CODE_BYTES);
    expect(await codeHash(bytes)).toBe(GUARDIAN_CODE_HASH);
    const tampered = bytes.slice(); tampered[100] ^= 1;
    expect(await codeHash(tampered)).not.toBe(GUARDIAN_CODE_HASH);
  });
  it("base58 keeps leading zero bytes", () => expect(base58Encode(new Uint8Array([0, 0, 1]))).toBe("112"));
  it("quotes about 1.77 NEAR of storage and the shortfall for a low balance", () => {
    const acct = { amount: 10n ** 24n, locked: 0n, storageUsage: 182n, codeHash: "11111111111111111111111111111111" };
    const quote = quoteStorage(acct);
    expect(nearShort(quote.codeStorage)).toBe("1.77");
    expect(quote.shortfall).toBe(quote.required - 10n ** 24n);
    expect(quoteStorage({ ...acct, amount: 3n * 10n ** 24n }).shortfall).toBe(0n);
  });
});
