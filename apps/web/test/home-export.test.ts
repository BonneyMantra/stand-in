import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadNetworkConfig } from "../../../packages/core/src/config.ts";
import { loadHomeKey, saveHomeKey } from "../../../packages/core/src/homeacct.ts";
import { generateKey, loadDevKey } from "../../../packages/core/src/rpc.ts";
import { writeHomeConfig, type HomePlan } from "../../../packages/cli/src/home-accounts.ts";
import { buildHomeTar, exportCommand, exportFileName, homeConfig, parseHomeFiles } from "../src/lib/wallet/homeExport.ts";
import { newHome } from "../src/lib/wallet/homeStore.ts";
import { generateKeyPair } from "../src/lib/wallet/keys.ts";

const OWNER = "judge-fresh.testnet";
const GUARDIAN = "judge-fresh.testnet";
const tmp: string[] = [];
const mk = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "standin-export-")); tmp.push(d); return d; };
const saved = { home: process.env.STANDIN_HOME, cfg: process.env.STANDIN_CONFIG };
beforeEach(() => { delete process.env.STANDIN_CONFIG; });
afterEach(() => {
  for (const k of ["home", "cfg"] as const) { const v = saved[k]; const name = k === "home" ? "STANDIN_HOME" : "STANDIN_CONFIG"; if (v === undefined) delete process.env[name]; else process.env[name] = v; }
  for (const d of tmp.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const mode = (p: string) => fs.statSync(p).mode & 0o777;
const enc = (s: string) => new TextEncoder().encode(s);
const readAll = (root: string): { path: string; bytes: Uint8Array }[] => {
  const out: { path: string; bytes: Uint8Array }[] = [];
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else out.push({ path: path.relative(root, f), bytes: new Uint8Array(fs.readFileSync(f)) }); } };
  walk(root);
  return out;
};

describe("exported tar and the CLI's own loader", () => {
  it("extracts with the system tar, with the right modes, and the CLI reads the home", () => {
    const home = newHome(OWNER, GUARDIAN);
    const dir = mk();
    fs.writeFileSync(path.join(dir, "home.tar"), buildHomeTar(home, GUARDIAN));
    const into = path.join(dir, "out");
    fs.mkdirSync(into);
    execFileSync("tar", ["-xf", path.join(dir, "home.tar"), "-C", into]);
    const sh = path.join(into, ".standin");
    expect(mode(sh)).toBe(0o700);
    expect(mode(path.join(sh, "keys"))).toBe(0o700);
    expect(mode(path.join(sh, "config.json"))).toBe(0o644);
    for (const id of [home.bait.account_id, home.watcher.account_id]) expect(mode(path.join(sh, "keys", `${id}.json`))).toBe(0o600);
    expect(fs.readFileSync(path.join(sh, "README.txt"), "utf8").split("\n")[0]).toMatch(/low-value testnet keys .* must never hold or guard real funds/i);
    expect(fs.readFileSync(path.join(sh, "README.txt"), "utf8")).toContain("pnpm standin dev up --home DIR");
    const keyFile = JSON.parse(fs.readFileSync(path.join(sh, "keys", `${home.bait.account_id}.json`), "utf8"));
    expect(keyFile).toMatchObject({ account_id: home.bait.account_id, role: "bait", public_key: home.bait.public_key, private_key: home.bait.secret_key });
    expect(keyFile.note).toMatch(/never hold or guard real funds/);

    process.env.STANDIN_HOME = sh;
    const cfg = loadNetworkConfig();
    expect(cfg.file).toBe(path.join(sh, "config.json"));
    expect(cfg.accounts.agent).toBe(GUARDIAN);
    expect(cfg.accounts.decoy).toBe(home.bait.account_id);
    expect(cfg.accounts.watcher).toBe(home.watcher.account_id);
    expect(cfg.raw.home_accounts).toEqual({ parent: OWNER, bait: home.bait.account_id, watcher: home.watcher.account_id });
    expect(loadDevKey(cfg, "decoy")).toEqual({ secret_key: home.bait.secret_key, public_key: home.bait.public_key });
    expect(loadDevKey(cfg, "watcher")).toEqual({ secret_key: home.watcher.secret_key, public_key: home.watcher.public_key });
    expect(loadHomeKey(sh, home.bait.account_id)?.public_key).toBe(home.bait.public_key);
    expect(loadHomeKey(sh, home.watcher.account_id)?.secret_key).toBe(home.watcher.secret_key);
  });

  it("keeps the base config's other accounts and builds the documented command", () => {
    const home = newHome(OWNER, GUARDIAN);
    const c = homeConfig(home, "other-guardian.testnet") as { accounts: Record<string, string>; network: string };
    expect(c.network).toBe("testnet");
    expect(c.accounts.agent).toBe("other-guardian.testnet");
    expect(c.accounts.registry).toMatch(/\.testnet$/);
    expect(exportFileName(OWNER)).toBe("standin-home-judge-fresh.testnet.tar");
    expect(exportCommand(OWNER)).toBe("mkdir -p ~/standin-judge-fresh.testnet && tar -xf ~/Downloads/standin-home-judge-fresh.testnet.tar -C ~/standin-judge-fresh.testnet && pnpm standin dev up --home ~/standin-judge-fresh.testnet");
    expect(() => exportCommand("a; rm -rf ~")).toThrow();
  });
});

describe("import", () => {
  it("round trips our tar", () => {
    const home = newHome(OWNER, GUARDIAN);
    const r = parseHomeFiles([{ path: exportFileName(OWNER), bytes: buildHomeTar(home, GUARDIAN) }], OWNER);
    if (!r.ok) throw new Error(r.problems.join("; "));
    expect(r.home.bait).toEqual({ account_id: home.bait.account_id, public_key: home.bait.public_key, secret_key: home.bait.secret_key });
    expect(r.home.watcher).toEqual({ account_id: home.watcher.account_id, public_key: home.watcher.public_key, secret_key: home.watcher.secret_key });
    expect(r.home.guardian).toBe(GUARDIAN);
    expect(r.home.files).toContain(".standin/config.json");
  });

  it("reads a tar made by `tar -cf home.tar -C DIR .standin` and loose files from a CLI home (saveHomeKey + writeHomeConfig)", () => {
    const dir = mk();
    const cliHome = path.join(dir, ".standin");
    const bait = generateKey(), watcher = generateKey();
    saveHomeKey(cliHome, "bait", `deployer.${OWNER}`, bait);
    saveHomeKey(cliHome, "watcher", `watch.${OWNER}`, watcher);
    const plan: HomePlan = {
      parent: OWNER,
      bait: { role: "bait", account_id: `deployer.${OWNER}`, public_key: bait.public_key, exists: true },
      watcher: { role: "watcher", account_id: `watch.${OWNER}`, public_key: watcher.public_key, exists: true },
      toCreate: [],
    };
    process.env.STANDIN_HOME = path.join(dir, "elsewhere"); // loadNetworkConfig must read the repo config, not a home
    writeHomeConfig(cliHome, loadNetworkConfig(), "agent-x.testnet", plan);

    const loose = readAll(dir).map((f) => ({ ...f, path: f.path.replace(/^\.standin\//, "") })); // a picked .standin folder: config.json, keys/x.json
    const a = parseHomeFiles(loose, OWNER);
    if (!a.ok) throw new Error(a.problems.join("; "));
    expect(a.home.bait.secret_key).toBe(bait.secret_key);
    expect(a.home.watcher.secret_key).toBe(watcher.secret_key);
    expect(a.home.guardian).toBe("agent-x.testnet");

    const tarFile = path.join(mk(), "home.tar");
    execFileSync("tar", ["-cf", tarFile, "-C", dir, ".standin"]);
    const b = parseHomeFiles([{ path: "home.tar", bytes: new Uint8Array(fs.readFileSync(tarFile)) }], OWNER);
    if (!b.ok) throw new Error(b.problems.join("; "));
    expect(b.home.bait.public_key).toBe(bait.public_key);
    expect(b.home.guardian).toBe("agent-x.testnet");

    const picked = parseHomeFiles(readAll(dir).map((f) => ({ ...f, path: `my-folder/${f.path}` })), OWNER);
    expect(picked.ok).toBe(true);
  });

  it("accepts bare .key text and secret_key JSON, falling back to deployer.<owner>/watch.<owner> with no config", () => {
    const bait = generateKeyPair(), watcher = generateKeyPair();
    const r = parseHomeFiles([
      { path: `deployer.${OWNER}.key`, bytes: enc(bait.secret_key + "\n") },
      { path: `keys/watch.${OWNER}.json`, bytes: enc(JSON.stringify({ account_id: `watch.${OWNER}`, secret_key: watcher.secret_key })) },
    ], OWNER);
    if (!r.ok) throw new Error(r.problems.join("; "));
    expect(r.home.bait.public_key).toBe(bait.public_key);
    expect(r.home.watcher.public_key).toBe(watcher.public_key);
    expect(r.home.guardian).toBeNull();
  });

  describe("refusals", () => {
    it("a wrong owner", () => {
      const home = newHome("someone-else.testnet", GUARDIAN);
      const r = parseHomeFiles([{ path: "h.tar", bytes: buildHomeTar(home, GUARDIAN) }], OWNER);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.problems.filter((p) => /different owner/.test(p))).toHaveLength(2);
    });

    it("a missing watcher key", () => {
      const home = newHome(OWNER, GUARDIAN);
      const files = readTarFiles(buildHomeTar(home, GUARDIAN)).filter((f) => !f.path.includes(`keys/${home.watcher.account_id}`));
      const r = parseHomeFiles(files, OWNER);
      expect(r).toMatchObject({ ok: false });
      if (!r.ok) expect(r.problems).toEqual([`no key file for the watcher ${home.watcher.account_id} (expected keys/${home.watcher.account_id}.json)`]);
    });

    it("a secret that does not match the file's public key, without leaking any secret", () => {
      const home = newHome(OWNER, GUARDIAN);
      const stranger = generateKeyPair();
      const files = readTarFiles(buildHomeTar(home, GUARDIAN)).map((f) => {
        if (!f.path.endsWith(`${home.bait.account_id}.json`)) return f;
        const j = JSON.parse(new TextDecoder().decode(f.bytes));
        return { ...f, bytes: enc(JSON.stringify({ ...j, private_key: stranger.secret_key })) };
      });
      const r = parseHomeFiles(files, OWNER);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.problems.join(" ")).toMatch(/does not match its public_key/);
        for (const s of [home.bait.secret_key, home.watcher.secret_key, stranger.secret_key]) expect(r.problems.join(" ")).not.toContain(s.slice(8));
      }
    });

    it("a garbage key and a damaged tar", () => {
      const home = newHome(OWNER, GUARDIAN);
      const tar = buildHomeTar(home, GUARDIAN);
      expect(parseHomeFiles([{ path: "h.tar", bytes: tar.slice(0, 700) }], OWNER)).toMatchObject({ ok: false });
      const r = parseHomeFiles([{ path: `keys/deployer.${OWNER}.json`, bytes: enc("{\"private_key\":\"nope\"}") }, { path: `keys/watch.${OWNER}.key`, bytes: enc("hello") }], OWNER);
      expect(r.ok).toBe(false);
    });
  });
});

/** The tar's files as loose entries (the same bytes a folder pick would give). */
function readTarFiles(tar: Uint8Array) {
  const dir = mk();
  fs.writeFileSync(path.join(dir, "h.tar"), tar);
  const out = path.join(dir, "x");
  fs.mkdirSync(out);
  execFileSync("tar", ["-xf", path.join(dir, "h.tar"), "-C", out]);
  return readAll(out);
}
