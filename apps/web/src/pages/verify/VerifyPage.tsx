import { PageHead, PublicShell } from "@/components/public/PublicShell";
import { ClaimCard } from "@/components/verify/ClaimCard";
import { SignatureChecks } from "@/components/verify/SignatureChecks";
import { VerifySummary } from "@/components/verify/VerifySummary";
import { REPO_URL } from "@/components/landing/content";
import { SourceLink } from "@/components/landing/primitives";
import { ENDPOINTS, host } from "@/lib/verify/rpc";
import { useVerify } from "@/lib/verify/useVerify";

export default function VerifyPage() {
  const { claims, checks, finishedAt, sigs, rerun } = useVerify();
  return (
    <PublicShell title="Verify · Stand-in">
      <PageHead eyebrow="Re-checked in your browser · public RPC" title="Check every claim yourself." muted="Straight from the chain, no server of ours." dot="safe">
        <p>
          Each claim below lists the transactions that prove it. This page asks public NEAR RPC nodes for every one, right now, and compares the
          result with what the claim says: success or failure, the error text, the blocks between theft and freeze, and the contract state.
        </p>
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          <SourceLink href={`${REPO_URL}/blob/main/docs/claims.json`}>docs/claims.json</SourceLink>
          <SourceLink href={`${REPO_URL}/tree/main/apps/web/src/lib/verify`}>checker source</SourceLink>
        </p>
      </PageHead>

      <div className="mt-10">
        <VerifySummary checks={checks} finishedAt={finishedAt} onRerun={rerun} />
      </div>

      <section aria-label="Claims" className="mt-5 grid gap-5 md:grid-cols-2">
        {claims.map((c, i) => (
          <ClaimCard key={c.id} claim={c} check={checks[i]} />
        ))}
      </section>

      <p className="mt-5 font-mono text-[11px] leading-relaxed text-fg-faint">
        RPC order, archival first: {ENDPOINTS.testnet.map(host).join(" → ")} (testnet), {ENDPOINTS.mainnet.map(host).join(" → ")} (mainnet).
        A node that fails, rate-limits or lacks the tx is skipped for the next.
      </p>

      <SignatureChecks state={sigs} />
    </PublicShell>
  );
}
