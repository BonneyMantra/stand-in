import fs from "node:fs";
import path from "node:path";
import {
  appendEvent, callMethod, credentialsPath, explorerTx, generateKey, homeAccountIds, loadNetworkConfig, loadScopedKey, logger, makeAccount,
  makeProvider, publicKeyOf, readEvents, refillPool, repoConfigFile, requireAccount, saveScopedKey, takeDecoy, type NetworkConfig,
} from "@standin/core";
import { validateTestnetAccount } from "./adopt-wallet.ts";
import { ensureGuardian, MIN_GUARDIAN_BALANCE } from "./adopt-guardian.ts";
import { checkFunding, createHomeAccounts, liveHomeChain, planHomeAccounts, HomeRefusal, watcherMismatch, writeHomeConfig } from "./home-accounts.ts";
import { storeRealKey, type StoreKind } from "./keystore.ts";
import { scanHome, type Found } from "./scan.ts";
import { out, short, table } from "./util.ts";

const log = logger("adopt");
const EMPTY = "11111111111111111111111111111111";

export interface AdoptOpts {
  home: string;
  store: StoreKind;
  scopedMethods: string[];
  allowance: string;
  /** the account to protect (default: the config's agent account) */
  account?: string;
}

/** Real full-access key for `accountId`? (checked on chain) */
async function isFullAccess(cfg: NetworkConfig, accountId: string, pk: string): Promise<boolean> {
  try {
    const k: any = await makeProvider(cfg).viewAccessKey({ accountId, publicKey: pk } as any);
    return k.permission === "FullAccess";
  } catch {
    return false;
  }
}

const isMainnetLoc = (f: Found) => !!f.account_id?.endsWith(".near") || f.path.split(path.sep).includes("mainnet");
/** The project's own film account keeps the project's bait and watcher (their keys are in <repo>/.secrets). */
const filmAgent = () => { try { return loadNetworkConfig(repoConfigFile()).accounts.agent; } catch { return ""; } };

export async function adopt(o: AdoptOpts): Promise<void> {
  const home = o.home;
  if (!fs.existsSync(home)) throw new Error(`--home ${home} does not exist`);
  if (!process.env.STANDIN_HOME) process.env.STANDIN_HOME = path.join(home, ".standin");
  const ledgerHome = process.env.STANDIN_HOME;
  let cfg = loadNetworkConfig();
  if (cfg.network !== "testnet") throw new Error(`config network is ${cfg.network}; adopt supports testnet only`);
  if (o.account) {
    const bad = validateTestnetAccount(o.account);
    if (bad) throw new Error(bad);
  }
  const agent = o.account ?? requireAccount(cfg, "agent");
  const project = requireAccount(cfg, "project");
  if (agent === project) throw new Error(`the agent key's receiver may not be the guardian account ${agent} itself`);
  // Any other account gets its own bait and watcher, created below with its owner key: no key of ours is needed.
  const selfServe = agent !== filmAgent();
  const decoyId = selfServe ? homeAccountIds(agent).bait : requireAccount(cfg, "decoy");

  const planted = new Set(readEvents({ type: "decoy_planted" }, ledgerHome).map((e) => String(e.public_key)));
  const all = scanHome(home);
  const mainnet = all.filter(isMainnetLoc);
  const decoys = all.filter((f) => !isMainnetLoc(f) && (f.account_id === decoyId || f.account_id === requireAccount(cfg, "decoy") || planted.has(publicKeyOf(f.secret))));
  const found = all.filter((f) => !mainnet.includes(f) && !decoys.includes(f));
  for (const f of mainnet) out(`note: ${path.relative(home, f.path)} (${f.account_id ?? "mainnet"}) is a mainnet key; Stand-in is testnet only, left untouched`);
  if (!found.length) {
    out(decoys.length
      ? `already adopted: ${decoys.length} Stand-in decoy key(s) in place under ${home}, no real NEAR key left to move`
      : `no NEAR secret keys found under ${home}${o.account ? ` (expected a full-access key for ${o.account} in .near-credentials/testnet/${o.account}.json, a .env or shell history)` : ""}`);
    return;
  }

  // Every real key is saved first, whatever the chain says: nothing below may leave a key with no copy.
  const rows: string[][] = [];
  const bySecret = new Map<string, Found[]>();
  for (const f of found) bySecret.set(f.secret, [...(bySecret.get(f.secret) ?? []), f]);
  const accountOf = (locs: Found[]) => locs.find((l) => l.account_id)?.account_id ?? agent;
  const kept = new Map<string, string>();
  for (const [secret, locs] of bySecret) kept.set(secret, storeRealKey(o.store, accountOf(locs), secret, publicKeyOf(secret)));
  let ownerSecret = "";
  for (const [secret, locs] of bySecret) {
    if (accountOf(locs) === agent && (await isFullAccess(cfg, agent, publicKeyOf(secret)))) { ownerSecret = secret; break; }
  }

  let scopedPk = "";
  if (ownerSecret) {
    const owner = makeAccount(cfg, agent, ownerSecret);
    if (selfServe) cfg = await setUpHomeAccounts(cfg, agent, owner, ledgerHome, rows);
    const g = await ensureGuardian(cfg, agent, owner);
    if (g.deployed) {
      rows.push([short(publicKeyOf(ownerSecret)), agent, "(guardian)", `guardian deployed, watcher ${requireAccount(cfg, "watcher")}`, `deploy tx ${g.tx_hash}`]);
      out(`guardian deployed on ${agent}: ${explorerTx(cfg, g.tx_hash!)}`);
    }
    scopedPk = await provisionScopedKey(cfg, agent, owner, project, o, ledgerHome, rows, publicKeyOf(ownerSecret));
  } else if (selfServe && cfg.accounts.decoy !== decoyId) {
    throw new HomeRefusal(`no full-access key for ${agent} under ${home}: adopt needs it once to create ${decoyId} and ${homeAccountIds(agent).watcher} (the bait and the watcher this home runs). Put it in .near-credentials/testnet/${agent}.json, or use \`standin adopt --wallet --account ${agent} --home ${home}\`. Nothing was changed on chain; real keys were copied to ${[...kept.values()][0]}`);
  }

  // Mint every decoy in one transaction first (on this home's bait when self-serve): concurrent mints collide on the nonce.
  const decoy = requireAccount(cfg, "decoy");
  await refillPool(found.length, cfg, ledgerHome);
  for (const [secret, locs] of bySecret) {
    const pk = publicKeyOf(secret);
    const account = accountOf(locs);
    if (secret !== ownerSecret && !(await isFullAccess(cfg, account, pk))) out(`note: ${short(pk)} (${account}) is not a full-access key on chain; replacing its copies anyway (the real key is saved at ${kept.get(secret)})`);
    for (const loc of locs) {
      const d = await takeDecoy({ cfg, home: ledgerHome, refill: false });
      replace(loc, secret, account, decoy, d);
      const newPath = loc.kind === "near-credentials" ? credentialsPath(path.dirname(path.dirname(loc.path)), path.basename(path.dirname(loc.path)), decoy) : loc.path;
      appendEvent("decoy_planted", {
        account_id: decoy, public_key: d.public_key, kind: loc.kind, path: newPath, agent: "manual", session_id: "", cwd: home, replaced_real_key: pk,
      }, ledgerHome);
      rows.push([short(pk), account, `${loc.kind}: ${path.relative(home, loc.path)}`, `decoy ${short(d.public_key)} (${decoy})`, kept.get(secret)!]);
    }
  }
  out(table(rows, ["real key", "account", "was at", "now", "real key moved to"]));
  out(`\nledger: ${ledgerHome}/ledger.ndjson`);
  if (scopedPk) {
    out(`agent scoped key: ${ledgerHome}/agent-scoped-key.json (${scopedPk})`);
    if (selfServe) out(`config for this home: ${cfg.file} (guardian ${agent}, bait ${decoy}, watcher ${requireAccount(cfg, "watcher")}; their keys in ${ledgerHome}/keys)`);
    out(`start the watcher for it:  standin dev up --home ${home}   (STANDIN_WATCHER_PORT=<free port> if :4317 is taken)`);
  }
}

/** Self-serve: checks the guardian's watcher and the funding, creates the bait and watcher with the owner key, writes the home config. */
async function setUpHomeAccounts(cfg: NetworkConfig, agent: string, owner: ReturnType<typeof makeAccount>, ledgerHome: string, rows: string[][]): Promise<NetworkConfig> {
  const chain = liveHomeChain(cfg);
  const ids = homeAccountIds(agent);
  const acc = await chain.account(agent);
  if (!acc) throw new HomeRefusal(`${agent} does not exist on testnet; create and fund it first`);
  if (acc.code_hash !== EMPTY) {
    const st: any = await makeProvider(cfg).callFunction({ contractId: agent, method: "get_state", args: {} } as any).catch(() => null);
    if (st && typeof st === "object" && "watcher" in st && String(st.watcher) !== ids.watcher) throw new HomeRefusal(watcherMismatch(agent, String(st.watcher), ids.watcher));
  }
  const plan = await planHomeAccounts(agent, ledgerHome, chain);
  await checkFunding(chain, plan, acc.code_hash === EMPTY ? MIN_GUARDIAN_BALANCE : 0n);
  for (const c of await createHomeAccounts(owner, plan)) {
    out(`created ${c.account_id} (0.2 NEAR, key in ${ledgerHome}/keys): ${explorerTx(cfg, c.tx_hash)}`);
    rows.push(["-", c.account_id, "(new account)", c.account_id === ids.bait ? "bait: every decoy is a key on it" : "watcher: freezes the guardian", `tx ${c.tx_hash}`]);
  }
  const file = writeHomeConfig(ledgerHome, cfg, agent, plan);
  process.env.STANDIN_CONFIG = file;
  return loadNetworkConfig(file);
}

/** The agent's scoped key on the guardian: kept when it is still registered, else a fresh one (guardian.add_agent_key). */
async function provisionScopedKey(cfg: NetworkConfig, agent: string, owner: ReturnType<typeof makeAccount>, project: string, o: AdoptOpts, ledgerHome: string, rows: string[][], ownerPk: string): Promise<string> {
  const prev = loadScopedKey(ledgerHome);
  const st: any = await makeProvider(cfg).callFunction({ contractId: agent, method: "get_state", args: {} } as any);
  if (prev && prev.account_id === agent && (st.agent_keys ?? []).includes(prev.public_key)) {
    rows.push([short(ownerPk), agent, "(provisioned)", `scoped FC key ${short(prev.public_key)} already on the guardian`, "-"]);
    return prev.public_key;
  }
  const scoped = generateKey();
  const res = await callMethod(owner, agent, "add_agent_key", {
    public_key: scoped.public_key, receiver_id: project, method_names: o.scopedMethods, allowance: o.allowance,
  }, { waitUntil: "EXECUTED_OPTIMISTIC" });
  saveScopedKey({
    account_id: agent, public_key: scoped.public_key, secret_key: scoped.secret_key, receiver_id: project,
    method_names: o.scopedMethods, created_at: new Date().toISOString(),
  }, ledgerHome);
  log.info(`guardian.add_agent_key tx ${res.tx_hash}`);
  rows.push([short(ownerPk), agent, "(provisioned)", `scoped FC key ${short(scoped.public_key)} -> ${project}`, `guardian tx ${res.tx_hash}`]);
  return scoped.public_key;
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
