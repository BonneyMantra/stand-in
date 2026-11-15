import { useMemo } from "react";
import { useMyAccount } from "@/data/useMyAccount";
import { decoysOf, freezesOf } from "@/data/accountDerive";
import { activityTxs, useActivity } from "@/data/useActivity";
import { useTheftTxs } from "@/data/useTheftTxs";
import { useWallet } from "@/components/owner/WalletProvider";
import { useOwnerTx } from "@/components/owner/useOwnerTx";
import { useConsoleActions } from "@/components/owner/useConsoleActions";
import { useHomePlan } from "@/components/owner/useHomePlan";
import { useHomeTools } from "@/components/owner/useHomeTools";

/**
 * Everything the My account pages derive and do: decoys and freezes from the snapshot, indexed transactions, the home's
 * missing part (one wallet approval) and its tools (add a decoy, export, import).
 */
export function useAccountTools() {
  const w = useWallet();
  const m = useMyAccount();
  const s = m.snapshot;
  const tx = useOwnerTx(w.wallet, w.accountId, m.refresh);
  const actions = useConsoleActions(w, tx, null, m.refreshSoon);
  const watched = useMemo(() => (s ? s.guardians.filter((g) => g.state.watcher === s.watcher.id).map((g) => g.id) : []), [s]);
  // The home is made for the guardian it watches: the stored one, else the first guardian watched by watch.<owner>.
  const homeGuardian = m.home?.guardians[0] ?? watched[0] ?? null;
  const needsPlan = !!s && !m.eth && !!homeGuardian && !!m.summary && (m.summary.bait !== "held" || m.summary.watcher !== "held");
  const { read: planRead } = useHomePlan(needsPlan ? m.owner : null, homeGuardian, actions.homeKey);
  const plan = planRead.status === "ready" ? planRead.plan : null;
  const tools = useHomeTools(m.owner, watched, m.refreshSoon);
  const freezes = useMemo(() => (s ? freezesOf(s.guardians) : []), [s]);
  const decoys = useMemo(() => (s ? decoysOf(s.bait, m.home, freezes) : []), [s, m.home, freezes]);
  const thefts = useTheftTxs(freezes, m.owner);
  const accounts = useMemo(() => (s ? [...s.guardians.map((g) => g.id), ...(s.bait.exists ? [s.bait.id] : []), ...(s.watcher.exists ? [s.watcher.id] : [])] : []), [s]);
  const freezeCount = freezes.length;
  const activity = useActivity(accounts, freezeCount + (m.home?.txs.length ?? 0));
  return {
    plan, tools, freezes, decoys, thefts, activity, activityTxs: activityTxs(activity.read),
    busy: tx.busy, log: tx.log, createHome: actions.createHome,
  };
}
