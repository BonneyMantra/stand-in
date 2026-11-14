import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  loadNetworkConfig, makeProvider, poolSize, refillPool, repoRoot, standinHome, ROLES,
} from "@standin/core";
import { out, table } from "./util.ts";

const EMPTY = "11111111111111111111111111111111";

/** The ledger path the watcher on `port` reads, or null when nothing answers there. */
async function watcherLedger(port: number): Promise<string | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(800) });
    return r.ok ? String(((await r.json()) as { ledger?: string }).ledger ?? "?") : null;
  } catch {
    return null;
  }
}
const watcherUp = async (port: number) => (await watcherLedger(port)) !== null;

/** Idempotent: check accounts and deployments, top the decoy pool up, start the watcher if it is not running. */
export async function devUp(opts: { noWatcher?: boolean; pool?: number } = {}): Promise<boolean> {
  const cfg = loadNetworkConfig();
  const prov = makeProvider(cfg);
  const needsCode = new Set(["agent", "project", "registry", "intents"]);
  const rows: string[][] = [];
  let ok = true;
  for (const r of ROLES) {
    const id = cfg.accounts[r];
    if (!id) { rows.push([r, "(missing in config)", "-", "MISSING"]); ok = false; continue; }
    try {
      const a: any = await prov.viewAccount({ accountId: id } as any);
      const hasCode = a.code_hash !== EMPTY;
      const state = needsCode.has(r) ? (hasCode ? "contract deployed" : "NO CONTRACT YET") : "exists";
      if (needsCode.has(r) && !hasCode) ok = false;
      rows.push([r, id, `${(Number(BigInt(a.amount) / 10n ** 21n) / 1000).toFixed(2)} NEAR`, state]);
    } catch {
      rows.push([r, id, "-", "ACCOUNT MISSING"]);
      ok = false;
    }
  }
  out(table(rows, ["role", "account", "balance", "state"]));

  const home = standinHome();
  fs.mkdirSync(home, { recursive: true });
  const target = opts.pool ?? Number(process.env.STANDIN_POOL_SIZE ?? 8);
  const added = await refillPool(target, cfg, home);
  out(`decoy pool: ${poolSize(home)}/${target} keys (${added} minted now) in ${home}`);

  const port = Number(process.env.STANDIN_WATCHER_PORT ?? 4317);
  if (opts.noWatcher) return ok;
  const running = await watcherLedger(port);
  if (running !== null) {
    if (running !== path.join(home, "ledger.ndjson")) {
      out(`port ${port} is taken by a watcher for another home (ledger ${running}); it would not see this home's decoys. Start this one on a free port: STANDIN_WATCHER_PORT=<port> standin dev up`);
      return false;
    }
    fs.writeFileSync(path.join(home, "watcher.port"), String(port));
    out(`watcher already running on 127.0.0.1:${port}`);
    return ok;
  }
  const main = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../watcher/src/main.ts");
  const logFile = path.join(home, "watcher.log");
  const fd = fs.openSync(logFile, "a");
  const child = spawn(process.execPath, ["--import", "tsx", main], {
    cwd: repoRoot(), detached: true, stdio: ["ignore", fd, fd], env: { ...process.env, STANDIN_HOME: home },
  });
  child.unref();
  fs.writeFileSync(path.join(home, "watcher.pid"), String(child.pid));
  for (let i = 0; i < 40; i++) {
    if (await watcherUp(port)) { fs.writeFileSync(path.join(home, "watcher.port"), String(port)); out(`watcher started (pid ${child.pid}), log ${logFile}`); return ok; }
    await new Promise((r) => setTimeout(r, 250));
  }
  out(`watcher did not come up; see ${logFile}`);
  return false;
}
