// Aggregates route results into the numbers the README and dashboard show. Nothing is assumed:
// a route that was blocked, skipped or had no theft is counted separately and never as a pass.
const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor((a.length - 1) / 2)] : null);

export function summarize(on, off, pre) {
  const ran = on.filter((r) => !r.status && !r.route_outputs?.skipped);
  const blocked = on.filter((r) => r.status === 'blocked_auth');
  const leaks = ran.filter((r) => r.theft_attempts?.length || r.score?.exposure_detected); // something reached the thief or a decoy key left its file
  const sc = (r) => r.score || {};
  const detectedEx = ran.filter((r) => sc(r).exposure_detected);
  const detectedTrip = ran.filter((r) => sc(r).trip_detected);
  const detected = ran.filter((r) => sc(r).exposure_detected || sc(r).trip_detected);
  const attrSession = ran.filter((r) => sc(r).attributed_session_via_exposure || sc(r).trip_attributed_session);
  const attrExact = ran.filter((r) => sc(r).attributed_exact || sc(r).trip_attributed_tool_use_id);
  const inferred = ran.filter((r) => sc(r).inferred_correct);
  const blocks = ran.map((r) => sc(r).blocks_to_freeze).filter((x) => x != null);
  const base = off.filter((r) => !r.status);
  return {
    routes_total: on.length, routes_run: ran.length, routes_blocked_auth: blocked.map((r) => r.route),
    real_agent_routes_run: ran.filter((r) => r.kind.startsWith('real')).length,
    scripted_routes_run: ran.filter((r) => r.kind === 'scripted').length,
    leaks_reached_thief: ran.filter((r) => r.loot?.length).length,
    theft_txs_succeeded: ran.filter((r) => r.theft_succeeded).length,
    detected: detected.length, detected_by_exposure_before_theft: detectedEx.length, detected_by_trip: detectedTrip.length,
    attributed_session: attrSession.length, attributed_session_and_tool_use: attrExact.length,
    inferred_tool_correct_when_not_exact: inferred.length,
    blocks_to_freeze: blocks, median_blocks_to_freeze: median(blocks), freezes_measured: blocks.length,
    freeze_measurable: !!pre.chain_freeze_measurable,
    baseline_routes_run: base.length,
    baseline_thefts_succeeded: base.filter((r) => r.theft_succeeded).length,
    baseline_lost_near: base.map((r) => r.baseline?.lost_near).filter((x) => x != null),
    standin_real_account_delta_near: pre.agent_balance_near_before != null && pre.agent_balance_near_after != null ? +(pre.agent_balance_near_after - pre.agent_balance_near_before).toFixed(4) : null,
    leaks_total: leaks.length,
  };
}
