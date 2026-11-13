import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { devKeysDir } from "@standin/core";

/**
 * Where a real full-access key goes after `adopt`.
 *  - dev (default): <repo>/.secrets/real/<account>.json  (gitignored)
 *  - keychain: macOS login keychain via `security` (service "standin-real-key"); use on a real machine.
 */
export type StoreKind = "dev" | "keychain";

export function storeRealKey(kind: StoreKind, accountId: string, secretKey: string, publicKey: string): string {
  if (kind === "keychain") {
    execFileSync("security", ["add-generic-password", "-s", "standin-real-key", "-a", accountId, "-w", secretKey, "-U"], { stdio: "ignore" });
    return `keychain:standin-real-key/${accountId}`;
  }
  const dir = path.join(devKeysDir(), "real");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const f = path.join(dir, `${accountId}.json`);
  fs.writeFileSync(f, JSON.stringify({ account_id: accountId, public_key: publicKey, private_key: secretKey }, null, 2), { mode: 0o600 });
  return f;
}

export function readRealKey(kind: StoreKind, accountId: string): string | null {
  try {
    if (kind === "keychain") {
      return execFileSync("security", ["find-generic-password", "-s", "standin-real-key", "-a", accountId, "-w"]).toString().trim();
    }
    return JSON.parse(fs.readFileSync(path.join(devKeysDir(), "real", `${accountId}.json`), "utf8")).private_key;
  } catch {
    return null;
  }
}
