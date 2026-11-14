// Builds docs/claims.json: every public claim Stand-in makes, with the transactions that prove it.
// Signer, block and status are read from NearBlocks so the /verify page can re-check each one over RPC.
// Usage: node docs/claims-src.mjs
import fs from "node:fs";

const T = "testnet", M = "mainnet";
const CLAIMS = [
  { id: "guardian-freeze", title: "The watcher's function-call key freezes the agent account", network: T,
    txs: [{ hash: "EFrvBZmt53PYB9cD1AuZ3hYQvdVpatuMqMCCqTmJwzXv", expect: "success", role: "freeze" }] },
  { id: "intent-after-freeze", title: "A signed intent with a removed key is rejected (PublicKeyNotExist)", network: T,
    txs: [{ hash: "2CNYoa89ey8Sguv3JyqGjNuYCBLmfVE1vu9NdP57rHYZ", expect: "failure", match: "PublicKeyNotExist", role: "rejected intent" }] },
  { id: "watcher-3-blocks", title: "Decoy use to freeze in 3 blocks (watcher proof run)", network: T, blocks: { from: 0, to: 1, expect: 3 },
    txs: [{ hash: "8wxyGxQPeqGpEyRYnDJ3m9WYY2fYDYbK5DGAvv5EbLZo", expect: "success", role: "decoy used" },
          { hash: "oVRDRGAR64Pb6vS2YTy5zzej4HixWVEpm1jbtWgZEWy", expect: "success", role: "freeze" }] },
  { id: "real-claude-supply-chain", title: "Real Claude Code + compromised npm reporter: frozen 3 blocks after the theft", network: T, blocks: { from: 0, to: 1, expect: 3 },
    txs: [{ hash: "3A9ERiLXgkyC52u6FFVB2iJnMh7ecnZxXM7ikSRqLKai", expect: "success", role: "decoy used" },
          { hash: "9KeXDxzzvHK4ZjCh5bJkorXTUjKcYkQxEwAJcgVqhrMz", expect: "success", role: "freeze" }] },
  { id: "tee-blocklist", title: "OutLayer TEE verdict adds the thief to the blocklist", network: T,
    link: "https://testnet-api.outlayer.ai/attestations/by-tx/51t83JuRDeXbptzxR857rqcKav8BevJsBDgkShQMZpBX",
    txs: [{ hash: "51t83JuRDeXbptzxR857rqcKav8BevJsBDgkShQMZpBX", expect: "success", role: "report" }],
    view: { network: T, account: "blocklist.si-ol-25769.testnet", method: "check", args: { account_id: "si-w2atk-25769.testnet" }, expect_contains: "block" } },
  { id: "chain-signatures", title: "Chain Signatures: the agent signs while active; refused after a freeze", network: T,
    txs: [{ hash: "86J721R72GArAgs7CphqL3q5qc5WtRkuxNqFnrfjJDDU", expect: "success", role: "signed" },
          { hash: "CTWWW5C4XFedNYaToMWsAvJQBc2zTCGZJPeyrwGPsHYy", expect: "success", role: "freeze" },
          { hash: "7vj8xXr8WCVzEdd7gum5R5yu9D3zsVt8uXUvoBySSfLd", expect: "failure", match: "frozen", role: "refused" }] },
  { id: "mainnet-intents", title: "Mainnet: freeze removes the agent's key from intents.near, 3 blocks after the theft", network: M, blocks: { from: 1, to: 2, expect: 3 },
    txs: [{ hash: "6bx5kvosQrmc8mPP2gCh4cFB3HqH5QX8aPWjEUmcAndg", expect: "success", role: "intents key added" },
          { hash: "9xzjaXMPWuZonnsrwdZoRASNb13ohA56P1PVXLhseTbV", expect: "success", role: "decoy used" },
          { hash: "7u6CFZBjujxsBS2RqLJEXSEWgaU3XY5oNpK22uAN6NWx", expect: "success", role: "agent key deleted" },
          { hash: "DEePEBTr3LQ2QkDYj2pCJ2vhpq4ytqMU7qmsQULYR58Y", expect: "success", role: "intents key removed" }] },
];

const api = (net) => (net === M ? "https://api.nearblocks.io" : "https://api-testnet.nearblocks.io");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const c of CLAIMS) {
  for (const t of c.txs) {
    for (let a = 0; a < 4; a++) {
      const res = await fetch(`${api(c.network)}/v1/txns/${t.hash}`);
      if (res.status === 429) { await sleep(3000 * (a + 1)); continue; }
      const j = await res.json();
      const x = j.txns?.[0];
      if (x) { t.signer = x.signer_account_id; t.receiver = x.receiver_account_id; t.block = Number(x.block?.block_height ?? x.included_in_block_height ?? 0); t.status = x.outcomes?.status === false ? "failure" : "success"; }
      break;
    }
    await sleep(700);
  }
}
fs.writeFileSync(new URL("./claims.json", import.meta.url), JSON.stringify({ generated_at: new Date().toISOString(), claims: CLAIMS }, null, 1) + "\n");
for (const c of CLAIMS) console.log(c.id, c.txs.map((t) => `${t.role}:${t.signer ?? "?"}@${t.block ?? "?"}:${t.status ?? "?"}`).join(" | "));
