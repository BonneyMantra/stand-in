import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "@standin/core";

/** Tiny .env parser: KEY=value lines, optional quotes. Returns only the requested key. */
function fromFile(file: string, name: string): string | undefined {
  if (!fs.existsSync(file)) return undefined;
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const m = raw.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[1] === name) return m[2].replace(/^(['"])(.*)\1$/, "$2") || undefined;
  }
  return undefined;
}

/** The API key from the process env or <repo>/.env.local. Never log it, never put it in a URL. */
export function apiKey(): string | undefined {
  return process.env.NEARAI_API_KEY || fromFile(path.join(repoRoot(), ".env.local"), "NEARAI_API_KEY");
}
export const hasApiKey = () => Boolean(apiKey());

/** Remove the key (if loaded) from any text that might reach a log or an error message. */
export function scrubKey(text: string): string {
  const k = apiKey();
  return k ? text.split(k).join("<key>") : text;
}
