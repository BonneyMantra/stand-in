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

## 2026-11-14, 23:05–23:30 IST: protect from wallet, op=adopt, guardian factory, near-connect patch

Code: `apps/web/src/components/owner/{ProtectPanel,AdoptPanel,DeployFacts,FactoryPanel,WithdrawPanel}.tsx`,
`apps/web/src/lib/wallet/{guardianCode,factory,deeplink,connector}.ts`. Production build (`pnpm --filter ./apps/web build`)
served by `vite preview` on 127.0.0.1:4402; headless agent-browser (`--mute-audio`); the scripted test wallet
(`scripts/wallet-test/signer.ts` + `executor.js`) through NEAR Connect's own picker. RPC: drpc first (FastNEAR answered 429).

Guardian code: `apps/web/public/guardian/standin_guardian.wasm`, `view_code` of `si-agent-5289.testnet`, 176,033 bytes,
code hash `7PbHKsE6PhdvypoUrE179X5kPxjqgzfFJr7Z1kRr9ZuE` (pinned; the page and the test signer both re-hash it).

### Funding (project-owned accounts only)
| Step | Tx |
|---|---|
| 4 NEAR `si-watch-5289.testnet` → `si-project-5289.testnet` (parent was at 1.51 NEAR) | `8JbDKRj1EwQtcbBpPfyDuKDKxtTRe7VnywP2jP5c1PDg` |
| create `protect-2307.si-project-5289.testnet`, 2.3 NEAR, no contract (`setup.ts --no-deploy`) | `Dw1kfS5Y6wW2WTRxNDMeSS66D4nxf22v77D9C2sZrmgQ` |
| create `adopt-2307.si-project-5289.testnet`, 2.0 NEAR, no contract | `m5Jyf153PQs6RCxpM27oSag6t8Vd4LNruwPSqNLatRn` |
| 2.7 NEAR `si-intents-5289.testnet` → `si-project-5289.testnet` | `D2CkDrqUS9Kgyww9bMkYdeWaCuw5XUVQybHrVGdoXAtT` |
| create `fowner-2321.si-project-5289.testnet`, 2.55 NEAR, no contract | `C8sSFdh99Mmm2bySBz1eNEbufyTkQjdGh3xkNLsH2qAa` |

### a. Protect this account (connect → Protect → freeze → unfreeze), `protect-2307.si-project-5289.testnet`
| # | What the page did | Result | Tx |
|---|---|---|---|
| 1 | Protect: one tx `DeployContract` + `new {watcher: si-watch-5289.testnet, intents_contract: si-intents-5289.testnet}` | landed; page re-read `get_state`: owner = the account, watcher si-watch-5289.testnet, active | `Da1b5X47Aq4VF248Pousm7TGf2J6mGyrmcdXwhTSGRiT` |
| 2 | Freeze ("Protect-from-wallet test: freeze after deploy") | frozen | `2ZRxDAFKBD31KdXHz7FrL3S65hhisv2MSznKB5xgUjMS` |
| 3 | Unfreeze | active | `7iFNQmjJX7iRqfiKgF1HLXKhzGTSoz1nRRoBoK7pNEuF` |

Independent readback (curl, drpc): `view_account.code_hash` = `7PbHKs…9ZuE`, storage 176,472 bytes; `get_state` owner
`protect-2307…`, watcher `si-watch-5289.testnet`, frozen false, 1 freeze record by the owner. Before signing the page
showed the code, its hash ("checked here"), byte-identity with si-agent-5289.testnet, owner, watcher (freeze only),
about 1.77 NEAR locked, balance 2.300 vs 1.822 NEAR needed.

### b. op=adopt on a fresh no-contract account, `adopt-2307.si-project-5289.testnet`
Link: `op=adopt&account=adopt-2307…&watcher=si-watch-5289.testnet&intents=si-intents-5289.testnet&agent_key=ed25519:4sMsyUrWXYgZZRFLkYB1bWCSiAwwizpMFteFzGVXUYXf&receiver=si-project-5289.testnet&methods=record_deploy,ping&allowance=250000000000000000000000`.
One tx `DeployContract` + `new` + `add_agent_key`: `FqZrZGznfEEby97PpCNsfCbTUhk3D65xxM1qVhShomaF`.
`view_access_key` → `FunctionCall {receiver_id: si-project-5289.testnet, method_names: [record_deploy, ping], allowance: 250000000000000000000000}`;
`get_state` owner = the account, watcher si-watch-5289.testnet, agent_keys = [that key].

### Guardian factory (`guard.si-project-5289.testnet`), owner `fowner-2321.si-project-5289.testnet`
| # | What the page did | Result | Tx |
|---|---|---|---|
| 1 | Create a guarded agent account `agent-2321`, deposit = required_deposit 2.13924 NEAR | `agent-2321.guard.si-project-5289.testnet`; guardians_of lists it; get_state.owner = fowner-2321 | `Bp25A4ZyJu2EKzv8HBEQaEjsWZxv3b1jMu4KUt39kMMq` |
| 2 | op=adopt link `account=agent-2321.guard…`, agent key `ed25519:DzEhdSDEPbXBkv2J1kNNoPPgkw7G6dkK98c1t5JhuLJ3`, `record_deploy`, 0.1 NEAR; signer = owner, receiver = guardian; add_agent_key only | `view_access_key`: FunctionCall, si-project-5289.testnet, [record_deploy], 100000000000000000000000 | `CupFUmR4auuAggCXCquDMPtbSeySzE2mbPArax5wKPp` |
| 3 | Freeze (from the owner) | frozen; 1 agent key deleted | `AMGkWCsvXy6E5erhHxhAo1FcZMva26gdKVr7Jt6m6i77` |
| 4 | Unfreeze | active | `5K9c7eVCdcnJmspBXJjTHvMy8tFRx5wWeGxHnwMKm3ET` |
| 5 | Withdraw 0.2 NEAR (withdrawable shown: 0.3057) | guardian 2.139 → 1.939 NEAR (readback) | `MbFYYQJmasCUEbVMe24zf4PmkWx4sNo1pZKiHRBaCfv` |

Entering 5 NEAR in the withdraw field shows "More than the withdrawable balance." and disables the button (no tx).

### c. Refusals (no transaction sent)
| State | How | Seen |
|---|---|---|
| Wrong connected account | adopt link for adopt-2307 while connected as protect-2307 | names both accounts, "only the owner's wallet can sign it", Switch account button |
| Invalid link | bad account, 1-char watcher, short key, repeated method, allowance 0 | "Adopt link refused" listing all five problems |
| Duplicate field | `watcher` twice | "watcher appears 2 times" |
| Existing non-guardian contract | connected as `si-project-5289.testnet` (signer mode `account:`) | Protect refused ("already runs a contract that is not a Stand-in guardian…"); an adopt link for it refused |
| Watcher mismatch | adopt link with `watcher=si-attacker-5289.testnet` on adopt-2307's guardian | "This guardian's watcher is si-watch-5289.testnet; the link asks for si-attacker-5289.testnet. The key is not added" |
| Low balance | connected as `lab-thief.si-project-5289.testnet` (0.299 NEAR) | "Short by 1.522864 NEAR", faucet link, sign button disabled |
| 0x account | signer mode `account:0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266` (simulated id, read-only) | no Protect offer ("would overwrite that contract"); Create a guarded agent account with the 2.139 NEAR deposit |

Widths 390 / 1024 / 1440: no horizontal scroll (scrollWidth = viewport) on the Protect, adopt and 0x screens.
Unit tests: `apps/web/test/adopt-link.test.ts` (op=adopt grammar, receiver == account refused for both ops, pinned
wasm hash, storage quote). Root `pnpm test`: 19 files, 147 tests passed; `pnpm typecheck` clean.

### NEAR Connect patch: `window.open(url, "_blank")` with no features
`node --import tsx apps/web/scripts/wallet-test/open-spy.ts http://127.0.0.1:4402` (init script `open-spy.init.js`
wraps `window.open`). Connect → "Meteor Wallet" → "Meteor Web" in Meteor's NEAR Connect iframe; nothing entered on
Meteor's site. Recorded call: `argc 2`, url `https://wallet.meteorwallet.app/connect/testnet/login?connectionUid=…&pageUri=about%253Asrcdoc&source=wpm`,
target `"_blank"`, features `undefined`. The new page is a normal tab (toolbar/menubar/locationbar visible; 2 tabs in the
session). Closing that tab without approving: the console shows "The wallet window was closed before it answered.
Nothing was sent." (Meteor's own text, "User closed the window before completing the action", is now mapped.) Exit 0.

### Ethereum Wallets (EIP-1193) path: not completed
The `ethereum-wallets` executor (`https://evm-on-near.dev/executor.js`) never reads `window.ethereum`: it runs in NEAR
Connect's sandboxed iframe and opens its sign page on `evm-on-near.dev` as a tab, where Reown AppKit looks for the
provider. A provider injected into the console page is therefore invisible to it, and agent-browser's `--init-script`
did not reach that window.open'd tab (`window.ethereum` undefined there). Injected at run time into the tab, the scripted
provider (`scripts/wallet-test/eth-provider.init.js`: EIP-6963 announce, no key, signs nothing) appeared in AppKit as
"Stand-in test EVM wallet INSTALLED", but selecting it made no provider request within 6 s. A browser extension with a
MAIN-world content script would reach every tab; not tried in time.
