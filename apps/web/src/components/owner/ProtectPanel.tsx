import { ShieldAlert, ShieldPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/app/common";
import { DEFAULT_INTENTS, DEFAULT_WATCHER, type GuardianCode } from "@/lib/wallet/guardianCode";
import { isEthAccount, type GuardianLookup } from "@/lib/wallet/near";
import { DeployFacts } from "./DeployFacts";
import { useDeployPlan } from "./useDeployPlan";

export interface ProtectInit { watcher: string; intents_contract: string }

/**
 * "Protect this account": deploy the guardian from the connected wallet onto its own account, in one transaction
 * (DeployContract + new). Offered only for an account with no contract code.
 */
export function ProtectPanel({ accountId, lookup, busy, onDeploy }: {
  accountId: string; lookup: Exclude<GuardianLookup, { kind: "guardian" }>; busy: boolean;
  onDeploy: (code: GuardianCode, init: ProtectInit) => void;
}) {
  const eth = isEthAccount(accountId);
  const offer = lookup.kind === "no-contract" && !eth;
  const { plan, reload } = useDeployPlan(offer ? accountId : null);

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

  const ready = plan.status === "ready" && plan.quote.shortfall === 0n;
  return (
    <Panel title="Protect this account" icon={ShieldPlus} id="protect-title" meta="deploy the guardian from your wallet" bodyClassName="p-0">
      <p className="px-3.5 pt-3 text-xs leading-relaxed text-fg-muted">
        No contract runs on <span className="font-mono text-fg">{accountId}</span>. Deploy the Stand-in guardian on it, and a decoy key used by
        an agent freezes this account's agent keys. You stay the owner: only a transaction from this wallet can unfreeze.
      </p>
      <DeployFacts accountId={accountId} watcher={DEFAULT_WATCHER} intents={DEFAULT_INTENTS} plan={plan} onReload={() => void reload()} />
      <div className="space-y-3 border-t border-line p-3.5">
        <p className="text-xs text-fg-muted">
          One transaction from <span className="font-mono text-fg">{accountId}</span> to itself:
          <span className="ml-1.5 font-mono text-fg">1. DeployContract</span>
          <span className="ml-1.5 font-mono text-fg">2. new</span>
        </p>
        <p className="text-xs text-fg-muted" data-testid="protect-wallet-note">
          Meteor refuses contract deployment from any app (tested 15 Nov: "Meteor blocks this for apps"). With Meteor, use
          a guarded agent account below; it is one plain function call.
        </p>
        <Button
          size="sm" variant="invert" className="w-full sm:w-auto" data-testid="protect-sign"
          disabled={busy || !ready} onClick={() => plan.status === "ready" && onDeploy(plan.code, { watcher: DEFAULT_WATCHER, intents_contract: DEFAULT_INTENTS })}
        >
          <ShieldPlus aria-hidden />{busy ? "Waiting for wallet…" : "Review and sign in wallet"}
        </Button>
      </div>
    </Panel>
  );
}
