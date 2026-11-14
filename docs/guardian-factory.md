# Guardian factory (owner without a contract-capable account)

For an owner whose NEAR account cannot host a contract (an Ethereum-wallet `0x…` account via NEAR Connect).
`guard.si-project-5289.testnet` creates `<name>.guard.si-project-5289.testnet`, deploys the guardian
there and calls `new_owned(owner = caller, watcher, intents_contract)`. The new account has **no access
key at all**: nothing can act as it except the guardian's own logic, so the owner calls the guardian
methods from their own account, and `freeze` still deletes only the agent's function-call keys.

## Contracts
- `contracts/guardian`: new `new_owned(owner, watcher, intents_contract)` (rejects owner == itself) and
  owner-only `withdraw(amount)`. `new` is unchanged, so `si-agent-5289.testnet` keeps working; no existing
  deployment was upgraded.
  - `withdraw` is allowed while frozen (the freeze only cuts agent access; an owner reacting to a compromise
    must still be able to pull funds, and agent keys cannot call it) and cannot dip below the storage reserve.
- `contracts/factory`: `create_guardian(name, watcher, intents_contract)` (payable), `guardians_of(owner)`,
  `required_deposit()`. Name: lowercase `a-z0-9`, single `-`/`_` separators, no dots; full id <= 64 chars.
  A callback records owner -> guardian on success and refunds the whole deposit to the caller on failure.

## Builds (cargo-near 0.17, non-reproducible, rustc 1.86.0)
| wasm | bytes | sha256 | NEAR code hash (bs58) |
|---|---|---|---|
| `target/near/standin_guardian.wasm` (with `new_owned`, `withdraw`) | 182,924 | 737366dc028dc260dac256fd2bd472bfa5caaff692ae26adeda10d8f33fa589f | 8mfwwJ9bmSEoaTEtrk8NPbh2A1A65WDWjaHeGoaF4Lm4 |
| `target/near/standin_guardian_factory.wasm` | 319,910 | 634565ef88c25e4cf678b21c4d3eaba0d51a56bf39f35b16041f87ce66873d6a | 7gWjpFxwfEg5PgfM9uQeiSudn5UjwgvhvPsQ8qVxo88y |

Build order matters: the factory embeds the guardian wasm with `include_bytes!`, so build the guardian first.

## Testnet evidence (2026-11-14)
Factory: `guard.si-project-5289.testnet` (key in `.secrets/keys/`, **not** deleted). Owner stand-in:
`owner.si-project-5289.testnet` (a plain NEAR account; the guardian only sees the predecessor).
`required_deposit()` = 2.13924 NEAR.

| Step | Result | Tx |
|---|---|---|
| deploy factory + `new` | ok | 2LCkoA8HG3n7A5f8hA98cg8X3ENe91J5YMUEWaq4vD6r |
| `create_guardian` (e2emwgp5ifv, 2.13924 NEAR) | ok; `get_state.owner` == owner; guardian has 0 access keys; `guardians_of(owner)` lists it | 9XnadNUCVC55mbFk6h5MFCC3d29C3kk9JdPeQZZW4P9c |
| `add_agent_key` from owner | ok; `view_access_key_list` shows the scoped FunctionCall key (receiver si-project-5289, `record_deploy`, 0.25 NEAR) | GXBm22dAWKgP3geDV1eShZz9xmj739bZ5jFqppvK7vNM |
| `add_agent_key` from non-owner (watcher) | refused: `owner only` | FmwrGZakN3p3iWFeeQHdX1LCTQSSMGc4LQpWktVARgNt |
| `freeze` from si-watch-5289.testnet | ok; agent key deleted (0 keys); `frozen=true` | CN4BKav41L6rWv9pR8P1GDJTP2ncagGyTJ4cV3vaWnL1 |
| second `freeze` | refused: `already frozen` | GMGh6G6LrU8jnG5U5rw6aqiPwasNNrjmX5J2NkNRUBms |
| `unfreeze` from owner | ok | 72vhHuKWumK9A1fU4CiyVTf6cNBJ7jqSkpYy1Lq5Nyb5 |
| `withdraw` 0.2 NEAR from owner | ok; guardian 2.139 -> 1.939, owner +0.2 | Dpa6kV9oujpoTUy1WhjAuqrmAC57YVKw86eusfkMudjL |
| `withdraw` 900 NEAR | refused: `amount exceeds balance above the storage reserve` | DEwZ5Hjs3pzh88iSTm4rJ1NhMX2J6VRKDgmegHyosdnS |
| `create_guardian` with an existing name | creation fails, deposit refunded (owner 3.099 -> 3.097, gas only), nothing recorded | 94Coki6Nuj3LrL1zoyDUd2qonjD1cZB4CFNkJC35Nz7A |

The guardian account itself cannot act: its `view_access_key_list` is empty (there is no key to sign as it).
An earlier run on guardian `e2emwgp3cw4` (create tx B2EGDJT1KBG7VzNkV5RM3Psyy1Xoa4pymBfSp4WXJYy)
was cut off by an RPC 500; its steps were repeated above. Script: `contracts/factory/scripts/deploy-and-e2e.ts`.

## Limits
- `si-guard-5289.testnet` could not be created: top-level `*.testnet` needs the testnet helper, which was
  rate limited ("retry in 50 minutes"). The factory is a sub-account, so guardian ids are
  `<name>.guard.si-project-5289.testnet` and the name is at most 34 characters.
- Only direct children (no dots in the name). Name collisions refund and return `null`.
- The guardian's withdrawable balance is the deposit minus its storage (about 0.3 NEAR at the minimum
  deposit); attach more to `create_guardian` to leave more.
- The real 0x wallet path (Ethereum wallet contract as predecessor) is not covered here.
- No near-workspaces sandbox tests for the factory (big neard download); coverage is unit tests plus the live run.
- `MPC_SIGNER` in the guardian is the testnet signer, as before.
- Not reproducible builds; code hashes are for these local builds.
