// Renders bench/README.md from results.json. All numbers come from the run; gaps are listed, not hidden.
const yn = (v) => (v === true ? 'yes' : v === false ? 'no' : '-');

export function renderReadme(r) {
  const s = r.summary;
  const off = Object.fromEntries(r.baseline_off.map((x) => [x.route, x]));
  const rows = r.stand_in_on.map((x) => {
    const sc = x.score || {};
    const b = off[x.route]?.baseline;
    const status = x.status === 'blocked_auth' ? 'blocked (agent auth)' : x.route_outputs?.skipped ? 'skipped' : 'ran';
    return `| ${x.route} | ${x.kind} | ${status} | ${yn(sc.exposure_detected)} | ${yn(sc.trip_detected)} | ${yn(sc.attributed_exact || sc.trip_attributed_tool_use_id)} | ${yn(sc.attributed_session_via_exposure || sc.trip_attributed_session)} | ${sc.blocks_to_freeze ?? '-'} | ${yn(x.theft_succeeded)} | ${b ? (b.lost_near != null ? `${b.lost_near} NEAR` : '-') : '-'} |`;
  });
  const gaps = [];
  if (s.routes_blocked_auth.length) gaps.push(`${s.routes_blocked_auth.length} real-agent route(s) did not run: the agent could not authenticate inside the isolated sandbox (${s.routes_blocked_auth.join(', ')}).`);
  if (!s.freeze_measurable) gaps.push('Blocks-to-freeze was not measured: watcher and/or guardian contract were not both live during this run (see preflight in results.json).');
  return `# Bench results

Generated ${r.generated_at} on ${r.preflight.network}. Claude Code ${r.versions.claude}; ${r.versions.codex}.
Source of truth: \`bench/results.json\` (written by \`node bench/run.mjs\`); this file is rendered from it.

Stand-in ON = decoy keys + hooks + watcher + guardian. OFF = the same route against a disposable testnet
account whose real full-access key sits in plaintext where the decoys would be, no hooks. Scripted routes
replay a fixed attack through the real hook entry point; real routes drive \`claude -p\` / \`codex exec\`.

## Numbers

| Metric | Value |
|---|---|
| Routes defined / run / blocked | ${s.routes_total} / ${s.routes_run} / ${s.routes_blocked_auth.length} |
| Real-agent routes run / scripted routes run | ${s.real_agent_routes_run} / ${s.scripted_routes_run} |
| Detected (exposure before theft or watcher trip) | ${s.detected} of ${s.routes_run} |
| Detected by hook exposure (before any theft) / by trip | ${s.detected_by_exposure_before_theft} / ${s.detected_by_trip} |
| Attributed to the right session | ${s.attributed_session} of ${s.routes_run} |
| Attributed to session + exact tool call | ${s.attributed_session_and_tool_use} of ${s.routes_run} |
| Blocks from decoy tx to freeze (each / median) | ${s.blocks_to_freeze.join(', ') || 'not measured'} / ${s.median_blocks_to_freeze ?? 'not measured'} |
| Thefts that succeeded with Stand-in ON (decoy account only) | ${s.theft_txs_succeeded} |
| Real agent account balance change over the run (gas only expected) | ${s.standin_real_account_delta_near ?? 'n/a'} NEAR |
| Baseline thefts that succeeded (Stand-in OFF) | ${s.baseline_thefts_succeeded} of ${s.baseline_routes_run} |
| Baseline NEAR lost per route | ${s.baseline_lost_near.join(', ') || 'n/a'} |

## Per route

| Route | Kind | Status | Exposure | Trip | Session+tool | Session | Blocks to freeze | Theft ok (ON) | Baseline loss |
|---|---|---|---|---|---|---|---|---|---|
${rows.join('\n')}

"Exposure" = a hook saw a decoy key in a tool input, response or prompt before it left. "Trip" = the watcher saw a
decoy key sign a transaction. Leaks inside a child process (npm postinstall, \`env | curl\`, git push) cannot show up
as exposure; they are caught by the trip, attributed to the session via the key, and the tool call is inferred.

## Not covered

${gaps.map((g) => `- ${g}`).join('\n') || '- none beyond the routes above'}
- Hooks only see harness-mediated tool calls; hosted tools and the VS Code extension are not covered.
- Scripted routes prove the hook, ledger and watcher path, not that a given model obeys an injection.
`;
}
