# Stand-in contracts (W1)

Three near-sdk (Rust) contracts, all deployed on **testnet** (suffix `5289`, ids in `config/testnet.json`).
Private keys live only in `.secrets/` (gitignored).

| Contract | Deployed at | wasm size (measured) |
|---|---|---|
| `guardian/` | `si-agent-5289.testnet` (the "real" agent account) | 139,758 bytes |
| `intents-replica/` | `si-intents-5289.testnet` | 164,903 bytes |
| `project-demo/` | `si-project-5289.testnet` | 95,550 bytes |

Mainnet storage is roughly 1 NEAR per 100 KB, so the guardian costs about 1.4 NEAR to hold on mainnet
(the 0.5 NEAR mainnet budget does not cover deploying it there; it is testnet only).

## guardian

State: `owner`, `watcher`, `intents_contract`, `agent_keys[]`, `intents_keys[]`, `frozen`, `freeze_log[]`.
A contract cannot list its own access keys, so every key it adds is recorded in state and `freeze`
enumerates that list.

Owner = the account itself: owner-only methods require `predecessor == current_account_id`, i.e. a call
signed by the agent account's full-access key. The owner full-access key is never recorded and survives a freeze.

| Method | Who | Effect |
|---|---|---|
| `new(watcher, intents_contract)` | init | sets owner = own account |
| `add_agent_key(public_key, receiver_id, method_names[], allowance)` | owner | `AddKey(FunctionCall)` on its own account; `allowance` is a yoctoNEAR string, `"0"` = unlimited; empty `method_names` = any method |
| `add_intents_key(public_key)` | owner | calls intents `add_public_key` with 1 yocto as the account; records the key in a callback only on success |
| `freeze(reason, decoy_public_key?, tx_hash?)` | watcher or owner | one `DeleteKey` receipt per agent key (so one failure cannot block the rest) plus intents `remove_public_key` (1 yocto) per intents key; sets `frozen`; appends `{at_block, reason, decoy_public_key, tx_hash, by, deleted_keys, intents_keys_removed}` to `freeze_log` |
| `unfreeze()` | owner | clears `frozen`; keys must then be re-provisioned |
| `get_state()` | view | everything above |

`freeze` takes two optional arguments beyond the brief's `freeze(reason)` so the log can carry the decoy
key and trigger tx; `{"reason": "..."}` alone still works. While frozen, `add_agent_key` and `add_intents_key` are refused.

Events (NEP-297): `EVENT_JSON:{"standard":"standin","version":"1.0.0","event":"freeze","data":[{by,reason,decoy_public_key,tx_hash,deleted_keys,intents_keys_removed}]}`.
Also `unfreeze` and `agent_key_added`. (The brief says `standin_freeze`; the shipped shape is standard `standin`, event `freeze`.)

The watcher account holds a function-call key limited to `freeze` on the agent account
(`add-key ... --contract-account-id si-agent-5289.testnet --function-names freeze`, 2 NEAR allowance).

## intents-replica

Minimal replica of the near/intents (defuse) account-key registry, not the whole protocol. Methods:
`add_public_key`, `remove_public_key` (both `assert_one_yocto`, authenticated by predecessor),
`has_public_key`, `public_keys_of`, `executed_count`, and
`execute_signed(signer_id, public_key, payload, signature)` where `signature` is base64 ed25519 over the UTF-8 `payload`.
Check order matches upstream: signature, then key registered for `signer_id` **now** (else `PublicKeyNotExist`), then replay
protection on `sha256(payload)` per signer, then execute (the replica only records and emits an event).
It does not move tokens, verify NEP-413 wrappers, deadlines or the other intent types.

Upstream source (github.com/near/intents, branch `main`, fetched 2026-11-14; commit SHA not recorded because the GitHub API was rate limited):

| Behaviour | File and lines |
|---|---|
| `has_public_key`, `public_keys_of`, `add_public_key`, `remove_public_key` with `assert_one_yocto` and `ensure_auth_predecessor_id` | `contracts/defuse/src/contract/accounts/mod.rs` L32-56 |
| `add_public_key_and_emit_event` / `remove_public_key_and_emit_event` (event on success, panic on error) | same file, L132-166 |
| `execute_signed_intent`: verify signature (L44), then the registered-key check returning `PublicKeyNotExist` (L70-73), then nonce commit | `contracts/defuse/core/src/engine/mod.rs` L42-86 |
| `remove_public_key` returns `PublicKeyNotExist` when the key is absent; `add_public_key` returns `PublicKeyExists` | `contracts/defuse/core/src/engine/state/cached.rs` L134-172 (L149, L169) |
| Error definitions and messages (`public key '{1}' doesn't exist for account '{0}'`) | `contracts/defuse/core/src/error.rs` L64-67 |

Consequence used by the guardian: removing a key that is already gone fails on the intents side (L169), so
`freeze` sends the removals as independent receipts.

## project-demo

`record_deploy(note)` (max 280 bytes; stores `{by, at_block, note}`, `by` = predecessor, which is the agent account when called with its
function-call key) and `get_notes()`.

## Build

Needs Rust 1.86 (pinned by `rust-toolchain.toml`; cargo-near refuses wasm from 1.87+ with nearcore) and `cargo-near`.
`near-sdk` is pinned to `~5.17` because newer releases require rustc 1.95.

```
cd contracts/<name> && cargo near build non-reproducible-wasm --no-abi   # -> target/near/<crate>.wasm
```
If dependency resolution picks crates newer than 1.86 supports: `CARGO_RESOLVER_INCOMPATIBLE_RUST_VERSIONS=fallback cargo generate-lockfile`.
Profile: `opt-level = "z"`, LTO, `strip = "symbols"`, `panic = "abort"`, then `wasm-opt -O` via cargo-near. This is a non-reproducible
build; the Docker reproducible build was not run.

## Tests (real runs, 2026-11-14)

| Suite | Command | Result |
|---|---|---|
| guardian unit | `cargo test --lib` | 4 passed, 0 failed |
| intents-replica unit | `cargo test` | 3 passed, 0 failed |
| project-demo unit | `cargo test` | 1 passed, 0 failed |
| guardian sandbox (near-workspaces 0.22, near-sandbox 2.9.0) | `cargo +stable test --test sandbox -- --test-threads=1` | 5 passed, 0 failed |

The sandbox suite needs the three wasm files built first, and `+stable` (the pinned 1.86 toolchain cannot compile
dev-dependencies of near-workspaces). Its five tests:
1. `freeze_deletes_all_agent_keys_and_removes_intents_keys`: two FC keys and one intents key provisioned, watcher freezes, all three gone on chain, owner key survives, event emitted, log filled.
2. `queued_signed_intent_fails_public_key_not_exist_after_freeze`: an intent signed by the intents key executes before the freeze; a second intent signed earlier fails with `PublicKeyNotExist` after it; a forged signature fails `InvalidSignature`.
3. `non_watcher_freeze_refused_and_keys_survive`: stranger refused, key still on chain, watcher cannot call owner methods.
4. `watcher_function_call_key_can_freeze_and_owner_can_unfreeze_and_reprovision`: the freeze runs through the watcher's FC key; re-provisioning is refused while frozen and works after `unfreeze`.
5. `agent_fc_key_calls_project_but_cannot_transfer_or_add_keys`: `record_deploy` works; a NEAR transfer, another method, another receiver and AddKey all fail.

## Testnet run (every tx on https://testnet.nearblocks.io/txns/<hash>)

| Step | Tx |
|---|---|
| deploy + `new` project-demo | [9wB1h2cF...](https://testnet.nearblocks.io/txns/9wB1h2cFVrP3t1LP5Qd6RfnPiiQyDXrzLP1NyJYi2neU) |
| deploy + `new` intents-replica | [S6gpM9Ci...](https://testnet.nearblocks.io/txns/S6gpM9CiWZb5fEa2h9xkuXr5GnBGhpyneqGWkRFd8j4) |
| deploy + `new` guardian | [3nm7QYZn...](https://testnet.nearblocks.io/txns/3nm7QYZnFCE985bkdmD8AG5Xme1zSPT5VvQuE4f5cU2L) |
| watcher FC key (`freeze` only on agent) | [GmDLfguF...](https://testnet.nearblocks.io/txns/GmDLfguFzy9FFZ32g6tm1oqd6HsM9mv37R2thPXrGwXZ) |
| `add_agent_key` (FC key, project, `record_deploy`, 0.5 NEAR) | [6JAZErRR...](https://testnet.nearblocks.io/txns/6JAZErRRNvq6NyG5Dzdo1UafFZShchBRsw1n6M1gei5Q) |
| `add_intents_key` | [CQbwF3T9...](https://testnet.nearblocks.io/txns/CQbwF3T9a6mNjtChAtkFEZU4U5B9rkKY25ZK9t1nWcWN) |
| `execute_signed` before freeze (succeeds) | [E25SYk9D...](https://testnet.nearblocks.io/txns/E25SYk9DbLkCPv2xGkhLqP7xjfnrRf25ohZJGx4PqHkJ) |
| **`freeze`**, called by the watcher FC key (deletes the FC key, removes the intents key) | [EFrvBZmt...](https://testnet.nearblocks.io/txns/EFrvBZmt53PYB9cD1AuZ3hYQvdVpatuMqMCCqTmJwzXv) |
| **`execute_signed` after freeze: fails `PublicKeyNotExist`** | [2CNYoa89...](https://testnet.nearblocks.io/txns/2CNYoa89ey8Sguv3JyqGjNuYCBLmfVE1vu9NdP57rHYZ) |
| `unfreeze` | [r62QuXcX...](https://testnet.nearblocks.io/txns/r62QuXcXWhkLsQvAwSDn4jsfWp38fYNzyMHpSH9FW3d) |
| re-provision agent key | [BT4X1Uz6...](https://testnet.nearblocks.io/txns/BT4X1Uz6XTKfssc5xQe9RKgP7ZvMVaEo4e9BznPkL6fb) |
| re-provision intents key (first attempt expired in flight, resent) | [CRJhrghk...](https://testnet.nearblocks.io/txns/CRJhrghkjVJTedyKMEub3KrCHkwqz621WXzsXrz7j5fo) |
| `record_deploy` with the agent FC key | [8GkRAXes...](https://testnet.nearblocks.io/txns/8GkRAXesaNwbPk4hK1weqciEeVjL7iitEj5qHEeZyFN6) |

State left behind: guardian not frozen; one FC key (`record_deploy` on the project) and one intents key registered.
The agent account's `freeze_log` also contains a second entry written by another worker's watcher run, not by W1.

## Limits of function-call keys (reference: https://docs.near.org/protocol/access-keys, not re-fetched during this run)

- A function-call key can only call methods on its one `receiver_id` (optionally an allow-list of methods). Sandbox test 5 confirms a different method and a different receiver are rejected.
- It cannot transfer NEAR, stake, deploy, or attach a deposit; sandbox test 5 confirms a transfer is rejected.
- It cannot add or delete keys (AddKey is not allowed), also confirmed in test 5.
- Gas is paid from an **allowance** on the key. When the allowance is spent the key can no longer sign: the sandbox surfaced `InvalidAccessKeyError(NotEnoughAllowance ...)` when a 300 Tgas call exceeded a 1 NEAR allowance. A thief with the key can therefore burn the allowance to lock the legitimate agent out, and an attacker or a bug can do the same by accident. Keep allowances small and re-provision after a freeze.
- A leaked FC key still lets a thief call the permitted methods on the permitted receiver until the guardian deletes it; that window is what the watcher closes.
