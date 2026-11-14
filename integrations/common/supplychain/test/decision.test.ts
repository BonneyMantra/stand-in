import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// @ts-expect-error plain mjs
import { checkSupplyChain } from "../index.mjs";
// @ts-expect-error plain mjs
import { isMalText } from "../osv.mjs";
// @ts-expect-error plain mjs
import { previousVersion } from "../provenance.mjs";

let home: string, proj: string;
const jres = (o: unknown, status = 200) => ({ ok: status < 400, status, json: async () => o }) as any;

function mock(over: { osv?: Record<string, string[]>; vulns?: Record<string, any>; prov?: Record<string, number> } = {}) {
  const calls: string[] = [];
  const fn = async (url: string, init?: any) => {
    calls.push(url);
    if (url.endsWith("/v1/querybatch")) {
      const q = JSON.parse(init.body).queries;
      return jres({ results: q.map((x: any) => ({ vulns: (over.osv?.[`${x.package.name}@${x.version}`] || []).map((id) => ({ id })) })) });
    }
    const v = /\/v1\/vulns\/(.+)$/.exec(url);
    if (v) return jres(over.vulns?.[decodeURIComponent(v[1])] || { summary: "ordinary issue" });
    const a = /attestations\/(.+)$/.exec(url);
    if (a) return jres({}, over.prov?.[decodeURIComponent(a[1]).replace("%2F", "/")] ?? 404);
    if (url.endsWith("/tinycolor") || /registry\.npmjs\.org\/[^/]+$/.test(url)) return jres({ versions: { "1.0.0": {}, "1.1.0": {}, "1.2.0": {} } });
    return jres({}, 404);
  };
  return { fn: fn as any, calls };
}
const input = (command: string) => ({ session_id: "s1", tool_use_id: "t1", cwd: proj, tool_input: { command } });
const events = () => fs.readFileSync(path.join(home, "ledger.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "sc-home-"));
  proj = fs.mkdtempSync(path.join(os.tmpdir(), "sc-proj-"));
  process.env.STANDIN_HOME = home;
  fs.writeFileSync(path.join(proj, "package.json"), JSON.stringify({ dependencies: { "@ctrl/tinycolor": "4.1.1", "is-odd": "3.0.1" } }));
});

describe("deny / allow decision", () => {
  it("denies a MAL- advisory with its id, and logs the ledger event", async () => {
    const m = mock({ osv: { "@ctrl/tinycolor@4.1.1": ["MAL-2025-47141"] } });
    const r = await checkSupplyChain("claude-code", input("npm install"), { fetchImpl: m.fn });
    expect(r.decision).toBe("deny");
    expect(r.deny).toContain("MAL-2025-47141");
    expect(r.deny).toContain("@ctrl/tinycolor@4.1.1");
    const e = events().find((x) => x.type === "supplychain");
    expect(e).toMatchObject({ session_id: "s1", tool_use_id: "t1", packages_checked: 2, decision: "deny", malicious: [{ name: "@ctrl/tinycolor", version: "4.1.1", id: "MAL-2025-47141" }] });
    expect(typeof e.at).toBe("string");
  });
  it("denies a GHSA advisory whose summary marks malicious code", async () => {
    const m = mock({ osv: { "is-odd@3.0.1": ["GHSA-aaaa-bbbb-cccc"] }, vulns: { "GHSA-aaaa-bbbb-cccc": { summary: "Embedded malicious code in is-odd" } } });
    const r = await checkSupplyChain("codex", input("npm test"), { fetchImpl: m.fn });
    expect(r.decision).toBe("deny");
  });
  it("warns but allows an ordinary vulnerability", async () => {
    const m = mock({ osv: { "is-odd@3.0.1": ["GHSA-xxxx-yyyy-zzzz"] }, vulns: { "GHSA-xxxx-yyyy-zzzz": { summary: "Prototype pollution in is-odd" } } });
    const r = await checkSupplyChain("codex", input("npm install"), { fetchImpl: m.fn });
    expect(r.decision).toBe("warn");
    expect(r.deny).toBeUndefined();
    expect(r.warn).toContain("GHSA-xxxx-yyyy-zzzz");
  });
  it("allows a clean tree and ignores non-package commands (no network)", async () => {
    const m = mock();
    expect((await checkSupplyChain("codex", input("npm run build"), { fetchImpl: m.fn })).decision).toBe("allow");
    const n = mock();
    expect(await checkSupplyChain("codex", input("ls -la"), { fetchImpl: n.fn })).toBeNull();
    expect(n.calls).toEqual([]);
  });
  it("caches results for an hour: second run makes no OSV call", async () => {
    const m = mock({ osv: { "@ctrl/tinycolor@4.1.1": ["MAL-2025-47141"] } });
    await checkSupplyChain("codex", input("npm install"), { fetchImpl: m.fn });
    const n = mock();
    const r = await checkSupplyChain("codex", input("npm install"), { fetchImpl: n.fn });
    expect(r.decision).toBe("deny");
    expect(n.calls.filter((u) => u.includes("api.osv.dev"))).toEqual([]);
  });
  it("sends one batch to OSV for the lockfile", async () => {
    const m = mock();
    await checkSupplyChain("codex", input("npm ci"), { fetchImpl: m.fn });
    expect(m.calls.filter((u) => u.endsWith("/v1/querybatch")).length).toBe(1);
  });
});

describe("provenance downgrade", () => {
  it("warns (never denies) when the previous version had provenance and this one has none", async () => {
    const m = mock({ prov: { "tinycolor@1.2.0": 404, "tinycolor@1.1.0": 200 } });
    const r = await checkSupplyChain("codex", input("npm install tinycolor@1.2.0"), { fetchImpl: m.fn });
    expect(r.decision).toBe("warn");
    expect(r.event.provenance).toBe("downgrade");
    expect(r.warn).toContain("lost npm provenance");
  });
  it("present and absent stay quiet; previousVersion skips prereleases", async () => {
    const p = mock({ prov: { "tinycolor@1.2.0": 200 } });
    expect((await checkSupplyChain("codex", input("npm i tinycolor@1.2.0"), { fetchImpl: p.fn })).event.provenance).toBe("present");
    const a = mock(); process.env.STANDIN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "sc-home2-"));
    const r = await checkSupplyChain("codex", input("npm i tinycolor@1.2.0"), { fetchImpl: a.fn });
    expect(r.event.provenance).toBe("absent");
    expect(r.decision).toBe("allow");
    expect(previousVersion(["1.0.0", "1.1.0-beta.1", "1.2.0", "2.0.0"], "1.2.0")).toBe("1.0.0");
  });
});

describe("fail open", () => {
  it("OSV unreachable: allow with a warning and an unchecked ledger flag", async () => {
    const down = (async () => { throw new Error("ENOTFOUND"); }) as any;
    const r = await checkSupplyChain("codex", input("npm install"), { fetchImpl: down });
    expect(r.decision).toBe("warn");
    expect(r.deny).toBeUndefined();
    expect(r.warn).toContain("NOT checked");
    expect(events().find((x) => x.type === "supplychain")).toMatchObject({ unchecked: true, decision: "warn" });
  });
  it("a hung OSV is cut off at the budget (2.5 s default), even if fetch ignores abort", async () => {
    const hang = (() => new Promise(() => {})) as any;
    const t = Date.now();
    const r = await checkSupplyChain("codex", input("npm install"), { fetchImpl: hang, budgetMs: 150 });
    expect(Date.now() - t).toBeLessThan(1500);
    expect(r.decision).toBe("warn");
    expect(r.warn).toContain("did not answer");
  });
  it("HTTP 500 and malformed input fail open", async () => {
    const bad = (async () => jres({}, 500)) as any;
    expect((await checkSupplyChain("codex", input("npm install"), { fetchImpl: bad })).deny).toBeUndefined();
    expect(await checkSupplyChain("codex", { tool_input: null } as any, { fetchImpl: bad })).toBeNull();
  });
  it("text classifier is narrow", () => {
    expect(isMalText({ summary: "Malicious code in foo (npm)" })).toBe(true);
    expect(isMalText({ summary: "XSS via malicious input" })).toBe(false);
  });
});
