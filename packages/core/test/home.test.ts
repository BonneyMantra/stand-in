import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  generateKey, homeAccountIds, homeAccountProblem, loadDevKey, loadHomeKey, loadNetworkConfig, poolSize, repoConfigFile, saveHomeKey, takeDecoy,
} from "../src/index.ts";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "standin-home-"));
const saved = { home: process.env.STANDIN_HOME, cfg: process.env.STANDIN_CONFIG, secrets: process.env.STANDIN_SECRETS };
let home = "";
beforeEach(() => {
  home = tmp();
  process.env.STANDIN_HOME = home;
  delete process.env.STANDIN_CONFIG;
  process.env.STANDIN_SECRETS = tmp(); // an empty .secrets: a stranger's checkout
});
afterEach(() => {
  for (const [k, v] of [["STANDIN_HOME", saved.home], ["STANDIN_CONFIG", saved.cfg], ["STANDIN_SECRETS", saved.secrets]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

const writeHomeCfg = (accounts: Record<string, string>) =>
  fs.writeFileSync(path.join(home, "config.json"), JSON.stringify({ network: "testnet", accounts: { project: "proj.testnet", intents: "intents.testnet", ...accounts } }));

describe("a home's own accounts", () => {
  it("names the bait and watcher as sub-accounts and refuses parents that cannot hold them", () => {
    expect(homeAccountIds("alice.testnet")).toEqual({ parent: "alice.testnet", bait: "deployer.alice.testnet", watcher: "watch.alice.testnet" });
    expect(homeAccountProblem("alice.testnet")).toBeNull();
    expect(homeAccountProblem("0x" + "ab".repeat(20))).toContain("Ethereum Wallets");
    expect(homeAccountProblem("a".repeat(64))).toContain("implicit");
    expect(homeAccountProblem("x".repeat(50) + ".testnet")).toContain("too long");
  });

  it("stores keys 0600 in a 0700 <home>/keys and never overwrites a different key", () => {
    const k = generateKey();
    const f = saveHomeKey(home, "bait", "deployer.alice.testnet", k);
    expect(fs.statSync(f).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(f)).mode & 0o777).toBe(0o700);
    expect(loadHomeKey(home, "deployer.alice.testnet")).toEqual(k);
    expect(() => saveHomeKey(home, "bait", "deployer.alice.testnet", generateKey())).toThrow(/refusing to overwrite/);
    saveHomeKey(home, "bait", "deployer.alice.testnet", k); // the same key again is fine
    expect(loadHomeKey(home, "nobody.testnet")).toBeNull();
  });

  it("the home's config.json is the default config when STANDIN_HOME has one; its keys are found with no .secrets", () => {
    writeHomeCfg({ agent: "alice.testnet", decoy: "deployer.alice.testnet", watcher: "watch.alice.testnet" });
    const k = generateKey();
    saveHomeKey(home, "watcher", "watch.alice.testnet", k);
    const cfg = loadNetworkConfig();
    expect(cfg.file).toBe(path.join(home, "config.json"));
    expect(cfg.keysDir).toBe(path.join(home, "keys"));
    expect(cfg.accounts.decoy).toBe("deployer.alice.testnet");
    expect(loadDevKey(cfg, "watcher")).toEqual(k);
    expect(() => loadDevKey(cfg, "decoy")).toThrow(/no dev key for deployer\.alice\.testnet/);
  });

  it("a home without config.json keeps the project's config (the film's .sandbox/default)", () => {
    expect(loadNetworkConfig().file).toBe(repoConfigFile());
    expect(loadNetworkConfig().keysDir).toBeUndefined();
  });

  it("the pool never plants a key minted on another bait account", async () => {
    writeHomeCfg({ agent: "alice.testnet", decoy: "deployer.alice.testnet", watcher: "watch.alice.testnet" });
    const mk = (account_id?: string) => ({ ...generateKey(), minted_at: "now", ...(account_id ? { account_id } : {}) });
    const legacy = mk(), other = mk("deployer.bob.testnet"), mine = mk("deployer.alice.testnet");
    fs.writeFileSync(path.join(home, "pool.json"), JSON.stringify({ keys: [legacy, other, mine] }));
    expect(poolSize(home, "deployer.alice.testnet")).toBe(1);
    expect(poolSize(home)).toBe(3);
    const k = await takeDecoy({ cfg: loadNetworkConfig(), home, refill: false });
    expect(k.public_key).toBe(mine.public_key);
    expect(poolSize(home)).toBe(2); // the others stay on disk untouched
  });
});

describe("one quote for the CLI and the owner console (funding.ts)", () => {
  it("factory: locked storage + the factory's own required_deposit + 100 TGas up front", async () => {
    const { quoteFactory, shortOf, near, GUARDIAN_CODE_BYTES } = await import("../src/funding.ts");
    const q = quoteFactory({ storageBytes: 176_544n, deposit: 2_139_240_000_000_000_000_000_000n });
    expect(q.lines.map((l) => [l.label, near(l.yocto, 3)])).toEqual([["already locked", "1.765"], ["factory deposit", "2.139"], ["gas", "0.100"]]);
    // fresh-v.stranger-qa-1115a.testnet on 15 Nov: 3.084 NEAR with a guardian deployed, refused before signing
    expect(near(shortOf(3_084_000_000_000_000_000_000_000n, q), 3)).toBe("0.921");
    const web = await import("../../../apps/web/src/lib/wallet/guardianCode.ts");
    expect(BigInt(web.GUARDIAN_CODE_BYTES)).toBe(GUARDIAN_CODE_BYTES);
  });
});
