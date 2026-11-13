import fs from "node:fs";
import path from "node:path";

export const SECRET_RE = /ed25519:[1-9A-HJ-NP-Za-km-z]{80,90}/g;
const SKIP = new Set(["node_modules", ".git", ".standin", "Library", ".cache", ".npm"]);
const HISTORY = [".zsh_history", ".bash_history", ".histfile", ".local/share/fish/fish_history"];

export interface Found {
  kind: "near-credentials" | "dotenv" | "shell-history";
  path: string;
  secret: string;
  account_id?: string;
}

function walk(dir: string, depth: number, visit: (f: string) => void) {
  if (depth < 0) return;
  let ents: fs.Dirent[];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, depth - 1, visit);
    else if (e.isFile()) visit(p);
  }
}

/** Scan a HOME for NEAR secret keys: .near-credentials/**.json, .env*, shell history. */
export function scanHome(home: string): Found[] {
  const found: Found[] = [];
  walk(path.join(home, ".near-credentials"), 4, (f) => {
    if (!f.endsWith(".json")) return;
    try {
      const j = JSON.parse(fs.readFileSync(f, "utf8"));
      const secret = j.private_key ?? j.secret_key;
      if (typeof secret === "string" && secret.startsWith("ed25519:")) found.push({ kind: "near-credentials", path: f, secret, account_id: j.account_id });
    } catch { /* not a credentials file */ }
  });
  walk(home, 4, (f) => {
    const base = path.basename(f);
    if (base === ".env" || base.startsWith(".env.")) {
      const txt = fs.readFileSync(f, "utf8");
      const acct = txt.match(/^\s*(?:export\s+)?NEAR_ACCOUNT_ID\s*=\s*["']?([\w.-]+)/m)?.[1];
      for (const m of new Set(txt.match(SECRET_RE) ?? [])) found.push({ kind: "dotenv", path: f, secret: m, account_id: acct });
    }
  });
  for (const h of HISTORY) {
    const f = path.join(home, h);
    if (!fs.existsSync(f)) continue;
    const txt = fs.readFileSync(f, "utf8");
    const acct = txt.match(/NEAR_ACCOUNT_ID=["']?([\w.-]+)/)?.[1];
    for (const m of new Set(txt.match(SECRET_RE) ?? [])) found.push({ kind: "shell-history", path: f, secret: m, account_id: acct });
  }
  return found;
}
