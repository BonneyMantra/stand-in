# @standin/mainnet

The mainnet slice: a real `intents.near` key, a real decoy bait account and an owner-key freeze. Everything here was run on
**mainnet** on 2026-11-14. No contract is deployed on mainnet (storage staking would exceed the 0.5 NEAR budget), so the
freeze runs in **owner-key mode** instead of through the guardian contract.

## Budget guard (enforced by code)

`src/budget.ts`: every mainnet tx is signed in `Signer.send` (`src/chain.ts`) or in the watcher's `OwnerKeyFreezer`, and both call
`reserve()` before anything is broadcast. Over a cap it throws `BudgetExceeded` and nothing leaves the machine. Ledger:
`.secrets/mainnet-spend.ndjson` (gitignored), one reservation per tx with `{at, purpose, amount_yocto, gas_estimate_yocto, tx_hash}`,
plus `settle` lines (actual gas burnt replaces the estimate) and `recovered` lines (money swept back, credited to its purpose).

| purpose | cap (NEAR) | | purpose | cap (NEAR) |
|---|---|---|---|---|
| bait | 0.20 | | thief | 0.03 |
| account creation + storage | 0.06 | | gas | 0.03 |
| intents add/remove | 0.01 | | global | 0.38 |

Caps count amount + gas. Tests: `packages/mainnet/test/budget.test.ts` (7, includes over-cap refusal before send and global cap),
`packages/watcher/test/ownerfreeze.test.ts` (freeze sends nothing when the guard refuses). Failed sends stay counted (we cannot tell
whether the tx reached the chain). Limit: the guard governs code in this repo; it cannot stop someone using the keys elsewhere.

## Accounts (public ids; keys only in `.secrets/mainnet`, 0600)

| role | account |
|---|---|
| funding (owner) | `7aa26dbb3bf025d1335b0f950abb3d14bae01006370d8b8894609cafb443c93e` |
| agent (the "real" account) | `standin-agent-5705.near` (owner full-access key + one FC key + one intents key) |
| decoy (bait) | `standin-decoy-1701.near` (admin key + 3 decoy full-access keys: `public-repo-env`, `seed-phrase`, `demo-scripted-thief`) |
| attacker-test (we control it) | `b320c619c4a15bacdf6302a58345800ee9c878f5d7a910fba7fb24791fe41728` (implicit: no registrar fee) |

Observed costs: creating a named `.near` account via `near.create_account` or funding a new implicit account each burn about **0.0074 NEAR**
of gas/fees on top of the deposit. The decoy ledger is `.sandbox/mainnet/.standin/ledger.ndjson` (`decoy_planted`, same schema as testnet;
`kind` for the seed phrase is `seed-phrase`, an extension of the brief's list).

## Agent keys

- FC key: receiver `wrap.near`, method `ft_balance_of` only, allowance 0.01 NEAR. Chosen because wrap.near is always present and a
  function-call key cannot attach a deposit, so it cannot wrap or move funds: the worst a thief can do with it is burn the allowance.
- Real `intents.near`: `add_public_key {"public_key": "ed25519:..."}` with 1 yocto, called as the agent account; verified with
  `has_public_key` and `public_keys_of`. (An implicit account's own key is implicitly listed on intents.near, so the agent is a named account.)

## Owner-key freeze (`packages/watcher/src/ownerfreeze.ts`, `config/mainnet.json`)

`STANDIN_CONFIG=config/mainnet.json` switches the watcher to owner-key mode. On a decoy trip it signs with the agent OWNER key:
one tx with a `DeleteKey` per agent FC key, and one tx to `intents.near` with a `remove_public_key` per registered intents key
(two txs is the minimum: a tx has one receiver). Demo: the owner key is loaded from `.secrets/mainnet`; production would read it from the
macOS keychain at start. Both txs use one key, so they are broadcast in order (DeleteKey nonce n+1, then n+2), each verified to have
reached the node, and re-signed once if not. A first run that broadcast them in parallel **lost the DeleteKey** (nonce order); that is why.
Testnet guardian mode is unchanged. Endpoint rotation: fastnear mainnet, free.rpc.fastnear.com, drpc, then rpc.mainnet.near.org;
1rpc.io was dropped because it lacks `EXPERIMENTAL_changes`. The free fastnear tier did return HTTP 429 during runs and the poller rotated.

## Measured on mainnet

Proof run (own watcher on port 4318, scripted thief signing with the `demo-scripted-thief` decoy key, 0.01 NEAR decoy -> attacker-test):

| step | tx | block |
|---|---|---|
| decoy theft | [9xzjaXMP...](https://nearblocks.io/txns/9xzjaXMPWuZonnsrwdZoRASNb13ohA56P1PVXLhseTbV) | 224473777 |
| freeze: DeleteKey of the FC key | [7u6CFZBj...](https://nearblocks.io/txns/7u6CFZBjujxsBS2RqLJEXSEWgaU3XY5oNpK22uAN6NWx) | 224473780 |
| freeze: intents.near `remove_public_key` | [DEePEBTr...](https://nearblocks.io/txns/DEePEBTr3LQ2QkDYj2pCJ2vhpq4ytqMU7qmsQULYR58Y) | 224473780 |

Theft block to freeze block: **3 blocks** (both freeze txs in the same block). Watcher detection to broadcast: 1398 ms. Agent FC key list after:
empty; `has_public_key` before **true**, after **false**. One run only; not a distribution.

All other mainnet txs:

| what | tx |
|---|---|
| create agent account (0.03 NEAR) | [EPKHo98k...](https://nearblocks.io/txns/EPKHo98kHm8SNR7NDK7BZEJisZtFiQEh1YBWWKt2dhrZ) |
| create decoy account | [AsUXLsX9...](https://nearblocks.io/txns/AsUXLsX9x2Tynx1RNZZXVKA4CpbFskMgkZJsiBp5tqGB) |
| fund attacker-test | [4zqiCBVy...](https://nearblocks.io/txns/4zqiCBVy7nH9jvF6KPehyyAvbmiB8ygWkHVDp9K6DVjR) |
| fund bait (0.1995 NEAR) | [BywTPsC9...](https://nearblocks.io/txns/BywTPsC9V6kyLx7dmAsdo3fK5CheeVdss2M3e8VUf9nN) |
| decoy keys added | [ChDNFrXs...](https://nearblocks.io/txns/ChDNFrXsCx8R1ZPW2PGHEA9DSZbEahLyJjU2BgnNFrxN), [BpaL6byY...](https://nearblocks.io/txns/BpaL6byYTivdZxpbk6oNKjDEu1VNw438L9KCC7JxQaxM), [14B33umu...](https://nearblocks.io/txns/14B33umudfY5vWTx8ZH11aWMHebLsw59AWP61q2A3ifN) |
| agent FC key added | [D6cq6JGQ...](https://nearblocks.io/txns/D6cq6JGQF6bEs799hnNYaYQmx3pwdKXrFFDWuQ75VMv) |
| intents.near `add_public_key` (first) | [6bx5kvos...](https://nearblocks.io/txns/6bx5kvosQrmc8mPP2gCh4cFB3HqH5QX8aPWjEUmcAndg) |
| first proof attempt (parallel freeze): theft | [3gLM13hf...](https://nearblocks.io/txns/3gLM13hfx4FpqoDN9kfD4QbouNSHu4LYhWAeEWuAT6f5) |
| ...its `remove_public_key` (landed) | [JbExbd6Z...](https://nearblocks.io/txns/JbExbd6Z9ZeBnxxQinAqNG6icat14vHhwmfngeiFtbS) |
| ...its DeleteKey `Grd8Mb59...` | never landed (unknown to the chain): the bug fixed above |
| intents key re-added after that attempt | [GSpYPHLH...](https://nearblocks.io/txns/GSpYPHLHbcZ66sDPPeFQj2fUT4DtKXJHcRDwJu4DhGH7) |
| re-provision after proof: FC key | [AANtdqcr...](https://nearblocks.io/txns/AANtdqcrFWqDrkExA52oqHW9xe2xoQPPGxJ23dwgJ7cN) (block 224473802) |
| re-provision after proof: intents key | [FQbBjbaJ...](https://nearblocks.io/txns/FQbBjbaJCBPMV1uAeFUeQQRM858LrZYVeqodqinTXeyx) (block 224473806) |
| sweep back: decoy / attacker-test / agent | [8aK5Aob6...](https://nearblocks.io/txns/8aK5Aob6Z9ouRpRHym41iHtut5osiJgQKsctVqXSpv8n), [AKDMZjqK...](https://nearblocks.io/txns/AKDMZjqKWVFc9qfyCX7ZkwjD7zgSvXn6oxN66UWYb3qt), [3C8jt8rA...](https://nearblocks.io/txns/3C8jt8rALWhVDmPta5UAGB7xJZ9HXdCUq4kazPwcnDKC) |

The agent was re-provisioned (FC key + intents key present) before the sweep; the sweep then returned the agent's spare balance, so
**re-fund the agent (about 0.02 NEAR) before filming**: a freeze needs gas on the agent account.

## Money (net consumed vs recoverable)

Read from chain after the sweep: funding 0.4379, agent 0.0113, decoy 0.0124, attacker-test 0.0100, total 0.4717 of the 0.5 funded,
so **0.0283 NEAR consumed** (3 account/implicit creation fees ~0.0222 plus gas). About 0.034 NEAR is locked in the three accounts as storage
and gas margin: recoverable only by deleting those accounts (not done). Guard view (conservative, counts the deposits that stay in our accounts): 0.0926 NEAR net.

## Scripts

`scripts/provision.ts` (accounts, bait, decoy keys), `agent-setup.ts`, `prove.ts` (own watcher + thief + measure + re-provision),
`sweep-back.ts` (dry run by default, `--execute` to move funds back, `--leave-agent <near>`), `bait.ts` (prepare, never publish).
Run with `HOME=<repo>/.sandbox/w6 node --import tsx packages/mainnet/scripts/<name>.ts`.

## Not done / planned

- Bait is prepared in `.sandbox/mainnet/bait/` and **not published**. Nothing proves a public sweeper would take it.
- Production keychain storage of the owner key: documented, not built.
- Guardian contract on mainnet: not deployed (budget).
- Latency was measured once on mainnet; the testnet numbers in `packages/watcher/README.md` are separate.
