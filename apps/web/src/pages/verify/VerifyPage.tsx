import { PageHead, PublicShell } from "@/components/public/PublicShell";
import { ClaimCard } from "@/components/verify/ClaimCard";
import { SignatureChecks } from "@/components/verify/SignatureChecks";
import { VerifySummary } from "@/components/verify/VerifySummary";
import { GuardianCheck } from "@/components/verify/GuardianCheck";
import { REPO_URL } from "@/components/landing/content";
import { SourceLink } from "@/components/landing/primitives";
import { ENDPOINTS, host } from "@/lib/verify/rpc";
import { useVerify } from "@/lib/verify/useVerify";

export default function VerifyPage() {
  const { claims, checks, finishedAt, sigs, rerun } = useVerify();
  return (
    <PublicShell title="Verify · Stand-in">
      <PageHead eyebrow="Re-checked in your browser · public RPC" title="Check any guardian yourself." muted="Straight from the chain, no server of ours." dot="safe">
        <p>
          Name an account, yours or anyone's, and this page reads its guardian from public NEAR RPC: the code hash against the pinned build,
          owner, watcher, frozen state, agent and intents keys, and every freeze with its transactions. Below it, every claim the project makes is
          re-checked the same way: success or failure, the error text, the blocks between theft and freeze, and the contract state.
        </p>
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          <SourceLink href={`${REPO_URL}/blob/main/docs/claims.json`}>docs/claims.json</SourceLink>
          <SourceLink href={`${REPO_URL}/tree/main/apps/web/src/lib/verify`}>checker source</SourceLink>
        </p>
      </PageHead>

      <div className="mt-10">
        <GuardianCheck />
      </div>

      <h2 className="mt-14 text-[22px] leading-tight font-medium tracking-[-0.02em] text-fg">The project's own claims</h2>
      <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-fg-muted">The transactions behind every claim in the README, re-checked now. These are our recorded runs; the check above is for your own account.</p>
      <div className="mt-5">
        <VerifySummary checks={checks} finishedAt={finishedAt} onRerun={rerun} />
      </div>

      <section aria-label="Claims" className="mt-5 grid gap-5 md:grid-cols-2">
        {claims.map((c, i) => (
          <ClaimCard key={c.id} claim={c} check={checks[i]} />
        ))}
      </section>

      <p className="mt-5 font-mono text-[11px] leading-relaxed text-fg-faint">
        RPC order: {ENDPOINTS.testnet.map(host).join(" → ")} (testnet), {ENDPOINTS.mainnet.map(host).join(" → ")} (mainnet).
        A node that fails, rate-limits or lacks the tx is skipped for the next; the archival nodes hold the older blocks.
      </p>

      <SignatureChecks state={sigs} />
    </PublicShell>
  );
}
