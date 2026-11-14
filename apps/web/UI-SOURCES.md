# UI sources

Where each piece of the Stand-in UI comes from. Visual direction first, then components.

## Visual references (vibrant.design)

- Landing `/`: **Axiom** (near-black, hairline frames, mono eyebrows, one alarm colour).
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
| Nav CTA, stat strip, six-step grid | custom, adapted from ReUI blocks `navbar-12`, `stats-7`, `card-2` | |

## Focus and motion

Landing controls use one focus treatment (`FOCUS` in `landing/primitives.tsx`): a 2px offset
outline in `fg-muted`. Motion respects `prefers-reduced-motion` through `motion/react`.
