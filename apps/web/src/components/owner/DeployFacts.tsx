import { CircleAlert, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyText, ExtLink, Shimmer, Tag } from "@/components/app/common";
import { shortKey } from "@/data/derive";
import { explorerAccount, yoctoToNear } from "@/lib/wallet/near";
import { CODE_SOURCE, FAUCET_URL, GUARDIAN_CODE_HASH, nearShort } from "@/lib/wallet/guardianCode";
import { ownsWatcher } from "@/lib/wallet/homeAccounts";
import { Row } from "./ApprovePanel";
import type { DeployPlan } from "./useDeployPlan";

/** What a deploy from the wallet puts on the account, in plain words: code, hash, owner, watcher, storage and balance. */
export function DeployFacts({ accountId, watcher, intents, plan, onReload, watcherInRequest = false }: {
  accountId: string; watcher: string; intents: string; plan: DeployPlan; onReload: () => void; watcherInRequest?: boolean;
}) {
  return (
    <div data-testid="deploy-facts">
      <dl className="divide-y divide-line px-3.5 py-1">
        <Row k="deploys">
          <span className="font-sans text-fg">Stand-in guardian contract</span>
          <span className="text-fg-faint [word-break:normal] [overflow-wrap:anywhere]"> · {plan.status === "ready" ? `${plan.code.bytes.length.toLocaleString("en-US")} bytes` : "wasm"} · on {accountId} itself</span>
        </Row>
        <Row k="code hash">
          <CopyText value={GUARDIAN_CODE_HASH} display={<span data-testid="deploy-hash">{shortKey(GUARDIAN_CODE_HASH, 10, 8)}</span>} />
          {plan.status === "ready" && <Tag tone="safe" className="ml-2">checked here</Tag>}
          <p className="mt-1 font-sans text-[11px] leading-relaxed text-fg-muted [word-break:normal] [overflow-wrap:anywhere]">
            Byte-identical to the guardian on <ExtLink href={explorerAccount(CODE_SOURCE)}>{CODE_SOURCE}</ExtLink>: compare its{" "}
            <code className="font-mono">view_account</code> code_hash. This page hashed the file (sha256) before offering it.
          </p>
        </Row>
        <Row k="owner">{accountId} <span className="font-sans text-fg-faint [word-break:normal] [overflow-wrap:anywhere]">(the account itself: only your wallet can unfreeze)</span></Row>
        <Row k="watcher">
          <span data-testid="deploy-watcher">{watcher}</span>
          <p className="mt-1 font-sans text-[11px] leading-relaxed text-fg-muted [word-break:normal] [overflow-wrap:anywhere]">
            Can freeze this account when a decoy key is used. It can never unfreeze, add keys or move funds.
            {watcherInRequest ? <> It is your own account, created in this same request with a key your CLI generated; <code className="font-mono">standin dev up</code> runs it.</>
              : ownsWatcher(accountId, watcher) ? <> It is your own account: <code className="font-mono">standin adopt --wallet</code> creates it with a key that stays on your machine, and runs it. Until then, only you can freeze.</> : null}
          </p>
        </Row>
        <Row k="intents registry">{intents}</Row>
        <Row k="storage"><Storage plan={plan} onReload={onReload} /></Row>
      </dl>
      {plan.status === "error" && (
        <p className="flex items-start gap-2 border-t border-line px-3.5 py-2.5 text-xs text-trip" data-testid="deploy-plan-error">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{plan.mismatch ? plan.error : `Could not prepare the deploy: ${plan.error}`}</span>
        </p>
      )}
    </div>
  );
}

function Storage({ plan, onReload }: { plan: DeployPlan; onReload: () => void }) {
  if (plan.status !== "ready") {
    return plan.status === "error" ? <span className="font-sans text-fg-faint">unknown</span> : <Shimmer className="h-4 w-40" />;
  }
  const { quote } = plan;
  return (
    <div className="space-y-1 font-sans [word-break:normal] [overflow-wrap:anywhere]">
      <p className="text-fg">
        About <span className="font-mono">{nearShort(quote.codeStorage)} NEAR</span> stays locked for storage while the guardian is deployed.
      </p>
      <p className="text-[11px] text-fg-muted">
        Balance <span className="font-mono text-fg" data-testid="deploy-balance">{nearShort(quote.balance, 3)} NEAR</span> · needed with gas{" "}
        <span className="font-mono text-fg">{nearShort(quote.required, 3)} NEAR</span>
      </p>
      {quote.shortfall > 0n && (
        <div className="space-y-1.5 rounded-md border border-warn/30 bg-warn/10 px-2.5 py-2 text-[11px] text-warn" data-testid="deploy-shortfall">
          <p>
            Short by <span className="font-mono">{yoctoToNear(quote.shortfall).slice(0, 8)} NEAR</span>. Add testnet NEAR from the{" "}
            <ExtLink href={FAUCET_URL}>testnet faucet</ExtLink>, then read the balance again.
          </p>
          <Button variant="line" size="xs" onClick={onReload}><RefreshCw aria-hidden />Read balance again</Button>
        </div>
      )}
    </div>
  );
}
