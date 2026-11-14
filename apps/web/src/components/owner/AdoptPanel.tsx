import type { ReactNode } from "react";
import { Link } from "react-router";
import { CircleAlert, RefreshCw, ShieldAlert, ShieldPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExtLink, Panel, Tag } from "@/components/app/common";
import { unfreezeLinkFor, type AdoptRequest, type DeepLink } from "@/lib/wallet/deeplink";
import { explorerTx, isEthAccount, yoctoToNear, type GuardianLookup } from "@/lib/wallet/near";
import type { GuardianCode } from "@/lib/wallet/guardianCode";
import { Decoded, Row, type ApproveResult } from "./ApprovePanel";
import { DeployFacts } from "./DeployFacts";
import { useDeployPlan } from "./useDeployPlan";

type AdoptLink = Extract<DeepLink, { kind: "adopt" }> | Extract<DeepLink, { kind: "invalid" }>;

const mono = (s: string) => <span className="font-mono text-fg">{s}</span>;

/** `standin adopt --wallet` request: deploy the guardian if the account has no code, then register the agent's scoped key. */
export function AdoptPanel({ link, accountId, guardian, busy, result, onAdopt, onSwitch }: {
  link: AdoptLink; accountId: string | null; guardian: GuardianLookup | undefined; busy: boolean; result: ApproveResult | null;
  onAdopt: (req: AdoptRequest, code: GuardianCode | null) => void; onSwitch: () => void;
}) {
  const req = link.kind === "adopt" ? link.req : null;
  // Accept the owner: get_state.owner on an existing guardian, or `account` itself when there is no contract yet.
  const existing = guardian?.kind === "guardian" ? guardian.state : null;
  const match = !!req && !!accountId && (existing ? accountId === existing.owner : accountId === req.account);
  const deploy = match && accountId === req?.account && guardian?.kind === "no-contract" && !isEthAccount(req.account);
  const { plan, reload } = useDeployPlan(deploy ? req.account : null);

  if (!req) {
    return (
      <Panel title="Adopt link refused" icon={ShieldAlert} id="adopt-title" className="border-trip/30">
        <div className="space-y-2 p-3.5 text-xs" data-testid="deeplink-invalid">
          <p className="text-fg">This link cannot be signed. Nothing was sent, and nothing will be offered for signing from it.</p>
          <ul className="list-disc space-y-1 pl-4 text-trip">{link.kind === "invalid" && link.problems.map((p) => <li key={p}>{p}</li>)}</ul>
          <p className="text-fg-faint">Run <code className="font-mono text-fg-muted">standin adopt --wallet</code> again for a fresh link.</p>
        </div>
      </Panel>
    );
  }

  const g = match && guardian?.kind === "guardian" ? guardian.state : null;
  let gate: ReactNode = null;
  let action: ReactNode = null;
  if (!accountId) gate = <>Connect the wallet that holds {mono(req.account)} to approve.</>;
  else if (!match) {
    gate = <>Connected as {mono(accountId)}. This request is for {mono(req.account)}{existing && existing.owner !== req.account ? <>, owned by {mono(existing.owner)}</> : null}: only the owner's wallet can sign it.</>;
    action = <Button variant="line" size="sm" onClick={onSwitch} data-testid="adopt-switch"><RefreshCw aria-hidden />Switch account</Button>;
  } else if (isEthAccount(req.account) && !existing) {
    gate = <>{mono(req.account)} is an Ethereum Wallets account: it runs NEAR's Ethereum wallet contract, and deploying the guardian would overwrite it. Refused.</>;
  } else if (!guardian) gate = <>Reading {mono(req.account)} from testnet…</>;
  else if (guardian.kind === "missing-account") gate = <>{mono(req.account)} does not exist on testnet.</>;
  else if (guardian.kind === "not-guardian") gate = <>{mono(req.account)} already runs a contract that is not a Stand-in guardian. Deploying would replace it, so this link is refused.</>;
  else if (g && g.watcher !== req.watcher) {
    gate = <>This guardian's watcher is {mono(g.watcher)}; the link asks for {mono(req.watcher)}. The key is not added: re-run the CLI with the guardian's watcher, or check who issued this link.</>;
  } else if (g?.frozen) {
    gate = <>This guardian is frozen. Unfreeze first: the approve route unfreezes and adds the same key in one transaction.</>;
    action = <Button variant="line" size="sm" asChild><Link to={unfreezeLinkFor(req)} data-testid="adopt-unfreeze-route">Open the unfreeze route</Link></Button>;
  } else if (g?.agent_keys.includes(req.agent_key) && !result) gate = <>This key is already registered on the guardian.</>;

  const steps = deploy ? ["DeployContract", "new", "add_agent_key"] : ["add_agent_key"];
  const ready = deploy ? plan.status === "ready" && plan.quote.shortfall === 0n : !!g;

  return (
    <Panel title={guardian?.kind === "no-contract" ? "Protect and add agent key" : "Add agent key"} icon={ShieldPlus} id="adopt-title" meta="request from standin adopt" bodyClassName="p-0">
      <Decoded req={req} />
      <dl className="divide-y divide-line border-t border-line px-3.5 py-1">
        <Row k="watcher">{req.watcher}</Row>
        <Row k="intents">{req.intents}</Row>
      </dl>
      {deploy && !result && (
        <div className="border-t border-line">
          <DeployFacts accountId={req.account} watcher={req.watcher} intents={req.intents} plan={plan} onReload={() => void reload()} />
        </div>
      )}
      <div className="space-y-3 border-t border-line p-3.5">
        {result ? (
          <Result result={result} />
        ) : gate ? (
          <div className="space-y-2.5">
            <p className="flex items-start gap-2 text-xs text-fg-muted" data-testid="adopt-gate"><CircleAlert className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden /><span>{gate}</span></p>
            {action}
          </div>
        ) : (
          <>
            <p className="text-xs text-fg-muted">
              One transaction from {mono(accountId ?? req.account)} to {accountId === req.account ? "itself" : mono(req.account)}:
              {steps.map((s, i) => <span key={s} className="ml-1.5 font-mono text-fg">{i + 1}. {s}</span>)}
            </p>
            <Button size="sm" variant="invert" disabled={busy || !ready} className="w-full sm:w-auto" data-testid="adopt-sign"
              onClick={() => onAdopt(req, deploy && plan.status === "ready" ? plan.code : null)}>
              <ShieldPlus aria-hidden />{busy ? "Waiting for wallet…" : "Review and sign in wallet"}
            </Button>
          </>
        )}
      </div>
    </Panel>
  );
}

function Result({ result }: { result: ApproveResult }) {
  const fc = result.key && typeof result.key.permission === "object" ? result.key.permission.FunctionCall : null;
  return (
    <div className="space-y-1.5 text-xs" data-testid="adopt-result">
      <p className="flex items-center gap-2 text-fg"><Tag tone="safe">signed</Tag><ExtLink href={explorerTx(result.hash)}>{result.hash.slice(0, 12)}…</ExtLink></p>
      {fc ? (
        <p className="text-fg-muted">
          Read back from chain after signing: function-call key for {mono(fc.receiver_id)}, methods {mono(fc.method_names.join(", ") || "any")},
          allowance {mono(`${fc.allowance ? yoctoToNear(BigInt(fc.allowance)) : "unlimited"} NEAR`)}.
        </p>
      ) : (
        <p className="text-warn">The transaction landed but the key is not visible on chain yet. Read the guardian again in a few seconds.</p>
      )}
    </div>
  );
}
