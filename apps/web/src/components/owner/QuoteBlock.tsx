import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExtLink } from "@/components/app/common";
import { FAUCET_URL, nearShort } from "@/lib/wallet/guardianCode";
import type { Quote } from "@/lib/wallet/funding";

/**
 * Exactly what one wallet request will spend, line by line, before it is offered for signing, against the signer's
 * balance. Every line comes from packages/core/src/funding.ts, the module `standin adopt` prints the same quote from.
 * This site never funds an account: a shortfall points to the testnet faucet.
 */
export function QuoteBlock({ quote, signerId, balance, onReload, testid = "quote" }: {
  quote: Quote; signerId: string; balance: bigint; onReload?: () => void; testid?: string;
}) {
  const short = balance >= quote.total ? 0n : quote.total - balance;
  return (
    <div className="space-y-1.5 text-xs [overflow-wrap:anywhere]" data-testid={testid}>
      <ul className="space-y-1">
        {quote.lines.filter((l) => l.yocto > 0n).map((l) => (
          <li key={l.label} className="flex gap-2 text-[11px] leading-relaxed text-fg-muted">
            <span className="w-[68px] shrink-0 text-right font-mono text-fg">{nearShort(l.yocto, 3)}</span>
            <span className="min-w-0"><span className="text-fg">{l.label}</span>: {l.why}</span>
          </li>
        ))}
      </ul>
      <p className="flex gap-2 border-t border-line pt-1.5 text-fg">
        <span className="w-[68px] shrink-0 text-right font-mono" data-testid={`${testid}-total`}>{nearShort(quote.total, 3)}</span>
        <span className="min-w-0">NEAR in total; <span className="font-mono">{signerId}</span> holds <span className="font-mono" data-testid={`${testid}-balance`}>{nearShort(balance, 3)} NEAR</span>.</span>
      </p>
      <p className="text-[11px] text-fg-faint">Most of it stays yours: storage stays locked on your own accounts, unused gas comes back. Same numbers as <code className="font-mono">standin adopt</code> (packages/core/src/funding.ts).</p>
      {short > 0n && (
        <div className="space-y-1.5 rounded-md border border-warn/30 bg-warn/10 px-2.5 py-2 text-[11px] text-warn" data-testid={`${testid}-shortfall`}>
          <p>Short by <span className="font-mono">{nearShort(short, 3)} NEAR</span>, so nothing is offered for signing. Get testnet NEAR from the <ExtLink href={FAUCET_URL}>testnet faucet</ExtLink>, then read the balance again.</p>
          {onReload && <Button variant="line" size="xs" onClick={onReload}><RefreshCw aria-hidden />Read balance again</Button>}
        </div>
      )}
    </div>
  );
}
