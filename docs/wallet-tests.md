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

- **NEAR Auth / FastAuth (Google or email) sign-in.** Left out by decision (14 Nov): owner sign-in is external
  wallets only, through NEAR Connect.
- **Ethereum Wallets executor as owner** (superseded 14 Nov, 23:30 IST). An Ethereum-wallet NEAR account (0x…)
  already runs NEAR's wallet contract, so the guardian cannot be deployed on it; the console says so and never offers
  "Protect this account" to a 0x account. Such an owner uses the guardian factory instead (section below): the 0x
  account calls `create_guardian` and owns a keyless guardian account. The contract path is proven with a NEAR owner;
  a real MetaMask connection is not (see "Ethereum Wallets (EIP-1193) path").
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
Re-run against the deployed site (`… open-spy.ts https://stand-in-44e.pages.dev`, deploy 2357ff7c, 14 Nov 23:28 IST):
every check passed (no features argument, a normal tab, 2 tabs in the session, the cancelled state shown). The served
`/guardian/standin_guardian.wasm` hashes to `7PbHKsE6PhdvypoUrE179X5kPxjqgzfFJr7Z1kRr9ZuE`, the code hash of
`si-agent-5289.testnet`.

### Ethereum Wallets (EIP-1193) path: not completed
The `ethereum-wallets` executor (`https://evm-on-near.dev/executor.js`) never reads `window.ethereum`: it runs in NEAR
Connect's sandboxed iframe and opens its sign page on `evm-on-near.dev` as a tab, where Reown AppKit looks for the
provider. A provider injected into the console page is therefore invisible to it, and agent-browser's `--init-script`
did not reach that window.open'd tab (`window.ethereum` undefined there). Injected at run time into the tab, the scripted
provider (`scripts/wallet-test/eth-provider.init.js`: EIP-6963 announce, no key, signs nothing) appeared in AppKit as
"Stand-in test EVM wallet INSTALLED", but selecting it made no provider request within 6 s. A browser extension with a
MAIN-world content script would reach every tab; not tried in time.

## 2026-11-15, 00:08–00:22 IST: a real Meteor Web wallet (no scripted signer)

Wallet: Meteor Web, testnet account `bonneymantra.testnet` (created in Meteor for this project; funded with 2.4 test
NEAR from `owner.si-project-5289.testnet`, tx `2nKzTy…2Z96`). It ran unlocked in a dedicated Chrome window that an
agent drove over CDP; every signature was pressed in Meteor's own Approve screen; nothing was typed into Meteor.
Page: local production build on `http://127.0.0.1:4402/app/owner`, live testnet. Connect, Protect and create ran on
commit `440e14f`; freeze, unfreeze, the agent key and withdraw ran on `440e14f` plus the closed-window fix below,
committed as `96934eb`. Every row was read back with `tx` (signer `bonneymantra.testnet`, no `Failure`).

| Step | Through | Result | Tx |
|---|---|---|---|
| Connect | NEAR Connect → Meteor Wallet → Meteor Web | opened as a tab in the same window; Meteor asked only for address and balance (no function-call key) | — |
| Protect this account | DeployContract + `new` | **refused by Meteor**: "Contract deployment blocked … Meteor blocks this for apps"; Approve disabled. Cancel → console: rejected, nothing sent | — |
| Create a guarded agent account | `create_guardian` → `guard.si-project-5289.testnet`, 2.1392 NEAR | landed; `bonney-agent.guard.si-project-5289.testnet`, code hash `8mfwwJ9b…`, `get_state.owner` = `bonneymantra.testnet`, watcher `si-watch-5289.testnet`. Meteor then showed "Cannot read properties of undefined (reading 'name')" after broadcasting | [`49zdQj…kffrR`](https://testnet.nearblocks.io/txns/49zdQj2anx4PwcqEUkZgrsYJbwFLmEkGdNRSc71kffrR) |
| Freeze | `freeze` on the guardian | landed; console read `frozen` | [`E52vki…KQvJ`](https://testnet.nearblocks.io/txns/E52vkimiQQ7gmoWkbwySJn9ZPVzX5KiNeURhbzgsKQvJ) |
| Unfreeze | `unfreeze` | landed; `active` | [`8zbFPU…arQx`](https://testnet.nearblocks.io/txns/8zbFPUhRt1G4Gu2cpQxFvqLeZCrKDz4nejBbxxx6arQx) |
| Agent key from the CLI | `standin adopt --wallet --account bonney-agent.guard… --owner bonneymantra.testnet` printed an `op=adopt` link; Meteor signed `add_agent_key` | landed; the CLI saw the key with the exact scope and exited 0; `view_access_key` = FunctionCall, receiver `si-project-5289.testnet`, `[record_deploy]`, 0.25 NEAR | [`BhLDs5…nsLW`](https://testnet.nearblocks.io/txns/BhLDs5CN4cNjzmm2dVDThDsR9qoYKrnfrrGLAxrbnsLW) |
| Withdraw | `withdraw` 0.1 NEAR | landed | [`Cps9gN…vTbk`](https://testnet.nearblocks.io/txns/Cps9gNpKQadej6FjiFh8D6b6AucXaAESqnustWs8vTbk) |

What the real wallet showed that the scripted one did not, and what changed:
- **Meteor blocks DeployContract from apps**, so "Protect this account" cannot work with Meteor. The panel now says so
  and points to the guarded agent account (one plain function call). Other wallets (Intear, Ledger, NEAR CLI) not tested.
- **A closed wallet window is not proof that nothing was sent.** After `create_guardian` landed, Meteor reported an error
  and its tab was closed; the console said "Nothing was sent", which was false. Now a missing result makes the page
  read the chain (guardian listed, frozen flag, key present) and report "Landed … confirmed by reading the chain", and
  it never says "nothing was sent" for a closed window.
- **After a cancel, Meteor Connect can stall** ("Continue in Meteor Web", no tab opens, `window.open` never called).
  Disconnect and connect again fixed it; the rejected-state message now says so.
- Popup timing: the console calls `signAndSendTransaction` with no network wait between the tap and the call
  (`OwnerPage.tsx` `run()`), and every Meteor sign tab in this run opened.

## 2026-11-15, 04:55–05:25 IST: the live root as a stranger (fresh accounts, fresh browser, fresh CLI homes)

Page: `https://stand-in-44e.pages.dev/app/owner` (the deployed site, not a local build). Wallet: the scripted test wallet,
added through NEAR Connect's own picker (its settings screen, "add your wallet for debug"), signing locally on 127.0.0.1.
Chrome 157 blocks a public page's sandboxed iframe from reaching 127.0.0.1 (Local Network Access), so the headless test
browser ran with `--disable-features=LocalNetworkAccessChecks`; a real wallet's executor talks to its own servers and is
not affected. Accounts: `stranger-qa-1115a.testnet` and `stranger-qa-1115b.testnet`, each created by the testnet faucet
helper with 10 NEAR. CLI runs used fresh `--home` directories. Every row was read back with `tx`, `get_state`,
`view_access_key` or `view_account` from drpc.

| Feature | What ran | Tx |
|---|---|---|
| op=adopt, no contract yet | `standin adopt --wallet --account stranger-qa-1115a.testnet --home <fresh>`; one tx DeployContract + `new` + `add_agent_key`; CLI exit 0, decoy planted | `382NcWdSiYGMoPmaY7ha5NGp2JWfGNmnqtW5guo9HY5c` |
| Freeze (button) | key deleted, `frozen: true`, reason logged | `6yxiPiXSnPE5WatZWsx7G4gdNidz4j6GLdqiDSoW88pF` |
| op=unfreeze | `standin unfreeze --wallet --home <same>`; one tx `unfreeze` + `add_agent_key`; CLI exit 0 | `BwbJnCfceb8GUfjvaZt1tzTU11wfGdsr9aNNnHnkLa5X` |
| Factory, taken name | `create_guardian agent-2321`: receipt `AccountAlreadyExists`, deposit refunded (gas only) | `Anopy4iQQeWwADJyNjzHiUAaJ8FN6DRW87bT3y3PoWio` |
| Factory create | `qa-agent-1115.guard.si-project-5289.testnet`, owner = stranger-qa-1115a, 0 access keys | `6mEMjdhCnzuvPgMBuUaPxWJseTL5NycTD4LeKi2n86Wv` |
| Freeze / Unfreeze (factory guardian) | from the owner wallet | `74qffyxXoJvEBNtUxUikh5eXLcpAmhp4ZQMri8c4Rgs2`, `24s8wbv5poVMWzyXX6X75VDZzCyazhkBZNM14u6fQHta` |
| Withdraw 0.1 NEAR | guardian 2.13924 → 2.03924 NEAR | `7NwToWCKb3JxcsRAb28bw6SsSsaiyncCcri283dg7vjJ` |
| Protect this account | `stranger-qa-1115b.testnet`: DeployContract + `new`, code hash `7PbHKs…9ZuE` | `8LHwsYfhJwFcJHGHfhFg9pV3AASdR3ZNp9Go3dzcSfXB` |
| Freeze / Unfreeze (protected account) | buttons | `CB2yqSFmVm9LwFTymzSahjhq3LiTSiqFLdw6Z9ZLxXoQ`, `5YiP3ZkEpBvL4ThBjiUm1jAsxup1a2dAmQMJPboD92KG` |

After the fixes (commits `056bb4a`, `a326bb7`, `b7c9335`; deploy `06851563`), on the live root again:

| Feature | What ran | Tx |
|---|---|---|
| op=adopt on an existing guardian, fresh `--home` | `add_agent_key` only; CLI exit 0 | `CMwCLSaPqJ8jWnMvSAjP6aBeY1tJ2vbV85wZqFvWKiBk` |
| unfreeze --wallet, not frozen | CLI: "not frozen and agent key … still active; nothing to do", exit 0, no link | none |
| Freeze, then op=unfreeze | `unfreeze --wallet --home <same>`; CLI exit 0 | `49ywejRHN2CRojACfjCVwKeCmM1hYdoPGZXTnRykuwJS`, `EYZLcVg87whaEx1eywipFHGptR1qeZ6KvYB1ToUWJV1o` |
| op=adopt on the factory guardian (`--owner`), 390 px | `add_agent_key` signed by the owner | `3xBjt29ESbTCQaXdubsU3XS3AniPCFsxLPxVwq6tLAkW` |
| Freeze, then op=unfreeze (factory guardian), 390 px | | `HHE8QzYeg89CFSBpgWhUFrVXHN6cd7tMpjWEZczQaiuK`, `9kHwCZSvAU38vgTEXPeqyMciUXzkhCfQgWXqH3jBTm2e` |
| Withdraw 0.05 NEAR, 390 px | 2.03924 → 1.98924 NEAR; field cleared | `6nG9tVkjXzfaZd9j67zRH5VhAC2TzTZ8XqCWgbf5bPCM` |

States seen on the live root: the picker (test wallet first, then Meteor, Intear, Ledger, Nightly, Ethereum Wallets, NEAR
CLI), a closed picker (no error), a rejected sign-in, the wrong network (mainnet account), disconnect and reconnect, session
restore on reload, loading skeletons, every RPC host aborted ("Every testnet RPC endpoint failed" + Try again, which
recovers), a rejected freeze and a rejected Protect (nothing sent, chain unchanged), a mismatched adopt link (Switch
account), malformed adopt and unfreeze links, an agent key whose receiver is the guardian itself (refused), a taken factory
name (caught before signing), a withdraw above the balance and a non-number. 390, 768 and 1440 px: no horizontal scroll on
every screen above. Browser console: no messages.

Found and fixed: another account's selected guardian, deploy notice and log stayed on screen after switching accounts (the
new account saw "Not this guardian's owner" and no Protect panel); a taken factory name was only discovered on chain and
reported as raw `ActionError` JSON; withdraw showed "0 NEAR" when the balance read failed and no message for a non-number;
alert text broke into one line per word group; below xl, Freeze sat under the factory form; the wallet chip said testnet
for a mainnet account; `unfreeze --wallet` printed a link for an unfrozen guardian with a live key; `adopt --wallet`
failed with a bare "no dev key" error in a checkout without the decoy account's key.

Still open: a checkout without `.secrets/` (any stranger's clone) cannot finish `standin adopt --wallet`. The wallet
transaction lands (`A6wYWTvWkmFDcVpR7zkV6agqi8pN6Rqq1EWxW8A6BfBy`, `add_agent_key` on `stranger-qa-1115b.testnet`, run
with an empty `STANDIN_SECRETS`), then planting the decoy needs a new key on `si-decoy-5289.testnet`, which only the
project holds; the CLI now says so and keeps the pending key for `--resume`. The watcher (`si-watch-5289.testnet`) is the
project's too. Resolved the same morning by the self-serve change below.

## 2026-11-15, 05:45–06:10 IST: self-serve bait and watcher, both routes, a stranger's checkout

Change: `adopt` (keystore and wallet) creates `deployer.<owner>` (bait) and `watch.<owner>` (watcher), 0.2 NEAR each, with
keys generated by the CLI and kept in `HOME/.standin/keys` (0600 in 0700). Every run below used an empty `STANDIN_SECRETS`
(no key of ours), fresh `--home` directories, and the live root (deploys `4721a38b`, `f5b8440a`, `86805716`; commits
`628459d`, `f9e43db`, `9f27694`, `22569db`, `39fb677`, `8ac53e8`). Every row was read back with `tx`, `get_state`,
`view_account` or `view_access_key` from drpc.

### Keystore route: `standin adopt --home H --account selfserve-k1115.testnet` (key in `H/.near-credentials/testnet/`)
| Step | Tx | Readback |
|---|---|---|
| create `deployer.selfserve-k1115.testnet` (owner key) | `AjgMNvsYiZd61PkQ9z87NGaw1LeiEayY539Xs7SmbZ5K` | CreateAccount, Transfer, AddKey; 0.2 NEAR |
| create `watch.selfserve-k1115.testnet` | `CGgvZSXp5HmWn3u1wmTD3bK8kabtupmpUpsZNs1QRpdU` | 0.2 NEAR |
| guardian deploy + `new(watch.selfserve-k1115.testnet)` | `7beNYncfmhUboQKv5msFbAKDvb8QZkiPfc372tUDUC4S` | code hash `7PbHKs…9ZuE`, watcher = `watch.selfserve-k1115.testnet` |
| `add_agent_key` | `4rMvcUREM7RicjZJd9dU9YNUqCYaNRqf6BnV9h5SAj1F` | FunctionCall key on the guardian |
| decoy minted on the bait (bait key) | `EMuKxQSp8PEZ5eCDKt2Ak2U2XLNPimhe7GUapDQv4aP9` | signer `deployer.selfserve-k1115.testnet`; the real credentials file now holds the decoy |
| theft (`standin attack drain`, block 277730169) | `3tiphqxNHwaMAHw6422HFGGEX8yvjfyk8Gq7DwV8h5a6` | 0.099 NEAR to `si-attacker-5289.testnet` |
| freeze by the home's own watcher (block 277730171, **2 blocks**) | `CjY8N7iVJkCJs3JNnWJztAnK7VoGpZzUpYXF8Dhj3ZYj` | signer `watch.selfserve-k1115.testnet`; `frozen: true`, agent key deleted |

### Wallet route: `standin adopt --wallet --account selfserve-w1115.testnet --home H`, scripted wallet in NEAR Connect's picker
| Step | Tx | Readback |
|---|---|---|
| cancel in the wallet (3-tx request) | none | three log rows "Rejected in the wallet. Not on chain."; account unchanged, no sub-accounts |
| wallet stops after tx 1 (`reject-after:1`) | `ANr645Bo85eoGpNLartT4NfmEpdqqbBJHoiQxBwgYGBD` | guardian + key landed; console: "only the missing accounts are offered", button "Review and sign 2 transactions"; CLI: "still missing on chain: deployer…, watch…" |
| finish the missing accounts | `DhLB2EMcRvoB9U48rWhXxH5PRkiwyGEBJdLH2kGkDEf3`, `2L6Uh6smCfJ5HNruDXQzs7u6HiixLT2tgGpaw8CLCL8j` | both exist with the CLI's keys; CLI exit 0, decoy minted on the bait (`3seL4f8t188ZHL1HmkAys6or6C1bPqjaXFN9zNWLbNK8`) |
| theft (block 277730582) | `Ek4fbx3vqZ3LfwgSxf5JJB1EjnJ8h8gbJLRf2bsTDcpk` | signer `deployer.selfserve-w1115.testnet` |
| freeze by `watch.selfserve-w1115.testnet` (block 277730585, **3 blocks**) | `FN1M5Bd596JZRCRvZBUVweWxSJZWgyFoBwqDER77QH95` | `frozen: true`; blocklist report skipped with one line (0.197 NEAR spendable, about 0.36 needed up front) |
| `standin unfreeze --wallet --home H` | `4TfV97gryJZgw9a12znqVRc6S4Dgo8eHGx1GCbKNkGe6` | `unfreeze` + `add_agent_key`; CLI exit 0 |
| one approval for all 3 (`fresh-v.stranger-qa-1115a.testnet`, after the re-read fix) | `Ei22YZt543ZcJwcee7A8rkFJS3JGCjRdD8wK7LzNNHVk`, `HdCAegsM57HwJyZpqqQFGwrfTdwjs4ySqJU5oaXuzDWq`, `75E7HW4VzsUaKAZmQBJaBqaVwLV13SUJPop5ZStawqun` | both accounts "exists, your CLI's key", no sign button left; CLI exit 0 |
| session hook decoy for that home | none | `takeKey()` source `core`, key `ed25519:5PxEnp…` is a FullAccess key on `deployer.fresh-v…` |
| factory guardian from the console, owner `selfserve-w1115.testnet` | `Hu6u25TCnCqUVsNZ9vvyRJQG8gt5G8cktFaxkRiXAeyx` | `selfserve-g1.guard.si-project-5289.testnet`, watcher `watch.selfserve-w1115.testnet` |
| `adopt --wallet --account selfserve-g1.guard… --owner selfserve-w1115.testnet`, a new home with the owner's two key files copied in | `C4VBHjsRK9F2evu2HVmAZfji5pbS37f9jGA4Etc2UNMc` | link carried no new accounts (reused); one `add_agent_key` |
| theft on the shared bait (block 277731966), freeze of the factory guardian (block 277731969, **3 blocks**) | `3ntJoYjugbR4WMt3odcrsgP2Xf2TnMMbAWv8AQ9fWBxj`, `43ZstBbj79Wa6xTokbJF3fiFaF3LXMNy5m1iq5ay1jtv` | signer `watch.selfserve-w1115.testnet`, `frozen: true` |

### Refusals, nothing sent (read back: no new account, no contract, no pending file)
CLI wallet route: too little NEAR (`lab-thief…`: "can spend 0.297 NEAR; this needs 2.450 … Short by 2.153"), a home
account that exists without this home's key (`deployer.selfserve-w1115.testnet`), a guardian watched by
`si-watch-5289.testnet` (`stranger-qa-1115a.testnet`: "has no method to change its watcher"), a 0x owner. Keystore route:
the same watcher refusal (`stranger-qa-1115b.testnet`) and existing-sub-account refusal (`selfserve-k1115.testnet` from a
second home); the credentials files stayed untouched. Console: shortfall before signing (sign disabled), a link whose
`watch_key` differs from the key on chain ("exists without your CLI's key"), a guardian watched by someone else, a factory
deposit above what the owner can spend (`fresh-v…`: 1.318 NEAR spendable). 390, 768 and 1440 px without horizontal
scroll on every changed screen; browser console: no messages.

Found and fixed during the run: right after a batch the console read the new accounts at `final` finality, missed
`watch.<owner>` and offered to create it again (now optimistic, sticky once seen, and read again after 4 s); a rejected part
said "Nothing was sent" while an earlier part had landed; the watcher's blocklist report needs about 0.36 NEAR up front and
failed twice on a 0.2 NEAR watcher (now skipped with one line); the factory panel did not check the owner's spendable
balance and showed `{"name":"INVALID_TRANSACTION"}`.

Multi-transaction wallets: NEAR Connect 0.12.0 passes `signAndSendTransactions` straight to the wallet's executor (no
fallback), and every testnet wallet in its manifest declares it. Meteor's executor sends all transactions in one
`near::sign_transactions` request (one approval screen) and Intear's in one `send-transactions` popup, read from their
executor code; neither was run with a real wallet here, and Meteor still refuses `DeployContract`. Whether Meteor's web
wallet accepts `AddKey` with full access from an app is not verified. A wallet without the feature is asked once per
transaction (`sendTransactions` falls back), and the console says so.

## 2026-11-15, 06:20–06:30 IST: a watcher funded to report, one quote for CLI and console

Measured from chain before choosing the amounts (`packages/core/src/funding.ts` cites them): a blocklist report from a
watcher prepays 300 TGas + a 0.05 NEAR deposit, 0.3509 NEAR up front (the RPC's refusal for a 0.2 NEAR watcher), and cost
0.0028 NEAR (`FdDiwpR43KB1YQ1v3k2LRJYx5Cf1toFaBdDKHVYkKJSi`: 0.0013 gas burnt, 0.0015 of the deposit kept); a freeze
prepays 100 TGas and cost 0.0002 (`CjY8N7iVJkCJs3JNnWJztAnK7VoGpZzUpYXF8Dhj3ZYj`). The watcher now gets 0.45 NEAR (0.36
up front for a report plus room for many freezes and reports); the bait keeps 0.2.

Fresh account `fresh-r.selfserve-w1115.testnet` (3 NEAR from this run's own test account; the faucet was rate-limited),
empty `STANDIN_SECRETS`, fresh home, live root (deploy `26e84752`, commit `86be44a`). The CLI printed the quote before the
link and the console showed the same lines before signing: 0.002 already locked, 1.770 guardian storage, 0.150 deploy gas,
0.200 bait, 0.450 watcher, 0.050 gas, **2.622 NEAR**; 390, 768 and 1440 px without horizontal scroll; console: no messages.

| Step | Tx | Readback |
|---|---|---|
| guardian + key, bait, watcher (one request, 3 tx) | `dkikgK3ZTqed3fkEQwiDP2kKYMmYPpevZ64Gf1ZjZW3`, `FM4XRpqBV8JWyGYpfJrFDoLagg1YiFufXaSSZhxccteb`, `DP1MKfrKtYEXUC7ThLLDyTeu3Ep2vFDTro4BeLtuYqTM` | `watch.fresh-r…` holds 0.45 NEAR, `deployer.fresh-r…` 0.2; CLI exit 0 |
| theft to a fresh thief `thief-r.selfserve-w1115.testnet` (block 277733601) | `6bFPNj3R7EXgcHp5srtgQFwosaMVg347Cqebfdof2AEZ` | signer `deployer.fresh-r…`; `check(thief-r)` was `allow` before |
| freeze by the home's own watcher (block 277733604, **3 blocks**) | `4VSbiUsP1ucGmhMAExkndVQ5iNpj7ZeZHwmujRWow14k` | signer `watch.fresh-r…`; `frozen: true` |
| blocklist report by the same watcher | `GW53k3pV6LckhN8TCY84Jy9aiPrNA2wcADJWyC1ZFUKM` | `report` SuccessValue; net cost 0.0028 NEAR; `check(thief-r)` = `block`, attested by OutLayer project `si-ol-25769.testnet/standin-verdict`; the watcher keeps 0.447 NEAR |

## 2026-11-15, 11:15–11:45 IST: the bait and watcher held in the browser, My account, intents and Chain Signatures

Change: Protect and Create create `deployer.<owner>` and `watch.<owner>` in the same wallet request, with keys generated
and kept in the browser (`homeStore.ts`); the watcher's key is a function-call key for `freeze` on one guardian. `/app` is
the owner's own state from chain; the recorded run is `/app/example`. No contract changed. Two fresh accounts, each funded
from one of this file's earlier test accounts (the faucet is rate-limited; the product never funds anyone):
`judge-p1.stranger-qa-1115b.testnet` (3.4 NEAR, tx `3ZLgN8jvyH1pG7tH838dTHRW5YNdEyy49epZfNYJNer6`) and
`judge-c1.selfserve-k1115.testnet` (3.5 NEAR, tx `E7oxWLapKWtcZ5gsmUovWL1C4T38U2TytH2EUT4MgQ8V`). Scripted wallet in
NEAR Connect's picker; every row read back with `tx`, `get_state`, `view_access_key_list` or `has_public_key` from drpc.

### Protect, local production build (commit `e953a5b` before deploy), `judge-p1`
| Step | Tx | Readback |
|---|---|---|
| one request, 3 transactions: DeployContract + `new`; create bait; create watcher (quote shown: 2.622 NEAR) | `7VgVhGMXiVv3mVCr1ew1vMLHufecYraFcLXGSUV6ZfPv`, `wduR9kZNqHnCi2tMEogjipcZx6HAyBq5ucuYZtD1Yi3`, `8SsHLj55YAgVL1PYQJ36nuTPu8mnjMhLUpsJmoNhearL` | code hash `7PbHKs…9ZuE`, watcher `watch.judge-p1…`; bait 0.2 NEAR, one full-access key; watcher 0.45 NEAR, one key `FunctionCall {receiver: judge-p1…, methods: [freeze], allowance: null}` |
| add a decoy (signed in the browser by the bait key, no wallet) | `Gj9u6ZWhyacCVj9HNtsNwJBT5TqHSRyJgQYi31RL1i9o` | a second full-access key on the bait; the bait key's nonce moved by one |
| add an intents key (a fresh test key) | `95C7JZ1kEpa7RZFVzqqmfed6EaTFxmrdmpjgPiZuMHxB` | `has_public_key` = true |
| Chain Signatures while active | `6BcgFfqYGrsDDbdBMdbtyzNPVASgLHuPhq8kw8PiZNqN` | SuccessValue: MPC signature (big_r, s, recovery_id 0) |
| freeze (owner) | `3a2X9VeoH6SypZc5AnAou4QbGfShCE9CvQARJk5YSyLj` | `frozen: true`; 1 intents key removed; `has_public_key` = false |
| Chain Signatures while frozen | `4YZhBoFktMKjDEq7X3MiEKYYm9XPzQHHFw7WDHiHXh2p` | Failure: `frozen: sign_evm refused until unfreeze` |
| unfreeze | `5B6ypVx5y4WSySv8HdVwC9g1zXborued2xoURxNE4iZJ` | `frozen: false` |
| Export to CLI home → `standin dev up --home DIR --pool 1` (empty `STANDIN_SECRETS`) | pool decoy `JCp2WXtQ2fSQooccYxcMt2gLuV7X4bFPonoXFu3wZpDw` | dev up accepted the browser's config and keys; the watcher started with the freeze-only key |
| theft with the browser's decoy (`standin attack drain`, block 277764369) | `AreyJ5Q7WFuh8Pifg8NUqBPtD9Hfp8uaQZikYyTadR4y` | 0.099 NEAR to `si-attacker-5289.testnet` |
| freeze by the exported watcher (block 277764372, **3 blocks**) | `FdCfw6aC7khVMCE5aoXCkMzBzzY57KnCxJMXZLqRqxAD` | signer `watch.judge-p1…` with the function-call key; `frozen: true`, freeze_log names the decoy and the theft; the watcher logged one line: report skipped (a function-call key cannot attach the deposit) |

My account then showed the guardian frozen, both freezes (trip by your watcher, manual by you) with the freeze tx matched
from the indexer, the used decoy tagged with its theft, and every transaction above with an explorer link.

### Create a guarded agent account, the live root (deploy `fb501b61`), `judge-c1`
| Step | Tx | Readback |
|---|---|---|
| one request, 3 transactions: `create_guardian judgec1-agent`; create bait; create watcher (quote: 2.941 NEAR) | `DcHUWcHUFAWeLwuVnjG3k1sFAnkfeA1JxkYEKzWA2uJ`, `FZu4nQfh9VSHm6qBbWhsYjp2RHBCrNdLKDiCu4UKaCn6`, `3wTkvpxavxwt1jCBsiLiKdkmhRmY2cTM7M2n7wF69LsL` | `judgec1-agent.guard.si-project-5289.testnet`: owner `judge-c1…`, watcher `watch.judge-c1…`, no access keys; watcher key `FunctionCall {receiver: judgec1-agent.guard…, methods: [freeze]}` |
| add a decoy | `EXXzDdvLYg15Z5itejvzNCupAaTsawQsZiGMPtFGJ7wS` | second key on the bait |
| Chain Signatures while active (owner calls through its own account) | `GtJ48dmJf9211gZHAhtzqZxPMc5tKoExVNuK9bjXtCKh` | MPC signature |
| freeze, then Chain Signatures while frozen | `SUdemjjj6Mi9CQ3ArMvzZSxPRB1fUkHLoZkhz8ANDjb`, `2i1nchLTvx8oVvnZT25ARthmF5rr8qPEiWQ4d3197XLi` | refused: `frozen: sign_evm refused until unfreeze` |
| unfreeze, add an intents key | `HRvz4P6vnRBJYVG7DK2WWBoZBnFs5Vr2ZL1DPsqnp2Gn`, `9mMS1TSQakcraJd81xYx2U1vNTiueqDgaSFAwp3pB58x` | `has_public_key` = true |

States on the live root: no wallet (connect invitation, Example offered), the picker, connected and empty (next step:
Protect), protected without decoys (next step: add a decoy), without an agent key (next step: the CLI command), frozen,
every RPC host aborted ("Every testnet RPC endpoint failed" + Try again, which recovers), the Example pages with their
banner, old links (`/app/trips/<hash>`, `/app/sessions`, `/app/blocklist`) redirected to the Example. 390, 768 and 1440
px: no horizontal scroll (scrollWidth = viewport). Browser console: no messages.

Headless Chrome reached the local test signer only with `--disable-features=Translate,LocalNetworkAccessChecks,
BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults`: the
browser tool adds its own `--disable-features=Translate`, which replaced a lone `LocalNetworkAccessChecks` flag.

## 2026-11-15, 11:20–12:15 IST: the lab on your own account, and Check any guardian

Code: `apps/web/src/lib/tabwatcher/` (in-tab watcher, run, journal), `apps/web/src/components/lab/My*.tsx`,
`WatcherHeartbeat.tsx`, `apps/web/src/lib/verify/guardian.ts`, `apps/web/src/components/verify/Guardian*.tsx`. Commits
`b0870eb` (landed inside that commit from the shared index), `d8f6f8b`, `a1be57b`; deploys `83062713`, `2e142866`,
`25ef3d73`. No contract changed. Every row was read back with `tx`, `get_state`, `view_account` from drpc, outside the page.

The in-tab watcher reads the bait's `view_access_key_list` every 0.35 s; a non-admin key whose nonce grew is a theft (the
CLI watcher's rule, read from key state so a slow tab cannot skip a block), and `EXPERIMENTAL_changes` over the blocks
between two reads names the transaction. The freeze is signed in the tab by the browser's freeze-only watcher key and sent
to every RPC endpoint at once. Unit tests: `apps/web/test/tabwatcher-detect.test.ts` (20).

### The live root, a fresh account: `labjudge-1115.selfserve-w1115.testnet`
Funded from this file's test accounts (2.0 NEAR `DCyunAhzTJZdXqkduRvjaAERymaWYnFj3pxS7V9yh9hH` and 0.85 NEAR
`ChCpgpNjd6QtzGS7K7mTioKXFc4ZjXWHBDNhkSAoYARd`); scripted wallet in NEAR Connect's picker.

| Step | Tx | Readback |
|---|---|---|
| My account → Protect: guardian, bait, watcher in one approval | `7ab6nykd7FNTnwVuH1b8fvtQCHkyQ5xSEPfVGx7hPD5z`, `2Bhpu18y69TEztNX3PkzSKq65qob11L31drDwzZzQAMN`, `HGAGN1GZiEYcYyzpPWfM7a54CBVeoLpwbGS3QKHy7wjM` | home in the browser; `/lab` opened on Your account, watcher live |
| run 1: plant (bait key, in the tab) | `csY2sDxgKnY4oda7uptgCcHMkSjcWSk9T9ELjkSFQaN` | AddKey on `deployer.labjudge…` |
| run 1: theft (decoy key → a fresh implicit account), block 277767906 | `AWZgwwhWWQptiSwKob1nutVJVLMYahbCnrzZgxT3VWRx` | Transfer 0.05 NEAR, SuccessValue |
| run 1: freeze by the tab watcher, block 277767911 (**5 blocks**) | `GZ9G5HPuTPz2aDa8g3eJkbXQXGCQ3wgnN4MEEzc57qEu` | signer `watch.labjudge…`; `frozen: true`; the freeze log had no theft hash (a lagging node answered UNKNOWN_BLOCK; fixed in `d8f6f8b`) |
| run 1: loot back, decoy deleted | `3FuruVAj2EGjquZuxnjiWZ3Myzv5w5jkry2FWAcgKRts`, `95LRk6WM65rQM5NmZnNkfDpdumGuGAUCd2VcKXJmgZZo` | |
| Unfreeze from your wallet (on the lab page) | `AsxUvuRDKYeDNr2PQ5T29LHphGqRz6QeiNRs3r2MEwnw` | `frozen: false` |
| run 2: plant, theft (block 277768279) | `W3eFvEiFD5Ge7FY6GpKGEA4gHjBqYKAQzwWB5ad4jvz`, `Be9TvuSSkAPkg8nG93BuK4YpTNGUMjLmGxDPqcqJ59Vz` | |
| run 2: freeze, block 277768282 (**3 blocks**) | `ABDNxu3HFPkpAHBGMeGUtPKppZhbrxfoHC77khrhXF9y` | `frozen: true`; freeze log names the decoy and the theft tx |
| run 2: loot back, decoy deleted; unfreeze (owner console) | `FW83gF5FFHaeWBYnPuiEpmzY7uqWo5SjARFffMbewUG7`, `QtA8J6eKy5VTm5PPV5ULEo3y1EQTHov56fh13mvYmxd`, `3utGdcWrL93ce8b8ZWx9BhGT6pcgkvcsNS9U3RT1D78a` | `frozen: false` |

### Local production build, scripted accounts (`labqa-a.stranger-qa-1115b.testnet`, `labqa-b.selfserve-k1115.testnet`)
| Step | Tx | Readback |
|---|---|---|
| run: theft (block 277764616), freeze (block 277764619, **3 blocks**) | `EQMf8m8dBX2sSmEFDZZg31pn7MB4pkeYeGGNSQgQjjSr`, `GdMXyyGpyGJ4L5BGD71QeoFZ9qDufkzFjttFxjS8QWb5` | the first run took 18 blocks: a hung drpc read waited for its whole timeout; reads are now hedged and the freeze goes to every endpoint |
| tab closed mid-run (the freeze broadcast held back, page reloaded) | theft `6chvE46VTjoeq7d9jHHWm7JotpApgecyjAUGqgPoVcHL` | the page read from chain: theft landed, guardian NOT frozen, decoy still on the bait, loot with the thief |
| Freeze now (from that report), then return the loot and delete the decoy | `7Q4iRwuP977d45huzJ97fPwLUfncpMixSQpsQpEM72iX` | `frozen: true`; the report then showed the freeze and nothing left to clean |
| unfreeze from the wallet, run again in the same tab: freeze in **4 blocks** | `H8At7mEpvDA2c14iGqUBHCLupGejnvPEgerc7w17tUpH`, `9TR8gm4QBcMRPLoejYJwLhzLTYNxrtePUcjZuTvUz1cP` | found and fixed here: a cached "frozen" from the earlier freeze made the watcher skip; it now re-reads chain before skipping |

States seen: not connected; connected without a guardian; guardians watched by another account (a home could never
freeze them); a guardian without a browser home; a home whose watcher and bait do not exist; bait 0.028 and watcher 0.047
NEAR (shortfalls, faucet link, Run disabled); already frozen (Unfreeze offered); the confirm step; running; done with the
read-back; a tab closed mid-run; every RPC host aborted (the watcher shows stalled with its last block, the page shows Try
again, which recovers); a lazy chunk removed after a deploy (one reload, then a reload notice).
`/verify`, Check any guardian, live: the connected owner pre-filled (pinned hash matched and re-hashed in the browser,
self-serve watcher, freeze log with theft and freeze transactions), a factory guardian (factory build), a contract that is
not a guardian (`si-project-5289.testnet`), an account without a contract, a missing account, every RPC host aborted.
390, 768 and 1440 px: no horizontal scroll on every state above. Browser console on the live root: no messages.

Not covered: the blocklist report from a full-access (CLI-imported) watcher in the tab (coded as the CLI files it; the
runs above used browser-made freeze-only keys, which show "available with a CLI watcher"); a real Meteor or Intear wallet
for the lab's unfreeze (the scripted wallet signed it).
