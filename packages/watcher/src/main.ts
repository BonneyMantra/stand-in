import { startWatcher } from "./index.ts";
import { logger } from "@standin/core";

const log = logger("watcher");
const mode = process.argv.includes("--final") ? "final" : "optimistic";
startWatcher({ mode }).then((w) => {
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => void w.stop().then(() => process.exit(0)));
}).catch((e) => {
  log.error(String(e?.stack ?? e));
  process.exit(1);
});
