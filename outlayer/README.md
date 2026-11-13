# OutLayer verdict app and blocklist contract

Everything below ran on NEAR **testnet** with testnet NEAR (no payment keys, no mainnet).

## What runs in the TEE, and why

`verdict/` is a Rust `wasm32-wasip2` app that OutLayer runs inside an Intel TDX enclave. Given
`{network, tx_hash, decoy_account_id, sender_id, admin_public_key}` it:

1. fetches the transaction over NEAR RPC (`EXPERIMENTAL_tx_status`, FINAL) and checks the hash matches,
2. asserts `signer_id == decoy_account_id`, the signing key is not `admin_public_key`, and the tx succeeded,
3. fetches the tx's block and checks the signing key was a **full-access key of the decoy account** at the
   parent block (the state the tx was validated against),
4. derives the attacker: the receiver of a `Transfer` (never the decoy itself) or the `DeleteAccount` beneficiary,
5. signs the statement with the project's ed25519 signing key, path `verdict`, and prints it.

Any failed check prints `{"error":...}` and exits 1; OutLayer then reports the run as failed and the contract
receives `null`.

**Why a TEE:** a blocklist entry says "this account stole from a decoy". Without the enclave that sentence is
only our word, and anyone who could talk to the contract could also name an innocent account. With it, an entry
can only exist if code with a known sha256, running in attested hardware, read the chain itself and signed
the result with a key that only that project's code can use (the key is derived inside the OutLayer keystore
and never leaves the enclave). The contract pins the matching public key and verifies the signature with
`env::ed25519_verify`. Remove the TEE and the same signature could be produced by anyone holding a key, so the
blocklist would be a list of claims instead of evidence.

### Signed message (exact)

```
bytes = "standin-verdict:v1:" ++ canonical_json(verdict)          // UTF-8, signed raw (no prehash)
canonical_json = {"attacker_account","decoy_public_key","tx_hash","block_height","decoy_account_id"}  // this order, no whitespace
signature = ed25519(signing_key["verdict"], bytes)                // 64 bytes, hex in the output
```

Output: `{"verdict":{...},"message":"<the signed string>","signature":"<hex>","public_key":"<hex>"}`.
The contract verifies over `message` (not the pretty `verdict` object) and then parses the JSON after the prefix.
The fixed prefix means the key can never be tricked into signing caller-chosen bytes (OutLayer's rule for signing
keys). The manifest declares `{"path":"verdict","type":"ed25519","caller":"none"}`: one key per project for every
caller, so the contract pins it once. `{"op":"public_key"}` returns just the key.

## Deployed (testnet)

| Item | Value |
|---|---|
| OutLayer owner account | `si-ol-25769.testnet` (keys in `.sandbox/w2/home/.near-credentials`, gitignored) |
| Project | `si-ol-25769.testnet/standin-verdict` (uuid `p0000000000000180`) |
| Version (wasm sha256) | `c3bd174afc156e54b0750107bb5a0adbfac33aabb7107b88d7ef7c75b7a4b402` |
| FastFS URL | `https://test.fastfs.io/si-ol-25769.testnet/outlayer.testnet/c3bd174afc156e54b0750107bb5a0adbfac33aabb7107b88d7ef7c75b7a4b402.wasm` |
| Verdict signing public key (ed25519, hex) | `50789ef6011db348993eec4852fb4406599085970d507f1f2f05b550682130a1` |
| Blocklist contract | `blocklist.si-ol-25769.testnet` (deploy tx `Fa5zZeupYoVAUHzz9BUfmrkxMam19R8JCymTeRvjNURX`) |

The blocklist is **not** on W1's `registry` account (`si-registry-5289.testnet`): that account holds a first
version of the contract with an older storage layout (it cannot be re-initialised in place) and the testnet faucet
returned 429 when a replacement was requested, so the final contract lives under a sub-account of the OutLayer
owner. Point `config/testnet.json` `accounts.registry` at `blocklist.si-ol-25769.testnet` (the coordinator owns that file).

### Evidence

| What | Link / id |
|---|---|
| Decoy account (2 extra full-access keys) | `si-w2decoy-25769.testnet`, drained to `si-w2atk-25769.testnet` |
| Drain tx (0.1 NEAR, signed by non-admin decoy key `ed25519:AvFxjYPySn11QTd6LrB314Ldd6oD6tp9qo4hGuQfJH54`) | `44z4SzWkakUZkuWegpHheXCe9xAeHVr2V8NFgQ34bH54`, block 277547521 |
| Direct OutLayer execution (verdict) | tx `J9MZ3kQZziCAbAGVc664TdniLyjakLA8V3g55rT4s6id`, attestation task 96650 |
| `report` end to end (yield, TEE run, callback stores entry, `blocklist_add`) | tx `51t83JuRDeXbptzxR857rqcKav8BevJsBDgkShQMZpBX` (https://explorer.testnet.near.org/transactions/51t83JuRDeXbptzxR857rqcKav8BevJsBDgkShQMZpBX), attestation task 96910, request 40213 |
| Attestation JSON | `https://testnet-api.outlayer.ai/attestations/by-tx/51t83JuRDeXbptzxR857rqcKav8BevJsBDgkShQMZpBX` |
| Executions dashboard | https://app.outlayer.ai/executions (switch to testnet, find the tx above) |
| `check` on the attacker | `block`, reason names the decoy key, drain tx, block and OutLayer project |
| Forged verdict refused | unit tests (below) and live: a tampered message with the real signature makes the `verify` view return `false` |
| App refuses bad input live | `admin_public_key` set to the signing key: execution fails, contract receives `null` |

The attestation record carries `wasm_hash`, `input_hash`, `output_hash`, `project_id`, the TDX quote and the
requesting tx hash. For an entry stored by `report`, look up the attestation by the **`report` tx hash**
(OutLayer keys attestations by the tx that called `request_execution`).

## How to verify the attestation

1. Open https://app.outlayer.ai/executions (testnet), find the execution for the report tx, click "View
   Attestation" (or fetch `/attestations/by-tx/<report tx>` from `https://testnet-api.outlayer.ai`).
2. Check `wasm_hash` equals the version above, and `project_id` is `si-ol-25769.testnet/standin-verdict`.
3. The page's Verify button checks the Intel-signed TDX quote and that the report data commits to input, output,
   caller and project. The signing key belongs to that project: `{"op":"public_key"}` run through the project
   returns `50789e...`, and the attestation of that run binds it to the project.
4. Rebuild the wasm from `verdict/` and compare sha256 with `wasm_hash` (the build is not bit-reproducible
   across toolchains; for a pinned build use OutLayer's `scripts/build_github_wasm.sh`).

## Contract: `contracts/blocklist`

- `new(owner, outlayer, project_id, network, verdict_public_key, min_deposit, report_fee)`: the key is pinned at init;
  only the owner can change it (`set_verdict_public_key`).
- `report(tx_hash, decoy_account_id, sender_id, admin_public_key)` (payable, attach >= 0.01 NEAR, 300 Tgas):
  calls `outlayer.testnet.request_execution` (Project source, `response_format: Json`, 2B instructions, 30 s) with
  the whole deposit, then chains `on_verdict`.
- `on_verdict` (private callback): verifies the ed25519 signature over `message` with `env::ed25519_verify`
  against the pinned key, requires the prefix, requires the verdict's `tx_hash` and `decoy_account_id` to match the
  request, stores `{attacker_account, decoy_public_key, decoy_account_id, tx_hash, block_height, reporter,
  attested_at_ns}` keyed by attacker, and logs NEP-297 `standin_blocklist` / `blocklist_add`. On any failure
  (no verdict, bad signature, mismatch) it stores nothing and logs `report_refused` with the reason. It never
  panics, so the refund always goes out: the reporter gets `deposit - report_fee` (0.0015 NEAR) back; OutLayer
  returns its unused part to the contract.
- Views: `check(account_id) -> {verdict: "block"|"allow", reasons[]}`, `list(from, limit)`, `count()`,
  `verify(message, signature)` (anyone can test a signature), `config()`.
- The attestation pointer is the `report` tx (the brief's `outlayer_call_or_tx`); the contract cannot read its own
  tx hash, so `reporter` + `attested_at_ns` + the event's receipt identify it.

## Costs observed (testnet NEAR)

| Action | Cost |
|---|---|
| Verdict execution (real tx lookup, ~1.8M instructions, ~1.3 s) | 0.00114 NEAR (estimate for the 2B/30 s limits: 0.0040; deposit 0.01, remainder refunded) |
| `outlayer deploy` (project creation) | 0.1 NEAR attached, unused refunded |
| Failed or timed-out execution | 0.001 NEAR base fee, rest refunded |
| Blocklist wasm (232 KB) | about 2.3 NEAR locked as storage; account funded with 3 NEAR |

Observation: between about 18:42 and 18:56 UTC on 2026-11-13 several executions (including identical requests
that succeeded minutes later) timed out after 200 blocks with no worker response; the contract's callback
logged `report_refused` and refunded the reporter each time. Retrying later worked. When `payer_account_id`
was set to a different account in `request_execution`, the runs also timed out during that window; whether that
field itself is the cause was not isolated, so the contract leaves it unset.

## Commands

```bash
# build + test the app (host tests use recorded RPC fixtures in verdict/tests/fixtures)
cd outlayer/verdict && cargo test --lib && cargo build --target wasm32-wasip2 --release
# CLI: cargo install outlayer-cli ; keys via `outlayer login testnet` (HOME=<repo>/.sandbox/w2/home)
outlayer upload target/wasm32-wasip2/release/standin-verdict.wasm
outlayer deploy standin-verdict <FastFS URL>
outlayer run si-ol-25769.testnet/standin-verdict '{"op":"public_key"}'
outlayer run si-ol-25769.testnet/standin-verdict '{"network":"testnet","tx_hash":"<tx>","decoy_account_id":"<decoy>","sender_id":"<decoy>","admin_public_key":"<admin key>"}'

# contract (rust 1.86 via rust-toolchain.toml; Cargo.lock pinned from guardian)
cd contracts/blocklist && cargo test && cargo build --target wasm32-unknown-unknown --release
near contract deploy blocklist.si-ol-25769.testnet use-file target/wasm32-unknown-unknown/release/standin_blocklist.wasm \
  with-init-call new json-args '{"owner":"si-ol-25769.testnet","outlayer":"outlayer.testnet","project_id":"si-ol-25769.testnet/standin-verdict","network":"testnet","verdict_public_key":"50789ef6011db348993eec4852fb4406599085970d507f1f2f05b550682130a1","min_deposit":"10000000000000000000000","report_fee":"1500000000000000000000"}' \
  prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-legacy-keychain send
near contract call-function as-transaction blocklist.si-ol-25769.testnet report json-args '{"tx_hash":"<tx>","decoy_account_id":"<decoy>","sender_id":"<decoy>","admin_public_key":"<admin key>"}' \
  prepaid-gas '300 Tgas' attached-deposit '0.01 NEAR' sign-as <reporter> network-config testnet sign-with-legacy-keychain send
```

## Tests

- `verdict`: 11 unit tests (recorded testnet RPC responses): accepts the real drain, rejects wrong signer, admin
  key, hash mismatch, failed tx, RPC error, transfer to self, handles `DeleteAccount`, block/key parsing,
  canonical message bytes.
- `blocklist`: 9 unit tests, including the **real TEE signature from the live execution** verifying and being
  stored, forged signature (another key), tampered message with the real signature, unprefixed message signed by the
  pinned key, verdict for a different tx, failed execution, deposit requirement, owner-only key rotation.

## Limits (not claimed)

- Attestation verification is done by OutLayer's dashboard; the contract trusts the pinned public key, not the quote.
  Binding that key to the project (step 3 above) is a one-off human check.
- One attacker per transaction (last `Transfer`/`DeleteAccount` receiver); multi-hop laundering is not followed.
- Mainnet is not deployed.
