# @standin/watcher

Node service that watches the **decoy account** and freezes the **agent account** when a decoy key is used.

```
node --import tsx packages/watcher/src/main.ts      # or: pnpm standin dev up
```

## How it detects (and why)

1. **Primary: access-key change detector** (`followKeyChanges`). One RPC call every ~300 ms:
   `EXPERIMENTAL_changes {changes_type: all_access_key_changes, account_ids:[decoy], finality: optimistic}`
   (plus a `final` poll every ~1.8 s as a safety net). A transaction signed by key K bumps K's nonce in the
   block that includes it (`cause.type = transaction_processing`, `cause.tx_hash` = the tx). Any such change on a key
   that is not the decoy admin key is a **trip**. Detection happens in the inclusion block, ~0.5 s after it is produced.
   This replaced streaming whole blocks because neardata's free tier returns HTTP 429 above ~2 req/s per IP
   (measured: a follower fell behind the chain), while one filtered RPC call per tick is light.
2. **Secondary (opt-in `STANDIN_BLOCK_STREAM=1`): block follower** (`followBlocks`). Long-polls
   `https://testnet.neardata.xyz/v0/block_opt/<next>` (one request per block, no head polling), matches
   `signer_id == decoy`, falls back to RPC `block`+`chunk` polling after repeated failures.
3. **Freeze**: the moment a trip is seen the watcher signs `guardian.freeze(reason, decoy_public_key, tx_hash)` with a
   **pre-warmed** key (cached nonce + recent block hash refreshed every 5 s, so the freeze costs one sign + one
   broadcast) and broadcasts it before doing anything else (attribution, block-height lookups, ledger writes happen
   while the freeze is in flight). One freeze per process; if the guardian is already frozen on chain it is not frozen again.
4. **Report**: after the freeze, `registry.report(tx_hash, decoy_account_id, sender_id, admin_public_key)` with 0.05 NEAR
   (the registry minimum is 0.01; OutLayer refunds the unused part), then polls `registry.check(attacker)` until `block`.
   `STANDIN_NO_REPORT=1` skips this (used for latency tests so OutLayer is not billed).
5. Everything is written to the ledger (`trip`, `freeze`, `blocklist` events with block heights and `blocks_after_trip`).
   `detection_to_submit_ms` is logged per trip.

`blocks_after_trip` = (block that included the freeze tx) - (block that included the decoy tx), per the brief.
We also record `executed_block_height` = the block where the guardian's DeleteKey receipt actually removed the agent
key (state-change query on the agent account); that is when the agent key stops working.

## API (127.0.0.1:4317)

`GET /api/state`, `GET /api/events` (SSE), `GET /api/health`. `/api/state` follows docs/BRIEF.md exactly
(`agent`, `decoy`, `sessions`, `exposures`, `trips`, `blocklist`, `bench`). Chain-backed fields are cached 1 s.
Sessions/exposures/bench come from the ledger, which the Claude Code / Codex hooks and the bench append to; the server
tails the ledger file every 200 ms and emits SSE `session`, `exposure`, `trip`, `freeze`, `blocklist`, `bench`.
SSE payloads: `session`/`exposure`/`bench`/`trip` are the brief's objects; `freeze` is the brief's `freeze` object plus
`trip_tx_hash`; `blocklist` is the brief's blocklist entry plus `trip_tx_hash` and the `blocklist` sub-object fields.
Extra fields never rename brief fields.

## Config

`config/testnet.json` (accounts, rpc_url). Env: `STANDIN_HOME` (ledger dir), `STANDIN_POLL_MS` (default 300),
`STANDIN_BLOCK_STREAM=1`, `STANDIN_NO_REPORT=1`, `STANDIN_REPORT_DEPOSIT_YOCTO`, `STANDIN_WATCHER_PORT`.
Keys: `<repo>/.secrets/keys/<account>.json` (dev only). Public RPCs are rate-limited and shared; a FastNear API key
in the `rpc_url` would remove the 429s.

## Reproduce

```
node --import tsx packages/watcher/scripts/prove.ts 3     # seeds a sandbox HOME, adopt, drain, measure, 3 runs
```

## Measured on testnet (real runs, si-agent-5289 guardian)

| run | trip tx (decoy drain) | trip block | freeze tx | freeze block | blocks_after_trip |
|---|---|---|---|---|---|
| prove run 1 (full adopt -> drain, guardian live) | [8wxyGxQP...](https://testnet.nearblocks.io/txns/8wxyGxQPeqGpEyRYnDJ3m9WYY2fYDYbK5DGAvv5EbLZo) | 277548954 | [oVRDRGAR...](https://testnet.nearblocks.io/txns/oVRDRGAR64Pb6vS2YTy5zzej4HixWVEpm1jbtWgZEWy) | 277548957 | 3 (agent_frozen=true, 0 agent keys left, 1 key deleted) |
| detector test, no guardian deployed yet (inclusion only) | [8VbsWdYZ...](https://testnet.nearblocks.io/txns/8VbsWdYZibxKgXdMHVbQqoLienzq8z1tByEf8mHwGcaK) | 277548776 | 6FVxN1oG... | 277548778 | 2 |
| detector test, no guardian (inclusion only) | n/a | 277548628 | n/a | 277548631 | 3 |

Detection-to-broadcast: 205-225 ms. In run 1 the DeleteKey receipt landed 6 blocks after the trip by the old (max receipt
block) metric, which included gas-refund receipts; the corrected `executed_block_height` (access_key_deletion state change)
was added afterwards and has **not** been re-measured. The 3-run proof did not complete: public FastNear RPC returned
HTTP 429 for a long stretch (shared with W4's bench), so only one full guardian run exists. The earlier runs predate the
guardian deployment, so they measure detection + inclusion only. Registry `report`/`blocklist` was not proven by this
watcher run (registry address changed mid-task to blocklist.si-ol-25769.testnet).

