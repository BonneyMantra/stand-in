import { GuardianState } from "../wallet/near";
import { firstFailure, sendLocalTx } from "../wallet/localSigner";
import { act, KeySigner } from "./sign";
import { blockHeight, viewAccessKey, viewAccount, viewFunction, waitExecuted, type Rpc, type TxView } from "./rpc";
import { REGISTRY, REPORT_DEPOSIT } from "./preflight";

export const MY_STEPS = ["check", "plant", "arm", "theft", "detect", "freeze", "readback", "blocklist", "incident", "cleanup"] as const;
export type MyStepId = (typeof MY_STEPS)[number];

export const MY_LABELS: Record<MyStepId, string> = {
  check: "Check your guardian and home",
  plant: "Plant a fresh decoy on your bait",
  arm: "Your tab watcher reads the decoy",
  theft: "Thief spends with the decoy",
  detect: "Your watcher sees the decoy used",
  freeze: "Your watcher freezes your guardian",
  readback: "Read the freeze back from chain",
  blocklist: "Blocklist the thief",
  incident: "Incident report",
  cleanup: "Return the loot, delete the decoy",
};

export const INCIDENT_CLI = "CLI only. With your own NEARAI_API_KEY, standin dev up --home DIR writes a private, attested incident report when your CLI watcher handles a trip. This page never uses the project's NEAR AI key.";

const failureOf = (t: TxView) => firstFailure(t as Parameters<typeof firstFailure>[0]);

/** Inclusion block of a transaction once it executed, and its failure text if a receipt failed (never throws for that). */
export async function included(rpc: Rpc, hash: string, signer: string, ms = 60_000): Promise<{ block: number; failure?: string }> {
  const tx = await waitExecuted(rpc, hash, signer, ms);
  return { block: await blockHeight(rpc, tx.transaction_outcome.block_hash), failure: failureOf(tx) };
}

/** Inclusion block of a transaction that executed; throws with the contract's text when it failed. */
export async function landed(rpc: Rpc, hash: string, signer: string, ms = 60_000): Promise<{ block: number; tx: TxView }> {
  const tx = await waitExecuted(rpc, hash, signer, ms);
  const block = await blockHeight(rpc, tx.transaction_outcome.block_hash);
  const failure = failureOf(tx);
  if (failure) throw Object.assign(new Error(failure), { hash, block });
  return { block, tx };
}

export interface Readback {
  frozen: boolean;
  by: string | null;
  atBlock: number | null;
  reason: string | null;
  decoyMatches: boolean;
  theftTx: string | null;
  deleted: { key: string; gone: boolean }[];
  intentsRemoved: string[];
  agentKeysLeft: number;
}

/** get_state after the freeze: the newest freeze record, and each key it says it deleted, checked with view_access_key. */
export async function readBack(rpc: Rpc, guardian: string, decoyPk: string): Promise<Readback> {
  const st = GuardianState.parse(await viewFunction(rpc, guardian, "get_state"));
  const rec = st.freeze_log.at(-1) ?? null;
  const deleted = await Promise.all((rec?.deleted_keys ?? []).map(async (key) => ({ key, gone: (await viewAccessKey(rpc, guardian, key)) === null })));
  return {
    frozen: st.frozen, by: rec?.by ?? null, atBlock: rec ? Number(rec.at_block) : null, reason: rec?.reason ?? null,
    decoyMatches: rec?.decoy_public_key === decoyPk, theftTx: rec?.tx_hash ?? null, deleted,
    intentsRemoved: rec?.intents_keys_removed ?? [], agentKeysLeft: st.agent_keys.length,
  };
}

export interface ReportResult { hash: string; verdict: string | null; block: number }

/** registry.report signed by a full-access watcher key (300 TGas, 0.05 NEAR deposit), as the CLI watcher files it. */
export async function fileReport(rpc: Rpc, watcher: KeySigner, o: { theftTx: string; bait: string; adminPk: string; thief: string }, onSigned: (h: string) => void): Promise<ReportResult> {
  const args = { tx_hash: o.theftTx, decoy_account_id: o.bait, sender_id: o.bait, admin_public_key: o.adminPk };
  const hash = await watcher.broadcast(REGISTRY, [act.call("report", args, 300n, REPORT_DEPOSIT)], onSigned);
  // The report finishes only after OutLayer resumes it with a verdict: allow a few minutes.
  const { block } = await landed(rpc, hash, watcher.accountId, 240_000);
  const v = await viewFunction<{ verdict?: string }>(rpc, REGISTRY, "check", { account_id: o.thief }).catch(() => null);
  return { hash, verdict: v?.verdict ?? null, block };
}

const fmtNear = (y: bigint) => (Number((y * 10_000n) / 10n ** 24n) / 10_000).toFixed(4);

export interface CleanStep { label: string; hash?: string; error?: string; detail?: string }

/**
 * The thief deletes its own throwaway account with the bait as beneficiary, so everything it took comes back (read back: the
 * thief account no longer exists, and what the bait received); then the bait's key deletes the used decoy.
 */
export async function cleanUp(rpc: Rpc, o: { bait: KeySigner; thief: { account: string; secret: string }; decoyPk: string | null; stole: boolean }, onSigned: (label: string, h: string) => void): Promise<CleanStep[]> {
  const out: CleanStep[] = [];
  if (o.stole) {
    try {
      const [thiefBefore, baitBefore] = await Promise.all([viewAccount(rpc, o.thief.account), viewAccount(rpc, o.bait.accountId)]);
      if (!thiefBefore) {
        out.push({ label: "return loot", error: "the thief account no longer exists" });
      } else {
        const r = await sendLocalTx({ signerId: o.thief.account, secretKey: o.thief.secret, receiverId: o.thief.account, actions: [{ type: "DeleteAccount", beneficiaryId: o.bait.accountId }] });
        onSigned("return loot", r.hash);
        if (r.failure) {
          out.push({ label: "return loot", hash: r.hash, error: r.failure });
        } else {
          const [thiefAfter, baitAfter] = await Promise.all([viewAccount(rpc, o.thief.account), viewAccount(rpc, o.bait.accountId)]);
          const got = baitAfter && baitBefore ? baitAfter.amount - baitBefore.amount : null;
          out.push({
            label: "return loot", hash: r.hash,
            detail: `${thiefAfter ? "the thief account still exists" : "the thief account is deleted"}; the bait received ${got !== null ? fmtNear(got) : "?"} NEAR of the ${fmtNear(thiefBefore.amount)} it held`,
          });
        }
      }
    } catch (e) {
      out.push({ label: "return loot", error: (e as Error).message });
    }
  }
  if (o.decoyPk) {
    const pk = o.decoyPk;
    try {
      if (!(await viewAccessKey(rpc, o.bait.accountId, pk))) out.push({ label: "delete decoy", error: "already gone" });
      else {
        const h = await o.bait.broadcast(o.bait.accountId, [act.deleteKey(pk)], (x) => onSigned("delete decoy", x));
        await landed(rpc, h, o.bait.accountId);
        out.push({ label: "delete decoy", hash: h });
      }
    } catch (e) {
      out.push({ label: "delete decoy", error: (e as Error).message });
    }
  }
  return out;
}
