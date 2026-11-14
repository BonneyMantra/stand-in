/**
 * Mainnet provisioning, idempotent: re-running skips what is already on chain.
 * Every tx goes through Signer.send -> budget guard. Keys land in .secrets/mainnet (0600), never in tracked files.
 *   node --import tsx packages/mainnet/scripts/provision.ts
 */
import fs from "node:fs";
import path from "node:path";
import { PublicKey, baseDecode } from "near-api-js";
import { generateSeedPhrase } from "near-seed-phrase";
import { appendEvent, repoRoot } from "@standin/core";
import {
  NEAR, Signer, accessKeys, accountExists, accountKeyPath, actions, agentFcKeyPath, balanceOf, decoyKeyPath, fmtNear,
  intentsKeyPath, loadKeyFile, mainnetConfig, mainnetKeysDir, newKeyPair, saveKey, tgas, view,
} from "../src/index.ts";

const HOME = process.env.STANDIN_HOME ?? path.join(repoRoot(), ".sandbox", "mainnet", ".standin");
process.env.STANDIN_HOME = HOME;
const cfgFile = path.join(repoRoot(), "config", "mainnet.json");
const statePath = path.join(mainnetKeysDir(), "state.json");
const cfg = mainnetConfig();
const ops = JSON.parse(fs.readFileSync(path.join(repoRoot(), ".secrets", "mainnet-ops.json"), "utf8"));
const opsSigner = new Signer(cfg, ops.account_id, ops.private_key);

const DECOY_LABELS = [
  { label: "public-repo-env", kind: "dotenv", path: "deploy-scripts/.env (committed to a public repo)" },
  { label: "seed-phrase", kind: "seed-phrase", path: "notes/near-wallet-seed.txt (bait folder)" },
  { label: "demo-scripted-thief", kind: "near-credentials", path: "demo: ~/.near-credentials/mainnet/<decoy>.json" },
];
const state: any = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : {};
const saveState = () => { fs.mkdirSync(path.dirname(statePath), { recursive: true }); fs.writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 }); };

async function pickName(prefix: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const id = `${prefix}-${1000 + Math.floor(Math.random() * 9000)}.near`;
    if (!(await accountExists(cfg, id))) return id;
  }
  throw new Error("no free name");
}

async function createNamed(role: string, prefix: string, depositNear: bigint) {
  state[role] ??= { account_id: await pickName(prefix) };
  const id: string = state[role].account_id;
  saveState();
  if (await accountExists(cfg, id)) { console.log(`${role}: ${id} exists`); return; }
  let kp = fs.existsSync(accountKeyPath(id)) ? loadKeyFile(accountKeyPath(id)) : { ...newKeyPair(), account_id: id };
  saveKey(accountKeyPath(id), kp);
  const r = await opsSigner.functionCall({
    purpose: "account", receiverId: "near", method: "create_account", gas: tgas(30), deposit: depositNear,
    args: { new_account_id: id, new_public_key: kp.public_key }, what: `create ${id}`,
  });
  state[role].create_tx = r.tx_hash;
  saveState();
  console.log(`${role}: created ${id} tx ${r.tx_hash} burnt ${fmtNear(r.gas_burnt_yocto)} NEAR`);
}

/** Implicit account (id = hex of the ed25519 key): no registrar fee, so the attacker-test account costs only its storage. */
async function createImplicit(role: string, depositYocto: bigint) {
  const f = path.join(mainnetKeysDir(), "attacker-test.json");
  const kp = fs.existsSync(f) ? loadKeyFile(f) : (() => { const k = newKeyPair(); const id = Buffer.from(baseDecode(k.public_key.slice(8))).toString("hex"); return { ...k, account_id: id }; })();
  saveKey(f, kp);
  state[role] = { account_id: kp.account_id }; saveState();
  if (await accountExists(cfg, kp.account_id)) { console.log(`${role}: ${kp.account_id} exists`); return; }
  const r = await opsSigner.send({ purpose: "account", receiverId: kp.account_id, acts: [actions.transfer(depositYocto)], amountYocto: depositYocto, gas: tgas(1), what: "fund attacker-test" });
  state[role].create_tx = r.tx_hash; saveState();
  console.log(`${role}: implicit ${kp.account_id} funded tx ${r.tx_hash}`);
}

async function main() {
  const only = process.argv[2];
  if (!only || only === "agent") await createNamed("agent", "standin-agent", (3n * NEAR) / 100n);
  if (!only || only === "decoy") await createNamed("decoy", "standin-decoy", (5n * NEAR) / 1000n);
  if (!only || only === "attacker") await createImplicit("attacker", (3n * NEAR) / 1000n);
  if (only) return;
  const accounts = { agent: state.agent.account_id, decoy: state.decoy.account_id, attacker: state.attacker.account_id, intents: "intents.near", project: "wrap.near" };
  const c = JSON.parse(fs.readFileSync(cfgFile, "utf8"));
  fs.writeFileSync(cfgFile, JSON.stringify({ ...c, accounts }, null, 2) + "\n");

  // bait: transfer 0.20 NEAR to the decoy (once)
  if (!state.bait_tx) {
    const r = await opsSigner.send({ purpose: "bait", receiverId: accounts.decoy, acts: [actions.transfer((1995n * NEAR) / 10000n)], amountYocto: (1995n * NEAR) / 10000n, gas: tgas(1), what: "fund bait" });
    state.bait_tx = r.tx_hash; saveState(); console.log(`bait funded tx ${r.tx_hash}`);
  }
  // decoy keys: the decoy admin key (from createNamed) adds one unique full-access key per leak location
  const admin = new Signer(cfg, accounts.decoy, loadKeyFile(accountKeyPath(accounts.decoy)).private_key);
  const onChain = new Set((await accessKeys(cfg, accounts.decoy)).map((k) => k.public_key));
  for (const d of DECOY_LABELS) {
    const f = decoyKeyPath(d.label);
    let k: any;
    if (fs.existsSync(f)) k = loadKeyFile(f);
    else if (d.label === "seed-phrase") { const s = generateSeedPhrase(); k = { account_id: accounts.decoy, label: d.label, public_key: s.publicKey, private_key: s.secretKey }; saveKey(path.join(mainnetKeysDir(), "decoys", "seed-phrase.words"), { account_id: accounts.decoy, public_key: s.publicKey, private_key: s.seedPhrase, label: "seed phrase words in private_key field" }); }
    else k = { account_id: accounts.decoy, label: d.label, ...newKeyPair() };
    saveKey(f, k);
    if (!onChain.has(k.public_key)) {
      const r = await admin.send({ purpose: "gas", receiverId: accounts.decoy, acts: [actions.addFullAccessKey(PublicKey.from(k.public_key))], gas: tgas(2), what: `addkey ${d.label}` });
      console.log(`decoy key ${d.label} ${k.public_key} added tx ${r.tx_hash}`);
    }
    if (!state[`planted_${d.label}`]) {
      appendEvent("decoy_planted", { account_id: accounts.decoy, public_key: k.public_key, kind: d.kind, path: d.path, agent: "manual", session_id: "", cwd: "", label: d.label, network: "mainnet" }, HOME);
      state[`planted_${d.label}`] = true; saveState();
    }
  }
  console.log("balances", Object.fromEntries(await Promise.all(Object.entries({ ops: ops.account_id, ...accounts }).filter(([k]) => !["intents", "project"].includes(k)).map(async ([k, v]) => [k, fmtNear(await balanceOf(cfg, v as string))]))));
  void view; void intentsKeyPath; void agentFcKeyPath;
}
main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
