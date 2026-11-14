import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, expect, it } from "vitest";
import { BudgetExceeded, CAPS_YOCTO, commit, readRows, recovered, reserve, settle, spend, totals } from "../src/budget.ts";

const N = 10n ** 24n;
let file: string;
beforeEach(() => { file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "standin-budget-")), "spend.ndjson"); });

it("records a spend and its tx hash", async () => {
  const r = await spend("gas", N / 1000n, N / 10000n, async () => ({ tx_hash: "abc" }), file);
  expect(r.tx_hash).toBe("abc");
  const rows = readRows(file);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ purpose: "gas", tx_hash: "abc", amount_yocto: (N / 1000n).toString() });
});

it("refuses a spend over the per-purpose cap before sending anything", async () => {
  let sent = false;
  await expect(spend("intents", N / 100n + 1n, 0n, async () => { sent = true; return { tx_hash: "x" }; }, file)).rejects.toBeInstanceOf(BudgetExceeded);
  expect(sent).toBe(false);
  expect(readRows(file)).toHaveLength(0);
});

it("counts amount plus gas against the purpose cap", () => {
  reserve("intents", N / 200n, N / 400n, file);
  expect(() => reserve("intents", N / 200n, N / 400n, file)).toThrow(BudgetExceeded);
});

it("refuses over the global cap even when every purpose is under its own cap", () => {
  reserve("bait", CAPS_YOCTO.bait, 0n, file);
  reserve("account", CAPS_YOCTO.account, 0n, file);
  reserve("thief", CAPS_YOCTO.thief, 0n, file);
  reserve("gas", CAPS_YOCTO.gas, 0n, file); // 0.20+0.06+0.03+0.03 = 0.32
  reserve("intents", N / 100n, 0n, file); // 0.33 total
  expect(totals(file).global).toBe(CAPS_YOCTO.bait + CAPS_YOCTO.account + CAPS_YOCTO.thief + CAPS_YOCTO.gas + N / 100n);
  expect(() => reserve("account", 1n, 0n, file)).toThrow(/account cap/);
  expect(CAPS_YOCTO.global).toBe((38n * N) / 100n);
});

it("a failed send stays counted; settle lowers a reservation to the actual gas", async () => {
  await expect(spend("gas", 0n, N / 100n, async () => { throw new Error("rpc down"); }, file)).rejects.toThrow("rpc down");
  expect(totals(file).byPurpose.gas).toBe(N / 100n);
  const id = reserve("gas", 0n, N / 100n, file);
  commit(id, "t", file);
  settle(id, N / 1000n, file);
  expect(totals(file).byPurpose.gas).toBe(N / 100n + N / 1000n);
});

it("rejects negative amounts and unknown purposes", () => {
  expect(() => reserve("gas", -1n, 0n, file)).toThrow(BudgetExceeded);
  expect(() => reserve("lunch" as any, 1n, 0n, file)).toThrow(BudgetExceeded);
});

it("money swept back is credited against its purpose so a bait can be funded again", () => {
  reserve("bait", CAPS_YOCTO.bait - 1000n, 0n, file);
  expect(() => reserve("bait", 2000n, 0n, file)).toThrow(BudgetExceeded);
  recovered("bait", CAPS_YOCTO.bait - 1000n, "sweep", file);
  expect(totals(file).byPurpose.bait).toBe(0n);
  expect(() => reserve("bait", CAPS_YOCTO.bait, 0n, file)).not.toThrow();
  expect(() => reserve("bait", 1n, 0n, file)).toThrow(BudgetExceeded);
});
