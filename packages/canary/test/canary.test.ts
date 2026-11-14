import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// @ts-expect-error plain mjs
import { plantCanaries, inside } from "../../../integrations/common/canary-plant.mjs";
// @ts-expect-error plain mjs
import { createPool, ntfyWebhook, MAX_POOL } from "../src/canary.mjs";

const tokens = [
  { kind: "canary-url", url: "http://canarytokens.com/images/abc123/x.jpg" },
  { kind: "canary-dns", hostname: "abc123.canarytokens.com" },
  { kind: "canary-mcp", mcpjson: JSON.stringify({ mcpServers: { "cloud-auth-broker": { type: "http", url: "https://example.invalid/mcp" } } }) },
];
let sandbox: string, proj: string;

function walk(d: string): string[] { return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])); }

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "canary-home-"));
  proj = path.join(sandbox, "proj");
  fs.mkdirSync(proj);
  process.env.STANDIN_HOME = path.join(sandbox, ".standin");
});

describe("planting stays inside the sandbox", () => {
  it("writes only under the given HOME and cwd, mode 0600, and ledgers each kind", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "canary-outside-"));
    const planted = plantCanaries("s1", { agent: "claude-code", cwd: proj, tokens, home: sandbox });
    expect(planted.map((p: any) => p.kind).sort()).toEqual(["canary-dns", "canary-mcp", "canary-url"]);
    for (const p of planted) { expect(inside(p.path, [sandbox])).toBe(true); expect(fs.statSync(p.path).mode & 0o777).toBe(0o600); }
    expect(fs.readdirSync(outside)).toEqual([]);
    const ev = fs.readFileSync(path.join(process.env.STANDIN_HOME!, "ledger.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(ev.map((e) => e.kind).sort()).toEqual(["canary-dns", "canary-mcp", "canary-url"]);
    expect(ev.every((e) => e.type === "decoy_planted" && e.session_id === "s1")).toBe(true);
    expect(walk(sandbox).every((f) => f.startsWith(sandbox))).toBe(true);
  });
  it("refuses a cwd-independent path escape (inside() rejects traversal and siblings)", () => {
    expect(inside(path.join(sandbox, "..", "evil"), [sandbox])).toBe(false);
    expect(inside(path.join(sandbox + "-sibling", "x"), [sandbox])).toBe(false);
    expect(inside(path.join(sandbox, "a", "b"), [sandbox])).toBe(true);
  });
  it("merges into an existing .mcp.json instead of overwriting it", () => {
    fs.writeFileSync(path.join(proj, ".mcp.json"), JSON.stringify({ mcpServers: { mine: { command: "x" } } }));
    plantCanaries("s2", { agent: "codex", cwd: proj, tokens, home: sandbox });
    const j = JSON.parse(fs.readFileSync(path.join(proj, ".mcp.json"), "utf8"));
    expect(Object.keys(j.mcpServers).sort()).toEqual(["cloud-auth-broker", "mine"]);
  });
  it("no pool means nothing planted and no error", () => {
    expect(plantCanaries("s3", { agent: "codex", cwd: proj, tokens: [], home: sandbox })).toEqual([]);
  });
});

describe("pool creation", () => {
  it("creates at most 4 tokens, 5 s apart, and stops at the first refusal", async () => {
    const file = path.join(sandbox, "canary.json");
    const sleeps: number[] = [];
    let n = 0;
    const fetchImpl = (async () => { n++; return n === 3 ? { ok: false, status: 429, text: async () => '{"error":"1","error_message":"slow down"}' } : { ok: true, status: 200, text: async () => JSON.stringify({ token: "t" + n, hostname: "h" + n, url: "u" + n, auth_token: "a" }) }; }) as any;
    const r = await createPool({ topic: "t", file, fetchImpl, sleep: async (ms: number) => { sleeps.push(ms); } });
    expect(r.stopped).toContain("refused");
    expect(r.pool.tokens.length).toBe(2);
    expect(r.pool.tokens.length).toBeLessThanOrEqual(MAX_POOL);
    expect(sleeps).toEqual([5000, 5000]);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(n).toBe(3); // no retry after a refusal
  });
  it("webhook is the ntfy topic URL", () => {
    expect(ntfyWebhook("my-topic")).toMatch(/^https:\/\/ntfy\.sh\/my-topic\?/);
  });
});
