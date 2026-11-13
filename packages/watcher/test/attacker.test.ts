import { expect, it } from "vitest";
import { attackerOf } from "../src/trip.ts";

it("finds where value went", () => {
  expect(attackerOf({ hash: "h", signer_id: "d", public_key: "k", receiver_id: "evil.testnet", actions: [{ Transfer: { deposit: "1" } }] })).toBe("evil.testnet");
  expect(attackerOf({ hash: "h", signer_id: "d", public_key: "k", receiver_id: "d", actions: [{ DeleteAccount: { beneficiary_id: "thief.testnet" } }] })).toBe("thief.testnet");
});
