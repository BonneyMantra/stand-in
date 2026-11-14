import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, expect, it } from "vitest";
import { baseDecode, KeyPair } from "near-api-js";
import { loadNetworkConfig } from "@standin/core";
import { CAPS_YOCTO, reserve, readRows } from "@standin/mainnet/budget";
import { OwnerKeyFreezer } from "../src/ownerfreeze.ts";

let spendFile: string;
beforeEach(() => { spendFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "standin-of-")), "spend.ndjson"); process.env.STANDIN_MAINNET_SPEND = spendFile; });

function freezer() {
  const cfg = loadNetworkConfig(path.join(import.meta.dirname, "../../../config/mainnet.json"));
  const owner = KeyPair.fromRandom("ed25519");
  const f = new OwnerKeyFreezer(cfg, "agent-test.near", "intents.near", owner.toString());
  const sent: { receiver: string; nonce: bigint; actions: string[] }[] = [];
  Object.assign(f as any, {
    nonce: 10n, blockHash: baseDecode("11111111111111111111111111111111"), fcKeys: [KeyPair.fromRandom("ed25519").getPublicKey().toString()],
    intentsKeys: [KeyPair.fromRandom("ed25519").getPublicKey().toString()],
    landed: async () => true, settleLater: async () => undefined,
    provider: { sendTransactionAsync: async (t: any) => { sent.push({ receiver: t.transaction.receiverId, nonce: BigInt(t.transaction.nonce), actions: t.transaction.actions.map((a: any) => Object.keys(a)[0] ?? a.enum) }); } },
  });
  return { f, sent };
}

it("broadcasts DeleteKey (nonce n+1) before remove_public_key (n+2), each through the budget guard", async () => {
  const { f, sent } = freezer();
  const r = await f.freeze();
  expect(sent.map((s) => [s.receiver, s.nonce])).toEqual([["agent-test.near", 11n], ["intents.near", 12n]]);
  expect(r.extra.deleted_keys).toHaveLength(1);
  expect(r.extra.intents_keys_removed).toHaveLength(1);
  expect(readRows(spendFile).map((x) => x.purpose)).toEqual(["gas", "intents"]);
  expect(readRows(spendFile).every((x) => x.tx_hash)).toBe(true);
});

it("sends nothing when the budget guard refuses", async () => {
  const { f, sent } = freezer();
  reserve("gas", CAPS_YOCTO.gas, 0n, spendFile); // gas bucket exhausted
  await expect(f.freeze()).rejects.toThrow(/budget refused/);
  expect(sent).toHaveLength(0);
});
