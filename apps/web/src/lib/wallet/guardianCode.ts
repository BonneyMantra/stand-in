import { rpc, YOCTO_PER_NEAR } from "./near";

/**
 * The guardian build the owner console deploys from the owner's wallet. It is byte-identical to the code on the film's
 * guardian account: anyone can compare `view_account <CODE_SOURCE> .code_hash` with GUARDIAN_CODE_HASH.
 * The page refuses to sign a deploy unless the fetched file hashes to this value.
 */
export const GUARDIAN_WASM_URL = "/guardian/standin_guardian.wasm";
export const GUARDIAN_CODE_HASH = "7PbHKsE6PhdvypoUrE179X5kPxjqgzfFJr7Z1kRr9ZuE";
export const GUARDIAN_CODE_BYTES = 176_033;
export const CODE_SOURCE = "si-agent-5289.testnet";

/** config/testnet.json: the Stand-in watcher (may freeze, never unfreeze) and the intents registry. */
export const DEFAULT_WATCHER = "si-watch-5289.testnet";
export const DEFAULT_INTENTS = "si-intents-5289.testnet";
export const FAUCET_URL = "https://docs.near.org/tools/faucet";

/** Protocol storage price: 10^19 yoctoNEAR per byte (1 NEAR per 100 kB). */
export const YOCTO_PER_BYTE = 10n ** 19n;
/** Guardian state after `new`, its key records and one agent key, rounded up. */
const STATE_MARGIN_BYTES = 1_000n;
/** Gas for one deploy transaction (deploy + new + add_agent_key), rounded up. */
const GAS_RESERVE = YOCTO_PER_NEAR / 20n;

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function base58Encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; out = "1" + out; }
  return out;
}

/** base58(sha256(code)), the form NEAR reports as `code_hash`. */
export async function codeHash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return base58Encode(new Uint8Array(digest));
}

export interface GuardianCode { bytes: Uint8Array; hash: string }

export class CodeMismatch extends Error {}

/** Fetches the pinned wasm and checks its hash. Throws CodeMismatch when the file is not the pinned build. */
export async function loadGuardianCode(url = GUARDIAN_WASM_URL): Promise<GuardianCode> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not fetch the guardian code (HTTP ${res.status}).`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const hash = await codeHash(bytes);
  if (hash !== GUARDIAN_CODE_HASH) {
    throw new CodeMismatch(`The guardian file hashes to ${hash}, not the pinned ${GUARDIAN_CODE_HASH}. Refusing to deploy it.`);
  }
  return { bytes, hash };
}

export interface AccountView { amount: bigint; locked: bigint; storageUsage: bigint; codeHash: string }

export async function viewAccount(accountId: string): Promise<AccountView> {
  const r = await rpc<{ amount: string; locked: string; storage_usage: number; code_hash: string }>("query", {
    request_type: "view_account", finality: "optimistic", account_id: accountId,
  });
  return { amount: BigInt(r.amount), locked: BigInt(r.locked), storageUsage: BigInt(r.storage_usage), codeHash: r.code_hash };
}

export interface StorageQuote {
  /** NEAR locked by the code and guardian state. */
  codeStorage: bigint;
  /** Balance the account needs in total after the deploy: existing storage + new storage + gas. */
  required: bigint;
  balance: bigint;
  shortfall: bigint;
}

export function quoteStorage(account: AccountView, codeBytes = GUARDIAN_CODE_BYTES): StorageQuote {
  const codeStorage = (BigInt(codeBytes) + STATE_MARGIN_BYTES) * YOCTO_PER_BYTE;
  const required = account.storageUsage * YOCTO_PER_BYTE + codeStorage + GAS_RESERVE;
  const balance = account.amount;
  return { codeStorage, required, balance, shortfall: balance >= required ? 0n : required - balance };
}

/** Rounds yoctoNEAR to a short NEAR figure for prose ("1.77"). Exact values stay in the decoded rows. */
export function nearShort(yocto: bigint, digits = 2): string {
  const scale = 10n ** BigInt(digits);
  const v = (yocto * scale + YOCTO_PER_NEAR / 2n) / YOCTO_PER_NEAR;
  const s = v.toString().padStart(digits + 1, "0");
  return `${s.slice(0, -digits)}.${s.slice(-digits)}`;
}
