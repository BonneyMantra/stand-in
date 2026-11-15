import type { ReactNode } from "react";
import { Link } from "react-router";
import { CircleAlert, RefreshCw, ShieldAlert, ShieldPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExtLink, Panel, Tag } from "@/components/app/common";
import { parentOf, unfreezeLinkFor, type AdoptRequest, type DeepLink } from "@/lib/wallet/deeplink";
import { explorerTx, isEthAccount, yoctoToNear, type GuardianLookup } from "@/lib/wallet/near";
import type { GuardianCode } from "@/lib/wallet/guardianCode";
import { FACTORY } from "@/lib/wallet/factory";
import { fundingFor, homeAccountsOf, type HomeAccountReq } from "@/lib/wallet/homeAccounts";
import { Decoded, Row, type ApproveResult } from "./ApprovePanel";
import { DeployFacts } from "./DeployFacts";
import { HomeAccountsFacts } from "./HomeAccountsFacts";
import { useDeployPlan } from "./useDeployPlan";
import { useHomeAccounts } from "./useHomeAccounts";

type AdoptLink = Extract<DeepLink, { kind: "adopt" }> | Extract<DeepLink, { kind: "invalid" }>;
/** What one signing sends: the guardian part unless it already landed, and the home accounts still missing. */
export interface AdoptSend { req: AdoptRequest; code: GuardianCode | null; guardianDone: boolean; creates: HomeAccountReq[] }

const mono = (s: string) => <span className="font-mono text-fg">{s}</span>;

/**
 * `standin adopt --wallet` request: deploy the guardian if the account has no code, register the agent's scoped key, and
 * create the home's own bait and watcher accounts, all in one wallet request. Re-opening the link offers only what is missing.
 */
export function AdoptPanel({ link, accountId, guardian, busy, result, batch, homeKey, onAdopt, onSwitch }: {
  link: AdoptLink; accountId: string | null; guardian: GuardianLookup | undefined; busy: boolean; result: ApproveResult | null;
  batch: boolean; homeKey: number; onAdopt: (s: AdoptSend) => void; onSwitch: () => void;
}) {
  const req = link.kind === "adopt" ? link.req : null;
  // Accept the owner: get_state.owner on an existing guardian, or `account` itself when there is no contract yet.
  const existing = guardian?.kind === "guardian" ? guardian.state : null;
  const match = !!req && !!accountId && (existing ? accountId === existing.owner : accountId === req.account);
  const deploy = match && accountId === req?.account && guardian?.kind === "no-contract" && !isEthAccount(req.account);
  const { plan, reload } = useDeployPlan(deploy ? req.account : null);
  const { read: home, reload: reloadHome } = useHomeAccounts(match ? req : null, accountId, homeKey);

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
  const wanted = homeAccountsOf(req);
  const states = home.status === "ready" ? home.accounts : [];
  const creates = states.filter((a) => a.status === "missing");
  const conflict = states.find((a) => a.status === "conflict");
  const guardianDone = !!g?.agent_keys.includes(req.agent_key);
  const allDone = guardianDone && (wanted.length === 0 || (home.status === "ready" && creates.length === 0 && !conflict));
  const parent = wanted.length ? parentOf(wanted[0]!.accountId) : null;

  let gate: ReactNode = null;
  let action: ReactNode = null;
  const switchBtn = <Button variant="line" size="sm" onClick={onSwitch} data-testid="adopt-switch"><RefreshCw aria-hidden />Switch account</Button>;
  if (!accountId) gate = <>Connect the wallet that holds {mono(parent ?? req.account)} to approve.</>;
  else if (!match) {
    gate = <>Connected as {mono(accountId)}. This request is for {mono(req.account)}{existing && existing.owner !== req.account ? <>, owned by {mono(existing.owner)}</> : null}: only the owner's wallet can sign it.</>;
    action = switchBtn;
  } else if (isEthAccount(req.account) && !existing) {
    gate = <>{mono(req.account)} is an Ethereum Wallets account: it runs NEAR's Ethereum wallet contract, and deploying the guardian would overwrite it. Refused.</>;
  } else if (!guardian) gate = <>Reading {mono(req.account)} from testnet…</>;
  else if (guardian.kind === "missing-account") gate = <>{mono(req.account)} does not exist on testnet.</>;
  else if (guardian.kind === "not-guardian") gate = <>{mono(req.account)} already runs a contract that is not a Stand-in guardian. Deploying would replace it, so this link is refused.</>;
  else if (g && g.watcher !== req.watcher) {
    gate = <>This guardian's watcher is {mono(g.watcher)}; the link asks for {mono(req.watcher)}. The guardian cannot change its watcher, so nothing is sent: protect a fresh account, or create a guarded agent account here and adopt that one.</>;
  } else if (g?.frozen) {
    gate = <>This guardian is frozen. Unfreeze first: the approve route unfreezes and adds the same key in one transaction.</>;
    action = <Button variant="line" size="sm" asChild><Link to={unfreezeLinkFor(req)} data-testid="adopt-unfreeze-route">Open the unfreeze route</Link></Button>;
  } else if (parent && parent !== accountId && creates.length) {
    gate = <>This link creates {creates.map((a) => a.accountId).join(" and ")}: only {mono(parent)} can create its own sub-accounts. Connect that wallet.</>;
    action = switchBtn;
  } else if (conflict) {
    gate = <>{mono(conflict.accountId)} already exists, but not with the key your CLI generated, so the CLI could not use it. Nothing is sent. Run <code className="font-mono">standin adopt --wallet</code> again with the --home that created it.</>;
  } else if (allDone && !result) gate = <>Everything in this link is already on chain: the agent key is registered{wanted.length ? <> and {wanted.map((a) => a.accountId).join(" and ")} exist with your CLI's keys</> : null}.</>;

  const guardianSteps = guardianDone ? [] : deploy ? ["DeployContract", "new", "add_agent_key"] : ["add_agent_key"];
  const txCount = (guardianDone ? 0 : 1) + creates.length;
  const deployRequired = deploy && plan.status === "ready" ? plan.quote.required : null;
  const short = home.status === "ready" && home.signer ? fundingFor(home.signer, creates.length, deployRequired).shortfall > 0n : false;
  const guardianReady = guardianDone || (deploy ? plan.status === "ready" && plan.quote.shortfall === 0n : !!g);
  const ready = guardianReady && (wanted.length === 0 || home.status === "ready") && !short && txCount > 0;

  return (
    <Panel title={guardian?.kind === "no-contract" ? "Protect and add agent key" : "Add agent key"} icon={ShieldPlus} id="adopt-title" meta="request from standin adopt" bodyClassName="p-0">
      <Decoded req={req} />
      <dl className="divide-y divide-line border-t border-line px-3.5 py-1">
        <Row k="watcher">{req.watcher}</Row>
        <Row k="intents">{req.intents}</Row>
      </dl>
      {deploy && !result && !guardianDone && (
        <div className="border-t border-line">
          <DeployFacts accountId={req.account} watcher={req.watcher} intents={req.intents} plan={plan} onReload={() => void reload()} watcherInRequest={!!req.watch_key} />
        </div>
      )}
      {wanted.length > 0 && match && accountId && (
        <div className="border-t border-line">
          <HomeAccountsFacts signerId={accountId} read={home} deployRequired={guardianDone ? null : deployRequired} txCount={txCount} batch={batch} onReload={() => void reloadHome()} />
        </div>
      )}
      <div className="space-y-3 border-t border-line p-3.5">
        {result ? <Result result={result} /> : null}
        {gate ? (
          <div className="space-y-2.5">
            <p className="flex items-start gap-2 text-xs text-fg-muted" data-testid="adopt-gate"><CircleAlert className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden /><span>{gate}</span></p>
            {action}
          </div>
        ) : txCount > 0 && !(result && allDone) ? (
          <>
            <ol className="space-y-1 text-xs text-fg-muted" data-testid="adopt-steps">
              {guardianSteps.length > 0 && <li>Transaction to {accountId === req.account ? "your account" : mono(req.account)}: {guardianSteps.map((s, i) => <span key={s} className="ml-1.5 font-mono text-fg">{i + 1}. {s}</span>)}</li>}
              {creates.map((a) => <li key={a.accountId}>Transaction creating {mono(a.accountId)}: <span className="font-mono text-fg">CreateAccount, Transfer 0.2 NEAR, AddKey</span></li>)}
            </ol>
            {guardianDone && creates.length > 0 && <p className="text-[11px] text-fg-faint" data-testid="adopt-partial">The agent key already landed; only the missing accounts are offered.</p>}
            {deploy && !guardianDone && (
              <p className="text-[11px] leading-relaxed text-fg-faint" data-testid="adopt-meteor-note">
                Meteor refuses contract deployment from apps. With Meteor, create a guarded agent account on{" "}
                <Link to="/app/owner" className="text-fg-muted underline underline-offset-4">/app/owner</Link>, then run{" "}
                <code className="font-mono text-fg-muted [overflow-wrap:anywhere]">standin adopt --wallet --account &lt;name&gt;.{FACTORY} --owner {req.account} --home DIR</code>;
                its link only adds the agent key and your accounts.
              </p>
            )}
            <Button size="sm" variant="invert" disabled={busy || !ready} className="w-full sm:w-auto" data-testid="adopt-sign"
              onClick={() => onAdopt({ req, code: deploy && !guardianDone && plan.status === "ready" ? plan.code : null, guardianDone, creates })}>
              <ShieldPlus aria-hidden />{busy ? "Waiting for wallet…" : txCount > 1 ? `Review and sign ${txCount} transactions` : "Review and sign in wallet"}
            </Button>
          </>
        ) : null}
      </div>
    </Panel>
  );
}

function Result({ result }: { result: ApproveResult }) {
  const fc = result.key && typeof result.key.permission === "object" ? result.key.permission.FunctionCall : null;
  return (
    <div className="space-y-1.5 text-xs" data-testid="adopt-result">
      <p className="flex items-center gap-2 text-fg"><Tag tone="safe">signed</Tag>{result.hash ? <ExtLink href={explorerTx(result.hash)}>{result.hash.slice(0, 12)}…</ExtLink> : <span className="text-fg-muted">confirmed on chain</span>}</p>
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
