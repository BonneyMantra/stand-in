# @standin/core API (stable for W4)

TypeScript source is exported directly (no build). Run scripts with `node --import tsx file.ts`
from the repo root, or `pnpm tsx`. Import: `import { ... } from "@standin/core"` (add
`"@standin/core": "workspace:*"` to your package.json, then `pnpm install`).
No `console.log`: use `logger("scope")` (stderr; `STANDIN_LOG=debug|info|warn|error|silent`).

## Paths and config
| Fn | Notes |
|---|---|
| `repoRoot()` | `STANDIN_REPO` or the repo root |
| `standinHome()` | `STANDIN_HOME` or `<repo>/.sandbox/default/.standin`. Holds `ledger.ndjson`, `pool.json`, `agent-scoped-key.json`. Set this to your sandbox's `.standin` |
| `loadNetworkConfig(file?)` | reads `config/testnet.json` (or `STANDIN_CONFIG`). Returns `{network, rpcUrl, archivalRpcUrl, neardataUrl, accounts:{agent,project,decoy,watcher,registry,intents,attacker}, raw}` |
| `requireAccount(cfg, role)` | account id or throws |
| `loadDevKey(cfg, roleOrAccount)` | dev key from `<repo>/.secrets/<account>.json\|<role>.json\|*.key` (`private_key`/`secret_key` field or bare `ed25519:..`) |

## Ledger (append-only NDJSON, `$STANDIN_HOME/ledger.ndjson`)
```ts
appendEvent(type, payload, home?)            // returns stored event; adds `at` (ISO) if absent
readEvents({type?, where?}, home?)           // LedgerEvent[]
findPlanted(publicKey, home?)                // latest decoy_planted event for a decoy key
interactionCount(accountId, home?)
```
Types: `decoy_planted | session_started | tool_call | exposure | trip | freeze | blocklist | bench`.
Every line is `{type, at, ...payload}`; payload is free-form but the watcher/dashboard read these fields:
- `decoy_planted`: `public_key, account_id, kind(near-credentials|dotenv|shell-history|session-env), path, agent, session_id, cwd` (written by `plantDecoy`)
- `session_started`: `session_id, agent, cwd, decoy_public_key`
- `tool_call`: `session_id, agent, tool_name, tool_use_id, tool_input_summary` (+ any account ids touched)
- `exposure`: `session_id, agent, tool_name, tool_input_summary, tool_use_id, decoy_public_key, where`
- `trip` / `freeze` / `blocklist`: written by the watcher; `bench`: written by bench.

## Decoy pool
```ts
const k = await takeDecoy({ home? });        // {public_key, secret_key, minted_at, tx_hash?}; removed from pool; refill runs in a detached background process
await refillPool(target?)                     // mints to target (default 8, STANDIN_POOL_SIZE) in ONE AddKey tx signed by the decoy admin key
poolSize(home?)
```
Cross-process safe (mkdir lock). If the pool is empty `takeDecoy` mints one synchronously (~2 s).
The decoy account id is `requireAccount(loadNetworkConfig(), "decoy")`.

## Planting
```ts
plantDecoy({ kind, path?, decoyAccountId, key:{public_key,secret_key}, agent:"claude-code"|"codex"|"manual", session_id?, cwd?, home? }) // writes + records decoy_planted
credentialsPath(baseDir, network, accountId)  // <base>/.near-credentials/<net>/<account>.json
decoyEnv(decoyAccountId, secretKey, network)  // {NEAR_ACCOUNT_ID, NEAR_PRIVATE_KEY, NEAR_ENV}
```
- `near-credentials`: JSON `{account_id, public_key, private_key}` (account_id is the DECOY account).
- `dotenv`: replaces/sets `NEAR_ACCOUNT_ID`, `NEAR_PRIVATE_KEY`, `NEAR_ENV` lines.
- `shell-history`: appends `export NEAR_ENV=.. NEAR_ACCOUNT_ID=.. NEAR_PRIVATE_KEY=..`.
- `session-env`: with `path` (e.g. `$CLAUDE_ENV_FILE`) appends `export` lines; without, just records the event (use `decoyEnv` for codex `-c shell_environment_policy.set.*`).
Plant one DISTINCT key per location so a leak identifies the exact location.

## Counterparty check
```ts
const r = await checkCounterparty("some.testnet", { cfg?, home? });
// r = { account_id, decision:"allow"|"warn"|"block", reasons:[{level:"block"|"warn"|"info", code, message}], prior_interactions, checked_at }
```
block = registry `check` verdict block. warn = account younger than 7 days / does not exist, or contract code
hash differs from 72h ago (archival RPC). Registry unreachable = info reason only (decision unaffected).
Tests can inject `registryCheck`, `stateAt`, `currentCodeHash`.

## Chain helpers
`makeProvider(cfg, archival?)`, `makeAccount(cfg, accountId, secretKey)`, `roleAccount(cfg, role)`,
`callMethod(account, contractId, method, args, {gas?, deposit?, waitUntil?})` -> `{tx_hash, block_hash, outcome}`,
`generateKey()`, `publicKeyOf(secret)`, `loadScopedKey()` (agent's legit FC key written by `standin adopt`:
`{account_id, public_key, secret_key, receiver_id, method_names}`), `explorerTx(cfg, hash)`.

## Chain Signatures ledger and the optional `chainsig` state field
`$STANDIN_HOME/chainsig.ndjson` (separate from `ledger.ndjson`), written by `packages/chainsig/scripts/prove.ts` via
`appendChainsig`, read by `chainsigState()`. Lines: `{type:"sign", at, evm_address, chain_id, path, ok, tx_hash, error?}` and
`{type:"blocked", at, evm_address, chain_id, path, via:"deleted-agent-key"|"owner-key", tx_hash?, error}`.

`GET /api/state` gains an OPTIONAL top-level `chainsig` object, present only when that ledger has events (no existing field changed):
```json
{ "chainsig": { "evm_address": "0x...", "chain_id": 11155111, "path": "standin-evm-1",
    "last_sign": {"tx_hash": "", "at": "", "ok": true},
    "blocked_after_freeze": {"tx_hash": "", "error": ""} } }
```
`last_sign` is the latest `sign` event (empty strings and `ok:false` if none). `blocked_after_freeze` is the latest owner-key refusal
(its `tx_hash` is an on-chain failed `sign_evm`; `error` is the guardian's frozen message); if only the deleted-key attempt exists,
that one is used, with an empty `tx_hash` because the RPC rejects it before it becomes a transaction.

## Watcher API (127.0.0.1:4317) is in packages/watcher/README.md and follows docs/BRIEF.md exactly.
