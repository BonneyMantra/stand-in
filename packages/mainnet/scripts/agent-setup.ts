/** Provision the agent's FC key and register its intents key on the real intents.near. */
import path from "node:path";
import { repoRoot } from "@standin/core";
import { fmtNear, mainnetConfig, accessKeys, balanceOf } from "../src/index.ts";
import { intentsHas, intentsKeys, provisionFcKey, registerIntentsKey } from "../src/agent.ts";

const cfg = mainnetConfig();
void path; void repoRoot;
console.log("has before", await intentsHas(cfg, "ed25519:11111111111111111111111111111111").catch((e) => String(e).slice(0, 100)));
const it = await registerIntentsKey(cfg);
console.log(`intents add tx ${it.tx.tx_hash} block ${it.tx.block_height} burnt ${fmtNear(it.tx.gas_burnt_yocto)}`);
console.log("has_public_key", await intentsHas(cfg, it.public_key), "keys", await intentsKeys(cfg));
console.log("agent keys", (await accessKeys(cfg, cfg.accounts.agent)).map((k) => `${k.public_key.slice(0, 16)}:${k.access_key.permission === "FullAccess" ? "FA" : "FC"}`), "balance", fmtNear(await balanceOf(cfg, cfg.accounts.agent)));
