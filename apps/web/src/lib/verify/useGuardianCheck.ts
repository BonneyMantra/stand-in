import { useCallback, useRef, useState } from "react";
import { loadGuardianCode, CodeMismatch } from "../wallet/guardianCode";
import { checkGuardian, findFreezeTx, verifyRpc, type CheckResult } from "./guardian";

export type GuardianCheckState =
  | { status: "idle" }
  | { status: "loading"; account: string }
  | { status: "ok"; account: string; result: CheckResult; at: Date }
  | { status: "error"; account: string; message: string };

/** Per freeze record (keyed by at_block): the transaction found for it, null when none, or still looking. */
export type FreezeTxs = Record<string, string | null | "loading" | "unreachable">;

export type ServedWasm = { status: "idle" | "loading" } | { status: "ok"; hash: string } | { status: "mismatch" | "error"; message: string };

const FREEZE_LOOKUPS = 6;

export function useGuardianCheck() {
  const [state, setState] = useState<GuardianCheckState>({ status: "idle" });
  const [freezeTxs, setFreezeTxs] = useState<FreezeTxs>({});
  const [served, setServed] = useState<ServedWasm>({ status: "idle" });
  const gen = useRef(0);

  const hashServed = useCallback(async () => {
    setServed({ status: "loading" });
    try {
      setServed({ status: "ok", hash: (await loadGuardianCode()).hash });
    } catch (e) {
      setServed({ status: e instanceof CodeMismatch ? "mismatch" : "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  const check = useCallback(async (raw: string) => {
    const account = raw.trim().toLowerCase();
    const g = ++gen.current;
    setState({ status: "loading", account });
    setFreezeTxs({});
    let result: CheckResult;
    try {
      result = await checkGuardian(account);
    } catch (e) {
      if (g === gen.current) setState({ status: "error", account, message: e instanceof Error ? e.message : String(e) });
      return;
    }
    if (g !== gen.current) return;
    setState({ status: "ok", account, result, at: new Date() });
    if (result.kind !== "guardian") return;
    if (served.status === "idle") void hashServed();
    // The newest records first, one at a time: each lookup is a few RPC calls.
    const recent = result.state.freeze_log.slice(-FREEZE_LOOKUPS).reverse();
    setFreezeTxs(Object.fromEntries(recent.map((r) => [r.at_block, "loading" as const])));
    for (const r of recent) {
      let found: string | null | "unreachable";
      try {
        found = await findFreezeTx(account, r.by, Number(r.at_block), verifyRpc);
      } catch {
        found = "unreachable";
      }
      if (g !== gen.current) return;
      setFreezeTxs((m) => ({ ...m, [r.at_block]: found }));
    }
  }, [served.status, hashServed]);

  return { state, freezeTxs, served, check };
}
