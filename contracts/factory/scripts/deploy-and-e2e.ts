// Testnet deploy + end-to-end for the guardian factory. Run from the repo root:
//   node --import tsx contracts/factory/scripts/deploy-and-e2e.ts deploy|e2e
// Keys: .secrets/keys/<account>.json (gitignored). Never prints key material. Prints tx hashes.
import fs from "node:fs";
import path from "node:path";
import { Rpc } from "../../../packages/lab/src/rpc.ts";
import { Wallet, waitTx, actions, addFullKey, call, newKey, nearAmount, PublicKey, explorerTx, NEAR } from "../../../packages/lab/src/chain.ts";

const root = path.resolve(import.meta.dirname, "../../..");
const keyDir = path.join(root, ".secrets/keys");
// si-guard-5289.testnet could not be created: top-level creation needs the testnet helper (rate limited).
const FACTORY = "guard.si-project-5289.testnet";
const OWNER = "owner.si-project-5289.testnet";
const WATCHER = "si-watch-5289.testnet";
const INTENTS = "si-intents-5289.testnet";
const rpc = new Rpc();
const log = (m: string) => process.stdout.write(m + "\n");

const keyPath = (id: string) => path.join(keyDir, `${id}.json`);
const readKey = (id: string) => JSON.parse(fs.readFileSync(keyPath(id), "utf8")) as { private_key: string; public_key: string };
const wallet = (id: string) => new Wallet(rpc, id, readKey(id).private_key);
const exists = (id: string) => rpc.call("query", { request_type: "view_account", finality: "final", account_id: id }).then(() => true, () => false);
const account = (id: string) => rpc.call("query", { request_type: "view_account", finality: "final", account_id: id });
async function view(id: string, method: string, args: object = {}) {
  const r = await rpc.call("query", { request_type: "call_function", finality: "optimistic", account_id: id, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
  return JSON.parse(Buffer.from(r.result).toString());
}
const keyList = (id: string) => rpc.call("query", { request_type: "view_access_key_list", finality: "optimistic", account_id: id });
const bal = async (id: string) => Number((BigInt((await account(id)).amount) * 1000n) / NEAR) / 1000;
function failure(r: any): string {
  const t = JSON.stringify(r.raw?.status ?? r.error ?? "").match(/"(?:FunctionCallError|ExecutionError)":"?([^"]{0,200})/);
  const rec = JSON.stringify(r.raw?.receipts_outcome ?? []).match(/"ExecutionError":"([^"]{0,200})/);
  return rec?.[1] ?? t?.[1] ?? r.error ?? "unknown";
}

async function sendx(w: Wallet, to: string, acts: any[]) {
  const { hash, b64 } = await w.build(to, acts);
  await rpc.call("send_tx", { signed_tx_base64: b64, wait_until: "NONE" }).catch(() => {});
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    try { return await waitTx(rpc, hash, w.accountId, "FINAL", 1); } catch {}
  }
  throw new Error(`no outcome for ${hash}`);
}
async function mustSend(label: string, w: Wallet, to: string, acts: any[]) {
  const r = await sendx(w, to, acts);
  log(`${label}: ok=${r.ok} ${r.hash}`);
  if (!r.ok) throw new Error(`${label} failed: ${failure(r)}`);
  return r;
}

async function ensureAccount(parent: Wallet, id: string, milli: number, fileKeyAs?: string) {
  if (await exists(id)) { log(`exists ${id}`); return; }
  const k = newKey();
  if (fileKeyAs) fs.writeFileSync(keyPath(fileKeyAs), JSON.stringify({ private_key: k.secret, public_key: k.public }), { mode: 0o600 });
  await mustSend(`create ${id}`, parent, id, [actions.createAccount(), actions.transfer(nearAmount(milli)), addFullKey(k.public)]);
}

if (process.argv[2] === "fund") {
  for (const [id, milli] of [["si-decoy-5289.testnet", 1500]] as const)
    await mustSend(`fund project from ${id}`, wallet(id), "si-project-5289.testnet", [actions.transfer(nearAmount(milli))]);
}

if (process.argv[2] === "deploy") {
  const proj = wallet("si-project-5289.testnet");
  log(`project balance ${await bal("si-project-5289.testnet")} NEAR`);
  await ensureAccount(proj, FACTORY, 3400, FACTORY);
  await ensureAccount(proj, OWNER, 4000, OWNER);
  const wasm = fs.readFileSync(path.join(root, "target/near/standin_guardian_factory.wasm"));
  const f = wallet(FACTORY);
  if ((await account(FACTORY)).code_hash === "11111111111111111111111111111111") {
    await mustSend("deploy factory + new", f, FACTORY, [actions.deployContract(wasm), call("new", {}, 30)]);
  }
  log(`required_deposit ${await view(FACTORY, "required_deposit")}`);
}

if (process.argv[2] === "e2e") {
  const name = process.argv[3] ?? `e2e${Date.now().toString(36)}`; // argv[3]: resume an already created guardian
  const guardian = `${name}.${FACTORY}`;
  const owner = wallet(OWNER), watch = wallet(WATCHER);
  if (!process.argv[3] && (await bal(OWNER)) < 4.5) await mustSend("top up owner (intents acct, funds only)", wallet("si-intents-5289.testnet"), OWNER, [actions.transfer(nearAmount(3000))]);
  const need = BigInt(await view(FACTORY, "required_deposit"));
  log(`create ${guardian} with deposit ${need} yocto`);
  if (!process.argv[3]) await mustSend("create_guardian", owner, FACTORY, [call("create_guardian", { name, watcher: WATCHER, intents_contract: INTENTS }, 100, need)]);
  const st0 = await view(guardian, "get_state");
  log(`state owner=${st0.owner} watcher=${st0.watcher} frozen=${st0.frozen} owner==OWNER:${st0.owner === OWNER}`);
  log(`guardians_of(owner)=${JSON.stringify(await view(FACTORY, "guardians_of", { owner: OWNER }))}`);
  log(`guardian access keys: ${(await keyList(guardian)).keys.length}`);

  const k = newKey();
  const addArgs = { public_key: k.public, receiver_id: "si-project-5289.testnet", method_names: ["record_deploy"], allowance: nearAmount(250).toString() };
  await mustSend("add_agent_key (owner)", owner, guardian, [call("add_agent_key", addArgs, 50)]);
  const kl = (await keyList(guardian)).keys;
  log(`guardian keys after add: ${kl.length} ${JSON.stringify(kl.map((x: any) => x.access_key.permission))}`);

  const bad = await sendx(watch, guardian, [call("add_agent_key", { ...addArgs, public_key: newKey().public }, 50)]);
  log(`REFUSAL non-owner add_agent_key: ok=${bad.ok} ${bad.hash} :: ${failure(bad)}`);
  log(`guardian self access-key list length (no key can sign as itself): ${(await keyList(guardian)).keys.length - kl.length + 0} extra beyond agent key`);

  await mustSend("freeze (watcher)", watch, guardian, [call("freeze", { reason: "e2e decoy tripped" }, 80)]);
  await new Promise((r) => setTimeout(r, 4000));
  const kl2 = (await keyList(guardian)).keys;
  log(`guardian keys after freeze: ${kl2.length}; frozen=${(await view(guardian, "get_state")).frozen}`);
  const again = await sendx(watch, guardian, [call("freeze", { reason: "second" }, 80)]);
  log(`REFUSAL second freeze: ok=${again.ok} ${again.hash} :: ${failure(again)}`);

  await mustSend("unfreeze (owner)", owner, guardian, [call("unfreeze", {}, 30)]);
  log(`frozen after unfreeze=${(await view(guardian, "get_state")).frozen}`);
  const before = await bal(OWNER), gb = await bal(guardian);
  await mustSend("withdraw 0.2 NEAR (owner)", owner, guardian, [call("withdraw", { amount: nearAmount(200).toString() }, 30)]);
  await new Promise((r) => setTimeout(r, 3000));
  log(`owner ${before} -> ${await bal(OWNER)}; guardian ${gb} -> ${await bal(guardian)}`);
  const over = await sendx(owner, guardian, [call("withdraw", { amount: nearAmount(900000).toString() }, 30)]);
  log(`REFUSAL withdraw above reserve: ok=${over.ok} ${over.hash} :: ${failure(over)}`);
  // failure path: duplicate name -> account exists -> refund
  const ob = await bal(OWNER);
  const dup = await sendx(owner, FACTORY, [call("create_guardian", { name, watcher: WATCHER, intents_contract: INTENTS }, 100, need)]);
  await new Promise((r) => setTimeout(r, 4000));
  log(`duplicate create: ok=${dup.ok} ${dup.hash}; owner ${ob} -> ${await bal(OWNER)} (refund expected: ~ -gas only)`);
  log(`guardians_of(owner)=${JSON.stringify(await view(FACTORY, "guardians_of", { owner: OWNER }))}`);
}
