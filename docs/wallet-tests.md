# Owner console (wallet) test evidence

Run on 2026-11-14 between 21:10 and 21:35 IST against testnet. Code: `apps/web/src/pages/app/OwnerPage.tsx`,
`apps/web/src/components/owner/`, `apps/web/src/lib/wallet/`. Connector: `@hot-labs/near-connect` 0.12.0
(published 2026-10-26), network `testnet`, wallets filtered to `testnet` + `signAndSendTransaction`.

## Test account

`wallet-owner.si-project-5289.testnet`, created for these tests by `apps/web/scripts/wallet-test/setup.ts`
(the testnet faucet answered 429, so it is a sub-account funded with 2.05 NEAR by `si-project-5289.testnet`).
The guardian code is the hosted lab's deployed build, copied with `view_code` from
`lab-agent.si-project-5289.testnet` (code hash `7PbHKsE6PhdvypoUrE179X5kPxjqgzfFJr7Z1kRr9ZuE`, 176,033 bytes),
initialised with watcher `lab-watch.si-project-5289.testnet` and intents `si-intents-5289.testnet`.
Its full-access key is in `.sandbox/wallet-test/` (gitignored, 0600). The film account `si-agent-5289.testnet`
was not touched.

| Step | Tx |
|---|---|
| create account (from `si-project-5289.testnet`) | [`6Z4Yiy…`](https://testnet.nearblocks.io/txns/6Z4Yiyjjxrhmb5k7Uox9TdcGXZ67Ys8tqDsvvt1a25dM) |
| deploy guardian + `new` | [`27fo5j…`](https://testnet.nearblocks.io/txns/27fo5jLRhP5DV3TE417Pk7AndnRdwtxm9mYdQANL7rv9) |

## How the wallet was driven

No third-party wallet UI was used and no key was typed into any page. NEAR Connect's own debug-wallet
mechanism (`registerDebugWallet`, persisted in the page's `localStorage["debug-wallets"]`) registered a
test-only executor, `apps/web/scripts/wallet-test/executor.js`. It runs in NEAR Connect's sandboxed iframe exactly
as Meteor's or HOT's executor does, and holds no key: it forwards each request to
`apps/web/scripts/wallet-test/signer.ts`, a local signer on 127.0.0.1:4391 that signs with the test account's key
and only accepts zero-deposit `freeze` / `unfreeze` / `add_agent_key` calls from the account to itself. Signer modes
simulate a rejecting wallet, a mainnet wallet, other accounts, and a wallet that drops an action.

Page under test: a production build (`pnpm --filter ./apps/web build`) served by `vite preview` on
127.0.0.1:4402, driven headless by agent-browser (session `standin-wallet-e2e`, `--mute-audio`). The debug wallet
appears first in NEAR Connect's own wallet picker; every step below went through that picker and the page's buttons.

```sh
node --import tsx apps/web/scripts/wallet-test/setup.ts wallet-owner.si-project-5289.testnet
node --import tsx apps/web/scripts/wallet-test/signer.ts              # 127.0.0.1:4391
cd apps/web && pnpm build && npx vite preview --host 127.0.0.1 --port 4402 --strictPort
# in the page: localStorage["debug-wallets"] = [manifest with executor http://127.0.0.1:4391/executor.js], reload
curl -XPOST 127.0.0.1:4391/mode -d '{"mode":"reject"}'                # ok | reject | mainnet | account:<id> | drop-unfreeze
```

## Transactions signed through the page

| # | What the page did | Result | Tx |
|---|---|---|---|
| 1 | Deep link (guardian active): `add_agent_key` HNAGDi…, receiver `si-project-5289.testnet`, `record_deploy`, 0.25 NEAR | landed; page read the key back: FunctionCall, same receiver/methods/allowance | [`EK1qLf…`](https://testnet.nearblocks.io/txns/EK1qLfoBzBCA3NbTrYPbp3bg2h8JvBzyjKk3KhKTVdb2) |
| 2 | Freeze, reason "Owner console test: agent session on build-03 pasted a key into a PR comment" | landed; state re-read: `frozen`, 1 agent key deleted, freeze log shows the reason and `by` = the account | [`4hD7G4…`](https://testnet.nearblocks.io/txns/4hD7G4uBguesCgUwMayu9vpKegxLx1m8uSmmTKshP7gN) |
| 3 | Unfreeze with the wallet in reject mode | nothing sent; "The request was rejected in the wallet. Nothing was sent." | none |
| 4 | Deep link while frozen, wallet drops the `unfreeze` action | landed with a contract panic; page showed "The guardian is frozen: unfreeze must run before a key can be added." with the tx link | [`8gp7h3…`](https://testnet.nearblocks.io/txns/8gp7h37xzY8keYbnJTtLSydUYGANNWLmLpPQzm7zGDrN) |
| 5 | Same deep link (8qXfyV…, `record_deploy,ping`, 0.5 NEAR), wallet normal: one tx `unfreeze` + `add_agent_key` | landed; state `active`; key read back with both methods and 0.5 NEAR | [`BJ6Vts…`](https://testnet.nearblocks.io/txns/BJ6VtsGPxSrHvEczxrnsRGjbqTrpRKwsNugRZFoRJkeC) |

Independent readback after step 5 (curl to testnet RPC, not the page):
`get_state` → `frozen: false`, `agent_keys: [8qXfyV…]`, one freeze record (block 277677840, deleted HNAGDi…);
`view_access_key` 8qXfyV… → `FunctionCall {receiver_id: si-project-5289.testnet, method_names: [record_deploy, ping],
allowance: 500000000000000000000000}`; `view_access_key` HNAGDi… → "does not exist" (deleted by the freeze).

## States checked in the page (local build)

| State | How | Seen |
|---|---|---|
| Disconnected / empty | first visit | connect prompt with the three owner facts and the testnet wallet list |
| Wallet picker | Connect wallet | NEAR Connect modal: test wallet, Meteor, Intear, Ledger, Nightly, Ethereum Wallets, NEAR CLI |
| Connected, active, frozen | after txs above | account + wallet name in the header; status tag, keys, freeze record |
| Session restore | reload and full navigation while connected | same account restored without the picker |
| Disconnect | Disconnect, then reload | `selected-wallet` cleared, prompt stays after reload; reconnect works |
| Wrong network | signer mode `mainnet` (signs in as `standin-owner.near`) | "Wrong network" alert, no chain read, no actions |
| Rejected sign-in | signer mode `reject` at connect | "The request was rejected in the wallet. Nothing was sent." |
| No contract | `account:lab-thief.si-project-5289.testnet` | "This account has no contract, so no guardian is watching it." + what `standin adopt` does |
| Not a guardian | `account:si-project-5289.testnet` | "runs a contract, but it is not a Stand-in guardian (the contract has no get_state method)" |
| Missing account | `account:no-such-owner-7731.testnet` | "This account does not exist on testnet." |
| Loading | reload while connected | skeleton rows until `get_state` answers |
| RPC error | agent-browser aborts all three RPC hosts | "Every testnet RPC endpoint failed: Failed to fetch" + Try again; after unrouting, Try again recovers |
| Deep link for another account | `account=lab-agent…` while connected as wallet-owner | names both accounts, no sign button |
| Deep link key already registered | re-open link 5 | "This key is already registered", no sign button |
| Malformed deep links | bad account, short key, `<script>` method, allowance 0, allowance 2 NEAR, duplicate `account`, missing `methods` | "Approval link refused" with each problem, no sign button |
| Widths | 390, 1024, 1440 | no horizontal scroll (scrollWidth = viewport); full agent key wraps at 390 |

Not exercised live: a wallet window closed mid-request ("Wallet closed" from NEAR Connect); its message is unit-tested.

## Unit tests

`apps/web/test/deeplink.test.ts` (in the root `pnpm test`; 9 tests): CLI-format links (encodeURIComponent, empty
methods), allowance bounds (1 NEAR accepted, above refused, 0 refused because the guardian treats it as unlimited),
account/key/method grammar, missing and repeated fields, contract-panic extraction and error wording.
Full suite after the change: 16 files, 114 tests passed. `tsc -b` clean; `oxlint` 0 errors.

## Deployed URL (https://stand-in-44e.pages.dev, deployed 21:31 IST)

HTTP 200: `/`, `/app`, `/app/owner`, `/lab`, `/verify`, `/api/lab/status`. Headless (session `standin-wallet-prod`):
connect prompt renders; the wallet picker opens with Meteor, Intear, Ledger, Nightly, Ethereum Wallets and NEAR CLI
(no test wallet there) and closes with no error; a valid link shows the decoded request and "Connect the wallet
that holds wallet-owner.si-project-5289.testnet"; a malformed link is refused with three problems; 390 px has no
horizontal scroll. `/app`, `/lab`, `/verify`, `/` render their headings. A real wallet was not connected on the
deployed URL (that needs the owner's own wallet).

## Not built, and why

- **NEAR Auth / FastAuth sign-in.** A FastAuth account could only act as an owner here if the guardian were deployed
  on that account (the guardian's owner is `current_account_id`). That needs an "adopt from wallet" flow: deploy
  176 KB of guardian code (about 1.8 NEAR of storage) and call `new` from the FastAuth account, then move the agent
  onto a scoped key. That flow does not exist yet, so a FastAuth button would sign in to an account the console can
  only show as "no guardian". Not built rather than shipped as a shim.
- **Ethereum Wallets executor as owner.** It is listed (NEAR Connect marks it testnet-capable) but untested. An
  Ethereum-wallet NEAR account already runs the wallet contract, so the guardian cannot be deployed on it; such an
  account can connect and will see the "not a guardian" state.
- **HOT Kit for external EVM/Solana accounts.** The guardian cannot freeze a key it does not control. The honest EVM
  story is the guardian's Chain Signatures `sign_evm`, refused while frozen, already in the product.
- **NEP-413 server login.** No server holds an owner session; every owner action is a wallet-signed transaction that
  proves control on chain. No server-side use was found.
