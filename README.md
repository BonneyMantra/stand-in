# Stand-in

**Your agent can read your keys. Make sure they're fake.**

Stand-in moves the real NEAR full-access key out of reach of AI coding agents (Claude Code, Codex) and
plants unique decoy keys everywhere a key used to live: `~/.near-credentials`, `.env` files, the session
environment. Every decoy belongs to one bait account. The moment any decoy signs a transaction, a watcher
freezes the real account through a guardian contract. The freeze deletes the agent's keys, removes its
keys from NEAR Intents, and cuts off its Chain Signatures on every other chain. The dashboard names the
agent session and the tool call that leaked the decoy. An OutLayer TEE verdict puts the thief on a
blocklist that agents check before they pay, and a NEAR AI Cloud model writes a private, attested
incident report.

Built for NEAR HACKATHON (November 2026), Security and Agents tracks. MIT licensed.

## How it works

| Step | What happens | Where |
|---|---|---|
| Adopt | The real full-access key leaves the agent's reach. The agent gets a function-call key scoped to your contract. | `packages/cli` (`standin adopt`) |
| Plant | Each agent session gets its own decoy keys, written where agents look for keys. | `integrations/claude-code`, `integrations/codex` |
| Watch | Claude Code and Codex hooks check every prompt, tool input and tool output for decoys and log each tool call. | `integrations/common` |
| Trip | A decoy signs a transaction on chain. The watcher sees the decoy account's key in use. | `packages/watcher` |
| Freeze | The watcher calls `guardian.freeze`: every agent key is deleted, every intents key is removed, `sign_evm` is refused. | `contracts/guardian` |
| Attribute | The decoy's public key maps to the session that received it and the tool call that exposed it. | ledger + dashboard |
| Blocklist | An OutLayer TEE app verifies the theft from chain data and signs a verdict; the registry adds the thief. `standin pay` refuses blocklisted receivers. | `outlayer/verdict`, `contracts/blocklist` |
| Report | A NEAR AI Cloud model inside a TEE writes the incident report; the signature and attestation are checked locally. | `packages/nearai` |

## NEAR technology used

| NEAR feature | What Stand-in does with it | Proof |
|---|---|---|
| Access keys + a guardian contract | The agent holds only a function-call key. The guardian adds and deletes the agent's keys on its own account. | testnet freeze [`EFrvBZ…`](https://testnet.nearblocks.io/txns/EFrvBZmt53PYB9cD1AuZ3hYQvdVpatuMqMCCqTmJwzXv) |
| NEAR Intents (`intents.near`) | The freeze removes the agent's keys from the Intents registry too, so queued intents cannot settle. | mainnet below; testnet replica rejects a signed intent with `PublicKeyNotExist` [`2CNYoa…`](https://testnet.nearblocks.io/txns/2CNYoa89ey8Sguv3JyqGjNuYCBLmfVE1vu9NdP57rHYZ) |
| Chain Signatures (`v1.signer-prod.testnet`) | The agent signs EVM transactions through the guardian. After a freeze, the MPC network never receives the request. | signed [`86J721…`](https://testnet.nearblocks.io/txns/86J721R72GArAgs7CphqL3q5qc5WtRkuxNqFnrfjJDDU), refused after freeze [`7vj8xX…`](https://testnet.nearblocks.io/txns/7vj8xXr8WCVzEdd7gum5R5yu9D3zsVt8uXUvoBySSfLd) |
| OutLayer (TEE execution) | `standin-verdict` reads the theft from chain inside a TEE and signs the verdict the blocklist contract verifies via yield/resume. | report [`51t83J…`](https://testnet.nearblocks.io/txns/51t83JuRDeXbptzxR857rqcKav8BevJsBDgkShQMZpBX), [attestation](https://testnet-api.outlayer.ai/attestations/by-tx/51t83JuRDeXbptzxR857rqcKav8BevJsBDgkShQMZpBX) |
| NEAR AI Cloud (private inference) | `Qwen/Qwen3.8-27B` in Intel TDX + NVIDIA TEE writes the incident report; the response signature and attestation are verified. | 3 reports, `packages/nearai/README.md` |

## Measured

**Benchmark** (`bench/results.json`, testnet, Claude Code 2.1.325, codex-cli 0.169.0): 20 attack routes, 8 run by real
agents and 12 scripted through the real hook entry point.

| | Stand-in on | Stand-in off |
|---|---|---|
| Thefts that froze the real account | 11 of 11 | n/a |
| Blocks from decoy tx to freeze | median 3 (range 2 to 8), read from chain | n/a |
| Real account balance change | −0.0017 NEAR (gas) | 12 of 19 thefts landed, about 0.2 NEAR each (−2.4016 NEAR) |
| Leak attributed to the right session | 10 | n/a |
| Attributed to the exact tool call | 4 (child-process leaks are inferred and labelled as such) | n/a |

- The six prompt-injection routes (README, code comment, web page) were run against real Claude Code and real
  Codex. Every agent refused the injection, with Stand-in on and off. That is a result about the models, not
  about Stand-in.
- Route 19: real Claude Code ran `npm test` in a project with a compromised test-reporter dependency, which
  sent the session's decoy to the thief. The account was frozen 3 blocks later. Route 20 (Codex) lost 0.2002
  NEAR with Stand-in off and did not leak with it on; the reason is not confirmed.
- Route 17: an agent tries to pay the attested thief through `standin pay`; it exits 3 (refused).

**Mainnet** (`packages/mainnet/README.md`): agent `standin-agent-5705.near`, decoy `standin-decoy-1701.near`.

| Step | Tx |
|---|---|
| Agent key registered on `intents.near` | [`6bx5kv…`](https://nearblocks.io/txns/6bx5kvosQrmc8mPP2gCh4cFB3HqH5QX8aPWjEUmcAndg) |
| Decoy used by a scripted thief | [`9xzjaX…`](https://nearblocks.io/txns/9xzjaXMPWuZonnsrwdZoRASNb13ohA56P1PVXLhseTbV) |
| Freeze: agent key deleted (3 blocks later) | [`7u6CFZ…`](https://nearblocks.io/txns/7u6CFZBjujxsBS2RqLJEXSEWgaU3XY5oNpK22uAN6NWx) |
| Freeze: `intents.near remove_public_key` (same block) | [`DEePEB…`](https://nearblocks.io/txns/DEePEBTr3LQ2QkDYj2pCJ2vhpq4ytqMU7qmsQULYR58Y) |

`has_public_key` on `intents.near` went from true to false. Mainnet runs without a guardian contract (storage
cost); the watcher freezes with the owner key instead. Every mainnet transaction goes through a spend guard
that refuses anything over its cap.

## Run it

Tested with Node 24 and pnpm 11; the contracts need Rust with `cargo-near`.

```sh
git clone https://github.com/BonneyMantra/stand-in && cd stand-in && pnpm install
pnpm standin dev up                         # check testnet accounts and contracts, decoy pool, watcher on 127.0.0.1:4317
pnpm standin adopt --home ~                 # move the real key out, plant decoys
pnpm standin:claude --home .sandbox/me      # Claude Code plugin into an isolated config dir
pnpm standin:codex                          # Codex with decoys and hooks
pnpm standin pay <account> <amount>         # counterparty check: allow / warn / block
cd apps/web && pnpm exec vite               # dashboard and landing page on 127.0.0.1:4173
pnpm test                                   # TypeScript tests (36)
```

The dashboard reads the live watcher; with no watcher it falls back to a recorded testnet run
(`apps/web/public/demo-state.json`, built from real ledgers by `apps/web/src/data/build-demo-state.mjs`).

## Repository

| Path | What |
|---|---|
| `contracts/guardian` | Freeze, agent and intents key management, `sign_evm` (Rust, near-sdk) |
| `contracts/intents-replica` | Source-faithful replica of the `intents.near` key registry for testnet |
| `contracts/blocklist`, `outlayer/verdict` | TEE-attested blocklist |
| `packages/core`, `packages/watcher`, `packages/cli` | RPC, decoy ledger, watcher and API, `standin` CLI |
| `packages/chainsig`, `packages/mainnet`, `packages/nearai` | Chain Signatures, mainnet slice with spend guard, NEAR AI Cloud reports |
| `integrations/` | Claude Code plugin and Codex launcher with shared hooks |
| `attacks/`, `bench/` | 20 attack routes and the on/off benchmark |
| `apps/web` | Landing page and dashboard (`apps/web/UI-SOURCES.md` lists component sources) |

## Limits and planned work

- Hooks see tool calls that go through the agent harness. Hosted tools and the VS Code extension are not covered.
- Leaks inside a child process (npm, `env | curl`, git) are caught by the trip; the tool call is inferred, not exact.
- The Chain Signatures transaction is signed and verified but was not broadcast to Sepolia (planned).
- The NEAR AI Cloud proof is checked locally except Intel's DCAP certificate chain, RTMR3 replay and NVIDIA GPU evidence.
- The plugin marketplace listing and an npm package are planned; today everything runs from a clone.
- No live public bait has been published yet; the mainnet theft above is our own scripted thief.

## Safety

Every test runs in a sandbox home under `.sandbox/` (gitignored). Keys live in `.secrets/` (gitignored). The
thief in the benchmark may only use decoy keys from its own run, and logs are scanned for secrets after every run.
