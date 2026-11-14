import { z } from "zod";
import type { NearWalletBase } from "@hot-labs/near-connect";
import { NETWORK, TGAS, rpc } from "./near";
import { readOutcome, type TxOutcome } from "./connector";
import { viewAccount } from "./guardianCode";

/**
 * Guardian factory: creates `<name>.guard.si-project-5289.testnet` with a guardian whose owner is the caller. For owners
 * whose own account cannot host the guardian (an Ethereum Wallets 0x account) and, optionally, any NEAR account.
 * The new account has no access keys; the owner calls it from their own account.
 */
export const FACTORY = "guard.si-project-5289.testnet";
export const isFactoryGuardian = (id: string) => id.endsWith(`.${FACTORY}`) && !id.slice(0, -FACTORY.length - 1).includes(".");

export const GuardianName = z.string()
  .max(34, "at most 34 characters")
  .regex(/^[a-z0-9]+([-_][a-z0-9]+)*$/, "lowercase a-z and 0-9, with single - or _ between them (no dots)");

const b64 = (o: unknown) => btoa(JSON.stringify(o));

async function view<T>(method: string, args: object): Promise<T> {
  const r = await rpc<{ result: number[] }>("query", {
    request_type: "call_function", finality: "optimistic", account_id: FACTORY, method_name: method, args_base64: b64(args),
  });
  return JSON.parse(new TextDecoder().decode(new Uint8Array(r.result))) as T;
}

export const requiredDeposit = async () => BigInt(await view<string>("required_deposit", {}));
export const guardiansOf = (owner: string) => view<string[]>("guardians_of", { owner });

/** Balance the owner can withdraw: balance minus the storage reserve (10^19 yocto per byte). */
export async function withdrawable(guardianId: string): Promise<bigint> {
  const a = await viewAccount(guardianId);
  const free = a.amount - a.storageUsage * 10n ** 19n;
  return free > 0n ? free : 0n;
}

export interface CreateResult extends TxOutcome { guardianId: string | null }

/** One transaction from the owner to the factory: create_guardian with the deposit. Resolves to the new id or null (refunded). */
export async function sendCreateGuardian(wallet: NearWalletBase, ownerId: string, name: string, watcher: string, intents: string, deposit: bigint): Promise<CreateResult> {
  const outcome = await wallet.signAndSendTransaction({
    network: NETWORK, signerId: ownerId, receiverId: FACTORY,
    actions: [{ type: "FunctionCall", params: { methodName: "create_guardian", args: { name, watcher, intents_contract: intents }, gas: (100n * TGAS).toString(), deposit: deposit.toString() } }],
  });
  const out = readOutcome(outcome);
  return { ...out, guardianId: successValue(outcome) };
}

/** The transaction's final SuccessValue (base64 JSON), here the created guardian id or null. */
function successValue(o: unknown): string | null {
  const v = (o as { status?: { SuccessValue?: string } } | null)?.status?.SuccessValue;
  if (!v) return null;
  try {
    const parsed = JSON.parse(atob(v));
    return typeof parsed === "string" ? parsed : null;
  } catch {
    return null;
  }
}
