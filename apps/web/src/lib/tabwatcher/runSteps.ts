import { GuardianState } from "../wallet/near";
import { firstFailure } from "../wallet/localSigner";
import { act, KeySigner } from "./sign";
import { blockHeight, spendable, viewAccessKey, viewAccount, viewFunction, waitExecuted, type Rpc, type TxView } from "./rpc";
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

export const INCIDENT_CLI = "CLI only. With your own NEARAI_API_KEY, `standin dev up --home DIR` writes a private, attested incident report when your CLI watcher handles a trip. This page never uses the project's NEAR AI key.";

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

/** The thief sends back what it can (its own storage stays locked) and the bait's key deletes the used decoy. */
export async function cleanUp(rpc: Rpc, o: { bait: KeySigner; thief: KeySigner; decoyPk: string | null; stole: boolean }, onSigned: (label: string, h: string) => void) {
  const out: { label: string; hash?: string; error?: string }[] = [];
  const jobs: Promise<void>[] = [];
  if (o.stole) {
    jobs.push((async () => {
      const a = await viewAccount(rpc, o.thief.accountId);
      const back = a ? spendable(a) - 500_000_000_000_000_000_000n : 0n; // keep 0.0005 NEAR for the transfer's gas (about 0.00005)
      if (back <= 0n) { out.push({ label: "return loot", error: "the thief account holds nothing to return" }); return; }
      const h = await o.thief.broadcast(o.bait.accountId, [act.transfer(back)], (x) => onSigned("return loot", x));
      await landed(rpc, h, o.thief.accountId);
      out.push({ label: "return loot", hash: h });
    })().catch((e) => { out.push({ label: "return loot", error: (e as Error).message }); }));
  }
  if (o.decoyPk) {
    const pk = o.decoyPk;
    jobs.push((async () => {
      if (!(await viewAccessKey(rpc, o.bait.accountId, pk))) { out.push({ label: "delete decoy", error: "already gone" }); return; }
      const h = await o.bait.broadcast(o.bait.accountId, [act.deleteKey(pk)], (x) => onSigned("delete decoy", x));
      await landed(rpc, h, o.bait.accountId);
      out.push({ label: "delete decoy", hash: h });
    })().catch((e) => { out.push({ label: "delete decoy", error: (e as Error).message }); }));
  }
  await Promise.all(jobs);
  return out;
}
