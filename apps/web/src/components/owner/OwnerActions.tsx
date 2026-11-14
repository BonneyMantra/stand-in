import { useState } from "react";
import { Snowflake, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/app/common";
import { cn } from "@/lib/utils";
import type { GuardianState } from "@/lib/wallet/near";

const MAX_REASON = 500;
const bytes = (s: string) => new TextEncoder().encode(s).length;

/** Freeze (reason, ≤500 bytes) and Unfreeze, each one wallet-signed transaction from the account to itself. */
export function OwnerActions({ state, busy, onFreeze, onUnfreeze }: {
  state: GuardianState; busy: boolean; onFreeze: (reason: string) => void; onUnfreeze: () => void;
}) {
  const [reason, setReason] = useState("");
  const used = bytes(reason);
  const tooLong = used > MAX_REASON;
  const canFreeze = !state.frozen && !busy && reason.trim().length > 0 && !tooLong;
  return (
    <Panel title="Owner actions" icon={Snowflake} id="owner-actions-title" meta="signed by your wallet">
      <div className="space-y-4 p-3.5">
        <div className="space-y-2">
          <label htmlFor="freeze-reason" className="flex items-baseline justify-between text-xs">
            <span className="font-medium text-fg">Freeze now</span>
            <span className={cn("font-mono text-[11px]", tooLong ? "text-trip" : "text-fg-faint")}>{used}/{MAX_REASON}</span>
          </label>
          <textarea
            id="freeze-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} disabled={state.frozen || busy}
            placeholder="Why: e.g. agent session on build-03 pasted a key into a PR comment"
            aria-invalid={tooLong}
            className="block w-full resize-none rounded-md border border-line-strong bg-ink-900 px-2.5 py-2 text-[13px] text-fg outline-none placeholder:text-fg-faint focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 aria-invalid:border-trip/60"
          />
          <p className="text-[11px] leading-relaxed text-fg-faint">
            Deletes every agent key and removes every intents key in one transaction. Your own full-access key stays.
          </p>
          <Button
            size="sm" onClick={() => onFreeze(reason.trim())} disabled={!canFreeze}
            className="w-full border border-trip/40 bg-trip-soft text-trip hover:bg-trip/20"
          >
            <Snowflake aria-hidden />{state.frozen ? "Already frozen" : "Freeze account"}
          </Button>
        </div>
        <div className="space-y-2 border-t border-line pt-4">
          <p className="text-xs font-medium text-fg">Unfreeze</p>
          <p className="text-[11px] leading-relaxed text-fg-faint">
            Owner only. Re-enables adding agent and intents keys; it does not restore the deleted ones.
          </p>
          <Button variant="line" size="sm" onClick={onUnfreeze} disabled={!state.frozen || busy} className="w-full">
            <Sun aria-hidden />{state.frozen ? "Unfreeze account" : "Not frozen"}
          </Button>
        </div>
      </div>
    </Panel>
  );
}
