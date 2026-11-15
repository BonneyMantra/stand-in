import { GuardianState } from "../wallet/near";
import type { Journal } from "./journal";
import { blockHeight, txStatus, viewAccessKey, viewAccount, viewFunction, type Rpc } from "./rpc";

/** What the chain says about a run whose tab closed before it finished. Every line is read now, not remembered. */
export interface Interrupted {
  lines: { tone: "safe" | "trip" | "warn" | "muted"; text: string; tx?: string }[];
  theftLanded: boolean;
  frozenByRun: boolean;
  frozen: boolean;
  decoyOnBait: boolean;
  /** The throwaway thief account still exists: deleting it returns everything it holds to the bait. */
  thiefExists: boolean;
}

const fmt = (y: bigint) => (Number((y * 1000n) / 10n ** 24n) / 1000).toFixed(3);

export async function assessInterrupted(rpc: Rpc, j: Journal): Promise<Interrupted> {
  const lines: Interrupted["lines"] = [];
  const [decoy, theft, stateRaw, thief] = await Promise.all([
    j.decoy_pk ? viewAccessKey(rpc, j.bait, j.decoy_pk) : Promise.resolve(null),
    j.tx.theft ? txStatus(rpc, j.tx.theft, j.bait) : Promise.resolve(null),
    viewFunction<unknown>(rpc, j.guardian, "get_state").catch(() => null),
    viewAccount(rpc, j.thief.account),
  ]);
  const st = GuardianState.safeParse(stateRaw);
  const state = st.success ? st.data : null;
  lines.push({ tone: "muted", text: `This tab closed or reloaded during "${j.current ?? "the run"}" of the run started ${new Date(j.started_at).toLocaleTimeString()}. Nothing ran while it was closed.` });

  if (!j.decoy_pk || !j.tx["plant decoy"]) lines.push({ tone: "muted", text: "No decoy was planted." });
  else if (decoy) lines.push({ tone: "warn", text: `The decoy key is still on ${j.bait}.`, tx: j.tx["plant decoy"] });
  else lines.push({ tone: "muted", text: `The decoy key is no longer on ${j.bait}.`, tx: j.tx["plant decoy"] });

  let theftLanded = false;
  if (!j.tx.theft) lines.push({ tone: "muted", text: "The thief's transaction was never signed." });
  else if (!theft) lines.push({ tone: "muted", text: "The thief's transaction was signed but no node knows it: it was not sent, or it expired." });
  else {
    theftLanded = true;
    const h = await blockHeight(rpc, theft.transaction_outcome.block_hash).catch(() => null);
    lines.push({ tone: "trip", text: `The theft landed${h ? ` in block ${h.toLocaleString("en-US")}` : ""}: the decoy signed a transfer from ${j.bait} to ${j.thief.account.slice(0, 12)}….`, tx: j.tx.theft });
  }

  const rec = state?.freeze_log.slice().reverse().find((r) => j.decoy_pk && r.decoy_public_key === j.decoy_pk) ?? null;
  const frozenByRun = !!rec;
  if (!state) lines.push({ tone: "warn", text: `Could not read get_state on ${j.guardian}.` });
  else if (rec) {
    const byTab = /^tab watcher:/.test(rec.reason);
    lines.push({ tone: "safe", text: `${j.guardian} was frozen at block ${Number(rec.at_block).toLocaleString("en-US")} by ${rec.by}${byTab ? " (a tab watcher)" : " (another watcher with this key, such as your CLI)"}.${state.frozen ? " It is still frozen." : " It has since been unfrozen."}`, tx: j.tx.freeze });
  } else if (theftLanded) {
    lines.push({ tone: "trip", text: `${j.guardian} was NOT frozen for this theft: no record in its freeze log names this decoy${state.frozen ? " (it is frozen by an earlier record)" : ""}. Nothing watches while this tab is closed; the CLI watcher (standin dev up --home DIR) does.` });
  } else {
    lines.push({ tone: "muted", text: `${j.guardian} is ${state.frozen ? "frozen" : "not frozen"}.` });
  }
  if (thief) lines.push({ tone: "warn", text: `The thief account still exists and holds ${fmt(thief.amount)} NEAR; deleting it returns all of it to the bait.` });
  return { lines, theftLanded, frozenByRun, frozen: !!state?.frozen, decoyOnBait: !!decoy, thiefExists: !!thief };
}
