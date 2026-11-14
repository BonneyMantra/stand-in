// Recorded testnet proofs behind the lower half of the landing page. Every value was read back from
// NEAR testnet RPC / NearBlocks on 2026-11-14 or copied from contracts/README.md,
// packages/chainsig/README.md and outlayer/README.md. Nothing here is illustrative.

/** contracts/README.md "Testnet run": one freeze tx, two registries. Receipts read from RPC. */
export const FREEZE = {
  tx: "EFrvBZmt53PYB9cD1AuZ3hYQvdVpatuMqMCCqTmJwzXv",
  block: 277548916,
  by: "si-watch-5289.testnet",
  agent: "si-agent-5289.testnet",
  intents: "si-intents-5289.testnet",
  agentKey: "ed25519:42jh5bLWYtSYUniGBJEZeRiQbQ9WNB2qjCGwpVmdfpZb",
  intentsKey: "ed25519:cN32wNqkknDwW4piyvNRtPzoTfqT5QP8EczY9sB86Cg",
  rejectedTx: "2CNYoa89ey8Sguv3JyqGjNuYCBLmfVE1vu9NdP57rHYZ",
  rejectedBlock: 277548944,
  rejectedNote: "queued intent signed with agent key",
} as const;

/** packages/chainsig/README.md "Measured on testnet". */
export const CHAINSIG = {
  agent: "si-agent-5289.testnet",
  mpc: "v1.signer-prod.testnet",
  path: "standin-evm-1",
  evmAddress: "0x5ac75f605ff88b69195614f4256639f6acd31339",
  chain: "Ethereum Sepolia",
  explorer: "https://sepolia.etherscan.io/address/0x5ac75f605ff88b69195614f4256639f6acd31339",
  payload: "cfd863159f1768b4ed2bd77319c6b4252df87d3bd78885397b9dfa2994dc4860",
  signedTx: "86J721R72GArAgs7CphqL3q5qc5WtRkuxNqFnrfjJDDU",
  signedBlock: 277611749,
  freezeTx: "CTWWW5C4XFedNYaToMWsAvJQBc2zTCGZJPeyrwGPsHYy",
  freezeBlock: 277611781,
  watcher: "si-watch-5289.testnet",
  ownerRefusedTx: "7vj8xXr8WCVzEdd7gum5R5yu9D3zsVt8uXUvoBySSfLd",
  ownerRefusedBlock: 277611798,
  ownerError: "frozen: sign_evm refused until unfreeze",
  stolenError: "AccessKeyNotFound",
} as const;

/** outlayer/README.md "Deployed" and "Evidence". */
export const BLOCKLIST = {
  thief: "si-w2atk-25769.testnet",
  decoy: "si-w2decoy-25769.testnet",
  decoyKey: "ed25519:AvFxjYPySn11QTd6LrB314Ldd6oD6tp9qo4hGuQfJH54",
  drainTx: "44z4SzWkakUZkuWegpHheXCe9xAeHVr2V8NFgQ34bH54",
  drainBlock: 277547521,
  reportTx: "51t83JuRDeXbptzxR857rqcKav8BevJsBDgkShQMZpBX",
  reportBlock: 277550036,
  contract: "blocklist.si-ol-25769.testnet",
  project: "si-ol-25769.testnet/standin-verdict",
  wasm: "c3bd174afc156e54b0750107bb5a0adbfac33aabb7107b88d7ef7c75b7a4b402",
  task: 96910,
  attestation: "https://testnet-api.outlayer.ai/attestations/by-tx/51t83JuRDeXbptzxR857rqcKav8BevJsBDgkShQMZpBX",
  payCommand: "standin pay si-w2atk-25769.testnet 0.5",
  payExit: 3,
} as const;

/** Shorten a hash or key for display: keeps the head and tail, never the middle. */
export const short = (s: string, head = 6, tail = 4) => {
  const [prefix, body] = s.includes(":") ? [s.slice(0, s.indexOf(":") + 1), s.slice(s.indexOf(":") + 1)] : ["", s];
  return body.length <= head + tail + 1 ? s : `${prefix}${body.slice(0, head)}…${body.slice(-tail)}`;
};

export const blockLabel = (n: number) => `#${n.toLocaleString("en-US")}`;
