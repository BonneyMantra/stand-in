import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Load <repo>/.env.local into process.env (never overrides a variable that is already set). Returns the keys it set. */
export function loadEnvLocal(file?: string): string[] {
  const p = file ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env.local");
  let txt = "";
  try { txt = fs.readFileSync(p, "utf8"); } catch { return []; }
  const set: string[] = [];
  for (const line of txt.split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || process.env[m[1]!] !== undefined) continue;
    process.env[m[1]!] = m[2]!.replace(/^(['"])(.*)\1$/, "$2");
    set.push(m[1]!);
  }
  return set;
}
