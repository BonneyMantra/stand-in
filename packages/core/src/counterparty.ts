import { loadNetworkConfig, type NetworkConfig } from "./config.ts";
import { interactionCount } from "./ledger.ts";
import { makeProvider } from "./rpc.ts";
import { logger } from "./logger.ts";

const log = logger("counterparty");
const EMPTY_CODE_HASH = "11111111111111111111111111111111";
const DAY_BLOCKS = 86_400; // ~1 block/s; corrected by a timestamp probe below

export type Decision = "allow" | "warn" | "block";
export interface Reason {
  level: "block" | "warn" | "info";
  code: "blocklist" | "young_account" | "contract_changed" | "no_account" | "prior_interactions" | "registry_unavailable" | "archival_unavailable";
  message: string;
}
export interface CounterpartyResult {
  account_id: string;
  decision: Decision;
  reasons: Reason[];
  prior_interactions: number;
  checked_at: string;
}
export interface RegistryVerdict {
  verdict: "block" | "allow";
  reasons?: string[];
  evidence_tx?: string;
}
export interface CheckOpts {
  cfg?: NetworkConfig;
  home?: string;
  /** override registry lookup (tests) */
  registryCheck?: (accountId: string) => Promise<RegistryVerdict>;
  /** override archival lookups (tests): returns {existed, codeHash} at `ageMs` before now */
  stateAt?: (accountId: string, ageMs: number) => Promise<{ existed: boolean; codeHash?: string }>;
  currentCodeHash?: (accountId: string) => Promise<string | null>;
  youngDays?: number;
  codeWindowHours?: number;
}

function isMissing(e: unknown): boolean {
  const s = `${(e as any)?.type ?? ""} ${(e as any)?.message ?? e}`;
  return /does not exist|UNKNOWN_ACCOUNT|AccountDoesNotExist|doesn't exist/i.test(s);
}

async function archivalStateAt(cfg: NetworkConfig, accountId: string, ageMs: number) {
  const prov = makeProvider(cfg, true);
  const head = (await makeProvider(cfg).viewBlock({ finality: "final" } as any)) as any;
  const guess = head.header.height - Math.round(ageMs / 1000);
  // correct the guess once using the timestamp of the guessed block
  const probe = (await prov.viewBlock({ blockId: guess } as any)) as any;
  const wantNs = BigInt(head.header.timestamp_nanosec) - BigInt(ageMs) * 1_000_000n;
  const driftS = Number((wantNs - BigInt(probe.header.timestamp_nanosec)) / 1_000_000_000n);
  const height = guess + driftS;
  try {
    const a = (await prov.viewAccount({ accountId, blockQuery: { blockId: height } } as any)) as any;
    return { existed: true, codeHash: String(a.code_hash) };
  } catch (e) {
    if (isMissing(e)) return { existed: false };
    throw e;
  }
}

export async function checkCounterparty(accountId: string, o: CheckOpts = {}): Promise<CounterpartyResult> {
  const reasons: Reason[] = [];
  const needsCfg = !o.registryCheck || !o.stateAt || !o.currentCodeHash;
  const cfg = o.cfg ?? (needsCfg ? loadNetworkConfig() : (undefined as unknown as NetworkConfig));

  // 1. blocklist registry
  try {
    const r = o.registryCheck
      ? await o.registryCheck(accountId)
      : await registryView(cfg, accountId);
    if (r.verdict === "block") {
      reasons.push({ level: "block", code: "blocklist", message: `on Stand-in blocklist${r.evidence_tx ? ` (evidence tx ${r.evidence_tx})` : ""}${r.reasons?.length ? `: ${r.reasons.join("; ")}` : ""}` });
    }
  } catch (e) {
    reasons.push({ level: "info", code: "registry_unavailable", message: `blocklist registry unreachable: ${(e as Error).message}` });
  }

  // 2. account age + contract code drift (archival RPC)
  const youngMs = (o.youngDays ?? 7) * 86_400_000;
  const codeMs = (o.codeWindowHours ?? 72) * 3_600_000;
  try {
    const nowCode = o.currentCodeHash ? await o.currentCodeHash(accountId) : await currentCode(cfg, accountId);
    if (nowCode === null) {
      reasons.push({ level: "warn", code: "no_account", message: "account does not exist on chain yet" });
    } else {
      const at = o.stateAt ?? ((a, ms) => archivalStateAt(cfg, a, ms));
      const young = await at(accountId, youngMs);
      if (!young.existed) {
        reasons.push({ level: "warn", code: "young_account", message: `account is younger than ${o.youngDays ?? 7} days` });
      }
      if (nowCode !== EMPTY_CODE_HASH) {
        const recent = await at(accountId, codeMs);
        if (recent.existed && recent.codeHash !== nowCode) {
          reasons.push({ level: "warn", code: "contract_changed", message: `contract code changed in the last ${o.codeWindowHours ?? 72}h` });
        }
      }
    }
  } catch (e) {
    log.warn(`archival check failed for ${accountId}: ${(e as Error).message}`);
    reasons.push({ level: "info", code: "archival_unavailable", message: `age/code check skipped: ${(e as Error).message}` });
  }

  // 3. prior interactions from the ledger (info only)
  const prior = interactionCount(accountId, o.home);
  if (prior > 0) reasons.push({ level: "info", code: "prior_interactions", message: `${prior} earlier tool call(s) touched this account` });

  const decision: Decision = reasons.some((r) => r.level === "block") ? "block" : reasons.some((r) => r.level === "warn") ? "warn" : "allow";
  return { account_id: accountId, decision, reasons, prior_interactions: prior, checked_at: new Date().toISOString() };
}

async function currentCode(cfg: NetworkConfig, accountId: string): Promise<string | null> {
  try {
    const a = (await makeProvider(cfg).viewAccount({ accountId } as any)) as any;
    return String(a.code_hash);
  } catch (e) {
    if (isMissing(e)) return null;
    throw e;
  }
}

/** Calls registry `check(account_id)`. Returns allow when no registry is configured is NOT done: throws. */
export async function registryView(cfg: NetworkConfig, accountId: string): Promise<RegistryVerdict> {
  const registry = cfg.accounts.registry;
  if (!registry) throw new Error("no registry account in config");
  const out = (await makeProvider(cfg).callFunction({ contractId: registry, method: "check", args: { account_id: accountId } } as any)) as any;
  if (!out || typeof out !== "object" || !["block", "allow"].includes(out.verdict)) throw new Error(`unexpected registry reply ${JSON.stringify(out)}`);
  return out as RegistryVerdict;
}
