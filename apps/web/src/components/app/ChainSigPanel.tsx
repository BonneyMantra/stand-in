import type { ReactNode } from "react";
import { Link2 } from "lucide-react";
import type { StandinState } from "@/data/types";
import { fmtTime, txUrl } from "@/data/derive";
import { cn } from "@/lib/utils";
import { CopyText, EmptyState, ExtLink, Panel, Tag } from "./common";

const CHAINS: Record<number, { name: string; explorer: string }> = {
  11155111: { name: "Ethereum Sepolia", explorer: "https://sepolia.etherscan.io/address/" },
  84532: { name: "Base Sepolia", explorer: "https://sepolia.basescan.org/address/" },
};

function Step({ dot, title, children, aside }: { dot: "safe" | "trip" | "muted"; title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <li className="relative flex min-w-0 gap-3 px-3.5 py-2.5">
      <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", dot === "safe" ? "bg-safe" : dot === "trip" ? "bg-trip" : "bg-fg-faint")} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-fg">{title}</p>
          {aside}
        </div>
        <div className="mt-1 min-w-0 space-y-1 text-[11.5px] leading-relaxed text-fg-muted">{children}</div>
      </div>
    </li>
  );
}

/** Chain Signatures: the agent signs EVM transactions through the NEAR MPC network via the guardian; a freeze cuts it off. */
export function ChainSigPanel({ state }: { state: StandinState }) {
  const cs = state.chainsig;
  const frozen = state.agent.frozen;
  const chain = cs ? CHAINS[cs.chain_id] ?? { name: `chain ${cs.chain_id}`, explorer: "" } : null;
  return (
    <Panel
      title="Cross-chain signing" icon={Link2} id="chainsig-title" bodyClassName="p-0"
      meta="NEAR MPC"
      actions={cs ? (frozen ? <Tag tone="trip">cut off</Tag> : <Tag tone="safe">signing</Tag>) : null}
    >
      {!cs || !chain ? (
        <EmptyState icon={Link2} title="No cross-chain signature recorded yet">
          Run the Chain Signatures proof to derive the agent's EVM address and sign through the MPC network.
        </EmptyState>
      ) : (
        <>
          <ol className="divide-y divide-line">
            <Step dot="muted" title={`${chain.name} address`} aside={<span className="font-mono text-[10.5px] text-fg-faint">path {cs.path}</span>}>
              <div className="flex min-w-0 items-center gap-2">
                <CopyText value={cs.evm_address} display={`${cs.evm_address.slice(0, 10)}…${cs.evm_address.slice(-8)}`} />
                {chain.explorer && <ExtLink href={chain.explorer + cs.evm_address}>explorer</ExtLink>}
              </div>
              <p className="text-fg-faint">Derived from {state.agent.account_id} by the MPC network. No private key exists for it anywhere.</p>
            </Step>
            <Step dot={cs.last_sign.ok ? "safe" : "muted"} title="Agent key signs" aside={cs.last_sign.ok ? <Tag tone="safe">signed</Tag> : <Tag>not run</Tag>}>
              {cs.last_sign.tx_hash ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <ExtLink href={txUrl(cs.last_sign.tx_hash)}>{cs.last_sign.tx_hash.slice(0, 10)}…</ExtLink>
                  {cs.last_sign.at && <span className="font-mono text-fg-faint">{fmtTime(cs.last_sign.at)}</span>}
                </div>
              ) : <p className="text-fg-faint">No signature requested yet.</p>}
              <p className="text-fg-faint">guardian.sign_evm → v1.signer-prod.testnet. The signature recovers to the address above.</p>
            </Step>
            <Step dot={cs.blocked_after_freeze.tx_hash ? "trip" : "muted"} title="After a freeze" aside={cs.blocked_after_freeze.tx_hash ? <Tag tone="trip">refused</Tag> : <Tag>not run</Tag>}>
              {cs.blocked_after_freeze.tx_hash ? (
                <>
                  <ExtLink href={txUrl(cs.blocked_after_freeze.tx_hash)}>{cs.blocked_after_freeze.tx_hash.slice(0, 10)}…</ExtLink>
                  {cs.blocked_after_freeze.error && <p className="font-mono break-words text-trip/90">{cs.blocked_after_freeze.error.replace(/^\w+Error:\s*/, "")}</p>}
                </>
              ) : <p className="text-fg-faint">Not measured yet.</p>}
              <p className="text-fg-faint">The stolen agent key is deleted, so the chain rejects it before inclusion; even the owner cannot sign until unfreeze.</p>
            </Step>
          </ol>
          <p className="border-t border-line px-3.5 py-2.5 text-[11px] leading-relaxed text-fg-faint">
            One decoy tripping freezes the agent on NEAR and on every chain it signs for through the MPC network.
          </p>
        </>
      )}
    </Panel>
  );
}
