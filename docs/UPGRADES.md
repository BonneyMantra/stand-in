# Upgrades brief (14 Nov, agent contract)

Gabriel picked four upgrades after the competitor review. Handback for every worker: **19:00 IST today**
(13:30Z), hard. Feature freeze 19:30 IST, then film. Read docs/BRIEF.md first: its hard constraints apply
(never touch ~/.claude, ~/.codex, ~/.near-credentials; secrets only in gitignored files; commit by explicit
path; no AI attribution; do not push; files < 300 lines; honest claims, "planned" for anything not run).

## Why (what the review found)
Every serious rival has a hosted demo judges can attack themselves; we are local-only. Claude Code and Codex
screen every repo first (reproducibility, feature verification), so verifiable proof matters. Nobody covers
supply-chain catches, phone alerts or a biometric gate.

## Shared values (in <repo>/.env.local, gitignored; never print them)
- `STANDIN_NTFY_TOPIC`: private ntfy.sh topic for the owner's alerts (canary webhooks post here too).
- `STANDIN_NTFY_REPLY_TOPIC`: private topic the phone's action buttons publish to; the watcher subscribes.
- `STANDIN_LAB_NTFY_TOPIC`: PUBLIC topic for the hosted lab (`standin-lab-09d9a8`); judges subscribe by QR.
- `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`: wrangler auth (env vars; never `wrangler login`).
- `NEARAI_API_KEY`: NEAR AI Cloud (spend cap in packages/nearai/src/spend.ts; do not raise it).

## Ownership
| Worker | Upgrade | Owns |
|---|---|---|
| W8 | 3 Supply-chain catch | `integrations/common/supplychain/**` (new), the PreToolUse wiring in `integrations/common/hooks.mjs`, `packages/canary/**` (new) |
| W9 | 1 Hosted attack lab (backend + deploy) | `apps/web/functions/**`, `apps/web/wrangler.toml`, `packages/lab/**` (new), lab testnet accounts |
| W10 | 4 Phone + Touch ID | `packages/notify/**`, `packages/touchid/**` (new), watcher wiring for alerts, CLI `unfreeze` / `pay --approve-warn` gates |
| UI (Opus) | 1 + 6 pages | `apps/web/src/**` (the `/lab` and `/verify` pages, the phone QR card) |
| Coordinator | 6 Judge kit docs | `JUDGES.md`, `docs/claims.json`, README |

## Lab API (W9 implements in Cloudflare Pages Functions; the UI consumes it)
- `POST /api/lab/run` → `text/event-stream`. Each event is `event: step` with data
  `{ run_id, step, status: "start"|"ok"|"fail", at, title, detail?, tx_hash?, block?, explorer? }`.
  Steps in order: `plant` (AddKey of a fresh decoy on the lab decoy account, tx), `leak` (a simulated agent
  session exposes the decoy in a tool response; no tx), `theft` (the lab thief moves 0.05 NEAR with the
  decoy key; tx, block), `detect` (the decoy key's use is seen on chain; block), `freeze`
  (`guardian.freeze` by the watcher function-call key; tx, block, `blocks_after_trip`), `notify` (ntfy push
  to the public lab topic), `reset` (unfreeze, re-provision the agent key, return the loot; txs), then
  `done` `{ run_id, blocks_to_freeze }`, or `error` `{ error }`.
- `409 { error: "busy", retry_after_s }` while a run holds the lock (KV, TTL 120 s).
  `429 { error: "rate_limited" }` beyond 3 runs per IP per 10 minutes.
- `GET /api/lab/runs?limit=10` → `{ runs: [{ run_id, at, blocks_to_freeze, steps: [...] }] }` from KV.
- `GET /api/lab/config` → `{ network: "testnet", accounts: { agent, decoy, thief }, ntfy_topic, explorer }`.
- The lab uses its OWN testnet accounts (sub-accounts of si-project-5289.testnet), never si-agent-5289 /
  si-decoy-5289 (the local watcher owns those). Testnet keys go in Pages secrets only.

## Phone alert format (W10; the lab reuses it)
ntfy JSON publish: `{ topic, title, message, tags, priority: 5, click: <explorer or dashboard url>,
actions: [{action:"http", label:"Freeze now", url:"https://ntfy.sh/<reply topic>", method:"POST", body:"freeze"},
{action:"http", label:"Ignore", url:"https://ntfy.sh/<reply topic>", method:"POST", body:"ignore"}] }`.
The lab's public topic has no actions (read-only).
