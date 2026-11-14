import { useEffect, useState } from "react";
import { ArrowDownToLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel, Shimmer } from "@/components/app/common";
import { nearShort } from "@/lib/wallet/guardianCode";
import { withdrawable } from "@/lib/wallet/factory";
import { YOCTO_PER_NEAR } from "@/lib/wallet/near";

/** "1.25" NEAR -> yocto; null when not a positive amount with at most 24 decimals. */
export function parseNear(v: string): bigint | null {
  const m = v.trim().match(/^(\d{1,9})(?:\.(\d{1,24}))?$/);
  if (!m) return null;
  const y = BigInt(m[1]!) * YOCTO_PER_NEAR + BigInt((m[2] ?? "").padEnd(24, "0") || "0");
  return y > 0n ? y : null;
}

/** Owner-only withdraw from a factory guardian: never below the storage reserve; allowed while frozen. */
export function WithdrawPanel({ guardianId, ownerId, busy, reloadKey, onWithdraw }: {
  guardianId: string; ownerId: string; busy: boolean; reloadKey: number; onWithdraw: (yocto: bigint) => void;
}) {
  const [free, setFree] = useState<bigint | null | "error">(null);
  const [amount, setAmount] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    setFree(null);
    setAmount("");
    withdrawable(guardianId).then((v) => alive && setFree(v), () => alive && setFree("error"));
    return () => { alive = false; };
  }, [guardianId, reloadKey, retry]);
  const y = parseNear(amount);
  const over = y !== null && typeof free === "bigint" && y > free;
  const bad = !!amount.trim() && y === null;
  return (
    <Panel title="Withdraw" icon={ArrowDownToLine} id="withdraw-title" meta="to the owner">
      <div className="space-y-2 p-3.5 text-xs">
        <p className="leading-relaxed text-fg-muted">
          Sends NEAR from the guardian account to <span className="font-mono break-all text-fg">{ownerId}</span>. The storage reserve (1 NEAR per
          100 kB of code and state) stays locked. Allowed while frozen.
        </p>
        {free === "error" ? (
          <p className="text-trip" data-testid="withdrawable-error">
            Could not read the guardian's balance from testnet.{" "}
            <button type="button" onClick={() => setRetry((n) => n + 1)} className="text-fg underline underline-offset-4">Try again</button>
          </p>
        ) : (
          <p className="text-fg-muted">Withdrawable now: {free === null ? <Shimmer className="inline-block h-3 w-16 align-middle" /> : <span className="font-mono text-fg" data-testid="withdrawable">{nearShort(free, 4)} NEAR</span>}</p>
        )}
        <div className="flex gap-2">
          <label htmlFor="withdraw-amount" className="sr-only">Amount in NEAR</label>
          <input id="withdraw-amount" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.1" inputMode="decimal" aria-invalid={over || bad}
            className="block min-w-0 flex-1 rounded-md border border-line-strong bg-ink-900 px-2.5 py-1.5 font-mono text-[13px] text-fg outline-none placeholder:text-fg-faint focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-trip/60" />
          <Button variant="line" size="sm" disabled={busy || y === null || over || typeof free !== "bigint"} onClick={() => y !== null && onWithdraw(y)}>
            <ArrowDownToLine aria-hidden />Withdraw
          </Button>
        </div>
        {over && <p className="text-trip">More than the withdrawable balance.</p>}
        {bad && <p className="text-trip">Enter an amount in NEAR, for example 0.1 (up to 24 decimals).</p>}
      </div>
    </Panel>
  );
}
