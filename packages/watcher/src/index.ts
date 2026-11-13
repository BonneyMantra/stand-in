import { loadNetworkConfig, logger, standinHome } from "@standin/core";
import { followBlocks } from "./stream.ts";
import { TripHandler } from "./trip.ts";
import { startServer } from "./server.ts";

export { followBlocks } from "./stream.ts";
export { TripHandler, attackerOf } from "./trip.ts";
export { startServer } from "./server.ts";
export { buildState } from "./state.ts";

const log = logger("watcher");

/** Start follower + API. Resolves with a stop() handle once the stream is running. */
export async function startWatcher(opts: { port?: number; mode?: "optimistic" | "final"; home?: string } = {}) {
  const cfg = loadNetworkConfig();
  const home = opts.home ?? standinHome();
  const handler = new TripHandler(cfg, home);
  await handler.init();
  const server = startServer(cfg, { port: opts.port, home });
  const ac = new AbortController();
  let first = true;
  const done = followBlocks({
    cfg, mode: opts.mode, signal: ac.signal,
    onBlock: async (b) => {
      if (first) { first = false; log.info(`following ${b.source} from block ${b.height}; decoy ${handler.decoy}`); }
      await handler.onBlock(b);
    },
  });
  return {
    stop: async () => { ac.abort(); handler.stop(); server.close(); await done; },
    done,
  };
}
