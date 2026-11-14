# @standin/lab: hosted attack lab (backend)

A judge presses "Leak a decoy" and watches a real testnet theft get frozen. Pages Functions in `apps/web/functions/api/lab/`
(`run.ts` SSE, `runs.ts`, `config.ts`) call `src/http.ts`, which drives `src/lab.ts`. API contract: `docs/UPGRADES.md`
(Lab API plus "API changes"). Live: https://stand-in-44e.pages.dev (Cloudflare Pages project `stand-in`).

## Accounts (testnet, sub-accounts of si-project-5289.testnet, ids in `config/lab.json`)
`lab-agent` (guardian deployed, owner = its own key, watcher = `lab-watch`, intents = si-intents-5289), `lab-decoy` (about 1 N bait,
one admin key kept), `lab-thief`, `lab-watch` (a function-call key limited to `freeze` on `lab-agent`, plus a maintenance key).
Keys: `.secrets/lab/*.json` (gitignored, 0600) and Pages secrets (`LAB_AGENT_OWNER_KEY`, `LAB_DECOY_ADMIN_KEY`, `LAB_THIEF_KEY`,
`LAB_WATCH_FC_KEY`, `LAB_NTFY_TOPIC`). KV binding `LAB_KV` holds the lock (TTL 120 s), the per-IP limit (3 per 10 min) and the last 20 runs.
Provision again with `node --import tsx packages/lab/scripts/setup.ts`; one local cycle without Cloudflare: `scripts/local.ts`.

## One run
1. plant: AddKey of a fresh decoy on `lab-decoy` (admin key). 2. leak: simulated session exposes it (log only, no tx).
3. theft: the fresh decoy key signs a 0.05 N transfer to `lab-thief`, broadcast without waiting.
4. detect: see below. 5. freeze: `lab-watch` FC key calls `guardian.freeze`; the freeze block minus the detected block is `blocks_to_freeze`.
6. notify: ntfy push to the public lab topic. 7. reset: unfreeze, re-add one agent FC key, thief returns the loot, delete the used decoy key,
then read `get_state` and fail the run unless the agent is unfrozen with a key. Net cost per run is gas only.

## How detection works (exactly)
The lab does not broadcast the freeze because it knows it sent the theft. After the theft is broadcast (`send_tx` with `wait_until: NONE`), `detectUse`
polls the chain every 150 ms: `query view_access_key` for the fresh decoy key at the optimistic head. A transaction signed by a key bumps that
key's nonce when it is included, so the moment the nonce reaches the theft's nonce the decoy key's use is on chain. That read carries the head
block height, recorded as `detected_at_block` (the `detection` field reads "decoy key nonce moved at the optimistic head, read via RPC
view_access_key"). The `detect` step is emitted, and only then is the freeze signed and broadcast with the pre-warmed watcher function-call key.
The real watcher uses `EXPERIMENTAL_changes` for the same nonce bump; an earlier lab version did too, but that call only returns the latest block,
so polls could miss it and a run waited several seconds. Reading the key state cannot miss. If nothing is seen for about 4 s the lab falls back
to waiting for the theft tx outcome over RPC and says so in `detection`.
While the freeze is in flight the lab looks up the theft's inclusion block (tx status, then block). `blocks_to_freeze` = freeze tx inclusion
block minus theft inclusion block, as in the watcher. It includes the real polling, signing and RPC latency of a Worker, so a run shows 2 to 3
blocks normally and more when an RPC is slow; every run's number is reported as measured.

## Known limits
- ntfy.sh times out or answers 429 to Cloudflare Workers egress (measured: most runs time out, one got HTTP 429; other hosts answer). The server-side publish
  therefore fails, the `notify` step is `fail` and carries the payload; the page can publish it from the browser (ntfy allows CORS).
- The lock lives in KV, which is eventually consistent across Cloudflare locations; two requests from far apart edges could both start. One lab, low traffic.
- Public RPCs rate-limit; `src/rpc.ts` rotates fastnear and drpc (rpc.testnet.near.org was dropped: 3 s latency, 429s) with backoff.

## Measured
Hosted runs against https://stand-in-44e.pages.dev on 14 Nov 2026 (detection by nonce poll, freeze only after it). Explorer: https://testnet.nearblocks.io/txns/<hash>.

| run | theft tx (block) | freeze tx (block) | blocks_to_freeze | wall | agent after |
|---|---|---|---|---|---|
| 1 | 2dbatG7TVirBDhVoKSsxysTS51gnzB3sYSjHs5Pa4CR6 (277640506) | ABiWqsAmbnznwd5Ljp7XsixymnPz2t1UadSe3nWi41V9 (277640508) | 2 | 15 s | unfrozen, 1 key (reset tx 2whewzHeB9yA5oPgVscqHPC4FYMKUgkzAPy68DgdnT3C) |
| 2 | 7junnUCFZprktnC9mjQWTU6Zcyo5TReym6JVxVJNw2gQ (277640533) | 81saktXjP9Wptz6kqZoGSn98SAYodGTC4sSh7qN9KyzF (277640536) | 3 | 13 s | unfrozen, 1 key |
| 3 | E8gx7Ef79xjdipevR8r8GeFA6pSFHVnt3sZNnD7FX52X (277640560) | 7iZbyLVstfB7Nqe4T7UPVBJxEkpYRVPsDKbY4KvZ75UC (277640563) | 3 | 15 s | unfrozen, 1 key |

Checks: a second POST while run 1 was live returned `409 {"error":"busy","retry_after_s":114}`; a 4th run from the same IP returned
`429 {"error":"rate_limited"}`. Server-side ntfy publish failed in all runs (timeout), so the browser fallback is the only push path.
Earlier runs under the previous detection (EXPERIMENTAL_changes) showed 12 to 19 blocks when the poll missed; that is why it was replaced.
