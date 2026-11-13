import fs from "node:fs";
import path from "node:path";
import { appendEvent, type LedgerEvent } from "./ledger.ts";
import { standinHome } from "./config.ts";

export const PLANT_KINDS = ["near-credentials", "dotenv", "shell-history", "session-env"] as const;
export type PlantKind = (typeof PLANT_KINDS)[number];
export type AgentName = "claude-code" | "codex" | "manual";

export interface PlantOpts {
  kind: PlantKind;
  /** near-credentials: file path (or use credentialsPath()). dotenv/shell-history: file path.
   *  session-env: optional file to append `export` lines to (e.g. $CLAUDE_ENV_FILE). */
  path?: string;
  decoyAccountId: string;
  key: { public_key: string; secret_key: string };
  agent: AgentName;
  session_id?: string;
  cwd?: string;
  network?: string;
  home?: string; // STANDIN_HOME for the ledger
}

/** <base>/.near-credentials/<network>/<account>.json  (the near-cli layout) */
export function credentialsPath(base: string, network: string, accountId: string): string {
  return path.join(base, ".near-credentials", network, `${accountId}.json`);
}

function setEnvLines(file: string, vars: Record<string, string>) {
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n") : [];
  const keep = existing.filter((l) => !Object.keys(vars).some((k) => new RegExp(`^\\s*(export\\s+)?${k}=`).test(l)));
  while (keep.length && keep[keep.length - 1] === "") keep.pop();
  const add = Object.entries(vars).map(([k, v]) => `${k}=${v}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, [...keep, ...add].join("\n") + "\n");
}

/**
 * Plant a decoy at a path and record `decoy_planted` in the ledger. Returns the ledger event.
 * The same (account, key) pair is written everywhere for one session, but every plant call
 * should receive a distinct key from takeDecoy() so a leak identifies the exact location.
 */
export function plantDecoy(o: PlantOpts): LedgerEvent {
  const network = o.network ?? "testnet";
  const vars = { NEAR_ACCOUNT_ID: o.decoyAccountId, NEAR_PRIVATE_KEY: o.key.secret_key, NEAR_ENV: network };
  let where = o.path ?? "";
  switch (o.kind) {
    case "near-credentials": {
      if (!where) throw new Error("near-credentials plant needs path");
      fs.mkdirSync(path.dirname(where), { recursive: true });
      fs.writeFileSync(
        where,
        JSON.stringify({ account_id: o.decoyAccountId, public_key: o.key.public_key, private_key: o.key.secret_key }, null, 2),
        { mode: 0o600 },
      );
      break;
    }
    case "dotenv":
      if (!where) throw new Error("dotenv plant needs path");
      setEnvLines(where, vars);
      break;
    case "shell-history": {
      if (!where) throw new Error("shell-history plant needs path");
      fs.mkdirSync(path.dirname(where), { recursive: true });
      const line = `export NEAR_ENV=${network} NEAR_ACCOUNT_ID=${o.decoyAccountId} NEAR_PRIVATE_KEY=${o.key.secret_key}\n`;
      fs.appendFileSync(where, line);
      break;
    }
    case "session-env":
      if (where) fs.appendFileSync(where, Object.entries(vars).map(([k, v]) => `export ${k}=${v}\n`).join(""));
      break;
  }
  return appendEvent(
    "decoy_planted",
    {
      account_id: o.decoyAccountId, public_key: o.key.public_key, kind: o.kind, path: where,
      agent: o.agent, session_id: o.session_id ?? "", cwd: o.cwd ?? "",
    },
    o.home ?? standinHome(),
  );
}

/** Env vars a launcher can export for a session-env decoy (no file write, no ledger event). */
export function decoyEnv(decoyAccountId: string, secretKey: string, network = "testnet") {
  return { NEAR_ACCOUNT_ID: decoyAccountId, NEAR_PRIVATE_KEY: secretKey, NEAR_ENV: network };
}
