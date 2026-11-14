# @standin/notify

Phone alerts over [ntfy.sh](https://ntfy.sh) (no account). Topic names are the only secret: they live in the
gitignored `.env.local` and are never logged or printed.

| env | meaning |
|---|---|
| `STANDIN_NTFY_TOPIC` | private topic for the owner's alerts; Canarytokens webhooks post here too |
| `STANDIN_NTFY_REPLY_TOPIC` | private topic the phone's buttons publish `freeze` / `ignore` to |
| `STANDIN_CANARY_FREEZE=0` | record a canary hit but do not freeze preemptively (default: freeze) |

- `publish(topic, alert)`: ntfy JSON publish (priority 5, tags, click URL, `Freeze now` / `Ignore` http actions when
  `replyTopic` is set). One push per event key, hard cap 60 pushes per 12 h (ntfy anonymous limit is 250), never throws.
- `subscribe(topic, onMessage)`: streams `/<topic>/json`, reconnects with backoff (1 s doubling to 60 s), resumes after
  the last message id.
- `parseCanary(body)`: recognises a Canarytokens webhook body (`token`/`canarytoken`, `memo`, `src_ip`, `channel`).

## Watcher wiring (`packages/watcher/src/alerts.ts`)

Every path is optional: no topic, no push and no listeners. The alert layer tails the ledger the freeze already wrote
to, so a slow or failing ntfy cannot delay a freeze.

- `trip` -> "Decoy used on chain: <attacker>" with the Freeze now / Ignore buttons.
- `freeze` -> "Frozen in N blocks: k agent keys deleted, intents keys removed".
- `incident_report` -> "Incident report ready" (summary text).
- Reply topic: `freeze` -> `TripHandler.manualFreeze` (same pre-warmed freeze, ledger `freeze` event with
  `manual: true`); `ignore` -> ledger `tool_call` outcome `ignored`.
- Owner topic: a Canarytokens webhook body -> ledger `canary` event, then a preemptive freeze.

## Measured (testnet, real runs, `scripts/prove.ts`, own watcher on :4399, own STANDIN_HOME)

Run: `node --import tsx packages/notify/scripts/prove.ts` (prints push titles only).

| check | result |
|---|---|
| (a) scripted decoy drain, agent si-agent-5289 | pushes on the private topic, in order: "Decoy key used" (Decoy used on chain: si-attacker-5289.testnet), then "Account frozen" ("Frozen in 3 blocks: 1 agent keys deleted, intents keys removed"). Trip to push about 5 s on the first run, the freeze push followed 5-8 s later. Two earlier runs gave the same titles (3 and 8 blocks after the trip; the 8 is testnet RPC rate limiting, not the guardian). |
| (b) POST `freeze` to the reply topic | the watcher wrote a ledger `freeze` event with `manual=true`, reason "owner tapped Freeze now on phone", 7.2 s after the publish (includes waiting for inclusion and the key-deletion lookup); guardian `frozen=true`; a push "Account frozen (manual)" followed. Then unfrozen by the owner key. |
| end state | si-agent-5289 unfrozen (checked on chain). |

Not covered: the "Incident report ready" push (no `incident_report` event was produced in these runs; the alert mapping is
unit-tested only); a real Canarytokens webhook driving a freeze (unit-tested with a mocked body; the topic does receive
real canary posts from the supply-chain work, and any of them reaching a running watcher will freeze it unless
`STANDIN_CANARY_FREEZE=0`); iOS/Android delivery latency (not measured, the phone was not used).
Tests: `npx vitest run`, mocked fetch for publish/subscribe/alerts.
