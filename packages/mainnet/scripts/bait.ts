/**
 * PREPARE (never publish) the live-bait artifacts in .sandbox/mainnet/bait/ (gitignored). The coordinator decides
 * where and whether to publish. Secrets are written only into these gitignored files, never printed.
 *   node --import tsx packages/mainnet/scripts/bait.ts
 */
import fs from "node:fs";
import path from "node:path";
import { parseSeedPhrase } from "near-seed-phrase";
import { repoRoot } from "@standin/core";
import { decoyKeyPath, loadKeyFile, mainnetConfig, mainnetKeysDir } from "../src/index.ts";

const root = path.join(repoRoot(), ".sandbox", "mainnet", "bait");
const cfg = mainnetConfig();
const decoy = cfg.accounts.decoy;
const envKey = loadKeyFile(decoyKeyPath("public-repo-env"));
const seedKey = loadKeyFile(decoyKeyPath("seed-phrase"));
const words = loadKeyFile(path.join(mainnetKeysDir(), "decoys", "seed-phrase.words")).private_key;

// The phrase must derive exactly the registered decoy key (near-seed-phrase: BIP39 + SLIP-10 ed25519, path m/44'/397'/0').
const derived = parseSeedPhrase(words);
if (derived.publicKey !== seedKey.public_key) throw new Error("seed phrase does not derive the registered seed-phrase decoy key");

const w = (rel: string, body: string, mode = 0o644) => {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, body, { mode });
};

w("deploy-scripts/.env", `# production deploy credentials: do not share
NEAR_ENV=mainnet
NEAR_ACCOUNT_ID=${decoy}
NEAR_PRIVATE_KEY=${envKey.private_key}
RPC_URL=https://rpc.mainnet.fastnear.com
`);
w("deploy-scripts/README.md", `# acme-treasury deploy scripts

Deploys the treasury contract to mainnet and funds the ops wallet.

    cp .env .env.local && ./deploy.sh

The deployer account is \`${decoy}\`.
`);
w("deploy-scripts/deploy.sh", `#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/.env"
near contract deploy "$NEAR_ACCOUNT_ID" use-file ./res/treasury.wasm without-init-call \\
  network-config "$NEAR_ENV" sign-with-private-key "$NEAR_PRIVATE_KEY" send
`, 0o755);
w("deploy-scripts/package.json", JSON.stringify({ name: "acme-treasury-deploy", version: "0.3.1", private: true, scripts: { deploy: "./deploy.sh", verify: "near account view-account-summary $NEAR_ACCOUNT_ID network-config mainnet now" } }, null, 2) + "\n");
w("deploy-scripts/.gitignore", "node_modules/\nres/\n");
w("notes/near-wallet-seed.txt", `acme treasury wallet (backup, do not lose)
account: ${decoy}

${words}
`, 0o600);
w("README.md", `# Bait (prepared, NOT published)

- deploy-scripts/ : a realistic repo folder whose committed .env holds the "public-repo-env" decoy key for ${decoy}.
- notes/near-wallet-seed.txt : the "seed-phrase" decoy as a 12-word BIP39 phrase (path m/44'/397'/0', verified to derive the registered key).
- Watcher: config/mainnet.json watches ${decoy}; ANY key on it other than the admin key is a trip.
- Nothing here has been pushed anywhere. Publishing is the coordinator's decision.
`);
console.log(`bait written under ${root}; seed phrase derives the registered decoy key: true; account ${decoy}`);
