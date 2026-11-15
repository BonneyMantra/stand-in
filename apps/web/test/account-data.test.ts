import { describe, expect, it } from "vitest";
import { hasSigned, readAccountSnapshot, signedCount, toKeyInfo, type Chain, type KeyInfo, type OwnerAccountView } from "../src/data/account.ts";
import { decoysOf, freezesOf, homeStatus, homeSummary, nextStep } from "../src/data/accountDerive.ts";
import { describeTx, freezeTxFor, toActivity, type ActivityTx } from "../src/data/activity.ts";
import { newHome, type HomeRecord } from "../src/lib/wallet/homeStore.ts";
import type { GuardianLookup, GuardianState } from "../src/lib/wallet/near.ts";

const OWNER = "judge-fresh.testnet";
const BAIT = `deployer.${OWNER}`, WATCH = `watch.${OWNER}`;
const FACT = "agent-1.guard.si-project-5289.testnet";
const acct: OwnerAccountView = { amount: 3n * 10n ** 24n, storageUsage: 182n, codeHash: "11111111111111111111111111111111" };
const state = (o: Partial<GuardianState> = {}): GuardianState => ({
  owner: OWNER, watcher: WATCH, intents_contract: "si-intents-5289.testnet", agent_keys: [], intents_keys: [], frozen: false, freeze_log: [], ...o,
});
const full = (pk: string, nonce = 277_000_000_000_000n): KeyInfo => ({ public_key: pk, nonce, kind: "full" });

/** A fake chain: `accounts` exist, `guardians` answer get_state, `keys` per account, `listed` from the factory. */
function chain(o: { accounts?: string[]; guardians?: Record<string, GuardianLookup>; keys?: Record<string, KeyInfo[]>; listed?: string[]; failGuardian?: string }): Chain {
  const exists = new Set(o.accounts ?? []);
  return {
    async guardian(id) {
      if (id === o.failGuardian) throw new Error("Every testnet RPC endpoint failed");
      return o.guardians?.[id] ?? (exists.has(id) ? { kind: "no-contract" } : { kind: "missing-account" });
    },
    async guardiansOf() { return o.listed ?? []; },
    async keys(id) { return exists.has(id) ? o.keys?.[id] ?? [] : []; },
    async account(id) { return exists.has(id) ? acct : null; },
  };
}

describe("account snapshot (data layer)", () => {
  it("a brand-new owner: no guardian, no home accounts, next step is Protect", async () => {
    const s = await readAccountSnapshot(OWNER, [], chain({ accounts: [OWNER] }));
    expect(s.guardians).toEqual([]);
    expect(s.bait.exists).toBe(false);
    expect(s.watcher.exists).toBe(false);
    expect(nextStep(s, null, false)).toEqual({ kind: "protect" });
  });

  it("an account that is not on testnet", async () => {
    const s = await readAccountSnapshot(OWNER, [], chain({}));
    expect(nextStep(s, null, false)).toEqual({ kind: "no-account" });
  });

  it("view_access_key_list's empty answer for a missing account is not read as an existing account", async () => {
    const c = chain({ accounts: [OWNER] });
    c.keys = async () => [];
    const s = await readAccountSnapshot(OWNER, [], c);
    expect(s.bait.exists).toBe(false);
  });

  it("collects the self-hosted guardian and the factory's guardians, and skips one owned by someone else", async () => {
    const s = await readAccountSnapshot(OWNER, ["other.testnet"], chain({
      accounts: [OWNER, FACT, "other.testnet"],
      guardians: { [OWNER]: { kind: "guardian", state: state() }, [FACT]: { kind: "guardian", state: state() }, "other.testnet": { kind: "guardian", state: state({ owner: "other.testnet" }) } },
      listed: [FACT],
    }));
    expect(s.guardians.map((g) => [g.id, g.hosted])).toEqual([[OWNER, "self"], [FACT, "factory"]]);
  });

  it("reports a listed guardian it could not read instead of dropping it silently", async () => {
    const s = await readAccountSnapshot(OWNER, [], chain({ accounts: [OWNER], listed: [FACT], failGuardian: FACT }));
    expect(s.unreadable).toEqual([{ id: FACT, why: "Every testnet RPC endpoint failed" }]);
  });

  it("home status: held with this browser's key, foreign without it, pending before it lands", async () => {
    const home = newHome(OWNER, OWNER);
    const s = await readAccountSnapshot(OWNER, [], chain({
      accounts: [OWNER, BAIT],
      guardians: { [OWNER]: { kind: "guardian", state: state() } },
      keys: { [BAIT]: [full(home.bait.public_key)] },
    }));
    expect(homeStatus(s.bait, home.bait.public_key)).toBe("held");
    expect(homeStatus(s.bait, null)).toBe("foreign");
    expect(homeStatus(s.watcher, home.watcher.public_key)).toBe("pending");
    expect(homeStatus(s.watcher, null)).toBe("missing");
    expect(nextStep(s, home, false)).toEqual({ kind: "create-home", guardian: OWNER });
    expect(nextStep(s, null, false)).toEqual({ kind: "import-home" });
  });

  it("a freeze-only watcher key covers exactly its guardian; others watched by watch.<owner> are listed as uncovered", async () => {
    const home = newHome(OWNER, OWNER);
    const fc: KeyInfo = { public_key: home.watcher.public_key, nonce: 1n, kind: "function-call", receiver_id: OWNER, method_names: ["freeze"], allowance: null };
    const s = await readAccountSnapshot(OWNER, [], chain({
      accounts: [OWNER, BAIT, WATCH, FACT],
      guardians: { [OWNER]: { kind: "guardian", state: state() }, [FACT]: { kind: "guardian", state: state() } },
      keys: { [BAIT]: [full(home.bait.public_key)], [WATCH]: [fc] }, listed: [FACT],
    }));
    const sum = homeSummary(s, home);
    expect(sum.covered).toEqual([OWNER]);
    expect(sum.uncovered).toEqual([FACT]);
    expect(nextStep(s, home, false)).toEqual({ kind: "add-decoy" });
  });
});

describe("decoys, freezes and next steps", () => {
  const home: HomeRecord = newHome(OWNER, OWNER);
  const freezes = freezesOf([{ id: OWNER, hosted: "self", state: state({
    frozen: true,
    freeze_log: [
      { at_block: "100", reason: "owner test", decoy_public_key: null, tx_hash: null, by: OWNER, deleted_keys: [], intents_keys_removed: ["ed25519:I"] },
      { at_block: "205", reason: "decoy used", decoy_public_key: "ed25519:D1", tx_hash: "THEFT", by: WATCH, deleted_keys: ["ed25519:A"], intents_keys_removed: [] },
    ],
  }) }]);

  it("freeze_log becomes trips (a decoy named) and manual freezes, newest first, with who froze", () => {
    expect(freezes.map((f) => [f.at_block, f.trip, f.byRole, f.trip_tx])).toEqual([["205", true, "watcher", "THEFT"], ["100", false, "owner", null]]);
  });

  it("decoys: every bait key but the admin; a moved nonce means it signed; the trip that named it", () => {
    const keys = [full(home.bait.public_key, 277_000_000_000_003n), full("ed25519:D1", 277_000_100_000_001n), full("ed25519:D2")];
    const d = decoysOf({ id: BAIT, exists: true, keys, amount: 1n }, home, freezes);
    expect(d[0]!.admin).toBe(true);
    const d1 = d.find((x) => x.public_key === "ed25519:D1")!;
    expect([d1.signed, d1.signedTxs, d1.trippedBy.length]).toEqual([true, 1, 1]);
    expect(d.find((x) => x.public_key === "ed25519:D2")!.signed).toBe(false);
  });

  it("nonce arithmetic: a new key sits on a multiple of 10^6", () => {
    expect(hasSigned({ nonce: 277_763_978_000_000n })).toBe(false);
    expect(signedCount({ nonce: 277_763_869_000_002n })).toBe(2);
    expect(toKeyInfo({ public_key: "ed25519:K", access_key: { nonce: 5, permission: { FunctionCall: { allowance: null, receiver_id: OWNER, method_names: ["freeze"] } } } }))
      .toEqual({ public_key: "ed25519:K", nonce: 5n, kind: "function-call", receiver_id: OWNER, method_names: ["freeze"], allowance: null });
  });
});

describe("indexed activity", () => {
  const raw = (o: Partial<{ hash: string; signer: string; receiver: string; method: string | null; action: string; block: number }>) => ({
    transaction_hash: o.hash ?? "H", signer_account_id: o.signer ?? WATCH, receiver_account_id: o.receiver ?? OWNER,
    block: { block_height: o.block ?? 100 }, block_timestamp: "1794699553436476768",
    actions: [{ action: o.action ?? "FUNCTION_CALL", method: o.method === undefined ? "freeze" : o.method }], outcomes: { status: true },
  });

  it("matches a freeze record to the freeze transaction one or two blocks before it", () => {
    const txs: ActivityTx[] = [toActivity(raw({ hash: "F", block: 204 })), toActivity(raw({ hash: "X", block: 150 }))];
    expect(freezeTxFor(txs, OWNER, 205)?.hash).toBe("F");
    expect(freezeTxFor(txs, OWNER, 300)).toBeNull();
  });

  it("describes deploys, decoy additions, thefts and account creation", () => {
    const ctx = { bait: BAIT, watcher: WATCH };
    expect(describeTx(toActivity({ ...raw({ method: "new" }), actions: [{ action: "DEPLOY_CONTRACT", method: null }, { action: "FUNCTION_CALL", method: "new" }] }), ctx)).toBe("contract deployed + new");
    expect(describeTx(toActivity(raw({ signer: BAIT, receiver: BAIT, method: null, action: "ADD_KEY" })), ctx)).toBe("decoy key added");
    expect(describeTx(toActivity(raw({ signer: BAIT, receiver: "thief.testnet", method: null, action: "TRANSFER" })), ctx)).toBe("signed by a bait key (a decoy used)");
    expect(describeTx(toActivity(raw({ signer: OWNER, receiver: WATCH, method: null, action: "CREATE_ACCOUNT" })), ctx)).toBe("account created");
  });
});
