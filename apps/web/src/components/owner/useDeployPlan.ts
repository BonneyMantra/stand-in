import { useCallback, useEffect, useRef, useState } from "react";
import { CodeMismatch, loadGuardianCode, quoteStorage, viewAccount, type AccountView, type GuardianCode, type StorageQuote } from "@/lib/wallet/guardianCode";

export type DeployPlan =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error: string; mismatch: boolean }
  | { status: "ready"; code: GuardianCode; account: AccountView; quote: StorageQuote };

/** Loads the pinned guardian code (hash-checked in this browser) and the account's balance, for a deploy from the wallet. */
export function useDeployPlan(accountId: string | null) {
  const [plan, setPlan] = useState<DeployPlan>({ status: "idle" });
  const seq = useRef(0);

  const reload = useCallback(async () => {
    if (!accountId) { setPlan({ status: "idle" }); return; }
    const n = ++seq.current;
    setPlan({ status: "loading" });
    try {
      const [code, account] = await Promise.all([loadGuardianCode(), viewAccount(accountId)]);
      if (n === seq.current) setPlan({ status: "ready", code, account, quote: quoteStorage(account) });
    } catch (e) {
      if (n === seq.current) setPlan({ status: "error", error: e instanceof Error ? e.message : String(e), mismatch: e instanceof CodeMismatch });
    }
  }, [accountId]);

  useEffect(() => { void reload(); }, [reload]);
  return { plan, reload };
}
