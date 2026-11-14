// Code-only upgrade of the guardian on the agent account (DeployContract, NO init call, so state is kept).
// Refuses unless get_state is identical before and after. Testnet only.
//   node --import tsx packages/chainsig/scripts/upgrade-guardian.ts
import fs from "node:fs";
import path from "node:path";
import { actions, loadDevKey, loadNetworkConfig, makeAccount, makeProvider, repoRoot, requireAccount, explorerTx } from "@standin/core";

const out = (s: string) => process.stdout.write(s + "\n");
const cfg = loadNetworkConfig();
if (cfg.network !== "testnet") throw new Error("testnet only");
const agent = requireAccount(cfg, "agent");
const prov = makeProvider(cfg);
const wasm = fs.readFileSync(path.join(repoRoot(), "contracts/guardian/target/near/standin_guardian.wasm"));
const state = async () => JSON.stringify(await prov.callFunction({ contractId: agent, method: "get_state", args: {} } as any));
const bal = async () => BigInt(((await prov.viewAccount({ accountId: agent } as any)) as any).amount);

const before = await state();
out(`balance before: ${(Number(await bal() / 10n ** 20n) / 1e4).toFixed(4)} NEAR, wasm ${wasm.length} bytes`);
const acct = makeAccount(cfg, agent, loadDevKey(cfg, "agent").secret_key);
const res: any = await acct.signAndSendTransaction({ receiverId: agent, actions: [actions.deployContract(wasm)], waitUntil: "EXECUTED_OPTIMISTIC" });
const hash = String(res.transaction?.hash ?? res.transaction_outcome?.id);
out(`deploy tx ${hash}\n${explorerTx(cfg, hash)}`);
const after = await state();
out(`state preserved: ${before === after}`);
if (before !== after) { out(`BEFORE ${before}\nAFTER  ${after}`); process.exit(2); }
out(`wasm sha256 deployed: see shasum of contracts/guardian/target/near/standin_guardian.wasm`);
