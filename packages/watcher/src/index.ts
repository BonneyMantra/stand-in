import { loadNetworkConfig, logger, standinHome } from "@standin/core";
import { followBlocks, followKeyChanges } from "./stream.ts";
import { TripHandler } from "./trip.ts";
import { startServer } from "./server.ts";
import { startAlerts } from "./alerts.ts";

export { followBlocks, followKeyChanges } from "./stream.ts";
export { TripHandler, attackerOf } from "./trip.ts";
export { startServer } from "./server.ts";
export { buildState } from "./state.ts";

const log = logger("watcher");

/** Start follower + API. Resolves with a stop() handle once the stream is running. */
export async function startWatcher(opts: { port?: number; mode?: "optimistic" | "final"; home?: string; blockStream?: boolean } = {}) {
  const cfg = loadNetworkConfig();
  const home = opts.home ?? standinHome();
  const handler = new TripHandler(cfg, home);
  await handler.init();
  const server = startServer(cfg, { port: opts.port, home });
  const alerts = startAlerts({ cfg, home, handler }); // optional phone layer; inert without STANDIN_NTFY_TOPIC
  const ac = new AbortController();
  const detectors: Promise<void>[] = [
    // primary: low-latency access-key change detector (RPC, ~4 req/s)
    followKeyChanges({
      cfg, accountId: handler.decoy, ignoreKeys: [handler.adminKey()], signal: ac.signal,
      onChange: (c) => { void handler.onKeyChange(c).catch((e) => log.error(`trip handling failed: ${e.message}`)); },
    }),
  ];
  log.info(`watching decoy ${handler.decoy} for key use (rpc access-key changes)`);
  if (opts.blockStream ?? process.env.STANDIN_BLOCK_STREAM === "1") {
    // secondary: full block follower via neardata (rate-limited on the free tier) with RPC fallback
    detectors.push(followBlocks({ cfg, mode: opts.mode, signal: ac.signal, onBlock: (b) => handler.onBlock(b) }));
    log.info("block stream follower enabled (neardata, rpc fallback)");
  }
  const done = Promise.all(detectors).then(() => undefined);
  return {
    stop: async () => { ac.abort(); alerts.stop(); handler.stop(); server.close(); await done; },
    done,
  };
}
