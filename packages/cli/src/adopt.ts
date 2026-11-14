import fs from "node:fs";
import path from "node:path";
import {
  appendEvent, callMethod, credentialsPath, explorerTx, generateKey, loadNetworkConfig, loadScopedKey, logger, makeAccount, makeProvider,
  publicKeyOf, readEvents, refillPool, requireAccount, saveScopedKey, takeDecoy,
} from "@standin/core";
import { validateTestnetAccount } from "./adopt-wallet.ts";
import { ensureGuardian } from "./adopt-guardian.ts";
import { storeRealKey, type StoreKind } from "./keystore.ts";
import { scanHome, type Found } from "./scan.ts";
import { out, short, table } from "./util.ts";

const log = logger("adopt");

export interface AdoptOpts {
  home: string;
  store: StoreKind;
  scopedMethods: string[];
  allowance: string;
  /** the account to protect (default: the config's agent account) */
  account?: string;
}

/** Real full-access key for `accountId`? (checked on chain) */
async function isFullAccess(cfg: ReturnType<typeof loadNetworkConfig>, accountId: string, pk: string): Promise<boolean> {
  try {
    const k: any = await makeProvider(cfg).viewAccessKey({ accountId, publicKey: pk } as any);
    return k.permission === "FullAccess";
  } catch {
    return false;
  }
}

const isMainnetLoc = (f: Found) => !!f.account_id?.endsWith(".near") || f.path.split(path.sep).includes("mainnet");

export async function adopt(o: AdoptOpts): Promise<void> {
  const cfg = loadNetworkConfig();
  if (cfg.network !== "testnet") throw new Error(`config network is ${cfg.network}; adopt supports testnet only`);
  const home = o.home;
  if (!fs.existsSync(home)) throw new Error(`--home ${home} does not exist`);
  if (o.account) {
    const bad = validateTestnetAccount(o.account);
    if (bad) throw new Error(bad.replace("adopt --wallet", "adopt"));
  }
  if (!process.env.STANDIN_HOME) process.env.STANDIN_HOME = path.join(home, ".standin");
  const ledgerHome = process.env.STANDIN_HOME;
  const agent = o.account ?? requireAccount(cfg, "agent");
  const decoy = requireAccount(cfg, "decoy");
  const project = requireAccount(cfg, "project");
  if (agent === project) throw new Error(`the agent key's receiver may not be the guardian account ${agent} itself`);

  const planted = new Set(readEvents({ type: "decoy_planted" }, ledgerHome).map((e) => String(e.public_key)));
  const all = scanHome(home);
  const mainnet = all.filter(isMainnetLoc);
  const decoys = all.filter((f) => !isMainnetLoc(f) && (f.account_id === decoy || planted.has(publicKeyOf(f.secret))));
  const found = all.filter((f) => !mainnet.includes(f) && !decoys.includes(f));
  for (const f of mainnet) out(`note: ${path.relative(home, f.path)} (${f.account_id ?? "mainnet"}) is a mainnet key; Stand-in is testnet only, left untouched`);
  if (!found.length) {
    out(decoys.length
      ? `already adopted: ${decoys.length} Stand-in decoy key(s) in place under ${home}, no real NEAR key left to move`
      : `no NEAR secret keys found under ${home}${o.account ? ` (expected a full-access key for ${o.account} in .near-credentials/testnet/${o.account}.json, a .env or shell history)` : ""}`);
    return;
  }

  // Mint every decoy in one transaction first: concurrent mints from the decoy admin key collide on its nonce.
  await refillPool(found.length, cfg, ledgerHome);
  const rows: string[][] = [];
  const bySecret = new Map<string, Found[]>();
  for (const f of found) bySecret.set(f.secret, [...(bySecret.get(f.secret) ?? []), f]);

  let scopedPk = "";
  let configFile = "";
  for (const [secret, locs] of bySecret) {
    const pk = publicKeyOf(secret);
    const account = locs.find((l) => l.account_id)?.account_id ?? agent;
    const full = await isFullAccess(cfg, account, pk);
    // The real key is saved first, whatever the chain says: nothing below may leave a key with no copy.
    const kept = storeRealKey(o.store, account, secret, pk);
    if (full) {
      if (account === agent && !scopedPk) {
        const owner = makeAccount(cfg, agent, secret);
        const g = await ensureGuardian(cfg, agent, owner);
        if (g.deployed) {
          rows.push([short(pk), account, "(guardian)", `guardian deployed on ${agent}`, `deploy tx ${g.tx_hash}`]);
          out(`guardian deployed on ${agent}: ${explorerTx(cfg, g.tx_hash!)}`);
        }
        const prev = loadScopedKey(ledgerHome);
        const st: any = await makeProvider(cfg).callFunction({ contractId: agent, method: "get_state", args: {} } as any);
        if (prev && prev.account_id === agent && (st.agent_keys ?? []).includes(prev.public_key)) {
          scopedPk = prev.public_key;
          rows.push([short(pk), account, "(provisioned)", `scoped FC key ${short(prev.public_key)} already on the guardian`, "-"]);
        } else {
          const scoped = generateKey();
          const res = await callMethod(owner, agent, "add_agent_key", {
            public_key: scoped.public_key, receiver_id: project, method_names: o.scopedMethods, allowance: o.allowance,
          }, { waitUntil: "EXECUTED_OPTIMISTIC" });
          saveScopedKey({
            account_id: agent, public_key: scoped.public_key, secret_key: scoped.secret_key, receiver_id: project,
            method_names: o.scopedMethods, created_at: new Date().toISOString(),
          }, ledgerHome);
          scopedPk = scoped.public_key;
          log.info(`guardian.add_agent_key tx ${res.tx_hash}`);
          rows.push([short(pk), account, "(provisioned)", `scoped FC key ${short(scoped.public_key)} -> ${project}`, `guardian tx ${res.tx_hash}`]);
        }
        if (agent !== cfg.accounts.agent) {
          configFile = path.join(ledgerHome, "config.json");
          fs.writeFileSync(configFile, JSON.stringify({ ...cfg.raw, accounts: { ...(cfg.raw.accounts as object), ...cfg.accounts, agent } }, null, 2) + "\n");
          process.env.STANDIN_CONFIG = configFile;
        }
      }
    } else {
      out(`note: ${short(pk)} (${account}) is not a full-access key on chain; replacing its copies anyway (the real key is saved at ${kept})`);
    }
    for (const loc of locs) {
      const d = await takeDecoy({ home: ledgerHome, refill: false });
      replace(loc, secret, account, decoy, d);
      const newPath = loc.kind === "near-credentials" ? credentialsPath(path.dirname(path.dirname(loc.path)), path.basename(path.dirname(loc.path)), decoy) : loc.path;
      appendEvent("decoy_planted", {
        account_id: decoy, public_key: d.public_key, kind: loc.kind, path: newPath, agent: "manual", session_id: "", cwd: home,
        replaced_real_key: pk,
      }, ledgerHome);
      rows.push([short(pk), account, `${loc.kind}: ${path.relative(home, loc.path)}`, `decoy ${short(d.public_key)} (${decoy})`, kept]);
    }
  }
  out(table(rows, ["real key", "account", "was at", "now", "real key moved to"]));
  out(`\nledger: ${ledgerHome}/ledger.ndjson`);
  if (scopedPk) {
    out(`agent scoped key: ${ledgerHome}/agent-scoped-key.json (${scopedPk})`);
    const env = `STANDIN_HOME=${ledgerHome}${configFile ? ` STANDIN_CONFIG=${configFile}` : ""}`;
    if (configFile) out(`config for this home: ${configFile} (agent = ${agent})`);
    out(`start the watcher for it:  ${env} STANDIN_WATCHER_PORT=<free port> pnpm standin dev up   (or run the other commands with --home ${home})`);
  }
}

/** Overwrite one location with a decoy: credentials file is rewritten (filename = decoy id), text files get the key and account swapped. */
function replace(loc: Found, secret: string, account: string, decoyAccount: string, d: { public_key: string; secret_key: string }) {
  if (loc.kind === "near-credentials") {
    const dir = path.dirname(loc.path);
    fs.rmSync(loc.path);
    fs.writeFileSync(
      path.join(dir, `${decoyAccount}.json`),
      JSON.stringify({ account_id: decoyAccount, public_key: d.public_key, private_key: d.secret_key }, null, 2), { mode: 0o600 },
    );
    return;
  }
  const txt = fs.readFileSync(loc.path, "utf8");
  fs.writeFileSync(loc.path, txt.split(secret).join(d.secret_key).split(account).join(decoyAccount));
}
