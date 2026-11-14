// Test-only. Creates a fresh testnet account with the Stand-in guardian on it, for the owner-console wallet tests.
// Run from the repo root: node --import tsx apps/web/scripts/wallet-test/setup.ts [account-id] [--no-deploy]
// --no-deploy: create and fund the account only (2.3 NEAR), for the owner console's "Protect this account" / op=adopt runs.
// Keys -> .sandbox/wallet-test/ (gitignored, 0600). Prints only public ids and tx hashes.
import fs from "node:fs";
import path from "node:path";
import { Rpc } from "../../../../packages/lab/src/rpc.ts";
import { PublicKey, Wallet, actions, call, explorerTx, newKey } from "../../../../packages/lab/src/chain.ts";

const root = path.resolve(import.meta.dirname, "../../../..");
const dir = path.join(root, ".sandbox/wallet-test");
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const rpc = new Rpc(["https://near-testnet.drpc.org", "https://rpc.testnet.near.org", "https://rpc.testnet.fastnear.com"]);
const log = (m: string) => process.stdout.write(m + "\n");
// Guardian code source: the hosted lab's guardian (public view_code), so the test runs the deployed build.
const CODE_FROM = "lab-agent.si-project-5289.testnet";
const INTENTS = "si-intents-5289.testnet";
const WATCHER = "lab-watch.si-project-5289.testnet";
const PARENT = "si-project-5289.testnet";
const FUND = 2_050_000_000_000_000_000_000_000n; // 2.05 NEAR: guardian code is ~180 KB of storage
// 2.3 NEAR by default (WALLET_TEST_FUND_MILLI overrides, in milliNEAR): the owner console deploys from the wallet
const FUND_NO_DEPLOY = BigInt(process.env.WALLET_TEST_FUND_MILLI ?? "2300") * 10n ** 21n;

const noDeploy = process.argv.includes("--no-deploy");
const name = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? `standin-owner-${Date.now().toString(36)}.testnet`;
const keyFile = path.join(dir, `${name}.json`);
if (fs.existsSync(keyFile)) { log(`exists: ${keyFile}`); process.exit(0); }
const k = newKey();
fs.writeFileSync(keyFile, JSON.stringify({ account_id: name, public_key: k.public, private_key: k.secret }), { mode: 0o600 });

if (name.endsWith(`.${PARENT}`)) {
  // Faucet is rate-limited: fund a sub-account from the project parent instead (only public ids printed).
  const parentKey = JSON.parse(fs.readFileSync(path.join(root, `.secrets/keys/${PARENT}.json`), "utf8")).private_key as string;
  const p = new Wallet(rpc, PARENT, parentKey);
  const c = await p.send(name, [actions.createAccount(), actions.transfer(noDeploy ? FUND_NO_DEPLOY : FUND), actions.addFullAccessKey(PublicKey.from(k.public))]);
  log(`create ${name} from ${PARENT} ok=${c.ok} ${explorerTx(c.hash)} ${c.error ?? ""}`);
  if (!c.ok) process.exit(1);
} else {
  const res = await fetch("https://helper.testnet.near.org/account", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ newAccountId: name, newAccountPublicKey: k.public }),
  });
  log(`faucet create ${name}: http ${res.status}`);
  if (!res.ok) { log((await res.text()).slice(0, 300)); fs.rmSync(keyFile); process.exit(1); }
}
for (let i = 0; i < 20; i++) {
  const ok = await rpc.call("query", { request_type: "view_account", finality: "final", account_id: name }).then(() => true, () => false);
  if (ok) break;
  await new Promise((r) => setTimeout(r, 1500));
}
if (noDeploy) {
  fs.writeFileSync(path.join(dir, `${name}.account.json`), JSON.stringify({ account_id: name, public_key: k.public, deployed: false }, null, 2));
  log(`created ${name} with no contract (--no-deploy)`);
  process.exit(0);
}
const code = await rpc.call("query", { request_type: "view_code", finality: "final", account_id: CODE_FROM });
const wasm = Buffer.from(code.code_base64, "base64");
log(`guardian wasm ${wasm.length} bytes, hash ${code.hash}`);
const w = new Wallet(rpc, name, k.secret);
const r = await w.send(name, [actions.deployContract(wasm), call("new", { watcher: WATCHER, intents_contract: INTENTS }, 30)]);
log(`deploy+new ok=${r.ok} ${explorerTx(r.hash)} ${r.error ?? ""}`);
fs.writeFileSync(path.join(dir, "account.json"), JSON.stringify({ account_id: name, public_key: k.public, deploy_tx: r.hash }, null, 2));
