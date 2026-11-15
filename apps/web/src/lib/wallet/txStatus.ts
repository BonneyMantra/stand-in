import { rpc } from "./near";
import { firstFailure, type Outcome } from "./localSigner";

/** A transaction read back from chain (RPC `tx`), not from what the wallet reported. */
export type TxRead =
  | { status: "success"; value: unknown; raw: unknown }
  | { status: "failure"; failure: string; raw: unknown }
  | { status: "pending" };

function decode(b64: string): unknown {
  try {
    const text = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/** Reads `hash` (signed by `signer`) until it has a final result, up to `tries` times. */
export async function readTx(hash: string, signer: string, tries = 6, waitMs = 2500): Promise<TxRead> {
  for (let i = 0; i < tries; i++) {
    try {
      const o = await rpc<Outcome & { status?: { SuccessValue?: string } | unknown }>("tx", { tx_hash: hash, sender_account_id: signer, wait_until: "EXECUTED_OPTIMISTIC" });
      const failure = firstFailure(o);
      if (failure) return { status: "failure", failure, raw: o };
      const sv = (o.status as { SuccessValue?: string } | undefined)?.SuccessValue;
      if (typeof sv === "string") return { status: "success", value: decode(sv), raw: o };
    } catch {
      // not visible on this node yet, or still executing (a Chain Signatures request resumes a few blocks later)
    }
    await new Promise((r) => setTimeout(r, waitMs));
  }
  return { status: "pending" };
}

/** intents registry view: is `publicKey` registered for `accountId` right now? */
export async function hasIntentsKey(intents: string, accountId: string, publicKey: string): Promise<boolean> {
  const r = await rpc<{ result: number[] }>("query", {
    request_type: "call_function", finality: "optimistic", account_id: intents, method_name: "has_public_key",
    args_base64: btoa(JSON.stringify({ account_id: accountId, public_key: publicKey })),
  });
  return JSON.parse(new TextDecoder().decode(new Uint8Array(r.result))) === true;
}
