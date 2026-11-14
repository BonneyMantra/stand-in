// node --import tsx packages/nearai/scripts/scan-leaks.ts <file-or-dir>...
// Exits 1 if the API credential, an sk- token, a long base58 secret, or an absolute home path appears. Prints only file names.
import fs from "node:fs";
import path from "node:path";
import { apiKey } from "../src/env.ts";

const k = apiKey();
const bad: string[] = [];
const walk = (p: string) => {
  if (p.includes("node_modules")) return;
  const st = fs.statSync(p);
  if (st.isDirectory()) { for (const f of fs.readdirSync(p)) walk(path.join(p, f)); return; }
  const t = fs.readFileSync(p, "utf8");
  if ((k && t.includes(k)) || /sk-[A-Za-z0-9_-]{10,}/.test(t) || /ed25519:[1-9A-HJ-NP-Za-km-z]{60,}/.test(t) || /\/Users\/[a-z0-9_.-]+\//i.test(t)) bad.push(p);
};
for (const a of process.argv.slice(2)) walk(a);
process.stdout.write(bad.length ? `LEAK in:\n${bad.join("\n")}\n` : "clean\n");
process.exit(bad.length ? 1 : 0);
