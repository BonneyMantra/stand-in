import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const BIN = process.env.STANDIN_TOUCHID_BIN ?? path.resolve(here, "../bin/standin-touchid");
export const SWIFT_SRC = path.resolve(here, "../standin-touchid.swift");

export type Availability = "available" | "unavailable" | "no-binary";

/** Compile the Swift helper next to this package (macOS only). Returns the binary path. */
export function build(): string {
  if (process.platform !== "darwin") throw new Error("Touch ID helper only builds on macOS");
  fs.mkdirSync(path.dirname(BIN), { recursive: true });
  const r = spawnSync("swiftc", ["-O", SWIFT_SRC, "-o", BIN], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`swiftc failed: ${r.stderr.trim().slice(0, 300)}`);
  return BIN;
}

/** Availability check, no prompt. exit 0 -> available, 2 -> unavailable. */
export function biometricsAvailable(): Availability {
  if (process.platform !== "darwin") return "unavailable";
  if (!fs.existsSync(BIN)) {
    try { build(); } catch { return "no-binary"; }
  }
  const r = spawnSync(BIN, ["--check"], { encoding: "utf8", timeout: 10_000 });
  return r.status === 0 ? "available" : "unavailable";
}

export interface GateOpts {
  timeoutMs?: number;
  /** test seams */
  run?: (reason: string, timeoutMs: number) => Promise<number>;
  availability?: () => Availability;
  confirm?: (prompt: string, expected: string) => Promise<string>;
  /** the exact word the owner must type when biometrics are unavailable (default "approve") */
  typed?: string;
}

function runBinary(reason: string, timeoutMs: number): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn(BIN, [reason], { stdio: ["ignore", "inherit", "inherit"] });
    const t = setTimeout(() => { p.kill("SIGKILL"); resolve(1); }, timeoutMs);
    p.on("error", () => { clearTimeout(t); resolve(1); });
    p.on("exit", (c) => { clearTimeout(t); resolve(c ?? 1); });
  });
}

async function askTyped(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) return "";
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const a = await rl.question(prompt);
  rl.close();
  return a;
}

/**
 * Owner-presence gate. Resolves true only if the owner's fingerprint was accepted (macOS with Touch ID).
 * Where biometrics are unavailable (non-Mac, no sensor, no GUI session) it never passes silently: the owner must
 * type an explicit confirmation word at a terminal; with no terminal it fails. Timeout 60 s by default.
 */
export async function requireFingerprint(reason: string, o: GateOpts = {}): Promise<boolean> {
  const timeoutMs = o.timeoutMs ?? 60_000;
  const avail = (o.availability ?? biometricsAvailable)();
  if (avail === "available") {
    const code = await (o.run ?? runBinary)(reason, timeoutMs);
    return code === 0;
  }
  const word = o.typed ?? "approve";
  process.stderr.write(`Touch ID is not available here (${avail}); explicit typed confirmation required.\n`);
  const got = await Promise.race([
    (o.confirm ?? ((p) => askTyped(p)))(`${reason}. Type "${word}" to confirm: `, word),
    new Promise<string>((r) => setTimeout(() => r(""), timeoutMs)),
  ]);
  return got.trim() === word;
}
