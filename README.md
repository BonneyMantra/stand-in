# Stand-in

**Your agent can read your keys. Make sure they're fake.**

Stand-in keeps the owner's NEAR key out of reach of AI coding agents (Claude Code, Codex): it stays in the owner's
own wallet, which approves a scoped key for the agent, or the CLI moves it out of the files agents read. It then
plants unique decoy keys everywhere a key would live: `~/.near-credentials`, `.env` files, the session
environment. Every decoy is a key on one bait account, and both the bait and the watcher are the user's own
accounts, created at adopt with keys that never leave the user's machine. The moment any decoy signs a transaction,
that watcher freezes the real account through a guardian contract. The freeze deletes the agent's keys, removes its
keys from NEAR Intents, and cuts off its Chain Signatures on every other chain. The dashboard names the
agent session and the tool call that leaked the decoy. An OutLayer TEE verdict puts the thief on a
blocklist that agents check before they pay, and a NEAR AI Cloud model writes a private, attested
incident report.

Built for NEAR HACKATHON (November 2026), Security and Agents tracks. MIT licensed.

**Try it without installing anything:** leak a decoy yourself at https://stand-in-44e.pages.dev/lab, check every claim
from chain at https://stand-in-44e.pages.dev/verify, and see the guide for judges in [JUDGES.md](JUDGES.md).

## How it works

| Step | What happens | Where |
|---|---|---|
| Adopt | The owner's key stays in their own wallet (NEAR Connect); the wallet deploys the guardian, approves a function-call key for the agent, scoped to your contract, and creates your own bait (`deployer.<you>`) and watcher (`watch.<you>`) accounts, 0.2 NEAR each, with keys generated on your machine. Without a wallet, the CLI does the same with the account's key, then moves it out of the agent's reach. | `apps/web` (`/app/owner`), `packages/cli` (`standin adopt --wallet`, `standin adopt`) |
| Plant | Each agent session gets its own decoy keys, written where agents look for keys. | `integrations/claude-code`, `integrations/codex` |
| Watch | Claude Code and Codex hooks check every prompt, tool input and tool output for decoys and log each tool call. | `integrations/common` |
| Trip | A decoy signs a transaction on chain. The watcher sees the decoy account's key in use. | `packages/watcher` |
| Freeze | The watcher calls `guardian.freeze`: every agent key is deleted, every intents key is removed, `sign_evm` is refused. | `contracts/guardian` |
| Attribute | The decoy's public key maps to the session that received it and the tool call that exposed it. | ledger + dashboard |
| Blocklist | An OutLayer TEE app verifies the theft from chain data and signs a verdict; the registry adds the thief. `standin pay` refuses blocklisted receivers. | `outlayer/verdict`, `contracts/blocklist` |
| Report | A NEAR AI Cloud model inside a TEE writes the incident report; the signature and attestation are checked locally. | `packages/nearai` |
| Prevent | Before the agent installs or runs packages, the hook checks OSV.dev and denies known malware; a provenance downgrade is flagged. | `integrations/common/supplychain` |
| Canary | Each session also gets Canarytokens decoys (DNS, URL, MCP config) that alert even if the thief never touches NEAR. | `packages/canary` |
| Alert | The owner's phone gets an ntfy push with Freeze now and Ignore buttons; a fired canary can freeze before any theft. | `packages/notify`, `packages/watcher` |
| Recover | Unfreezing is an owner transaction from the owner's wallet, or, on the keystore route, needs the owner's fingerprint (Touch ID). Approving a payment that only warns needs Touch ID. | `/app/owner`, `packages/touchid`, `packages/cli` |

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

## Owner console (wallet first)

The owner's own wallet is the main owner path: **https://stand-in-44e.pages.dev/app/owner**. Sign-in is an external
wallet through [NEAR Connect](https://github.com/hot-dao/near-selector) (`@hot-labs/near-connect` 0.12.0, testnet);
there is no Google or email sign-in, and the page never holds an owner key.

Two ways to own a guardian, each one wallet transaction:
- **Protect this account** (a named NEAR account in Meteor, Intear, Ledger, Nightly or NEAR CLI). The wallet signs
  `DeployContract` + `new(watcher, intents)` from the account to itself. The code is `/guardian/standin_guardian.wasm`,
  pinned to code hash `7PbHKsE6…9ZuE` (the guardian on `si-agent-5289.testnet`); the page re-hashes it before signing.
  About 1.9 NEAR is locked for storage, and the page shows any shortfall.
- **Guarded agent account** (any wallet; the route for Ethereum Wallets / MetaMask). A 0x account already runs NEAR's
  Ethereum wallet contract, so it cannot host the guardian. Its owner calls `create_guardian` on the factory
  `guard.si-project-5289.testnet` (deposit from about 2.14 NEAR). The factory creates
  `<name>.guard.si-project-5289.testnet` with the guardian, owned by the caller and with no access keys at all;
  `withdraw` returns its NEAR to the owner. Evidence: [`docs/guardian-factory.md`](docs/guardian-factory.md).

A guardian made here is watched by `watch.<owner>`, the owner's own watcher account (a 0x owner cannot create
sub-accounts, so its guardian keeps the project's watcher and is frozen from the console).

From the wallet the owner then freezes, unfreezes and withdraws, each with an explorer link and a fresh `get_state`
read. The CLI gives the agent its key without touching an owner key:
- `standin adopt --wallet --account <id> [--owner <id>] --home DIR` prints an `op=adopt` link. One wallet request
  carries the guardian part (deploy + `new` + `add_agent_key`, or `add_agent_key` alone on an existing guardian) and,
  for each missing home account, `CreateAccount` + `Transfer 0.2 NEAR` + `AddKey`. The CLI then writes the home's
  config, mints decoys on its own bait and plants one;
- `standin dev up --home DIR` starts that home's watcher, which signs freezes as `watch.<owner>`;
- `standin unfreeze --wallet --home DIR` prints an `op=unfreeze` link (and says "nothing to do" for an unfrozen guardian
  whose agent key is still live).

### Your own bait and watcher (no key of ours)
`adopt` (both routes) creates two sub-accounts of the account that owns the guardian: `deployer.<owner>`, the bait
(named like a deployment key, which is what a thief looks for), and `watch.<owner>`, the guardian's watcher. Their keys
are generated by the CLI and stored only in `HOME/.standin/keys/` (files 0600, directory 0700); a link carries public
keys only. `HOME/.standin/config.json` names them, and every mint, plant, session hook and the watcher use them. The
project's own film accounts (`config/testnet.json`, `.sandbox/default`) are unchanged.

Refused before anything is signed, each with the fix: a guardian whose watcher is another account (the guardian has no
method to change its watcher), a sub-account that already exists without this home's key, too little NEAR (guardian
storage + 0.2 NEAR per new account + gas), and a 0x owner. A partly landed request is picked up where it stopped: the
console offers only what is missing and `--resume` waits for it. The watcher's 0.2 NEAR pays for freezes; a blocklist
report needs about 0.36 NEAR up front, so a watcher with less skips the report and says so.

Multi-transaction requests: NEAR Connect passes `signAndSendTransactions` straight to the wallet, and every testnet
wallet in its manifest declares it. Meteor's and Intear's executors send all transactions in one request with one
approval screen (read from their executor code; not run here with the real wallets). A wallet without it is asked once
per transaction, and the console says so. The transactions are independent on chain. Meteor refuses `DeployContract`,
so with Meteor the guardian comes from the factory and the link only adds the key and the two accounts.

Each command activates the key only when the chain shows it with exactly the requested receiver, methods and allowance.
The page validates every link value with zod and refuses an agent key whose receiver is the guardian account itself.

Wallets offered on testnet: Meteor, Intear, Ledger, Nightly, NEAR CLI and Ethereum Wallets. Web wallets open as a tab in
the same window (a one-line pnpm patch to near-connect drops the popup size from `window.open`). WalletConnect and Unity
need a WalletConnect project id, which we do not have, so NEAR Connect hides them; HOT, MyNearWallet, NEAR Mobile and OKX
do not declare testnet.

Tested with a real Meteor Web wallet (`bonneymantra.testnet`, every signature pressed in Meteor's own Approve screen):
create a guarded agent account, freeze, unfreeze, an agent key from `standin adopt --wallet`'s link, and withdraw, each
read back from chain. Meteor refuses contract deployment from any app, so "Protect this account" needs another wallet
(Intear, Ledger and NEAR CLI are offered but not tested); the panel says so. A closed wallet window makes the page read
the chain before it reports anything.

Also tested with a scripted wallet inside NEAR Connect's own picker. Covered: protect, freeze and unfreeze; an `op=adopt` link on a fresh account; the
factory route from create to withdraw; `standin adopt --wallet`, then a decoy theft that the watcher froze three blocks
later; refusals (wrong account, bad link, foreign contract, watcher mismatch, low balance, 0x account). The deployed page
passed the `window.open` check. Every transaction: [`docs/wallet-tests.md`](docs/wallet-tests.md).
Not completed: a scripted MetaMask connection (the Ethereum Wallets sign page runs on its own site, out of reach of an
injected provider).

No wallet: [`/lab`](https://stand-in-44e.pages.dev/lab), [`/verify`](https://stand-in-44e.pages.dev/verify) and the
keystore CLI (`standin adopt`, Touch ID `standin unfreeze`) remain the no-wallet route; the film shows that route.

## Run it

Tested with Node 24 and pnpm 11; the contracts need Rust with `cargo-near`.

```sh
git clone https://github.com/BonneyMantra/stand-in && cd stand-in && pnpm install
pnpm standin adopt --wallet --account you.testnet --home ~   # owner key stays in your wallet: approve the printed link (guardian, agent key, your bait and watcher)
pnpm standin adopt --home ~ --account you.testnet   # no wallet: the same with the account's key, then the real key moves out
pnpm standin dev up --home ~                # your accounts and contracts, decoy pool on your bait, your watcher on 127.0.0.1:4317
pnpm standin:claude --home .sandbox/me      # Claude Code plugin into an isolated config dir
pnpm standin:codex                          # Codex with decoys and hooks
pnpm standin pay <contract> <method> --args '{"note":"x"}'   # counterparty check first: allow / warn / block
cd apps/web && pnpm exec vite               # dashboard and landing page on 127.0.0.1:4173
pnpm test                                   # TypeScript tests (181)
```

`adopt --account` needs the account's full-access key in `HOME/.near-credentials/testnet/`, a `.env` or shell history,
and about 2.45 NEAR on the account (about 2 for the guardian, 0.2 each for the bait and the watcher, gas). It creates
the bait and the watcher with that key before moving it, writes `HOME/.standin/config.json` naming them, and prints the
watcher command (`STANDIN_WATCHER_PORT=<port>` if 4317 is taken). No `.secrets/` is needed: a fresh clone works.
Without `--home`, `dev up` and the other commands use the project's own film accounts, whose keys only we hold. Every other command takes `--home HOME` to use that
home's ledger, scoped key and config. The agent holds a function-call key, so `pay` calls a method on the project
contract; it cannot transfer NEAR.

The dashboard reads the live watcher; with no watcher it falls back to a recorded testnet run
(`apps/web/public/demo-state.json`, built from real ledgers by `apps/web/src/data/build-demo-state.mjs`).

## Repository

| Path | What |
|---|---|
| `contracts/guardian` | Freeze, agent and intents key management, `sign_evm`, external owner and `withdraw` (Rust, near-sdk) |
| `contracts/factory` | Creates keyless guardian accounts owned by the caller (for owners whose account cannot host a contract) |
| `contracts/intents-replica` | Source-faithful replica of the `intents.near` key registry for testnet |
| `contracts/blocklist`, `outlayer/verdict` | TEE-attested blocklist |
| `packages/core`, `packages/watcher`, `packages/cli` | RPC, decoy ledger, watcher and API, `standin` CLI |
| `packages/chainsig`, `packages/mainnet`, `packages/nearai` | Chain Signatures, mainnet slice with spend guard, NEAR AI Cloud reports |
| `integrations/` | Claude Code plugin and Codex launcher with shared hooks |
| `attacks/`, `bench/` | 20 attack routes and the on/off benchmark |
| `apps/web` | Landing page, dashboard, hosted lab (`/lab`, Pages Functions in `functions/`) and claim checker (`/verify`); `UI-SOURCES.md` lists component sources |
| `packages/lab`, `packages/notify`, `packages/touchid`, `packages/canary` | Hosted lab backend, phone alerts, fingerprint gate, canary decoys |

## Limits and planned work

- Hooks see tool calls that go through the agent harness. Hosted tools and the VS Code extension are not covered.
- Leaks inside a child process (npm, `env | curl`, git) are caught by the trip; the tool call is inferred, not exact.
- The Chain Signatures transaction is signed and verified but was not broadcast to Sepolia (planned).
- The NEAR AI Cloud proof is checked locally except Intel's DCAP certificate chain, RTMR3 replay and NVIDIA GPU evidence.
- The plugin marketplace listing and an npm package are planned; today everything runs from a clone.
- No live public bait has been published yet; the mainnet theft above is our own scripted thief.
- The hosted lab sends its phone push from the visitor's browser, because ntfy.sh refuses connections from Cloudflare Workers.
- The OSV check reads package.json and the named packages; installs hidden inside scripts are not parsed.

## Safety

Every test runs in a sandbox home under `.sandbox/` (gitignored). Keys live in `.secrets/` (gitignored). The
thief in the benchmark may only use decoy keys from its own run, and logs are scanned for secrets after every run.
