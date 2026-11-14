// Read-only: print the derived EVM address for (agent account, path) and cross-check against the MPC contract's own view.
//   node --import tsx packages/chainsig/scripts/derive.ts
import { loadNetworkConfig, requireAccount } from "@standin/core";
import { PATH, deriveAddress } from "../src/derive.ts";

const cfg = loadNetworkConfig();
const d = await deriveAddress(cfg, requireAccount(cfg, "agent"), PATH);
process.stdout.write(JSON.stringify({ predecessor: requireAccount(cfg, "agent"), path: PATH, root_public_key: d.rootRaw, evm_address: d.address, matches_contract_view: d.matchesView }, null, 2) + "\n");
