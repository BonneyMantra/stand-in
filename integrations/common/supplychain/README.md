# Supply-chain catch (upgrade 3)

Two checks run inside the agent's PreToolUse hook (Claude Code and Codex share `hooks.mjs`), plus
off-chain Canarytokens decoys planted next to the NEAR decoys. Only metadata APIs are queried: nothing
flagged is ever installed or downloaded.

| Piece | File | Does |
|---|---|---|
| Command parser | `parse.mjs` | Decides which Bash commands count (npm/pnpm/yarn/bun `install, i, add, ci, test, run`, `npx`, `bunx`, `dlx`), collects named `pkg@version` or the project's lockfile and `package.json` (cap 400) |
| OSV check | `osv.mjs` | `POST api.osv.dev/v1/querybatch`. **Deny** only for `MAL-` ids or advisories whose text marks malicious code; ordinary vulnerabilities **warn and allow**. 1 hour cache in `$STANDIN_HOME/supplychain-cache.json`. Fails open (warning, ledger `unchecked`) after 2.5 s |
| Provenance | `provenance.mjs` | For an explicitly named `pkg@exact-version`: npm attestation for this and the previous version. Previous had it and this does not: warn (never deny) |
| Gate | `index.mjs` | Glue, deny/warn text, ledger event |
| Canary pool | `packages/canary/` | 3 tokens created once, 5 s apart, webhook = the owner's ntfy topic |
| Canary planting | `../canary-plant.mjs` | Writes only inside the session HOME or cwd; refuses anything else |

## What the user sees

Deny (agent gets this as the tool-call reason, the command is not run):

> Stand-in supply-chain check: @ctrl/tinycolor@4.1.1 (MAL-2025-47141) is flagged as a malicious package by OSV.dev. The command was not run and nothing was installed. Remove or pin away from it, then retry. Advisory: https://osv.dev/MAL-2025-47141 (1 packages checked)

Warn (allowed; shown as a system message and given to the agent as context):

> Stand-in supply-chain notice: 2 package(s) have known vulnerabilities, none flagged malicious (...).

## Ledger event

`{type:"supplychain", at, session_id, agent, tool_use_id, packages_checked, malicious:[{name,version,id}], decision:"deny|warn|allow", provenance?:"present|absent|downgrade", unchecked?, error?}`.
`provenance` is only set for an explicitly named exact version; with several named packages it is
`present` only if all are, `downgrade` if any is. Canary plants are `decoy_planted` with
`kind: canary-dns|canary-url|canary-mcp` and `off_chain: true`.
(`supplychain` was added to `EVENT_TYPES` in `packages/core/src/ledger.ts` so ledger readers keep these rows.)

## Limits (honest)

- OSV only lists known compromises: a fresh zero-day is not there for hours or days. The decoys catch what OSV misses.
- Versions come from the lockfile; without one, `package.json` ranges are checked at their base version (`^1.2.3` checks `1.2.3`), which is an approximation.
- OSV `querybatch` pagination (`next_page_token`) is not followed; ids beyond the first page of a package are not seen.
- Non-`MAL-` advisories are classified from their summary text; at most 20 advisory records are fetched per call, the rest stay as ordinary warnings.
- Provenance is presence only (200 vs 404 on the attestations endpoint); the Sigstore bundle is **not** cryptographically verified. Absence alone is never reported as suspicious, only a downgrade.
- The hook inspects the command string. Installs hidden in scripts the agent runs (`./setup.sh`) or in `make` are not parsed; `npm run`/`test` are checked against the project's dependencies, not against what a script later fetches.
- The canary hosted service (canarytokens.org, endpoint taken from the open-source frontend, not a documented API) may change; the pool is only 3 tokens and is shared across sessions, so a firing identifies the kind of decoy touched, and the session is found by matching the time to the planted ledger events.

## Measured (14 Nov 2026, sandbox `HOME=.sandbox/w8`, real OSV, registry and canarytokens.org)

**(a) Known-malicious fixture is denied.** `package.json` naming `@ctrl/tinycolor@4.1.1`, hook input
`npm install` (the package was never installed or downloaded): output `permissionDecision: "deny"`
with `MAL-2025-47141`, 0.64 s end to end uncached.

**(b) Clean fixture is allowed.** `is-odd@3.0.1` with `npm test`: no output, ledger `decision: "allow"`,
`packages_checked: 1`. A named install of `sigstore@2.3.1 lodash@4.17.21` is allowed with the warning
above (real GHSA vulnerabilities, none malicious), ledger `decision: "warn"`.

**(c) The canaries fire and reach the phone path.** `dig +short` on the DNS token hostname answered;
`curl` of the URL token returned HTTP 200. Reading `https://ntfy.sh/<topic>/json?poll=1&since=15m`
showed 5 messages titled "Canary fired: a Stand-in decoy was touched" (channels in the payloads:
HTTP 4, DNS 1; the extra HTTP hits are the service's own repeat or preview fetches and were not
investigated). Arrived within about 5 s of the request. Only the titles and channel names were read.

**Planting.** A Codex SessionStart in the sandbox planted `canary-url` (`~/.aws/sync-endpoint.conf`),
`canary-dns` (`.env.staging`) and `canary-mcp` (`.mcp.json`, merged, not overwritten), all under the
sandbox HOME or project; the real HOME was untouched. The test `packages/canary/test/canary.test.ts`
asserts that planting never writes outside the given HOME and cwd.

**Not run / planned.** The MCP token was not triggered (an MCP client calling its tool): planned.
Hook behaviour inside a live Claude Code or Codex session (rather than the hook fed its JSON on stdin)
was not run: planned. AWS-key canaries are not used (alerts arrive 2 to 30 minutes late).

Tests: `npx vitest run integrations packages/canary` (parser, deny/allow, fail-open, cache, provenance,
pool limits, sandbox-only planting).
