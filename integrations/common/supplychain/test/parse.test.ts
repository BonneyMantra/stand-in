import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// @ts-expect-error plain mjs
import { parseCommand, collect, segments, splitSpec } from "../parse.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "sc-parse-"));

describe("which Bash commands count", () => {
  it.each([
    "npm install", "npm i left-pad", "npm ci", "npm test", "npm run build", "pnpm install", "pnpm add zod@3.0.0",
    "yarn", "yarn add react", "bun install", "bun add hono", "bun test", "npx cowsay hi", "pnpm dlx create-vite", "cd app && npm ci",
    "NODE_ENV=test npm test", "sudo npm install -g typescript",
  ])("counts %s", (c) => expect(parseCommand(c, "/x").length).toBeGreaterThan(0));

  it.each([
    "ls -la", "cat package.json", "git commit -m 'npm install'", "echo npm install", "node index.js", "npm view lodash", "npm --version", "pnpm why x", "grep npm README.md",
  ])("ignores %s", (c) => expect(parseCommand(c, "/x")).toEqual([]));

  it("collects named packages, skipping paths and urls", () => {
    const [c] = parseCommand("npm install lodash@4.17.21 @ctrl/tinycolor@4.1.1 ./local github:foo/bar file:../x -D", "/x");
    expect(c.named).toEqual([{ name: "lodash", spec: "4.17.21" }, { name: "@ctrl/tinycolor", spec: "4.1.1" }]);
  });
  it("splits compound commands and follows cd", () => {
    expect(segments("a && b; c | d\ne")).toEqual(["a", "b", "c", "d", "e"]);
    const c = parseCommand("cd sub && npm test", "/proj");
    expect(c[0].cwd).toBe("/proj/sub");
  });
  it("npx and dlx name the fetched package", () => {
    expect(parseCommand("npx -y cowsay@1.6.0 hi", "/x")[0].named).toEqual([{ name: "cowsay", spec: "1.6.0" }]);
    expect(splitSpec("@a/b@^1.2.0")).toEqual({ name: "@a/b", spec: "^1.2.0" });
  });
});

describe("package collection", () => {
  it("prefers lockfile versions, falls back to package.json bases, caps at 400", () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, "package.json"), JSON.stringify({ dependencies: { a: "^1.2.3", b: "~2.0.0", c: "latest" } }));
    fs.writeFileSync(path.join(d, "package-lock.json"), JSON.stringify({ packages: { "": {}, "node_modules/a": { version: "1.2.9" }, "node_modules/@s/z": { version: "0.1.0" } } }));
    const got = collect("npm install", d).packages.map((p: any) => `${p.name}@${p.version}`).sort();
    expect(got).toEqual(["@s/z@0.1.0", "a@1.2.9", "b@2.0.0"]);

    const big: Record<string, any> = { "": {} };
    for (let i = 0; i < 600; i++) big[`node_modules/p${i}`] = { version: "1.0.0" };
    fs.writeFileSync(path.join(d, "package-lock.json"), JSON.stringify({ packages: big }));
    expect(collect("npm ci", d).packages.length).toBe(400);
  });
  it("named install checks the named package only", () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, "package.json"), JSON.stringify({ dependencies: { a: "1.0.0" } }));
    const c = collect("npm install left-pad@1.3.0", d);
    expect(c.packages.map((p: any) => p.name)).toEqual(["left-pad"]);
  });
  it("reads pnpm and yarn lockfiles", () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, "pnpm-lock.yaml"), "packages:\n  /left-pad@1.3.0:\n    resolution: {}\n  '@ctrl/tinycolor@4.1.1':\n    resolution: {}\n");
    fs.writeFileSync(path.join(d, "yarn.lock"), '"is-odd@^3.0.0":\n  version "3.0.1"\n');
    const got = collect("npm test", d).packages.map((p: any) => `${p.name}@${p.version}`);
    expect(got).toEqual(expect.arrayContaining(["left-pad@1.3.0", "@ctrl/tinycolor@4.1.1", "is-odd@3.0.1"]));
  });
});
