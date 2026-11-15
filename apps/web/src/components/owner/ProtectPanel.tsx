import { ShieldAlert, ShieldPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/app/common";
import { DEFAULT_INTENTS, type GuardianCode } from "@/lib/wallet/guardianCode";
import { watcherFor } from "@/lib/wallet/homeAccounts";
import { isEthAccount, type GuardianLookup } from "@/lib/wallet/near";
import { quoteAdopt } from "@/lib/wallet/funding";
import type { HomePlan } from "@/lib/wallet/homePlan";
import { DeployFacts } from "./DeployFacts";
import { useDeployPlan } from "./useDeployPlan";
import { useHomePlan } from "./useHomePlan";
import { HomeCreateRows } from "./HomeCreateRows";
import { QuoteBlock } from "./QuoteBlock";

export interface ProtectInit { watcher: string; intents_contract: string }

/**
 * "Protect this account": deploy the guardian from the connected wallet onto its own account, in one transaction
 * (DeployContract + new). Offered only for an account with no contract code.
 */
export function ProtectPanel({ accountId, lookup, busy, reloadKey, onDeploy }: {
  accountId: string; lookup: Exclude<GuardianLookup, { kind: "guardian" }>; busy: boolean; reloadKey: number;
  onDeploy: (code: GuardianCode, init: ProtectInit, home: HomePlan | null) => void;
}) {
  const eth = isEthAccount(accountId);
  const offer = lookup.kind === "no-contract" && !eth;
  const { plan, reload } = useDeployPlan(offer ? accountId : null);
  const home = useHomePlan(offer ? accountId : null, accountId, reloadKey);
  const watcher = watcherFor(accountId);

  if (!offer) {
    return (
      <Panel title="Protect this account" icon={ShieldAlert} id="protect-title" className="border-trip/30">
        <div className="space-y-2 p-3.5 text-xs" data-testid="protect-refused">
          {eth ? (
            <div className="space-y-2" data-testid="protect-eth">
              <p className="text-fg">
                <span className="font-mono break-all">{accountId}</span> is an Ethereum Wallets account. It already runs NEAR's Ethereum wallet
                contract, which is how your Ethereum key signs on NEAR. Deploying the guardian here would overwrite that contract, so this
                console will not offer it.
              </p>
              <p className="text-fg-muted">
                Use a guarded agent account instead (below): the guardian factory creates a new account for the agent with a guardian
                whose owner is this 0x account. Freeze, unfreeze, key approvals and withdrawals are then signed by this wallet through NEAR Connect.
              </p>
            </div>
          ) : lookup.kind === "not-guardian" ? (
            <p className="text-fg">
              <span className="font-mono">{accountId}</span> already runs a contract that is not a Stand-in guardian. Deploying the guardian would
              replace that contract and its behaviour, so this console will not offer it. Use a separate account for the agent.
            </p>
          ) : (
            <p className="text-fg"><span className="font-mono">{accountId}</span> does not exist on testnet, so there is nothing to protect yet.</p>
          )}
        </div>
      </Panel>
    );
  }

  const hp = home.read.status === "ready" && home.read.plan.kind === "plan" ? home.read.plan : null;
  const creates = hp ? (hp.create.bait ? 1 : 0) + (hp.create.watcher ? 1 : 0) : 0;
  const quote = plan.status === "ready"
    ? quoteAdopt({ storageBytes: plan.account.storageUsage, deployGuardian: true, createBait: !!hp?.create.bait, createWatcher: !!hp?.create.watcher, watcherFreezeOnly: true })
    : null;
  const ready = plan.status === "ready" && !!quote && plan.account.amount >= quote.total && home.read.status !== "loading";
  return (
    <Panel title="Protect this account" icon={ShieldPlus} id="protect-title" meta="guardian, bait and watcher in one approval" bodyClassName="p-0">
      <p className="px-3.5 pt-3 text-xs leading-relaxed text-fg-muted">
        No contract runs on <span className="font-mono text-fg">{accountId}</span>. One wallet approval deploys the Stand-in guardian on it and
        creates your own bait and watcher accounts, so a decoy key used by an agent freezes this account's agent keys. You stay the owner:
        only a transaction from this wallet can unfreeze.
      </p>
      <DeployFacts accountId={accountId} watcher={watcher} intents={DEFAULT_INTENTS} plan={plan} onReload={() => void reload()} watcherInRequest={!!hp?.create.watcher} browserKeys />
      <div className="border-t border-line">
        <p className="px-3.5 pt-2.5 text-[11px] text-fg-faint">Your bait and watcher</p>
        <HomeCreateRows owner={accountId} guardian={accountId} read={home.read} />
      </div>
      {quote && plan.status === "ready" && (
        <div className="border-t border-line px-3.5 py-3">
          <p className="mb-2 text-[11px] text-fg-faint">Before you sign: what this approval spends</p>
          <QuoteBlock quote={quote} signerId={accountId} balance={plan.account.amount} onReload={() => { void reload(); void home.reload(); }} testid="protect-quote" />
        </div>
      )}
      <div className="space-y-3 border-t border-line p-3.5">
        <p className="text-xs text-fg-muted">
          {creates ? <>{creates + 1} transactions in one wallet request, all from <span className="font-mono text-fg">{accountId}</span>:</> : <>One transaction from <span className="font-mono text-fg">{accountId}</span> to itself:</>}
          <span className="ml-1.5 font-mono text-fg">DeployContract + new</span>
          {hp?.create.bait && <span className="ml-1.5 font-mono text-fg">· create {`deployer.${accountId}`}</span>}
          {hp?.create.watcher && <span className="ml-1.5 font-mono text-fg">· create {`watch.${accountId}`}</span>}
        </p>
        {creates > 0 && (
          <p className="text-[11px] leading-relaxed text-fg-muted" data-testid="protect-batch-note">
            Wallets that sign batches (Meteor, Intear) ask once for all of them. They are separate transactions: if one fails, the others still
            land, and this page then offers only what is missing.
          </p>
        )}
        <p className="text-xs text-fg-muted" data-testid="protect-wallet-note">
          Meteor refuses contract deployment from any app (tested 15 Nov: "Meteor blocks this for apps"). With Meteor, use
          a guarded agent account below; it is one plain function call, and it creates the same bait and watcher.
        </p>
        <Button
          size="sm" variant="invert" className="w-full sm:w-auto" data-testid="protect-sign"
          disabled={busy || !ready} onClick={() => plan.status === "ready" && onDeploy(plan.code, { watcher, intents_contract: DEFAULT_INTENTS }, hp)}
        >
          <ShieldPlus aria-hidden />{busy ? "Waiting for wallet…" : "Review and sign in wallet"}
        </Button>
      </div>
    </Panel>
  );
}
