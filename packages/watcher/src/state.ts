import { loadDevKey, makeProvider, readEvents, requireAccount, type LedgerEvent, type NetworkConfig } from "@standin/core";

const s = (v: unknown) => (v == null ? "" : String(v));

/** Merge trip + freeze + blocklist ledger events into the brief's `trips[]` shape. */
export function buildTrips(home?: string) {
  const trips = readEvents({ type: "trip" }, home);
  const freezes = readEvents({ type: "freeze" }, home);
  const lists = readEvents({ type: "blocklist" }, home);
  return trips.map((t) => {
    const f = freezes.find((x) => x.trip_tx_hash === t.tx_hash) ?? freezes.at(-1);
    const b = lists.find((x) => x.trip_tx_hash === t.tx_hash);
    return {
      tx_hash: s(t.tx_hash), block_height: Number(t.block_height ?? 0), decoy_public_key: s(t.decoy_public_key),
      attacker_account: s(t.attacker_account),
      attributed_to: { session_id: "", agent: "", tool_name: "", tool_use_id: "", path: "", ...(t.attributed_to ?? {}) },
      freeze: f?.freeze ?? { tx_hash: "", block_height: 0, blocks_after_trip: 0, deleted_keys: [], intents_keys_removed: [] },
      blocklist: b?.blocklist ?? { tx_hash: "", outlayer_execution: "", attested: false },
    };
  });
}

function sessions(home?: string) {
  const calls = new Map<string, number>();
  for (const e of readEvents({ type: "tool_call" }, home)) calls.set(s(e.session_id), (calls.get(s(e.session_id)) ?? 0) + 1);
  return readEvents({ type: "session_started" }, home).map((e) => ({
    session_id: s(e.session_id), agent: s(e.agent), cwd: s(e.cwd), started_at: e.at,
    decoy_public_key: s(e.decoy_public_key), tool_calls: calls.get(s(e.session_id)) ?? 0,
  }));
}
const exposureOf = (e: LedgerEvent) => ({
  at: e.at, session_id: s(e.session_id), agent: s(e.agent), tool_name: s(e.tool_name),
  tool_input_summary: s(e.tool_input_summary), tool_use_id: s(e.tool_use_id), decoy_public_key: s(e.decoy_public_key), where: s(e.where),
});

let cache: { at: number; chain: any } | null = null;
async function chainSnapshot(cfg: NetworkConfig) {
  if (cache && Date.now() - cache.at < 1000) return cache.chain;
  const prov = makeProvider(cfg);
  const agent = requireAccount(cfg, "agent");
  const decoy = requireAccount(cfg, "decoy");
  const [g, d, reg] = await Promise.all([
    prov.callFunction({ contractId: agent, method: "get_state", args: {} } as any).catch(() => null) as Promise<any>,
    prov.viewAccount({ accountId: decoy } as any).catch(() => null) as Promise<any>,
    cfg.accounts.registry
      ? (prov.callFunction({ contractId: cfg.accounts.registry, method: "list", args: {} } as any).catch(() => null) as Promise<any>)
      : Promise.resolve(null),
  ]);
  cache = { at: Date.now(), chain: { g, d, reg } };
  return cache.chain;
}

export async function buildState(cfg: NetworkConfig, home?: string) {
  const { g, d, reg } = await chainSnapshot(cfg);
  const planted = new Map<string, LedgerEvent>();
  for (const e of readEvents({ type: "decoy_planted" }, home)) planted.set(s(e.public_key), e);
  const trips = buildTrips(home);
  const bench: Record<string, any> = readEvents({ type: "bench" }, home).at(-1) ?? {};
  const chainBlocklist = Array.isArray(reg) ? reg : Array.isArray(reg?.entries) ? reg.entries : [];
  const ledgerBlocklist = readEvents({ type: "blocklist" }, home).map((e) => ({
    account_id: s(e.account_id), evidence_tx: s(e.evidence_tx), decoy_public_key: s(e.decoy_public_key), attested_at: s(e.attested_at),
  }));
  const blocklist = chainBlocklist.length
    ? chainBlocklist.map((e: any) => ({
        account_id: s(e.account_id ?? e.attacker_account), evidence_tx: s(e.evidence_tx ?? e.tx_hash),
        decoy_public_key: s(e.decoy_public_key),
        attested_at: e.attested_at_ns ? new Date(Number(BigInt(e.attested_at_ns.toString()) / 1_000_000n)).toISOString() : s(e.attested_at),
      }))
    : ledgerBlocklist;
  return {
    network: cfg.network,
    agent: {
      account_id: requireAccount(cfg, "agent"), frozen: Boolean(g?.frozen),
      agent_keys: (g?.agent_keys ?? []).map((k: any) => (typeof k === "string" ? k : k.public_key)),
      intents_keys: (g?.intents_keys ?? []).map((k: any) => (typeof k === "string" ? k : k.public_key)),
    },
    decoy: {
      account_id: requireAccount(cfg, "decoy"), balance_yocto: s(d?.amount ?? "0"),
      keys: [...planted.values()].map((e) => ({
        public_key: s(e.public_key),
        planted: { kind: s(e.kind), path: s(e.path), agent: s(e.agent), session_id: s(e.session_id), cwd: s(e.cwd), at: e.at },
      })),
    },
    sessions: sessions(home),
    exposures: readEvents({ type: "exposure" }, home).map(exposureOf),
    trips, blocklist,
    bench: { routes: Number(bench.routes ?? 0), detected: Number(bench.detected ?? 0), attributed: Number(bench.attributed ?? 0), median_blocks_to_freeze: Number(bench.median_blocks_to_freeze ?? 0) },
  };
}

/** Map one new ledger event to its SSE (name, payload) per the brief, or null. */
export function sseOf(e: LedgerEvent, home?: string): { event: string; data: unknown } | null {
  switch (e.type) {
    case "session_started": return { event: "session", data: sessions(home).find((x) => x.session_id === s(e.session_id)) ?? e };
    case "exposure": return { event: "exposure", data: exposureOf(e) };
    case "trip": return { event: "trip", data: buildTrips(home).find((t) => t.tx_hash === e.tx_hash) };
    case "freeze": return { event: "freeze", data: { trip_tx_hash: e.trip_tx_hash, ...e.freeze } };
    case "blocklist": return { event: "blocklist", data: { account_id: s(e.account_id), evidence_tx: s(e.evidence_tx), decoy_public_key: s(e.decoy_public_key), attested_at: s(e.attested_at), trip_tx_hash: e.trip_tx_hash, ...e.blocklist } };
    case "bench": return { event: "bench", data: { routes: e.routes ?? 0, detected: e.detected ?? 0, attributed: e.attributed ?? 0, median_blocks_to_freeze: e.median_blocks_to_freeze ?? 0 } };
    default: return null;
  }
}
void loadDevKey;
