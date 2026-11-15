/**
 * Every NEAR amount Stand-in asks an owner to pay, in one place: the CLI (`standin adopt`) and the owner console import
 * this file, so both quote the same number and explain it the same way. Pure: no Node or browser APIs.
 *
 * Measured on testnet, 15 Nov 2026:
 *  - a guardian account after deploy + new + one agent key uses 176,544 bytes (182 for the account, 176,033 for the code);
 *  - NEAR charges prepaid gas up front at about 0.001 NEAR per TGas and refunds what is not burnt: a blocklist report
 *    (300 TGas + 0.05 NEAR deposit) needed 0.3509 NEAR up front (refused for a 0.2 NEAR watcher) and finally cost
 *    0.0028 NEAR (tx FdDiwpR43KB1YQ1v3k2LRJYx5Cf1toFaBdDKHVYkKJSi); a freeze (100 TGas) needs 0.1 up front and cost 0.0002
 *    (tx CjY8N7iVJkCJs3JNnWJztAnK7VoGpZzUpYXF8Dhj3ZYj).
 */
export const YOCTO_PER_NEAR = 10n ** 24n;
/** Protocol storage price: 1 NEAR per 100 kB. */
export const YOCTO_PER_BYTE = 10n ** 19n;
/** The pinned guardian wasm (code hash 7PbHKsE6…9ZuE). */
export const GUARDIAN_CODE_BYTES = 176_033n;
/** Guardian state with a few agent keys and freeze records (measured about 330 bytes after one key). */
export const GUARDIAN_STATE_BYTES = 1_000n;
/** Prepaid gas is charged up front at about this much per TGas (unused gas comes back). */
export const UPFRONT_PER_TGAS = 10n ** 21n;
/** The guardian deploy transaction: `new` (50 TGas) and, from an adopt link, `add_agent_key` (100 TGas). */
export const DEPLOY_TGAS = 150n;
/** Gas for the owner's other transactions (creating accounts, a key add): a margin, nearly all of it stays. */
export const OWNER_GAS = 50_000_000_000_000_000_000_000n;
/** The bait: storage for its decoy keys, gas for a thief's transaction, and something worth stealing. */
export const BAIT_FUND = 200_000_000_000_000_000_000_000n;
/** A blocklist report up front: 300 TGas prepaid + the registry deposit (0.05 NEAR, mostly returned). */
export const REPORT_UPFRONT = 360_000_000_000_000_000_000_000n;
/** The watcher: one report up front, plus room for many freezes and reports (each about 0.003 NEAR actually spent). */
export const WATCHER_FUND = 450_000_000_000_000_000_000_000n;
/** create_guardian prepays 100 TGas. */
export const FACTORY_TGAS = 100n;

export interface QuoteLine { label: string; yocto: bigint; why: string }
export interface Quote { lines: QuoteLine[]; total: bigint }

const sum = (lines: QuoteLine[]): Quote => ({ lines, total: lines.reduce((t, l) => t + l.yocto, 0n) });

/** Rounds yoctoNEAR to a short decimal string ("0.45"). */
export function near(yocto: bigint, digits = 2): string {
  const scale = 10n ** BigInt(digits);
  const v = (yocto * scale + YOCTO_PER_NEAR / 2n) / YOCTO_PER_NEAR;
  const s = v.toString().padStart(digits + 1, "0");
  return `${s.slice(0, -digits)}.${s.slice(-digits)}`;
}

export const guardianStorage = () => (GUARDIAN_CODE_BYTES + GUARDIAN_STATE_BYTES) * YOCTO_PER_BYTE;

/**
 * The balance an account needs before an adopt request: what its own storage already locks, the guardian (storage + up-front
 * deploy gas) when one is deployed, the bait and the watcher it creates, and gas.
 */
export function quoteAdopt(o: { storageBytes: bigint; deployGuardian: boolean; createBait: boolean; createWatcher: boolean }): Quote {
  const lines: QuoteLine[] = [{ label: "already locked", yocto: o.storageBytes * YOCTO_PER_BYTE, why: "the account's own storage, which it cannot spend" }];
  if (o.deployGuardian) {
    lines.push({ label: "guardian storage", yocto: guardianStorage(), why: "the 176,033-byte contract and its state at 1 NEAR per 100 kB; locked while the guardian is deployed" });
    lines.push({ label: "deploy gas", yocto: DEPLOY_TGAS * UPFRONT_PER_TGAS, why: "150 TGas paid up front; the unused part comes back" });
  }
  if (o.createBait) lines.push({ label: "bait account", yocto: BAIT_FUND, why: "storage for its decoy keys, gas for a thief's transaction, and something worth stealing" });
  if (o.createWatcher) lines.push({ label: "watcher account", yocto: WATCHER_FUND, why: `a blocklist report needs ${near(REPORT_UPFRONT)} NEAR up front (300 TGas + 0.05 deposit; about 0.003 is spent), plus freezes` });
  lines.push({ label: "gas", yocto: OWNER_GAS, why: "your own transactions; nearly all of it stays with you" });
  return sum(lines);
}

/** create_guardian: the factory's own required_deposit (read from chain) plus up-front gas, on top of locked storage. */
export function quoteFactory(o: { storageBytes: bigint; deposit: bigint }): Quote {
  return sum([
    { label: "already locked", yocto: o.storageBytes * YOCTO_PER_BYTE, why: "the account's own storage, which it cannot spend" },
    { label: "factory deposit", yocto: o.deposit, why: "the factory's required_deposit: the new account's guardian storage; about 0.3 NEAR of it stays withdrawable" },
    { label: "gas", yocto: FACTORY_TGAS * UPFRONT_PER_TGAS, why: "100 TGas paid up front; the unused part comes back" },
  ]);
}

/** How much `balance` is short of a quote (0 when it covers it). */
export const shortOf = (balance: bigint, q: Quote) => (balance >= q.total ? 0n : q.total - balance);
