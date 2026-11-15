import { sha256 } from "@noble/hashes/sha2.js";
import { base58Encode } from "./guardianCode";
import { base58Decode, publicKeyBytes, publicKeyOf, signEd25519 } from "./keys";
import { rpc, viewAccessKey } from "./near";

/**
 * Signs and sends NEAR transactions in the browser with a key this browser holds (a home's bait or watcher key). The web app
 * has no near-api-js, so this is a minimal borsh encoder for Transaction (V0) and SignedTransaction, checked byte for byte
 * against near-api-js in test/local-signer.test.ts. Secrets are used only to sign and are never logged or returned.
 */

export type LocalAction =
  | { type: "AddKey"; publicKey: string; permission: "FullAccess" | { receiverId: string; methodNames: string[]; allowance: bigint | null } }
  | { type: "DeleteKey"; publicKey: string }
  | { type: "FunctionCall"; methodName: string; args: Record<string, unknown> | Uint8Array; gas: bigint; deposit: bigint }
  | { type: "Transfer"; deposit: bigint }
  /** Deletes the signer's own account and sends its whole balance to `beneficiaryId` (the lab's throwaway thief returns everything to the bait). */
  | { type: "DeleteAccount"; beneficiaryId: string };

export interface LocalTx { signerId: string; publicKey: string; nonce: bigint; receiverId: string; blockHash: Uint8Array; actions: LocalAction[] }

class Writer {
  private parts: Uint8Array[] = [];
  bytes(b: Uint8Array) { this.parts.push(b); return this; }
  u8(n: number) { return this.bytes(Uint8Array.of(n)); }
  u32(n: number) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return this.bytes(b); }
  uint(n: bigint, size: 8 | 16) {
    if (n < 0n || n >= 1n << BigInt(size * 8)) throw new Error(`${n} does not fit in u${size * 8}`);
    const b = new Uint8Array(size);
    for (let i = 0, v = n; i < size; i++, v >>= 8n) b[i] = Number(v & 0xffn);
    return this.bytes(b);
  }
  vec(b: Uint8Array) { return this.u32(b.length).bytes(b); }
  str(s: string) { return this.vec(new TextEncoder().encode(s)); }
  pubkey(k: string) { return this.u8(0).bytes(publicKeyBytes(k)); }
  done(): Uint8Array {
    const out = new Uint8Array(this.parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of this.parts) { out.set(p, at); at += p.length; }
    return out;
  }
}

/** Action enum order: CreateAccount 0, DeployContract 1, FunctionCall 2, Transfer 3, Stake 4, AddKey 5, DeleteKey 6, DeleteAccount 7. */
function writeAction(w: Writer, a: LocalAction) {
  switch (a.type) {
    case "FunctionCall": {
      const args = a.args instanceof Uint8Array ? a.args : new TextEncoder().encode(JSON.stringify(a.args));
      w.u8(2).str(a.methodName).vec(args).uint(a.gas, 8).uint(a.deposit, 16);
      return;
    }
    case "Transfer": w.u8(3).uint(a.deposit, 16); return;
    case "AddKey": {
      w.u8(5).pubkey(a.publicKey).uint(0n, 8); // access key nonce 0, like near-api-js
      if (a.permission === "FullAccess") { w.u8(1); return; }
      w.u8(0);
      if (a.permission.allowance === null) w.u8(0); else w.u8(1).uint(a.permission.allowance, 16);
      w.str(a.permission.receiverId).u32(a.permission.methodNames.length);
      for (const m of a.permission.methodNames) w.str(m);
      return;
    }
    case "DeleteKey": w.u8(6).pubkey(a.publicKey); return;
    case "DeleteAccount": w.u8(7).str(a.beneficiaryId); return;
  }
}

export function encodeTransaction(tx: LocalTx): Uint8Array {
  if (tx.blockHash.length !== 32) throw new Error("a block hash is 32 bytes");
  const w = new Writer().str(tx.signerId).pubkey(tx.publicKey).uint(tx.nonce, 8).str(tx.receiverId).bytes(tx.blockHash).u32(tx.actions.length);
  for (const a of tx.actions) writeAction(w, a);
  return w.done();
}

/** Signs sha256(encoded tx) with `secretKey`; `hash` is the transaction hash the chain reports. */
export function signTransaction(tx: LocalTx, secretKey: string): { signed: Uint8Array; hash: string } {
  const encoded = encodeTransaction(tx);
  const digest = sha256(encoded);
  const signature = signEd25519(digest, secretKey);
  const signed = new Writer().bytes(encoded).u8(0).bytes(signature).done();
  return { signed, hash: base58Encode(digest) };
}

export interface LocalTxResult { hash: string; failure?: string; outcome: unknown }

/** The innermost readable text of a NEAR failure; "Smart contract panicked: X" reduces to X. */
function failureText(f: unknown): string {
  const strings: string[] = [];
  const walk = (v: unknown, key = "") => {
    if (typeof v === "string") strings.push(key === "ExecutionError" ? `\u0000${v}` : v);
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(f);
  const text = strings.find((s) => s.startsWith("\u0000"))?.slice(1) ?? (typeof f === "string" ? f : JSON.stringify(f).slice(0, 300));
  return text.replace(/^Smart contract panicked:\s*/, "");
}

export interface Outcome {
  status?: unknown;
  receipts_outcome?: { outcome?: { status?: unknown; executor_id?: string } }[];
  transaction?: { receiver_id?: string; actions?: unknown[] };
}

/** The account this transaction deleted (a DeleteAccount action on its receiver), if any. */
function deletedBy(o: Outcome): string | undefined {
  const acts = o.transaction?.actions ?? [];
  const deletes = acts.some((a) => (a && typeof a === "object" && "DeleteAccount" in a) || a === "DeleteAccount");
  return deletes ? o.transaction?.receiver_id : undefined;
}

/**
 * The first `Failure` in the transaction status or the receipts, or undefined when every step succeeded. After a
 * DeleteAccount, NEAR still sends the unused gas back to the deleted account; that refund receipt always fails with
 * AccountDoesNotExist and is not a failure of the transaction, so it is skipped.
 */
export function firstFailure(o: Outcome): string | undefined {
  if (o.status && typeof o.status === "object" && "Failure" in o.status) return failureText((o.status as { Failure: unknown }).Failure);
  const gone = deletedBy(o);
  const succeeded = !!o.status && typeof o.status === "object" && ("SuccessValue" in o.status || "SuccessReceiptId" in o.status);
  for (const r of o.receipts_outcome ?? []) {
    const s = r.outcome?.status;
    if (!(s && typeof s === "object" && "Failure" in s)) continue;
    const f = (s as { Failure: unknown }).Failure;
    const text = JSON.stringify(f);
    // The refund to the deleted account: named by the transaction's DeleteAccount when the outcome carries it, else (an
    // outcome without the transaction) an AccountDoesNotExist receipt with no executor in a transaction that succeeded.
    const refund = text.includes("AccountDoesNotExist") && (gone ? r.outcome?.executor_id === gone || text.includes(`"${gone}"`) : succeeded && !r.outcome?.executor_id);
    if (refund) continue;
    return failureText(f);
  }
  return undefined;
}

const INVALID_NONCE = /InvalidNonce|INVALID_NONCE/;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** How long a lost answer is looked up by hash before it counts as not sent. Tests shorten it. */
export interface Lookup { tries: number; waitMs: number }
const LOOKUP: Lookup = { tries: 6, waitMs: 1500 };

interface Signed { hash: string; base64: string }

async function signFresh(o: { signerId: string; secretKey: string; receiverId: string; actions: LocalAction[] }): Promise<Signed> {
  const publicKey = publicKeyOf(o.secretKey);
  const [key, block] = await Promise.all([
    viewAccessKey(o.signerId, publicKey),
    rpc<{ header: { hash: string } }>("block", { finality: "final" }),
  ]);
  if (!key) throw new Error(`${publicKey} is not an access key on ${o.signerId}: the account does not exist yet, or this key was never added to it (or was removed)`);
  const tx: LocalTx = { signerId: o.signerId, publicKey, nonce: BigInt(key.nonce) + 1n, receiverId: o.receiverId, blockHash: base58Decode(block.header.hash), actions: o.actions };
  const { signed, hash } = signTransaction(tx, o.secretKey);
  return { hash, base64: btoa(Array.from(signed, (c) => String.fromCharCode(c)).join("")) };
}

/** The transaction's outcome by hash, or null when the chain does not know it after `lookup.tries` reads. */
async function findByHash(hash: string, signerId: string, lookup: Lookup): Promise<Outcome | null> {
  for (let i = 0; i < lookup.tries; i++) {
    try {
      const o = await rpc<Outcome>("tx", { tx_hash: hash, sender_account_id: signerId, wait_until: "EXECUTED_OPTIMISTIC" });
      if (o && (o.status || o.receipts_outcome)) return o;
    } catch {
      // not known yet (UNKNOWN_TRANSACTION) or the node is behind: read again
    }
    if (i < lookup.tries - 1) await sleep(lookup.waitMs);
  }
  return null;
}

const result = (hash: string, outcome: Outcome): LocalTxResult => {
  const failure = firstFailure(outcome);
  return failure === undefined ? { hash, outcome } : { hash, failure, outcome };
};

/**
 * Signs with this browser's key and broadcasts. When the answer is lost or refused (a timeout, a duplicate the network
 * already applied, SignerDoesNotExist after a DeleteAccount that landed), the transaction is looked up by its hash before
 * anything else: it is never sent twice. Only a stale nonce with nothing on chain under that hash is signed once more.
 * A transaction that executes and fails returns `failure`.
 */
export async function sendLocalTx(o: { signerId: string; secretKey: string; receiverId: string; actions: LocalAction[]; waitUntil?: "INCLUDED" | "EXECUTED_OPTIMISTIC" | "FINAL"; lookup?: Lookup }): Promise<LocalTxResult> {
  const waitUntil = o.waitUntil ?? "EXECUTED_OPTIMISTIC";
  const lookup = o.lookup ?? LOOKUP;
  const send = (t: Signed) => rpc<Outcome>("send_tx", { signed_tx_base64: t.base64, wait_until: waitUntil });
  let t = await signFresh(o);
  try {
    return result(t.hash, await send(t));
  } catch (e) {
    const landed = await findByHash(t.hash, o.signerId, lookup);
    if (landed) return result(t.hash, landed);
    if (!INVALID_NONCE.test(String((e as Error)?.message ?? e))) throw e;
  }
  t = await signFresh(o);
  try {
    return result(t.hash, await send(t));
  } catch (e) {
    const landed = await findByHash(t.hash, o.signerId, lookup);
    if (landed) return result(t.hash, landed);
    throw e;
  }
}
