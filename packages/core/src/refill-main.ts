import { refillPool } from "./pool.ts";
import { logger } from "./logger.ts";

const log = logger("refill");
refillPool(Number(process.argv[2]) || undefined).catch((e) => {
  log.error(String(e?.message ?? e));
  process.exitCode = 1;
});
