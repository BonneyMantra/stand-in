import { describe, expect, it } from "vitest";
import { parseDeepLink } from "../src/lib/wallet/deeplink.ts";
import { adoptQuote, createAccountTx, homeAccountsOf, watcherFor } from "../src/lib/wallet/homeAccounts.ts";
import { REPORT_UPFRONT, WATCHER_FUND, quoteAdopt } from "../src/lib/wallet/funding.ts";
import { nearShort } from "../src/lib/wallet/guardianCode.ts";

const OWNER = "fresh-owner.testnet";
const KEY = "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp";
const BK = "ed25519:4sMsyUrWXYgZZRFLkYB1bWCSiAwwizpMFteFzGVXUYXf";
const WK = "ed25519:DzEhdSDEPbXBkv2J1kNNoPPgkw7G6dkK98c1t5JhuLJ3";
const link = {
  op: "adopt", account: OWNER, watcher: `watch.${OWNER}`, intents: "si-intents-5289.testnet", agent_key: KEY, receiver: "si-project-5289.testnet",
  methods: "record_deploy", allowance: "250000000000000000000000", bait: `deployer.${OWNER}`, bait_key: BK, watch_key: WK,
};
const q = (o: Record<string, string>) => "?" + new URLSearchParams(o).toString();
const problems = (o: Record<string, string>) => { const r = parseDeepLink(q(o)); return r.kind === "invalid" ? r.problems.join(" | ") : r.kind; };

describe("adopt link with the home's own accounts (self-serve bait and watcher)", () => {
  it("decodes the bait and both public keys; the owner creates exactly those accounts", () => {
    const r = parseDeepLink(q(link));
    expect(r.kind).toBe("adopt");
    if (r.kind !== "adopt") return;
    expect(homeAccountsOf(r.req)).toEqual([
      { role: "bait", accountId: `deployer.${OWNER}`, publicKey: BK },
      { role: "watcher", accountId: `watch.${OWNER}`, publicKey: WK },
    ]);
  });

  it("a link without keys creates nothing (accounts already exist, or an older CLI)", () => {
    const { bait_key: _b, watch_key: _w, ...rest } = link;
    const r = parseDeepLink(q(rest));
    expect(r.kind === "adopt" && homeAccountsOf(r.req)).toEqual([]);
  });

  it("refuses inconsistent home accounts, naming each problem", () => {
    const { bait: _b, ...noBait } = link;
    expect(problems(noBait)).toContain("bait_key needs bait");
    expect(problems({ ...link, bait: "deployer.someone-else.testnet" })).toContain("sub-accounts of the same owner");
    expect(problems({ ...link, bait: link.watcher })).toContain("must be different accounts");
    expect(problems({ ...link, bait_key: "ed25519:short" })).toContain("bait_key must be ed25519");
    expect(problems({ ...link, watch_key: "secret" })).toContain("watch_key must be ed25519");
    expect(problems(link) === "adopt").toBe(true);
    expect(parseDeepLink(q(link) + "&bait_key=" + encodeURIComponent(BK)).kind).toBe("invalid");
  });

  it("creates each account in one transaction: CreateAccount, its funding (bait 0.2, watcher 0.45 NEAR), the CLI key with full access", () => {
    expect(createAccountTx({ role: "watcher", accountId: `watch.${OWNER}`, publicKey: WK })).toEqual({
      receiverId: `watch.${OWNER}`,
      actions: [
        { type: "CreateAccount" },
        { type: "Transfer", params: { deposit: "450000000000000000000000" } },
        { type: "AddKey", params: { publicKey: WK, accessKey: { permission: "FullAccess" } } },
      ],
    });
    expect(createAccountTx({ role: "bait", accountId: `deployer.${OWNER}`, publicKey: BK }).actions[1]).toEqual({ type: "Transfer", params: { deposit: "200000000000000000000000" } });
  });

  it("quotes from the shared funding module: a fresh account adopting needs 2.622 NEAR, line by line", () => {
    const NEAR = 10n ** 24n;
    const fresh = { amount: 10n * NEAR, storageUsage: 182n };
    const q = adoptQuote(fresh, ["bait", "watcher"], true);
    expect(q.lines.map((l) => [l.label, nearShort(l.yocto, 3)])).toEqual([
      ["already locked", "0.002"], ["guardian storage", "1.770"], ["deploy gas", "0.150"], ["bait account", "0.200"], ["watcher account", "0.450"], ["gas", "0.050"],
    ]);
    expect(q.total).toBe(quoteAdopt({ storageBytes: 182n, deployGuardian: true, createBait: true, createWatcher: true }).total);
    expect(nearShort(q.total, 3)).toBe("2.622");
    expect(q.short).toBe(0n);
    expect(adoptQuote({ amount: 2n * NEAR, storageUsage: 182n }, ["bait", "watcher"], true).short).toBe(q.total - 2n * NEAR);
    // An existing guardian (factory or adopted before): only the accounts still missing, plus gas.
    expect(nearShort(adoptQuote(fresh, ["watcher"], false).total, 3)).toBe("0.502");
    // The watcher can prepay a blocklist report: its funding covers REPORT_UPFRONT with room for freezes.
    expect(WATCHER_FUND > REPORT_UPFRONT).toBe(true);
  });

  it("new guardians from the console are watched by the owner's own watch.<owner>; a 0x owner keeps the project's", () => {
    expect(watcherFor(OWNER)).toBe(`watch.${OWNER}`);
    expect(watcherFor("0x" + "ab".repeat(20))).toBe("si-watch-5289.testnet");
  });
});
