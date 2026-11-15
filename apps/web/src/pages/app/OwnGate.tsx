import type { ReactNode } from "react";
import { Link } from "react-router";
import { RefreshCw, ServerCrash, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/app/common";
import { useWallet } from "@/components/owner/WalletProvider";
import { useMyAccount } from "@/data/useMyAccount";

/** The own-account pages without a wallet, while reading, and when the read failed; the children once a snapshot exists. */
export function OwnGate({ children }: { children: ReactNode }) {
  const w = useWallet();
  const m = useMyAccount();
  const r = m.read;
  const box = (node: ReactNode) => <div className="rounded-[10px] border border-line bg-ink-900">{node}</div>;
  if (r.status === "no-wallet") {
    return box(
      <EmptyState icon={Wallet} title="Connect your wallet to see your own account">
        <p>This page reads your guardians and bait from testnet. Nothing is shown until you connect.</p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
          <Button variant="invert" size="sm" onClick={() => void w.connect()} disabled={w.status === "connecting"}><Wallet aria-hidden />Connect wallet</Button>
          <Link to="/app/example" className="text-xs text-fg-muted underline-offset-4 hover:text-fg hover:underline">See an example</Link>
        </div>
      </EmptyState>,
    );
  }
  if (r.status === "wrong-network") return box(<EmptyState icon={Wallet} title="Wrong network"><p>{r.owner} is a mainnet account; switch the wallet to testnet and connect again.</p></EmptyState>);
  if (!m.snapshot && r.status === "error") {
    return box(
      <EmptyState icon={ServerCrash} title="Could not read your account">
        <p>{r.error}</p>
        <Button variant="line" size="sm" onClick={() => void m.refresh()} className="mt-3"><RefreshCw aria-hidden />Try again</Button>
      </EmptyState>,
    );
  }
  if (!m.snapshot) return <div className="h-[320px] animate-pulse rounded-[10px] border border-line bg-ink-900" role="status" aria-label="Reading your account from testnet" />;
  return <>{children}</>;
}
