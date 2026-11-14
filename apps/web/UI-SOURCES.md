# UI sources

Where each piece of the Stand-in UI comes from. Visual direction first, then components.

## Visual references (vibrant.design)

- Landing `/`: **Axiom** (near-black, one accent: trip red for CTAs (`--color-cta`) and "See it live →" links, product
  shots bleeding off the right edge, text columns beside shots, no eyebrows or section hairlines, one travelling glint;
  redesigned 15 Nov against Gabriel's review). Logos: simple-icons 15.22.0 (NEAR, Claude, OpenAI, ntfy), CC0.
- Dashboard `/app`: the dashboard trio: **Edge Infrastructure Dashboard** (shell and framework),
  **Agent Trace Waterfall** (trip detail), **RAG Analytics** (benchmark numbers).

## Registry

`@reui` (ReUI Pro, licence key in `.env.local`, header in `components.json`). ReUI publishes its
own items (Frame, Badge, Alert, Stepper, Timeline, data-grid and ~1,900 blocks); its blocks pull
the base primitives (Button, Input, InputGroup, Switch, ToggleGroup, Tabs, Kbd, Tooltip) from the
shadcn registry, so those were added through the same CLI and themed here.

The app is dark-only: in newly added primitives the `dark:` values are applied directly.

## Components

| UI | Source | Notes |
|---|---|---|
| Section frames and panels (every landing section) | ReUI `frame` | `landing/frame.tsx` wraps `reui/frame.tsx`: 14px radius, 3px inset, zero panel padding, `fit` |
| Dashboard panels (`Panel`) | ReUI `frame` | `app/common.tsx`, with `FrameHeader` |
| Bench agent chips (Claude Code, Codex) | ReUI `badge` (`info-outline`) | `landing/bench-row.tsx` |
| Hero CTA, copy prompt, command copy, replay | shadcn `button` (ReUI dependency) | Themed variants `invert`, `line`, `quiet`, `bare` |
| Benchmark on/off | shadcn `switch` | Size `lg` and `thumbClassName` tone the thumb safe/trip |
| Chain-signatures mode picker | shadcn `toggle-group` | Radio semantics, roving focus, selects on arrow |
| Freeze scrubber stops | shadcn `toggle-group` | No wrap; Home/End |
| Freeze scrubber track and thumb | custom | ReUI `stepper` has no sliding thumb; the track animates on transform |
| Blocklist "pay" field | shadcn `input-group` + `kbd` | Prefix, amount and Check button as addons |
| Dashboard CopyText, "+N more" | shadcn `button` (`bare`) | Drop-in, same look |
| Dashboard shell and nav | shadcn `sidebar`, `sheet`, `tooltip`, `skeleton` | |
| Dashboard status tags (`Tag`) | custom | Swapping to ReUI Badge would change the look; left as is |
| Decoy map (landing and `/app`) | custom | No ReUI item draws a dot-matrix map with key pins and trip arcs |
| Trip waterfall | custom | Agent Trace Waterfall reference; no ReUI gantt fits block-scale rows |
| Freeze ledgers (two registries) | custom | Paired on-chain ledgers synced to the scrubber |
| Blocklist receipt | custom | Printed-receipt motion; content is the TEE verdict |
| Agent terminals and hook rail | custom | Scripted terminal replay |
| Data tables | custom, styled after ReUI `data-grid` | A small table with no need for the full grid |
| KPI strip | custom, after ReUI `card-38` | |
| `/lab` run trace | ReUI `timeline` | `reui/timeline.tsx`; indicator and separator restyled (trip colour for theft, detect, freeze) |
| `/lab` busy, rate-limit, dropped-stream and error notices | ReUI `alert` | `reui/alert.tsx`; warning/destructive variants toned to `warn`/`trip` |
| `/lab` run button, `/verify` "Check again", Recent runs refresh | shadcn `button` | `invert` and `quiet` variants |
| `/lab` phone QR code | custom SVG, matrix from `uqr` | Generated client-side; dark modules on a light tile for scanners |
| `/lab` Recent runs, `/verify` claim cards and signature list | custom, styled after ReUI `frame` | Same 14px frame with 3px inset as the landing |
| `/verify` summary bar | custom | Segmented verified/mismatch/unreachable bar |
| `/lab`, `/verify` shell | landing `Nav` + `PublicShell` | Nav gains Lab and Verify links at every width |
| Nav CTA, stat strip, six-step grid | custom, adapted from ReUI blocks `navbar-12`, `stats-7`, `card-2` | |

## Libraries added for /lab and /verify

- `uqr` 0.1.3: QR matrix for the ntfy topic card.
- `@noble/curves` 2.4.0 + `@noble/hashes` 2.4.0: secp256k1 recovery and keccak-256 for the EIP-191 check of NEAR AI Cloud report signatures.

## Focus and motion

Landing controls use one focus treatment (`FOCUS` in `landing/primitives.tsx`): a 2px offset
outline in `fg-muted`. Motion respects `prefers-reduced-motion` through `motion/react`.

## Owner console (`/app/owner`)

| UI | Source | Notes |
|---|---|---|
| Wallet picker and wallet windows | `@hot-labs/near-connect` 0.12.0 (its own modal) | Testnet wallets with `signAndSendTransaction`; wallet code runs in its sandboxed iframes |
| Guardian, owner actions, approval request, session log | `Panel` (ReUI `frame`), `KV`, `Tag`, `EmptyState` from `app/common.tsx` | Same shell and tokens as the other dashboard pages |
| Wallet error, wrong network | ReUI `alert` | destructive / warning |
| Connect, disconnect, sign buttons | shadcn `button` | `invert`, `line`, `quiet` variants |
| Freeze reason field | custom textarea in theme tokens | Byte counter against the guardian's 500-byte limit |

`zod` 4.6.7 validates the approval link (`src/lib/wallet/deeplink.ts`). The page is lazy-loaded, so the wallet code
is not in the other pages' bundle.
