import { z } from "zod";

/** The owner console is testnet-only: every read and every wallet request names this network. */
export const NETWORK = "testnet" as const;
// drpc first: FastNEAR answers HTTP 429 to some IPs (2026-11-14); it stays last as a fallback.
export const RPC_URLS = ["https://near-testnet.drpc.org", "https://rpc.testnet.near.org", "https://rpc.testnet.fastnear.com"];
export const TGAS = 10n ** 12n;
export const YOCTO_PER_NEAR = 10n ** 24n;

/** Same URL shape as packages/core explorerTx for testnet. */
export const explorerTx = (hash: string) => `https://testnet.nearblocks.io/txns/${hash}`;
export const explorerAccount = (id: string) => `https://testnet.nearblocks.io/address/${id}`;

const FreezeRecord = z.object({
  at_block: z.union([z.string(), z.number()]).transform(String),
  reason: z.string(),
  decoy_public_key: z.string().nullable().optional(),
  tx_hash: z.string().nullable().optional(),
  by: z.string(),
  deleted_keys: z.array(z.string()),
  intents_keys_removed: z.array(z.string()),
});
export const GuardianState = z.object({
  owner: z.string(),
  watcher: z.string(),
  intents_contract: z.string(),
  agent_keys: z.array(z.string()),
  intents_keys: z.array(z.string()),
  frozen: z.boolean(),
  freeze_log: z.array(FreezeRecord),
});
export type GuardianState = z.infer<typeof GuardianState>;

export type GuardianLookup =
  | { kind: "guardian"; state: GuardianState }
  | { kind: "missing-account" }
  | { kind: "no-contract" }
  | { kind: "not-guardian"; detail: string };

/** An answer from the chain (account missing, no code, method missing). Not retried on another endpoint. */
class Definitive extends Error {}

const DEFINITIVE = /UNKNOWN_ACCOUNT|does not exist|NO_CONTRACT_CODE|CodeDoesNotExist|MethodNotFound|UNKNOWN_ACCESS_KEY|access key .* does not exist|CONTRACT_EXECUTION_ERROR|wasm execution failed/i;

export async function rpc<T = unknown>(method: string, params: unknown): Promise<T> {
  let last: unknown;
  for (const url of RPC_URLS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "owner", method, params }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`RPC ${new URL(url).host} answered HTTP ${res.status}`);
      const j = (await res.json()) as { result?: T & { error?: string }; error?: unknown };
      const errText = j.error ? JSON.stringify(j.error) : j.result?.error;
      if (errText) {
        if (DEFINITIVE.test(errText)) throw new Definitive(errText);
        throw new Error(errText.slice(0, 200));
      }
      return j.result as T;
    } catch (e) {
      if (e instanceof Definitive) throw e;
      last = e;
    }
  }
  throw new Error(`Every testnet RPC endpoint failed${last instanceof Error ? `: ${last.message}` : ""}`);
}

const b64 = (o: unknown) => btoa(JSON.stringify(o));

/** Reads guardian.get_state on `accountId`; distinguishes a missing account, an account without code and a non-guardian contract. */
export async function readGuardian(accountId: string): Promise<GuardianLookup> {
  try {
    const r = await rpc<{ result: number[] }>("query", {
      request_type: "call_function", finality: "optimistic", account_id: accountId, method_name: "get_state", args_base64: b64({}),
    });
    const parsed = GuardianState.safeParse(JSON.parse(new TextDecoder().decode(new Uint8Array(r.result))));
    return parsed.success ? { kind: "guardian", state: parsed.data } : { kind: "not-guardian", detail: "get_state returned a different shape" };
  } catch (e) {
    if (!(e instanceof Definitive)) throw e;
    const m = e.message;
    if (/UNKNOWN_ACCOUNT|account .* does not exist/i.test(m)) return { kind: "missing-account" };
    if (/NO_CONTRACT_CODE|CodeDoesNotExist/i.test(m)) return { kind: "no-contract" };
    return { kind: "not-guardian", detail: /MethodNotFound/i.test(m) ? "the contract has no get_state method" : "get_state failed on this contract" };
  }
}

export async function accountExists(accountId: string): Promise<boolean> {
  try {
    await rpc("query", { request_type: "view_account", finality: "final", account_id: accountId });
    return true;
  } catch (e) {
    if (e instanceof Definitive) return false;
    throw e;
  }
}

/** Implicit (64 hex) and 0x accounts carry no network suffix; named accounts end in .testnet or .near. */
export function looksMainnet(accountId: string): boolean {
  return accountId.endsWith(".near");
}

/** An Ethereum Wallets (NEAR Connect) account: 0x + 20 bytes hex. It already runs NEAR's Ethereum wallet contract. */
export function isEthAccount(accountId: string): boolean {
  return /^0x[0-9a-f]{40}$/.test(accountId);
}

export const yoctoToNear = (yocto: bigint): string => {
  const whole = yocto / YOCTO_PER_NEAR;
  const frac = (yocto % YOCTO_PER_NEAR).toString().padStart(24, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
};

export interface AccessKeyView {
  nonce: number;
  permission: "FullAccess" | { FunctionCall: { allowance: string | null; receiver_id: string; method_names: string[] } };
}

/** view_access_key; null when the key is not on the account. */
export async function viewAccessKey(accountId: string, publicKey: string): Promise<AccessKeyView | null> {
  try {
    return await rpc<AccessKeyView>("query", { request_type: "view_access_key", finality: "optimistic", account_id: accountId, public_key: publicKey });
  } catch (e) {
    if (e instanceof Definitive) return null;
    throw e;
  }
}
