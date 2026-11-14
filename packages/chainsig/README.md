# @standin/chainsig

One freeze also cuts the agent's signing power on other chains. The guardian on `si-agent-5289.testnet` has
`sign_evm(payload_hex, path)`, which forwards to the NEAR MPC signer (`v1.signer-prod.testnet`, method `sign`).
The MPC derives the EVM key from (predecessor, path); the predecessor is the guardian account, so the address is
per (`si-agent-5289.testnet`, `"standin-evm-1"`).

Request shape (from near/mpc `crates/contract/README.md`, read 2026-11-14, not guessed):
`sign({request:{payload_v2:{Ecdsa:<64 hex>}, path, domain_id:0}})`, deposit >= 1 yoctoNEAR (the guardian attaches it, so a
function-call key, which cannot attach a deposit, still works), >= 10 Tgas. Response `{scheme:"Secp256k1",
big_r:{affine_point}, s:{scalar}, recovery_id}`.

## Why a stolen agent key is useless after a freeze (two independent layers)
1. `freeze` deletes the agent function-call key: the chain rejects any transaction signed with it (`AccessKeyNotFound`).
2. `sign_evm` panics while `frozen`, even for the owner key: `frozen: sign_evm refused until unfreeze`.
Callers other than the account itself (stranger, watcher) get `sign_evm: caller not authorized`.

## Files
- `src/mpc.ts` root key view, local derivation (`sha3_256("near-mpc-recovery v0.1.0 epsilon derivation:<predecessor>,<path>")` tweak), signature parse and recovery.
- `src/derive.ts` derives locally and refuses to continue unless it equals the contract's own `derived_public_key` view.
- `src/evm.ts` RLP, EIP-1559 tx build, signing hash, signed serialization, public RPC calls (Ethereum Sepolia default, Base Sepolia via `CHAINSIG_CHAIN=base-sepolia`).
- `src/sign.ts` `requestSignEvm` (client path) and `sendWithKeyRaw` (a thief's path: hand-picked nonce, chain-level rejection).
- `scripts/derive.ts` read-only address; `scripts/upgrade-guardian.ts` state-preserving code upgrade; `scripts/prove.ts` the proof run.
- Ledger: `$STANDIN_HOME/chainsig.ndjson` (see `packages/core/API.md`, optional `chainsig` field of `GET /api/state`).

## Run
```
node --import tsx packages/chainsig/scripts/derive.ts
node --import tsx packages/chainsig/scripts/prove.ts
```
`prove.ts` broadcasts to Sepolia only if the derived address already holds ETH. It never uses a faucet and never touches mainnet.

## Measured on testnet (2026-11-14, run by prove.ts; every NEAR tx on https://testnet.nearblocks.io/txns/<hash>)

Derived EVM address for (`si-agent-5289.testnet`, `standin-evm-1`): **`0x5ac75f605ff88b69195614f4256639f6acd31339`**
(local derivation equals the MPC contract's `derived_public_key` view). Root key `secp256k1:4NfTiv3UsGahebgTaHyD9vF8KYKMBnfd6kh94mK6xv8fGBiJB8TBtFMP5WWXz6B89Ac1fbpzPwAvoyQebemHFwx3`.

| Step | Result | Tx |
|---|---|---|
| guardian code upgrade (DeployContract, no `new`) | `get_state` byte-identical before and after (state preserved) | `8Au2ughh1tnfEfVPvV2v8PAE2v5duz35GmWQW4baWRGj` (the script ran twice with the same wasm; the first run's hash was not captured) |
| `add_agent_key` (FC key, receiver = agent, method `sign_evm`) | ok | `6yJCBQt6LFCtvPdqBqfK72zESYZqvN6SJEmvpES8LeRo` |
| (a) `sign_evm` via the agent FC key, unfrozen | ok; signature recovers to the derived address (recovery_id 1) | `86J721R72GArAgs7CphqL3q5qc5WtRkuxNqFnrfjJDDU` |
| (b) `freeze` by the watcher FC key | ok | `CTWWW5C4XFedNYaToMWsAvJQBc2zTCGZJPeyrwGPsHYy` |
| (c1) `sign_evm` with the now deleted FC key | rejected by the chain before inclusion: `AccessKeyNotFound ... does not exist on account si-agent-5289.testnet`. No tx hash exists. | none |
| (c2) `sign_evm` with the owner key while frozen | failed receipt: `frozen: sign_evm refused until unfreeze` | `7vj8xXr8WCVzEdd7gum5R5yu9D3zsVt8uXUvoBySSfLd` |
| (d) `unfreeze` | ok | `B5BKaRtjNGkXvrQ48KbzkJx5T6fLwghmRPW32kw8v78K` |
| (d) re-provision agent key (`resetAgent` from `attacks/lib/chain.mjs`, as bench) | ok | `GTv5kVrLVUjHUuGibF1GiXB5GfJEzzr21zkhGaV46fPB` |

Final state read back from the guardian: `frozen: false`, 1 agent key (the standard `record_deploy` key from `resetAgent`).
Two earlier prove runs the same day (one with a rate-limited deleted-key check, one before `sendWithKeyRaw`) left extra
sign, freeze and unfreeze txs on the account; they are in the NearBlocks history and in `chainsig.ndjson`.

Not broadcast: the derived address held 0 wei on Ethereum Sepolia at proof time, so no transaction was sent to Sepolia and no faucet was used.
The signed raw transaction was built and its signature verified by recovery, but acceptance by a Sepolia node is **planned**, not run.
The MPC returns a different `recovery_id` and `s` for the same payload on different runs, which is expected.

## Tests
- `npx vitest run packages/chainsig`: 7 tests (RLP vectors, known address, recovery round trip, malformed response, derivation, ledger state).
- Guardian sandbox, `contracts/guardian/tests/sign_evm.rs` (`cargo +stable test --test sign_evm -- --test-threads=1`): 3 tests: request forwarded
  with deposit 1 and the right path/payload/domain via an agent FC key; refused when frozen (owner) and the deleted key is dead; refused for stranger and watcher and for bad input.
  **The MPC contract cannot run in the sandbox: a test-only stub (`tests/mpc-stub`, records the request, signs nothing) is patched in at `v1.signer-prod.testnet`.**
  The real MPC call is covered only by the testnet proof above.
