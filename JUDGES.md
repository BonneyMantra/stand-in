# Judging Stand-in in five minutes

Sections 1 to 3 can be checked without installing anything or holding any key (the no-wallet route). With a NEAR
testnet wallet, the owner's main path is the owner console (section after 3).

## 1. Run an attack yourself (1 minute)
Open **https://stand-in-44e.pages.dev/lab** and press **Leak a decoy**. On NEAR testnet, the lab:
1. adds a fresh decoy key to its bait account,
2. leaks it through a simulated agent session,
3. lets a thief sign a 0.05 NEAR transfer with it,
4. watches the chain until that key's use is visible (it polls the decoy key's nonce; the freeze is never sent
   before the theft is seen),
5. freezes the agent account through its guardian contract with a key that may only call `freeze`,
6. pushes a phone alert (scan the QR code first to receive it),
7. resets: unfreezes, returns the loot, deletes the used decoy.

Every step links to its transaction. Recent runs from every visitor are listed under the trace. Limits: one run at a
time, three per visitor per ten minutes. Implementation: `apps/web/functions/api/lab/`, `packages/lab/`.

## 2. Check every claim from chain (1 minute)
Open **https://stand-in-44e.pages.dev/verify**. Your browser asks public NEAR RPC nodes (testnet and mainnet) about
every transaction behind every claim in [`docs/claims.json`](docs/claims.json) and compares status, error text and
block distances. It also recovers the signer of each NEAR AI Cloud incident report and compares it with the
enclave's attested signing address. No server of ours is involved.

## 3. Read the evidence (3 minutes)
| Claim | Where |
|---|---|
| Freeze deletes agent keys and removes intents keys; a signed intent then fails `PublicKeyNotExist` | `contracts/README.md` |
| Mainnet: the agent's key removed from `intents.near` 3 blocks after a decoy theft | `packages/mainnet/README.md` |
| Chain Signatures refused after a freeze | `packages/chainsig/README.md` |
| OutLayer TEE verdict adds the thief to the blocklist; `standin pay` refuses it (exit 3) | `outlayer/`, `contracts/blocklist/` |
| NEAR AI Cloud TEE incident report, signature and attestation checks | `packages/nearai/README.md` |
| 20 attack routes, real Claude Code and Codex included; 11 of 11 thefts frozen, median 3 blocks; Stand-in off lost 2.4016 NEAR | `bench/README.md`, `bench/results.json` |
| Known npm malware denied before it runs (OSV); off-chain canary decoys reach the phone | `integrations/common/supplychain/README.md` |
| Phone push with Freeze now / Ignore; unfreezing needs Touch ID | `packages/notify/README.md`, `packages/touchid/README.md` |
| Owner console (wallet first): protect an account from the wallet, `op=adopt` / `op=unfreeze` links from the CLI, freeze, unfreeze, and factory guardians for MetaMask owners (create to withdraw); every tx read back on chain (scripted wallet in NEAR Connect's picker, no third-party wallet) | `docs/wallet-tests.md`, `docs/guardian-factory.md`, `/app/owner` |

## With your own testnet wallet (the owner's main path)
Open **https://stand-in-44e.pages.dev/app/owner** and press Connect wallet. NEAR Connect lists the testnet wallets
(Meteor, Intear, Ledger, Nightly, NEAR CLI, Ethereum Wallets); there is no Google or email sign-in.
- A fresh named testnet account with about 2 NEAR: **Protect this account** deploys the guardian from your wallet
  (code hash shown and checked), then Freeze and Unfreeze are one wallet transaction each.
- A MetaMask (0x) account, or any account you would rather not deploy on: **Create a guarded agent account** asks the
  factory for a keyless guardian account you own; Freeze, Unfreeze and Withdraw work from your wallet.
- `standin adopt --wallet --account <id> --home DIR` prints a link that gives an agent its scoped key from your wallet.
What we tested, and how (a scripted wallet inside NEAR Connect's own picker, not a third-party wallet), is in
[`docs/wallet-tests.md`](docs/wallet-tests.md) and [`docs/guardian-factory.md`](docs/guardian-factory.md).

## 4. Run it locally
See [README.md](README.md#run-it). `pnpm test` runs the TypeScript suite; contract tests run with `cargo test` in each
`contracts/*` crate.

## What is not covered
Listed honestly in [README.md](README.md#limits-and-planned-work).
