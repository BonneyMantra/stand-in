import type { ReactNode } from "react";
import { CircleAlert, KeyRound, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExtLink, Panel, Tag } from "@/components/app/common";
import { cn } from "@/lib/utils";
import type { DeepLink, ApproveRequest } from "@/lib/wallet/deeplink";
import { explorerTx, yoctoToNear, type AccessKeyView, type GuardianLookup } from "@/lib/wallet/near";

export interface ApproveResult { hash: string; key: AccessKeyView | null }

export function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_1fr] items-baseline gap-3 py-1.5 text-xs sm:grid-cols-[120px_1fr]">
      <dt className="text-fg-faint">{k}</dt>
      <dd className="min-w-0 font-mono break-all text-fg">{children}</dd>
    </div>
  );
}

export function Decoded({ req }: { req: Pick<ApproveRequest, "account" | "agent_key" | "receiver" | "methods" | "allowance"> }) {
  return (
    <dl className="divide-y divide-line px-3.5 py-1" data-testid="approve-params">
      <Row k="account">{req.account}</Row>
      <Row k="agent key"><span data-testid="approve-key">{req.agent_key}</span></Row>
      <Row k="may call">{req.receiver}</Row>
      <Row k="methods">
        {req.methods.length ? req.methods.join(", ") : <span className="text-warn">any method on {req.receiver}</span>}
      </Row>
      <Row k="gas allowance">{yoctoToNear(req.allowance)} NEAR <span className="text-fg-faint">({req.allowance.toString()} yocto)</span></Row>
    </dl>
  );
}

/** The CLI's "approve agent key" request: decoded, checked, and signed only when the owner presses the button. */
export function ApprovePanel({ link, accountId, guardian, busy, result, onApprove }: {
  link: Exclude<DeepLink, { kind: "none" } | { kind: "adopt" }>; accountId: string | null; guardian: GuardianLookup | undefined;
  busy: boolean; result: ApproveResult | null; onApprove: (req: ApproveRequest, unfreezeFirst: boolean) => void;
}) {
  if (link.kind === "invalid") {
    return (
      <Panel title="Approval link refused" icon={ShieldAlert} id="approve-title" className="border-trip/30">
        <div className="space-y-2 p-3.5 text-xs" data-testid="deeplink-invalid">
          <p className="text-fg">This link cannot be signed. Nothing was sent, and nothing will be offered for signing from it.</p>
          <ul className="list-disc space-y-1 pl-4 text-trip">{link.problems.map((p) => <li key={p}>{p}</li>)}</ul>
          <p className="text-fg-faint">Run <code className="font-mono text-fg-muted">standin unfreeze</code> again for a fresh link.</p>
        </div>
      </Panel>
    );
  }
  const { req } = link;
  const g = guardian?.kind === "guardian" ? guardian.state : null;
  // Self-hosted guardian: owner == account. Factory guardian: get_state.owner is another account (e.g. a 0x one).
  const match = g ? accountId === g.owner : accountId === req.account;
  const steps = [...(g?.frozen ? ["unfreeze"] : []), "add_agent_key"];
  const already = g?.agent_keys.includes(req.agent_key);

  let gate: ReactNode = null;
  if (!accountId) gate = <>Connect the wallet that holds <span className="font-mono text-fg">{req.account}</span> to approve.</>;
  else if (!match) gate = <>Connected as <span className="font-mono text-fg">{accountId}</span>. This request is for <span className="font-mono text-fg">{req.account}</span>{g && g.owner !== req.account ? <>, owned by <span className="font-mono text-fg">{g.owner}</span></> : null}: disconnect and connect the owner's wallet.</>;
  else if (guardian && !g) gate = <>No guardian on <span className="font-mono text-fg">{req.account}</span>, so there is nothing to approve.</>;
  else if (already && !result) gate = <>This key is already registered on the guardian.</>;

  return (
    <Panel title="Approve agent key" icon={KeyRound} id="approve-title" meta="request from standin unfreeze" bodyClassName="p-0">
      <Decoded req={req} />
      <div className="space-y-3 border-t border-line p-3.5">
        {result ? (
          <div className="space-y-1.5 text-xs" data-testid="approve-result">
            <p className="flex items-center gap-2 text-fg"><Tag tone="safe">signed</Tag><ExtLink href={explorerTx(result.hash)}>{result.hash.slice(0, 12)}…</ExtLink></p>
            {result.key && typeof result.key.permission === "object" ? (
              <p className="text-fg-muted">
                Read back from chain after signing: function-call key for <span className="font-mono text-fg">{result.key.permission.FunctionCall.receiver_id}</span>,
                methods <span className="font-mono text-fg">{result.key.permission.FunctionCall.method_names.join(", ") || "any"}</span>,
                allowance <span className="font-mono text-fg">{result.key.permission.FunctionCall.allowance ? yoctoToNear(BigInt(result.key.permission.FunctionCall.allowance)) : "unlimited"} NEAR</span>.
              </p>
            ) : (
              <p className="text-warn">The transaction landed but the key is not visible on chain yet. Read the guardian again in a few seconds.</p>
            )}
          </div>
        ) : gate ? (
          <p className="flex items-start gap-2 text-xs text-fg-muted" data-testid="approve-gate"><CircleAlert className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden /><span>{gate}</span></p>
        ) : (
          <>
            <p className="text-xs text-fg-muted">
              One transaction from <span className="font-mono text-fg">{accountId}</span> to {accountId === req.account ? "itself" : <span className="font-mono text-fg">{req.account}</span>}:
              {steps.map((s, i) => <span key={s} className="ml-1.5 font-mono text-fg">{i + 1}. {s}</span>)}
            </p>
            <Button size="sm" variant="invert" disabled={busy || !g} onClick={() => onApprove(req, Boolean(g?.frozen))} className={cn("w-full sm:w-auto")}>
              <KeyRound aria-hidden />{busy ? "Waiting for wallet…" : "Review and sign in wallet"}
            </Button>
          </>
        )}
      </div>
    </Panel>
  );
}
