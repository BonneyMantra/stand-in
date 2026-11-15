import { CircleAlert, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyText, ExtLink, Shimmer, Tag } from "@/components/app/common";
import { shortKey } from "@/data/derive";
import { explorerAccount } from "@/lib/wallet/near";
import { FAUCET_URL, nearShort } from "@/lib/wallet/guardianCode";
import { adoptQuote, fundFor, type HomeAccountState } from "@/lib/wallet/homeAccounts";
import { Row } from "./ApprovePanel";
import type { HomeRead } from "./useHomeAccounts";

const ROLE = {
  bait: "Bait account. Every decoy your agents get is a key on it; a theft signs from here and trips the watcher.",
  watcher: "Watcher account. The guardian's watcher: it signs freeze and reports the thief to the blocklist; it can never unfreeze, add keys or move your funds.",
} as const;

const STATUS = {
  missing: <Tag tone="muted">created now</Tag>,
  ready: <Tag tone="safe">exists, your CLI's key</Tag>,
  conflict: <Tag tone="trip">exists without your CLI's key</Tag>,
} as const;

/**
 * The accounts an adopt link creates for this home, before anything is signed: who they are, what each receives, the
 * public key the CLI generated (the secret never left the CLI's machine), and the full quote against the signer's balance.
 * The quote comes from packages/core/src/funding.ts, the same code `standin adopt` prints it from.
 */
export function HomeAccountsFacts({ signerId, read, deployGuardian, txCount, batch, onReload }: {
  signerId: string; read: HomeRead; deployGuardian: boolean; txCount: number; batch: boolean; onReload: () => void;
}) {
  if (read.status === "idle") return null;
  if (read.status !== "ready") {
    return read.status === "error"
      ? <p className="flex items-start gap-2 px-3.5 py-2.5 text-xs text-trip" data-testid="home-error"><CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />Could not read the accounts from testnet: {read.error}</p>
      : <div className="space-y-2 px-3.5 py-3" aria-busy="true"><Shimmer className="h-4" /><Shimmer className="h-4 w-2/3" /></div>;
  }
  const creates = read.accounts.filter((a) => a.status === "missing").map((a) => a.role);
  const q = read.signer && (creates.length > 0 || deployGuardian) ? adoptQuote(read.signer, creates, deployGuardian) : null;
  return (
    <div data-testid="home-accounts">
      <dl className="divide-y divide-line px-3.5 py-1">
        {read.accounts.map((a) => <AccountRow key={a.accountId} a={a} />)}
        {q && read.signer && (
          <Row k="before you sign">
            <div className="space-y-1.5 font-sans [word-break:normal] [overflow-wrap:anywhere]" data-testid="home-quote">
              <ul className="space-y-1">
                {q.lines.filter((l) => l.yocto > 0n).map((l) => (
                  <li key={l.label} className="text-[11px] leading-relaxed text-fg-muted">
                    <span className="font-mono text-fg">{nearShort(l.yocto, 3)} NEAR</span> {l.label}: {l.why}
                  </li>
                ))}
              </ul>
              <p className="text-fg">
                Total <span className="font-mono" data-testid="home-total">{nearShort(q.total, 3)} NEAR</span>; {signerId} holds{" "}
                <span className="font-mono" data-testid="home-balance">{nearShort(read.signer.amount, 3)} NEAR</span>.
              </p>
              <p className="text-[11px] text-fg-faint">The same numbers `standin adopt` prints, from one shared module (packages/core/src/funding.ts).</p>
              {q.short > 0n && (
                <div className="space-y-1.5 rounded-md border border-warn/30 bg-warn/10 px-2.5 py-2 text-[11px] text-warn" data-testid="home-shortfall">
                  <p>Short by <span className="font-mono">{nearShort(q.short, 3)} NEAR</span>: nothing is offered for signing until it is covered. Add testnet NEAR from the <ExtLink href={FAUCET_URL}>testnet faucet</ExtLink>.</p>
                  <Button variant="line" size="xs" onClick={onReload}><RefreshCw aria-hidden />Read balance again</Button>
                </div>
              )}
            </div>
          </Row>
        )}
      </dl>
      {txCount > 1 && (
        <p className="border-t border-line px-3.5 py-2.5 text-[11px] leading-relaxed text-fg-muted" data-testid="batch-note">
          {batch
            ? <>Your wallet receives all {txCount} transactions in one request and asks once (Meteor and Intear show them on one approval screen). They are separate transactions: if one fails, the others still land, and this page shows what is still missing.</>
            : <>This wallet signs one transaction at a time, so it will ask {txCount} times. If you stop part-way, what landed stays; open this link again to finish the rest.</>}
        </p>
      )}
    </div>
  );
}

function AccountRow({ a }: { a: HomeAccountState }) {
  return (
    <Row k={a.role}>
      <span className="inline-flex flex-wrap items-center gap-2">
        <ExtLink href={explorerAccount(a.accountId)}>{a.accountId}</ExtLink>{STATUS[a.status]}
      </span>
      <p className="mt-1 font-sans text-[11px] leading-relaxed text-fg-muted [word-break:normal] [overflow-wrap:anywhere]">
        {ROLE[a.role]} {a.status === "missing" ? <>Gets {nearShort(fundFor(a.role), 2)} NEAR and one full-access key. </> : null}
        Its key was generated by your CLI, and the secret stays in the CLI's home: <CopyText value={a.publicKey} display={shortKey(a.publicKey, 8, 6)} />
      </p>
    </Row>
  );
}
