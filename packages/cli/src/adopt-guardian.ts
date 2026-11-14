import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { Account } from "near-api-js";
import { actions, eachEndpoint, makeProvider, repoRoot, requireAccount, type NetworkConfig } from "@standin/core";

/** Code hash of the audited guardian build (the one on si-agent-5289.testnet), also pinned by the owner console. */
export const GUARDIAN_CODE_HASH = "7PbHKsE6PhdvypoUrE179X5kPxjqgzfFJr7Z1kRr9ZuE";
/** Storage for the 176 kB wasm is about 1.76 NEAR; keep a margin for state and gas. */
export const MIN_GUARDIAN_BALANCE = 2_000_000_000_000_000_000_000_000n;
const EMPTY_HASH = "11111111111111111111111111111111";
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58(buf: Uint8Array): string {
  let n = BigInt("0x" + Buffer.from(buf).toString("hex"));
  let s = "";
  while (n > 0n) { s = ALPHABET[Number(n % 58n)] + s; n /= 58n; }
  for (const b of buf) { if (b === 0) s = "1" + s; else break; }
  return s;
}

export const guardianWasmPath = () => path.join(repoRoot(), "apps/web/public/guardian/standin_guardian.wasm");

export type GuardianState = "ready" | "none";

const missing = (e: unknown) => /does not exist|UnknownAccount|AccountDoesNotExist/i.test(String((e as Error)?.message ?? e) + String((e as Error)?.name ?? ""));

/**
 * Make sure `account` runs the guardian: an existing guardian is verified (its watcher must be ours), a bare account
 * gets the pinned build deployed and initialised in one transaction signed by the owner key. Refuses any other
 * contract, a missing account and a balance too small for the storage, before anything is sent.
 */
export async function ensureGuardian(cfg: NetworkConfig, account: string, owner: Account): Promise<{ deployed: boolean; tx_hash?: string }> {
  const prov = makeProvider(cfg);
  let acc: any;
  try {
    acc = await eachEndpoint(cfg, false, (p) => p.viewAccount({ accountId: account } as any), missing);
  } catch (e) {
    if (missing(e)) throw new Error(`${account} does not exist on ${cfg.network}; create and fund it first`);
    throw e;
  }
  const watcher = requireAccount(cfg, "watcher");
  if (acc.code_hash !== EMPTY_HASH) {
    let st: any;
    try { st = await prov.callFunction({ contractId: account, method: "get_state", args: {} } as any); } catch { st = null; }
    if (!st || typeof st !== "object" || !("watcher" in st)) {
      throw new Error(`${account} already runs a contract that is not a Stand-in guardian (code hash ${acc.code_hash}); refusing to overwrite it`);
    }
    if (String(st.watcher) !== watcher) throw new Error(`the guardian on ${account} is watched by ${st.watcher}, not ${watcher}; its freeze would never come from our watcher`);
    if (st.owner !== account) throw new Error(`the guardian on ${account} has owner ${st.owner}; this key cannot administer it`);
    return { deployed: false };
  }
  const bal = BigInt(acc.amount);
  if (bal < MIN_GUARDIAN_BALANCE) {
    const short = Number((MIN_GUARDIAN_BALANCE - bal) / 10n ** 21n) / 1000;
    throw new Error(`${account} holds ${(Number(bal / 10n ** 21n) / 1000).toFixed(2)} NEAR; the guardian needs about 2 NEAR locked for storage (${short.toFixed(2)} NEAR short). Fund it and run adopt again`);
  }
  const file = guardianWasmPath();
  if (!fs.existsSync(file)) throw new Error(`guardian wasm not found at ${file}`);
  const wasm = fs.readFileSync(file);
  const hash = base58(createHash("sha256").update(wasm).digest());
  if (hash !== GUARDIAN_CODE_HASH) throw new Error(`guardian wasm hash ${hash} does not match the pinned ${GUARDIAN_CODE_HASH}; refusing to deploy`);
  const res: any = await owner.signAndSendTransaction({
    receiverId: account,
    actions: [
      actions.deployContract(wasm),
      actions.functionCall("new", { watcher, intents_contract: requireAccount(cfg, "intents") }, 30_000_000_000_000n, 0n),
    ],
    waitUntil: "EXECUTED_OPTIMISTIC",
  });
  const s = res?.status;
  if (s && typeof s === "object" && "Failure" in s) throw new Error(`guardian deploy failed: ${JSON.stringify(s.Failure)}`);
  return { deployed: true, tx_hash: String(res.transaction?.hash ?? res.transaction_outcome?.id) };
}
