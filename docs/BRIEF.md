# Stand-in build brief (agent contract)

Owner: Claude Opus session (coordinator). Workers build only the paths they own, commit by
explicit path, never push (the coordinator pushes). Deadline 2026-11-14T23:59Z. Feature freeze
2026-11-14T14:00Z, then film. Files under 300 lines. No secrets in tracked files.

## Product in one line
Decoy NEAR keys for AI coding agents (Claude Code, Codex). A leaked decoy trips an on-chain freeze
of the real account within ~2 blocks, names the session and tool call that leaked it, and posts the
thief to a shared blocklist with an OutLayer TEE-attested proof that other agents check before paying.

## Hard constraints
- Never touch the developer's real agent configs: `~/.claude`, `~/.codex`, `~/.near-credentials`.
  Every test uses an isolated sandbox home: `HOME=<repo>/.sandbox/<run-id>` plus
  `CLAUDE_CONFIG_DIR` / `CODEX_HOME` inside it. `.sandbox/` is gitignored.
- Dev keys for our own testnet accounts live in `<repo>/.secrets/` (gitignored), never in git.
- Networks: everything on **testnet** except (a) the live public bait decoy and (b) one real
  `intents.near` add/remove key test. Mainnet budget for the whole product: 0.5 NEAR total
  (owner). Never spend mainnet funds without the coordinator.
- Commits: git identity is preconfigured (BonneyMantra). No AI attribution lines in commits.
- Honest claims only: anything not run says "planned"; no invented numbers.

## Accounts (testnet; names recorded in `config/testnet.json`, public ids only)
| Role | Account | Notes |
|---|---|---|
| agent (the "real" account) | `si-agent-<n>.testnet` | guardian contract deployed here |
| project | `si-project-<n>.testnet` | demo contract the agent legitimately calls |
| decoy | `si-decoy-<n>.testnet` | bait balance; ALL its full-access keys are decoys except one admin key |
| watcher | `si-watch-<n>.testnet` | holds a function-call key that may only call `freeze` on the agent |
| registry | `si-registry-<n>.testnet` | blocklist contract |
| intents | `si-intents-<n>.testnet` | source-faithful replica of the intents.near key registry |
| attacker | `si-attacker-<n>.testnet` | scripted thief |

## Components and ownership
| Path | Owner | What |
|---|---|---|
| `contracts/guardian/` | W1 | near-sdk Rust. State: owner, watcher, intents_contract, agent_keys[], intents_keys[], frozen, freeze_log[]. `add_agent_key(public_key, receiver_id, method_names, allowance)` owner-only → AddKey(FunctionCall) on its own account; `add_intents_key(public_key)` owner-only → calls intents `add_public_key` (1 yocto) as the account; `freeze(reason)` watcher-or-owner → DeleteKey every agent key AND intents `remove_public_key` (1 yocto) for every intents key, sets frozen, logs `{at_block, reason, decoy_public_key, tx_hash}` and emits NEP-297 event `standin_freeze`; `unfreeze()` owner-only; views `get_state()`. |
| `contracts/intents-replica/` | W1 | Minimal replica of near/intents account key registry: `add_public_key`, `remove_public_key` (assert_one_yocto, predecessor auth), `public_keys_of`, `has_public_key`, plus `execute_signed(intent)` that rejects when the signing key is not registered (`PublicKeyNotExist`). Cite source lines in README. |
| `contracts/project-demo/` | W1 | Tiny contract the agent legitimately calls (`record_deploy(note)`). |
| `contracts/blocklist/` | W2 | `report(tx_hash, decoy_account_id)` → NEAR yield/resume to OutLayer `request_execution` (project `standin-verdict`) → callback verifies the verdict's ed25519 signature against the stored OutLayer project public key (`env::ed25519_verify`) → stores `{attacker_account, decoy_public_key, tx_hash, outlayer_call_or_tx, attested_at}`. `check(account_id)` → `{verdict:"block"|"allow", reasons[]}`. |
| `outlayer/verdict/` | W2 | Rust WASI (wasm32-wasip2). Input `{network, tx_hash, decoy_account_id, sender_id}`. Fetch tx via RPC, assert signer == decoy account and signer public key is on the decoy account's key list (and not the admin key from input), find where value went (attacker), output `{attacker_account, decoy_public_key, tx_hash, block_height}` + ed25519 signature from an OutLayer signing key (`outlayer:signing-keys`, path `verdict`). Deployed with the `outlayer` CLI on testnet; paid in testnet NEAR. |
| `packages/core/` | W3 | TS library: NEAR RPC client, key generation, decoy pool, ledger (append-only NDJSON in `$STANDIN_HOME/ledger.ndjson`), counterparty check (`allow|warn|block` + reasons: blocklist hit=block; account age < 7 days or contract code changed in last 72h = warn; prior interactions count). |
| `packages/watcher/` | W3 | Node service. Streams final blocks (neardata/fastnear, fallback RPC polling), matches any tx with `signer_id == decoy account`, maps `public_key` → ledger entry, calls guardian `freeze` with the watcher key, calls registry `report`, records latency (decoy tx block → freeze tx block). Serves local API on `127.0.0.1:4317`: `GET /api/state`, `GET /api/events` (SSE). Schema below. |
| `packages/cli/` | W3 | `standin adopt` (scan `~/.near-credentials/**`, `.env*`, shell history for NEAR keys; move real full-access key to the macOS keychain via `security`; provision scoped agent keys via guardian; plant decoys in every original location, each a fresh decoy key, recorded in the ledger), `standin status`, `standin freeze`, `standin pay` (agent-side wrapper: refuses on block, asks a human on warn), `standin dev up` (creates/loads testnet accounts, deploys contracts via W1/W2 artifacts). |
| `integrations/claude-code/` | W4 | Claude Code plugin. SessionStart (startup/resume/clear/compact): take a pre-minted decoy key from the pool (pool refilled in background via the decoy admin key: AddKey), bind `session_id` → decoy in the ledger, write decoy to `~/.near-credentials/<net>/` + `.env.local` in the session sandbox and `$CLAUDE_ENV_FILE`; inject the agent's scoped FC key for legit work. PreToolUse: deny reads of the real-key locations; log every call. PostToolUse: scan `tool_response` for any decoy string → ledger `exposure` event naming tool_name + tool_input + tool_use_id. UserPromptSubmit: scan for `@` refs to decoy files. |
| `integrations/codex/` | W4 | `standin codex` launcher (mints decoy, sets `-c shell_environment_policy.set.*`, writes decoy files, isolated `CODEX_HOME`), Codex hooks for SessionStart/PreToolUse/PostToolUse with the same ledger events. Warn when `sandbox_mode=danger-full-access` disables path deny. |
| `attacks/` | W4 | Attack suite, ≥12 routes, each a reproducible script with a log: poisoned README prompt injection, malicious npm postinstall, poisoned MCP tool description, `.env` committed to a public repo (simulated sweeper), shell history grep, `cat ~/.near-credentials`, `@file` reference, log upload, clipboard, cross-session reuse, attacker tries real stolen FC key after freeze, prompt-injected agent tries to pay blocklisted address via `standin pay`. Real Claude Code (`claude -p`) and Codex (`codex exec`) runs inside sandboxes where feasible; otherwise scripted, labelled. |
| `bench/` | W4 | Runs the suite; writes `bench/results.json`: per route detected?, attributed correctly (session + tool)?, blocks from decoy tx to freeze, real-key damage before vs after. Baseline: same routes with Stand-in off. |
| `apps/dashboard/` | Opus | Local web UI against the watcher API. Coordinator only. |

## Watcher API schema (`GET /api/state`)
```json
{ "network": "testnet", "agent": {"account_id": "", "frozen": false, "agent_keys": [], "intents_keys": []},
  "decoy": {"account_id": "", "balance_yocto": "", "keys": [{"public_key": "", "planted": {"kind": "near-credentials|dotenv|shell-history|session-env", "path": "", "agent": "claude-code|codex|manual", "session_id": "", "cwd": "", "at": ""}}]},
  "sessions": [{"session_id": "", "agent": "", "cwd": "", "started_at": "", "decoy_public_key": "", "tool_calls": 0}],
  "exposures": [{"at": "", "session_id": "", "agent": "", "tool_name": "", "tool_input_summary": "", "tool_use_id": "", "decoy_public_key": "", "where": ""}],
  "trips": [{"tx_hash": "", "block_height": 0, "decoy_public_key": "", "attacker_account": "", "attributed_to": {"session_id": "", "agent": "", "tool_name": "", "tool_use_id": "", "path": ""},
             "freeze": {"tx_hash": "", "block_height": 0, "blocks_after_trip": 0, "deleted_keys": [], "intents_keys_removed": []},
             "blocklist": {"tx_hash": "", "outlayer_execution": "", "attested": true}}],
  "blocklist": [{"account_id": "", "evidence_tx": "", "decoy_public_key": "", "attested_at": ""}],
  "bench": {"routes": 0, "detected": 0, "attributed": 0, "median_blocks_to_freeze": 0} }
```
SSE events: `session`, `exposure`, `trip`, `freeze`, `blocklist`, `bench` with the same object shapes.

## Acceptance (each owner proves with a run, not a claim)
- W1: workspaces tests: freeze deletes every registered agent key and removes intents keys; a
  signed intent with a removed key fails `PublicKeyNotExist`; non-watcher freeze refused; deployed
  on testnet with tx links in `contracts/README.md`.
- W2: one real OutLayer testnet execution producing a verdict; registry accepts it via
  yield/resume and refuses a forged signature; links recorded.
- W3: `standin dev up` from a clean `.sandbox` reproduces accounts + deploys; watcher freezes the
  agent within ≤3 blocks of a decoy tx on testnet (measured); `standin pay` blocks a blocklisted
  receiver and asks on warn.
- W4: a real Claude Code session and a real Codex session in sandboxes each get a unique decoy,
  an exposure is attributed to the right tool call, and `bench/results.json` is produced from real runs.
