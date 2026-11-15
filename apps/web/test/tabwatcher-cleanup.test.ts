import { describe, expect, it } from "vitest";
import { ChainAnswer, type Rpc } from "../src/lib/tabwatcher/rpc.ts";
import { cleanUp } from "../src/lib/tabwatcher/runSteps.ts";
import { KeySigner } from "../src/lib/tabwatcher/sign.ts";
import { generateKeyPair } from "../src/lib/wallet/keys.ts";

const NEAR = 10n ** 24n;
const BAIT = "deployer.owner-qa.testnet";

/**
 * The thief returns the loot with DeleteAccount (beneficiary: the bait). Live, 15 Nov: the account was deleted and the bait
 * paid, yet one run showed it failed (the gas refund to the deleted account fails with AccountDoesNotExist) and another
 * threw (a retried send_tx answered SignerDoesNotExist after the first copy landed). The chain decides, not the RPC answer.
 */
function chain(opts: { sendAnswer: "ok" | "signer-gone" }) {
  const thief = generateKeyPair();
  const thiefAcct = "ab".repeat(32);
  let deleted = false;
  const sent: unknown[] = [];
  const rpc: Rpc = {
    async callAt<T>(method: string, params: unknown) {
      const p = params as { request_type?: string; account_id?: string };
      const ok = (result: unknown) => ({ result: result as T, endpoint: "x" });
      if (method === "query" && p.request_type === "view_account") {
        if (p.account_id === thiefAcct) {
          if (deleted) throw new ChainAnswer("UNKNOWN_ACCOUNT", "UNKNOWN_ACCOUNT");
          return ok({ amount: String(NEAR / 20n), storage_usage: 182, code_hash: "1".repeat(32), block_height: 1 });
        }
        return ok({ amount: String(deleted ? NEAR / 5n + NEAR / 20n : NEAR / 5n), storage_usage: 500, code_hash: "1".repeat(32), block_height: 1 });
      }
      if (method === "query" && p.request_type === "view_access_key") return ok({ nonce: 5 });
      if (method === "block") return ok({ header: { hash: "11111111111111111111111111111111", height: 9 } });
      if (method === "send_tx") {
        sent.push(params);
        deleted = true; // the first copy lands
        if (opts.sendAnswer === "signer-gone") throw new ChainAnswer("INVALID_TRANSACTION", '{"InvalidTxError":{"SignerDoesNotExist":{}}}');
        return ok({});
      }
      if (method === "tx") return ok({ final_execution_status: "EXECUTED", status: { SuccessValue: "" }, transaction: {}, transaction_outcome: { block_hash: "B" }, receipts_outcome: [{ outcome: { status: { Failure: { ActionError: { kind: { AccountDoesNotExist: {} } } } } } }] });
      throw new Error(`unexpected ${method}`);
    },
    async call<T>(m: string, p: unknown) { return (await this.callAt<T>(m, p)).result; },
  };
  const bait = new KeySigner(rpc, BAIT, generateKeyPair().secret_key);
  return { rpc, bait, thief: { account: thiefAcct, secret: thief.secret_key }, sent };
}

describe("the thief returns everything: DeleteAccount, judged by reading back", () => {
  it("a refund receipt that fails (AccountDoesNotExist) does not make a landed return a failure", async () => {
    const c = chain({ sendAnswer: "ok" });
    const signed: string[] = [];
    const out = await cleanUp(c.rpc, { bait: c.bait, thief: c.thief, decoyPk: null, stole: true }, (l, h) => signed.push(`${l}:${h}`));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ label: "return loot" });
    expect(out[0]!.error).toBeUndefined();
    expect(out[0]!.detail).toMatch(/thief account is deleted; the bait received 0\.0500 NEAR of the 0\.0500/);
    expect(signed[0]).toMatch(/^return loot:/); // the hash was known before it was sent
  });

  it("an RPC that answers SignerDoesNotExist after the first copy landed still reads as returned", async () => {
    const c = chain({ sendAnswer: "signer-gone" });
    const out = await cleanUp(c.rpc, { bait: c.bait, thief: c.thief, decoyPk: null, stole: true }, () => {});
    expect(out[0]!.error).toBeUndefined();
    expect(out[0]!.detail).toMatch(/thief account is deleted/);
  });
});
