// Relative import (not "@/"), so the vitest suite can load this module without the Vite alias.
import { rpc, viewCall } from "../../lib/verify/rpc";
import { BLOCKLIST as B } from "./proof-data";

/**
 * The landing's counterparty check, read live from NEAR testnet in the visitor's browser: the blocklist
 * registry's `check(account_id)` view (the same call `standin pay` makes) and whether the account exists.
 * Account age and contract-code history need archival RPC and stay with the CLI.
 */

const NEAR_ID = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export type Verdict =
  | { kind: "block"; live: boolean }
  | { kind: "listed"; account: string; reason: string }
  | { kind: "clear"; account: string; exists: boolean | null }
  | { kind: "checking"; account: string }
  | { kind: "unreachable"; account: string }
  | { kind: "invalid"; input: string }
  | { kind: "empty" };

export type Parsed = { ok: true; account: string } | { ok: false; verdict: Verdict };

export function parseAccount(raw: string): Parsed {
  const a = raw.trim().toLowerCase();
  if (!a) return { ok: false, verdict: { kind: "empty" } };
  return NEAR_ID.test(a) ? { ok: true, account: a } : { ok: false, verdict: { kind: "invalid", input: raw.trim() } };
}

export async function checkOnChain(account: string): Promise<Verdict> {
  const reg = await viewCall("testnet", B.contract, "check", { account_id: account });
  if (!reg.ok) return account === B.thief ? { kind: "block", live: false } : { kind: "unreachable", account };
  let reply: { verdict?: string; reasons?: string[] } = {};
  try {
    reply = JSON.parse(reg.text) as typeof reply;
  } catch {
    return { kind: "unreachable", account };
  }
  if (reply.verdict === "block") {
    return account === B.thief ? { kind: "block", live: true } : { kind: "listed", account, reason: (reply.reasons ?? []).join("; ") };
  }
  // A final-state view_account is authoritative: a node that says "unknown account" is not asked again elsewhere.
  const acct = await rpc("testnet", "query", { request_type: "view_account", finality: "final", account_id: account }, { authoritative: true });
  const exists = acct.ok ? true : acct.reason === "not_found" ? false : null;
  return { kind: "clear", account, exists };
}
