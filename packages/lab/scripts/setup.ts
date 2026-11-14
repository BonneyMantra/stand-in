// One-off provisioning of the hosted lab's testnet accounts. Run: node --import tsx packages/lab/scripts/setup.ts
// Keys -> <repo>/.secrets/lab/*.json (0600). Public ids -> config/lab.json. Never prints keys.
import fs from "node:fs";
import path from "node:path";
import { Rpc } from "../src/rpc.ts";
import { Wallet, actions, addFullKey, call, newKey, nearAmount, PublicKey, explorerTx } from "../src/chain.ts";

const root = path.resolve(import.meta.dirname, "../../..");
const dir = path.join(root, ".secrets/lab");
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const parent = "si-project-5289.testnet";
const A = { agent: `lab-agent.${parent}`, decoy: `lab-decoy.${parent}`, thief: `lab-thief.${parent}`, watcher: `lab-watch.${parent}` };
const intents = "si-intents-5289.testnet";
const rpc = new Rpc();

function keyFile(name: string) {
  const f = path.join(dir, `${name}.json`);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8")) as { secret: string; public: string };
  const k = newKey();
  fs.writeFileSync(f, JSON.stringify(k), { mode: 0o600 });
  return k;
}
const log = (m: string) => process.stderr.write(m + "\n");

const projKey = JSON.parse(fs.readFileSync(path.join(root, ".secrets/keys/si-project-5289.testnet.json"), "utf8")).private_key as string;
const proj = new Wallet(rpc, parent, projKey);

const exists = async (id: string) => rpc.call("query", { request_type: "view_account", finality: "final", account_id: id }).then(() => true, () => false);

const keys = { agent: keyFile("agent-owner"), decoy: keyFile("decoy-admin"), thief: keyFile("thief"), watchAdmin: keyFile("watch-admin"), watchFc: keyFile("watch-fc") };
const fund: Record<string, [number, any[]]> = {
  [A.agent]: [2300, [addFullKey(keys.agent.public)]],
  [A.decoy]: [1300, [addFullKey(keys.decoy.public)]],
  [A.thief]: [300, [addFullKey(keys.thief.public)]],
  [A.watcher]: [500, [addFullKey(keys.watchAdmin.public), actions.addFunctionCallAccessKey(PublicKey.from(keys.watchFc.public), A.agent, ["freeze"], nearAmount(500))]],
};
for (const [id, [milli, acts]] of Object.entries(fund)) {
  if (await exists(id)) { log(`exists ${id}`); continue; }
  const r = await proj.send(id, [actions.createAccount(), actions.transfer(nearAmount(milli)), ...acts]);
  log(`created ${id} ok=${r.ok} ${explorerTx(r.hash)}`);
}

const agent = new Wallet(rpc, A.agent, keys.agent.secret);
const wasm = fs.readFileSync(path.join(root, "contracts/guardian/target/near/standin_guardian.wasm"));
const st = await rpc.call("query", { request_type: "view_account", finality: "final", account_id: A.agent });
if (st.code_hash === "11111111111111111111111111111111") {
  const r = await agent.send(A.agent, [actions.deployContract(wasm), call("new", { watcher: A.watcher, intents_contract: intents }, 30)]);
  log(`deployed guardian ok=${r.ok} ${explorerTx(r.hash)} ${r.error ?? ""}`);
}
const view = async () => JSON.parse(Buffer.from((await rpc.call("query", { request_type: "call_function", finality: "optimistic", account_id: A.agent, method_name: "get_state", args_base64: "e30=" })).result).toString());
let s = await view();
if (!s.agent_keys?.length) {
  const k = newKey();
  const r = await agent.send(A.agent, [call("add_agent_key", { public_key: k.public, receiver_id: parent, method_names: ["record_deploy"], allowance: nearAmount(250).toString() }, 30)]);
  log(`add_agent_key ok=${r.ok} ${explorerTx(r.hash)} ${r.error ?? ""}`);
  s = await view();
}
log(`guardian: frozen=${s.frozen} agent_keys=${s.agent_keys?.length} watcher=${s.watcher}`);

fs.writeFileSync(path.join(root, "config/lab.json"), JSON.stringify({
  network: "testnet", parent, intents, thief_loot_milli_near: 50,
  accounts: { agent: A.agent, decoy: A.decoy, thief: A.thief, watcher: A.watcher },
  watcher_fc_public_key: keys.watchFc.public, ntfy_topic_env: "STANDIN_LAB_NTFY_TOPIC",
}, null, 2) + "\n");
log("wrote config/lab.json");
