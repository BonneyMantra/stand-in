// Calls guardian.sign_evm and reports success / failure without throwing, so refusals can be proven.
import { callMethod, makeProvider, type NetworkConfig } from "@standin/core";
import { KeyPairSigner, actions, baseDecode, createTransaction, type Account } from "near-api-js";
import { parseSignature, type MpcSignature } from "./mpc.ts";

export interface SignAttempt {
  ok: boolean;
  tx_hash?: string;
  signature?: MpcSignature;
  /** where it failed: "rpc" = rejected before it became a transaction (e.g. InvalidAccessKey); "chain" = a failed receipt */
  failed_at?: "rpc" | "chain";
  error?: string;
}

const failureText = (f: unknown) => JSON.stringify(f).replace(/\\"/g, '"').slice(0, 400);

/** The receipts of one tx: the first failure anywhere in the tree, if any (the refusal is in the guardian receipt). */
function firstFailure(outcome: any): unknown {
  if (outcome?.status && typeof outcome.status === "object" && "Failure" in outcome.status) return outcome.status.Failure;
  for (const r of outcome?.receipts_outcome ?? []) {
    const st = r?.outcome?.status;
    if (st && typeof st === "object" && "Failure" in st) return st.Failure;
  }
  return undefined;
}

export async function requestSignEvm(
  _cfg: NetworkConfig, acct: Account, guardianId: string, payloadHex: string, path: string,
): Promise<SignAttempt> {
  let res: Awaited<ReturnType<typeof callMethod>>;
  try {
    res = await callMethod(acct, guardianId, "sign_evm", { payload_hex: payloadHex, path }, { gas: 150_000_000_000_000n, waitUntil: "EXECUTED_OPTIMISTIC" });
  } catch (e: any) {
    if (e?.transactionResult) {
      // the call became a transaction and a receipt panicked (e.g. the guardian refused): keep its hash
      const tr = e.transactionResult;
      return { ok: false, failed_at: "chain", tx_hash: String(tr.transaction?.hash ?? tr.transaction_outcome?.id ?? ""), error: `${e.name ?? "Error"}: ${e.panicMessage ?? e.message}`.slice(0, 400) };
    }
    const msg = String(e?.message ?? e);
    return { ok: false, failed_at: "rpc", error: `${e?.type ?? e?.name ?? "Error"}: ${msg}`.slice(0, 400) };
  }
  const f = firstFailure(res.outcome);
  if (f) return { ok: false, failed_at: "chain", tx_hash: res.tx_hash, error: failureText(f) };
  const b64 = res.outcome?.status?.SuccessValue;
  if (typeof b64 !== "string") return { ok: false, failed_at: "chain", tx_hash: res.tx_hash, error: `no SuccessValue (status ${JSON.stringify(res.outcome?.status).slice(0, 200)})` };
  try {
    return { ok: true, tx_hash: res.tx_hash, signature: parseSignature(JSON.parse(Buffer.from(b64, "base64").toString("utf8"))) };
  } catch (e: any) {
    return { ok: false, failed_at: "chain", tx_hash: res.tx_hash, error: String(e.message) };
  }
}

/**
 * What a thief holding a copied agent key would do: sign a sign_evm transaction with a hand-picked nonce (no
 * client-side access-key lookup) and broadcast it. After a freeze the key is gone, so the CHAIN rejects the
 * transaction itself (InvalidAccessKey: AccessKeyNotFound); it never becomes a transaction with a hash.
 */
export async function sendWithKeyRaw(cfg: NetworkConfig, accountId: string, secretKey: string, payloadHex: string, path: string): Promise<SignAttempt> {
  const prov: any = makeProvider(cfg);
  const signer = KeyPairSigner.fromSecretKey(secretKey as `ed25519:${string}`);
  const block: any = await prov.viewBlock({ finality: "final" });
  const nonce = 5_000_000_000_001n; // arbitrary and valid-looking; irrelevant when the key is absent
  const tx = createTransaction(accountId, await signer.getPublicKey(), accountId, nonce, [actions.functionCall("sign_evm", { payload_hex: payloadHex, path }, 150_000_000_000_000n, 0n)], baseDecode(block.header.hash));
  const { signedTransaction } = await signer.signTransaction(tx);
  try {
    await prov.sendTransaction(signedTransaction);
    return { ok: true };
  } catch (e: any) {
    const inner = Array.isArray(e?.errors) && e.errors[0] ? e.errors[0] : e;
    return { ok: false, failed_at: "rpc", error: `${inner?.name ?? "Error"}: ${String(inner?.message ?? e).slice(0, 300)}` };
  }
}
